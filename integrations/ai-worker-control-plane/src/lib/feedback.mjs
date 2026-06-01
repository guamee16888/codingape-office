import { createId } from "./ids.mjs";
import { migrate, nowIso, openDatabase, toJson } from "./db.mjs";
import { validateFeedbackPayload } from "./validation.mjs";
import { createPolicyRuleDraftFromApprovedSuggestion } from "./policy-rules.mjs";
import { createPromptVersionFromApprovedSuggestion } from "./prompt-versions.mjs";
import { upsertLearningRuleFromSuggestionFeedback } from "./learning-rules.mjs";

function suggestionStatusForFeedback(feedbackType) {
  if (feedbackType === "approve" || feedbackType === "approved") return "approved";
  if (feedbackType === "reject" || feedbackType === "rejected") return "rejected";
  if (feedbackType === "useful") return "useful";
  if (feedbackType === "not_useful") return "not_useful";
  if (feedbackType === "wrong") return "wrong";
  return null;
}

export function storeFeedback(payload, options = {}) {
  const normalized = validateFeedbackPayload(payload);
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(normalized.project_id);
    if (!project) {
      throw new Error(`Project not found: ${normalized.project_id}`);
    }

    const feedbackId = createId("feedback");
    const createdAt = options.createdAt || nowIso();
    let transactionOpen = false;

    try {
      db.exec("BEGIN");
      transactionOpen = true;

      const suggestion = normalized.target_type === "suggestion"
        ? db.prepare(
          `SELECT id, type, status
           FROM optimization_suggestions
           WHERE id = ? AND project_id = ?`
        ).get(normalized.target_id, normalized.project_id)
        : null;

      if (normalized.target_type === "suggestion" && !suggestion) {
        throw new Error(`Suggestion not found: ${normalized.target_id}`);
      }

      db.prepare(
        `INSERT INTO user_feedback (
          id, org_id, project_id, target_type, target_id, feedback_type, comment, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        feedbackId,
        project.org_id,
        normalized.project_id,
        normalized.target_type,
        normalized.target_id,
        normalized.feedback_type,
        normalized.comment,
        createdAt
      );

      const result = { feedback_id: feedbackId };
      const approved = normalized.feedback_type === "approve" || normalized.feedback_type === "approved";

      if (suggestion) {
        if (approved) {
          const promptVersion = createPromptVersionFromApprovedSuggestion(db, {
            projectId: normalized.project_id,
            suggestionId: normalized.target_id,
            createdAt,
          });

          if (promptVersion) {
            result.prompt_version_id = promptVersion.prompt_version_id;
          }

          const policyRule = createPolicyRuleDraftFromApprovedSuggestion(db, {
            projectId: normalized.project_id,
            suggestionId: normalized.target_id,
            createdAt,
          });

          if (policyRule) {
            result.policy_rule_id = policyRule.policy_rule_id;
          }
        }

        const suggestionStatus = suggestionStatusForFeedback(normalized.feedback_type);
        if (suggestionStatus) {
          db.prepare("UPDATE optimization_suggestions SET status = ? WHERE id = ?").run(suggestionStatus, normalized.target_id);
          result.suggestion_status = suggestionStatus;

          const learningRule = upsertLearningRuleFromSuggestionFeedback(db, {
            projectId: normalized.project_id,
            suggestionId: normalized.target_id,
            feedbackType: normalized.feedback_type,
            createdAt,
          });

          if (learningRule) {
            result.learning_rule_id = learningRule.learning_rule_id;
            result.learning_rule_type = learningRule.rule_type;
            result.learning_rule_confidence = learningRule.confidence;
          }

          db.prepare(
            `INSERT INTO audit_events (
              id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            createId("audit"),
            project.org_id,
            normalized.project_id,
            "user",
            null,
            "optimization_suggestion.feedback_status_updated",
            "optimization_suggestion",
            normalized.target_id,
            toJson({ feedback_id: feedbackId, feedback_type: normalized.feedback_type, status: suggestionStatus }),
            createdAt
          );
        }
      }

      db.exec("COMMIT");
      transactionOpen = false;

      return result;
    } catch (error) {
      if (transactionOpen) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
