import { createId } from "./ids.mjs";
import { fromJson, migrate, openDatabase, toJson } from "./db.mjs";

const TRUST_FEEDBACK = new Set(["approve", "approved", "useful"]);
const SUPPRESS_FEEDBACK = new Set(["reject", "rejected", "not_useful", "wrong"]);

function canonicalText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 10)
    .join("_") || "untitled";
}

export function ruleTypeForFeedback(feedbackType) {
  if (TRUST_FEEDBACK.has(feedbackType)) {
    return "trust_suggestion_pattern";
  }

  if (SUPPRESS_FEEDBACK.has(feedbackType)) {
    return "suppress_suggestion_pattern";
  }

  return null;
}

export function suggestionPatternKey(suggestion) {
  return `suggestion:${suggestion.type || "unknown"}:${canonicalText(suggestion.title)}`;
}

function feedbackSetForRuleType(ruleType) {
  return ruleType === "trust_suggestion_pattern"
    ? Array.from(TRUST_FEEDBACK)
    : Array.from(SUPPRESS_FEEDBACK);
}

function confidenceFor(ruleType, feedbackType, count) {
  const base = ruleType === "suppress_suggestion_pattern" && feedbackType === "wrong"
    ? 0.8
    : ruleType === "suppress_suggestion_pattern"
      ? 0.7
      : 0.62;

  return Number(Math.min(0.95, base + Math.max(0, count - 1) * 0.08).toFixed(2));
}

function parseLearningRuleRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    confidence: Number(row.confidence || 0),
    source_feedback_count: Number(row.source_feedback_count || 0),
    pattern_json: fromJson(row.pattern_json, {}),
    evidence_json: fromJson(row.evidence_json, {}),
  };
}

function parseLearningRuleEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: fromJson(row.evidence_json, {}),
  };
}

const LEARNING_RULE_STATUS_TRANSITIONS = {
  active: new Set(["paused", "trusted", "rejected"]),
  paused: new Set(["active", "rejected"]),
  trusted: new Set(["paused", "rejected"]),
  rejected: new Set(["active"]),
};

function assertValidLearningRuleTransition(fromStatus, toStatus) {
  if (!LEARNING_RULE_STATUS_TRANSITIONS[fromStatus]?.has(toStatus)) {
    throw new Error(`Invalid learning rule transition: ${fromStatus} -> ${toStatus}`);
  }
}

function confidenceForEffectiveness(effectivenessStatus, count) {
  const base = {
    blocker_cleared: 0.74,
    score_improved_blocker_persisted: 0.66,
    readiness_improved_blocker_persisted: 0.66,
    evidence_not_credible: 0.72,
    strong_evidence_no_metric_improvement: 0.68,
    regressed_after_action: 0.82,
    readiness_regressed_after_action: 0.82,
    dismissed_without_action: 0.64,
    no_measurable_improvement: 0.6,
  }[effectivenessStatus] || 0.58;
  return Number(Math.min(0.96, base + Math.max(0, count - 1) * 0.06).toFixed(2));
}

function ruleTypeForEffectivenessStatus(effectivenessStatus) {
  if (effectivenessStatus === "blocker_cleared") return "boost_certification_action_pattern";
  if (effectivenessStatus === "score_improved_blocker_persisted") return "monitor_certification_action_pattern";
  if (effectivenessStatus === "evidence_not_credible") return "require_stronger_certification_evidence";
  if (effectivenessStatus === "strong_evidence_no_metric_improvement") return "flag_certification_action_no_metric_lift";
  if (effectivenessStatus === "regressed_after_action") return "suppress_certification_action_pattern";
  if (effectivenessStatus === "no_measurable_improvement") return "monitor_certification_action_pattern";
  return null;
}

function ruleTypeForPolicyWorkItemEffectivenessStatus(effectivenessStatus) {
  if (effectivenessStatus === "blocker_cleared") return "boost_policy_work_item_pattern";
  if (effectivenessStatus === "readiness_improved_blocker_persisted") return "monitor_policy_work_item_pattern";
  if (effectivenessStatus === "no_measurable_improvement") return "deprioritize_policy_work_item_pattern";
  if (effectivenessStatus === "dismissed_without_action") return "deprioritize_policy_work_item_pattern";
  if (effectivenessStatus === "readiness_regressed_after_action") return "suppress_policy_work_item_pattern";
  return null;
}

function certificationEffectivenessPatternKey(effectiveness) {
  return [
    "certification_action",
    effectiveness.blocker_code || "unknown_blocker",
    effectiveness.recommended_action || "unknown_action",
    effectiveness.evidence_quality_level || "none",
  ].map(canonicalText).join(":");
}

function policyWorkItemEffectivenessPatternKey(effectiveness) {
  return [
    "policy_work_item",
    effectiveness.blocker_code || "ready_decision",
    effectiveness.action_type || "unknown_action",
    effectiveness.event_type || "unknown_event",
  ].map(canonicalText).join(":");
}

function countMatchingFeedback(db, { projectId, suggestion, ruleType }) {
  const feedbackTypes = feedbackSetForRuleType(ruleType);
  const placeholders = feedbackTypes.map(() => "?").join(", ");
  const row = db.prepare(
    `SELECT COUNT(*) AS count
     FROM user_feedback f
     JOIN optimization_suggestions s ON s.id = f.target_id
     WHERE f.project_id = ?
       AND f.target_type = 'suggestion'
       AND s.type = ?
       AND lower(s.title) = lower(?)
       AND f.feedback_type IN (${placeholders})`
  ).get(projectId, suggestion.type, suggestion.title, ...feedbackTypes);

  return Number(row?.count || 0);
}

export function upsertLearningRuleFromSuggestionFeedback(db, {
  projectId,
  suggestionId,
  feedbackType,
  actorId = null,
  createdAt,
  writeAudit = true,
}) {
  const ruleType = ruleTypeForFeedback(feedbackType);
  if (!ruleType) {
    return null;
  }

  const suggestion = db.prepare(
    `SELECT id, project_id, agent_id, type, severity, title, description, expected_impact, status
     FROM optimization_suggestions
     WHERE id = ? AND project_id = ?`
  ).get(suggestionId, projectId);

  if (!suggestion) {
    return null;
  }

  const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const patternKey = suggestionPatternKey(suggestion);
  const sourceFeedbackCount = countMatchingFeedback(db, { projectId, suggestion, ruleType });
  const confidence = confidenceFor(ruleType, feedbackType, sourceFeedbackCount);
  const pattern = {
    target: "optimization_suggestion",
    suggestion_type: suggestion.type,
    title: suggestion.title,
    normalized_title: canonicalText(suggestion.title),
  };
  const evidence = {
    source_suggestion_id: suggestion.id,
    source_agent_id: suggestion.agent_id,
    source_severity: suggestion.severity,
    feedback_type: feedbackType,
    source_feedback_count: sourceFeedbackCount,
    expected_impact: suggestion.expected_impact || null,
  };
  const existing = db.prepare(
    `SELECT id
     FROM learning_rules
     WHERE project_id = ? AND rule_type = ? AND pattern_key = ?`
  ).get(projectId, ruleType, patternKey);

  const learningRuleId = existing?.id || createId("learnrule");

  if (existing) {
    db.prepare(
      `UPDATE learning_rules
       SET pattern_json = ?,
           confidence = ?,
           source_feedback_count = ?,
           evidence_json = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(toJson(pattern), confidence, sourceFeedbackCount, toJson(evidence), createdAt, learningRuleId);
  } else {
    db.prepare(
      `INSERT INTO learning_rules (
        id, project_id, rule_type, pattern_key, pattern_json, confidence,
        source_feedback_count, evidence_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      learningRuleId,
      projectId,
      ruleType,
      patternKey,
      toJson(pattern),
      confidence,
      sourceFeedbackCount,
      toJson(evidence),
      "active",
      createdAt,
      createdAt
    );
  }

  if (writeAudit) {
    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      project.org_id,
      projectId,
      "user",
      actorId,
      "learning_rule.upserted_from_feedback",
      "learning_rule",
      learningRuleId,
      toJson({
        suggestion_id: suggestionId,
        feedback_type: feedbackType,
        rule_type: ruleType,
        pattern_key: patternKey,
        confidence,
        source_feedback_count: sourceFeedbackCount,
      }),
      createdAt
    );
  }

  return { learning_rule_id: learningRuleId, rule_type: ruleType, confidence };
}

export function rebuildLearningRulesFromFeedback(db, { projectId, createdAt }) {
  const rows = db.prepare(
    `SELECT target_id, feedback_type, created_at
     FROM user_feedback
     WHERE project_id = ?
       AND target_type = 'suggestion'
     ORDER BY created_at ASC`
  ).all(projectId);
  const results = [];

  for (const row of rows) {
    const result = upsertLearningRuleFromSuggestionFeedback(db, {
      projectId,
      suggestionId: row.target_id,
      feedbackType: row.feedback_type,
      createdAt: row.created_at || createdAt,
      writeAudit: false,
    });

    if (result) {
      results.push(result);
    }
  }

  return results;
}

export function rebuildLearningRulesFromCertificationEffectiveness(db, { projectId, createdAt }) {
  const rows = db.prepare(
    `SELECT *
     FROM certification_action_effectiveness
     WHERE project_id = ?
     ORDER BY created_at ASC`
  ).all(projectId).map((row) => ({
    ...row,
    blocker_persisted: Boolean(row.blocker_persisted),
    effectiveness: fromJson(row.effectiveness_json, {}),
  }));
  const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(projectId);
  const grouped = new Map();
  for (const row of rows) {
    const ruleType = ruleTypeForEffectivenessStatus(row.effectiveness_status);
    if (!ruleType) continue;
    const pattern = {
      target: "certification_action_effectiveness",
      blocker_code: row.blocker_code,
      recommended_action: row.recommended_action,
      evidence_quality_level: row.evidence_quality_level,
    };
    const patternKey = certificationEffectivenessPatternKey(row);
    const key = `${ruleType}:${patternKey}`;
    const current = grouped.get(key) || {
      ruleType,
      patternKey,
      pattern,
      rows: [],
    };
    current.rows.push(row);
    grouped.set(key, current);
  }

  const results = [];
  for (const group of grouped.values()) {
    const latest = group.rows[group.rows.length - 1];
    const count = group.rows.length;
    const confidence = confidenceForEffectiveness(latest.effectiveness_status, count);
    const evidence = {
      source: "certification_action_effectiveness",
      source_effectiveness_count: count,
      latest_effectiveness_id: latest.id,
      latest_effectiveness_status: latest.effectiveness_status,
      latest_certification_action_id: latest.certification_action_id,
      latest_score_delta: latest.score_delta,
      blocker_persisted: latest.blocker_persisted,
      evidence_quality_score: latest.evidence_quality_score,
      evidence_quality_level: latest.evidence_quality_level,
      safety_boundary: "advisory_only_no_automatic_execution",
    };
    const existing = db.prepare(
      `SELECT id
       FROM learning_rules
       WHERE project_id = ? AND rule_type = ? AND pattern_key = ?`
    ).get(projectId, group.ruleType, group.patternKey);
    const learningRuleId = existing?.id || createId("learnrule");
    if (existing) {
      db.prepare(
        `UPDATE learning_rules
         SET pattern_json = ?,
             confidence = ?,
             source_feedback_count = ?,
             evidence_json = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(toJson(group.pattern), confidence, count, toJson(evidence), createdAt, learningRuleId);
    } else {
      db.prepare(
        `INSERT INTO learning_rules (
          id, project_id, rule_type, pattern_key, pattern_json, confidence,
          source_feedback_count, evidence_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        learningRuleId,
        projectId,
        group.ruleType,
        group.patternKey,
        toJson(group.pattern),
        confidence,
        count,
        toJson(evidence),
        "active",
        createdAt,
        createdAt
      );
    }
    if (project) {
      db.prepare(
        `INSERT INTO audit_events (
          id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        createId("audit"),
        project.org_id,
        projectId,
        "system",
        null,
        "learning_rule.upserted_from_certification_effectiveness",
        "learning_rule",
        learningRuleId,
        toJson({
          rule_type: group.ruleType,
          pattern_key: group.patternKey,
          confidence,
          source_effectiveness_count: count,
        }),
        createdAt
      );
    }
    results.push({ learning_rule_id: learningRuleId, rule_type: group.ruleType, confidence });
  }

  return results;
}

export function rebuildLearningRulesFromPolicyWorkItemEffectiveness(db, { projectId, createdAt }) {
  const rows = db.prepare(
    `SELECT *
     FROM policy_review_work_item_effectiveness
     WHERE project_id = ?
     ORDER BY created_at ASC`
  ).all(projectId).map((row) => ({
    ...row,
    blocker_cleared: Boolean(row.blocker_cleared),
    effectiveness: fromJson(row.effectiveness_json, {}),
  }));
  const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(projectId);
  const grouped = new Map();

  for (const row of rows) {
    const ruleType = ruleTypeForPolicyWorkItemEffectivenessStatus(row.effectiveness_status);
    if (!ruleType) continue;
    const blockerCode = row.effectiveness?.blocker_code || null;
    const pattern = {
      target: "policy_review_work_item_effectiveness",
      blocker_code: blockerCode,
      action_type: row.action_type,
      event_type: row.event_type,
    };
    const patternKey = policyWorkItemEffectivenessPatternKey({
      blocker_code: blockerCode,
      action_type: row.action_type,
      event_type: row.event_type,
    });
    const key = `${ruleType}:${patternKey}`;
    const current = grouped.get(key) || {
      ruleType,
      patternKey,
      pattern,
      rows: [],
    };
    current.rows.push(row);
    grouped.set(key, current);
  }

  const results = [];
  for (const group of grouped.values()) {
    const latest = group.rows[group.rows.length - 1];
    const count = group.rows.length;
    const confidence = confidenceForEffectiveness(latest.effectiveness_status, count);
    const evidence = {
      source: "policy_review_work_item_effectiveness",
      source_effectiveness_count: count,
      latest_effectiveness_id: latest.id,
      latest_effectiveness_status: latest.effectiveness_status,
      latest_policy_rule_id: latest.policy_rule_id,
      latest_work_item_id: latest.work_item_id,
      latest_action_type: latest.action_type,
      latest_event_type: latest.event_type,
      latest_readiness_score_delta: latest.readiness_score_delta,
      blocker_cleared: Boolean(latest.blocker_cleared),
      safety_boundary: "advisory_only_no_automatic_execution",
    };
    const existing = db.prepare(
      `SELECT id
       FROM learning_rules
       WHERE project_id = ? AND rule_type = ? AND pattern_key = ?`
    ).get(projectId, group.ruleType, group.patternKey);
    const learningRuleId = existing?.id || createId("learnrule");

    if (existing) {
      db.prepare(
        `UPDATE learning_rules
         SET pattern_json = ?,
             confidence = ?,
             source_feedback_count = ?,
             evidence_json = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(toJson(group.pattern), confidence, count, toJson(evidence), createdAt, learningRuleId);
    } else {
      db.prepare(
        `INSERT INTO learning_rules (
          id, project_id, rule_type, pattern_key, pattern_json, confidence,
          source_feedback_count, evidence_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        learningRuleId,
        projectId,
        group.ruleType,
        group.patternKey,
        toJson(group.pattern),
        confidence,
        count,
        toJson(evidence),
        "active",
        createdAt,
        createdAt
      );
    }

    if (project) {
      db.prepare(
        `INSERT INTO audit_events (
          id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        createId("audit"),
        project.org_id,
        projectId,
        "system",
        null,
        "learning_rule.upserted_from_policy_work_item_effectiveness",
        "learning_rule",
        learningRuleId,
        toJson({
          rule_type: group.ruleType,
          pattern_key: group.patternKey,
          confidence,
          source_effectiveness_count: count,
        }),
        createdAt
      );
    }

    results.push({ learning_rule_id: learningRuleId, rule_type: group.ruleType, confidence });
  }

  return results;
}

export function listProjectLearningRules(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?"];
    const params = [projectId];

    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }

    if (Array.isArray(options.statuses) && options.statuses.length) {
      clauses.push(`status IN (${options.statuses.map(() => "?").join(", ")})`);
      params.push(...options.statuses);
    }

    if (options.ruleType) {
      clauses.push("rule_type = ?");
      params.push(options.ruleType);
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM learning_rules
       WHERE ${clauses.join(" AND ")}
       ORDER BY updated_at DESC, created_at DESC
       LIMIT ?`
    ).all(...params).map(parseLearningRuleRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function getLearningRule(learningRuleId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    return parseLearningRuleRow(db.prepare("SELECT * FROM learning_rules WHERE id = ?").get(learningRuleId));
  } finally {
    if (!options.db) db.close();
  }
}

export function updateLearningRuleStatus(learningRuleId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const rule = parseLearningRuleRow(db.prepare("SELECT * FROM learning_rules WHERE id = ?").get(learningRuleId));
    if (!rule) throw new Error(`Learning rule not found: ${learningRuleId}`);
    const toStatus = String(payload.status || payload.to_status || "").trim();
    assertValidLearningRuleTransition(rule.status, toStatus);
    const createdAt = options.createdAt || new Date().toISOString();
    const actorType = String(payload.actor_type || options.actorType || "user");
    const actorId = payload.actor_id || options.actorId || null;
    const note = payload.note ? String(payload.note) : null;
    const evidence = {
      ...(payload.evidence_json || payload.evidence || {}),
      safety_boundary: "advisory_only_no_automatic_execution",
    };
    const eventId = createId("learnrule_event");
    const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(rule.project_id);

    db.exec("BEGIN");
    try {
      db.prepare("UPDATE learning_rules SET status = ?, updated_at = ? WHERE id = ?")
        .run(toStatus, createdAt, learningRuleId);
      db.prepare(
        `INSERT INTO learning_rule_events (
          id, learning_rule_id, project_id, actor_type, actor_id,
          from_status, to_status, note, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        learningRuleId,
        rule.project_id,
        actorType,
        actorId,
        rule.status,
        toStatus,
        note,
        toJson(evidence),
        createdAt
      );
      if (project) {
        db.prepare(
          `INSERT INTO audit_events (
            id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          createId("audit"),
          project.org_id,
          rule.project_id,
          actorType,
          actorId,
          "learning_rule.status_updated",
          "learning_rule",
          learningRuleId,
          toJson({
            learning_rule_event_id: eventId,
            from_status: rule.status,
            to_status: toStatus,
            rule_type: rule.rule_type,
            pattern_key: rule.pattern_key,
            evidence,
          }),
          createdAt
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      learning_rule: parseLearningRuleRow(db.prepare("SELECT * FROM learning_rules WHERE id = ?").get(learningRuleId)),
      learning_rule_event: parseLearningRuleEventRow(db.prepare("SELECT * FROM learning_rule_events WHERE id = ?").get(eventId)),
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function listLearningRuleEvents(learningRuleId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    return db.prepare(
      `SELECT *
       FROM learning_rule_events
       WHERE learning_rule_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(learningRuleId, limit).map(parseLearningRuleEventRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function listProjectLearningRuleEvents(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    return db.prepare(
      `SELECT *
       FROM learning_rule_events
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(projectId, limit).map(parseLearningRuleEventRow);
  } finally {
    if (!options.db) db.close();
  }
}

function learningRuleMatchesCertificationAction(rule, action) {
  const pattern = rule.pattern_json || {};
  if (pattern.target !== "certification_action_effectiveness") return false;
  const coverage = action.action?.task_coverage || {};
  if (pattern.blocker_code && pattern.blocker_code !== action.blocker_code) return false;
  const allowActionDrift = new Set([
    "flag_certification_action_no_metric_lift",
    "require_stronger_certification_evidence",
  ]).has(rule.rule_type);
  if (!allowActionDrift && pattern.recommended_action && pattern.recommended_action !== action.recommended_action) return false;
  if (pattern.evidence_quality_level && pattern.evidence_quality_level !== coverage.validated_action_evidence_quality_level) return false;
  return true;
}

function learningRuleSource(rule) {
  const pattern = rule.pattern_json || {};
  if (rule.evidence_json?.source) return rule.evidence_json.source;
  if (pattern.target === "certification_action_effectiveness") return "certification_action_effectiveness";
  if (pattern.target === "policy_review_work_item_effectiveness") return "policy_review_work_item_effectiveness";
  return "feedback";
}

function learningRuleMatchesPolicyWorkItemEffectiveness(rule, effectiveness) {
  const pattern = rule.pattern_json || {};
  if (pattern.target !== "policy_review_work_item_effectiveness") return false;
  if (pattern.blocker_code && pattern.blocker_code !== effectiveness.effectiveness?.blocker_code) return false;
  if (pattern.action_type && pattern.action_type !== effectiveness.action_type) return false;
  if (pattern.event_type && pattern.event_type !== effectiveness.event_type) return false;
  return true;
}

export function buildLearningRuleReview(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const rules = listProjectLearningRules(projectId, {
      db,
      skipMigrate: true,
      status: options.status,
      statuses: options.statuses,
      ruleType: options.ruleType,
      limit: options.limit || 100,
    });
    const actions = db.prepare(
      `SELECT *
       FROM certification_action_queue
       WHERE project_id = ?
         AND status IN ('open', 'in_progress', 'evidence_attached', 'reopened')
       ORDER BY priority DESC, created_at DESC
       LIMIT 200`
    ).all(projectId).map((row) => ({
      ...row,
      action: fromJson(row.action_json, {}),
    }));
    const policyWorkItemEffectiveness = db.prepare(
      `SELECT *
       FROM policy_review_work_item_effectiveness
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT 200`
    ).all(projectId).map((row) => ({
      ...row,
      blocker_cleared: Boolean(row.blocker_cleared),
      effectiveness: fromJson(row.effectiveness_json, {}),
    }));
    const review = rules.map((rule) => {
      const source = learningRuleSource(rule);
      const affectedActions = actions.filter((action) => {
        const explicitReasons = action.action?.learning_priority_adjustment?.reasons || [];
        return explicitReasons.some((reason) => reason.learning_rule_id === rule.id) ||
          learningRuleMatchesCertificationAction(rule, action);
      }).slice(0, 10);
      const affectedPolicyWorkItems = policyWorkItemEffectiveness
        .filter((item) => learningRuleMatchesPolicyWorkItemEffectiveness(rule, item))
        .slice(0, 10);
      return {
        ...rule,
        review: {
          source,
          affected_action_count: affectedActions.length,
          affected_policy_work_item_count: affectedPolicyWorkItems.length,
          affected_actions: affectedActions.map((action) => ({
            id: action.id,
            agent_id: action.agent_id,
            blocker_code: action.blocker_code,
            recommended_action: action.recommended_action,
            priority: action.priority,
            status: action.status,
            learning_priority_adjustment: action.action?.learning_priority_adjustment || null,
          })),
          affected_policy_work_items: affectedPolicyWorkItems.map((item) => ({
            id: item.id,
            policy_rule_id: item.policy_rule_id,
            work_item_id: item.work_item_id,
            action_type: item.action_type,
            event_type: item.event_type,
            effectiveness_status: item.effectiveness_status,
            readiness_score_delta: item.readiness_score_delta,
            blocker_cleared: Boolean(item.blocker_cleared),
          })),
          suggested_review_decision: rule.rule_type === "suppress_certification_action_pattern" || rule.rule_type === "flag_certification_action_no_metric_lift"
            || rule.rule_type === "suppress_policy_work_item_pattern" || rule.rule_type === "deprioritize_policy_work_item_pattern"
            ? "review_before_trusting"
            : "keep_active_with_monitoring",
          safety_boundary: "advisory_only_no_automatic_execution",
        },
      };
    });
    return {
      project_id: projectId,
      learning_rule_review: review,
      summary: {
        total_rules: review.length,
        active_rules: review.filter((rule) => rule.status === "active").length,
        certification_effectiveness_rules: review.filter((rule) => rule.review.source === "certification_action_effectiveness").length,
        policy_work_item_effectiveness_rules: review.filter((rule) => rule.review.source === "policy_review_work_item_effectiveness").length,
        feedback_rules: review.filter((rule) => rule.review.source === "feedback").length,
        affected_action_count: review.reduce((sum, rule) => sum + Number(rule.review.affected_action_count || 0), 0),
        affected_policy_work_item_count: review.reduce((sum, rule) => sum + Number(rule.review.affected_policy_work_item_count || 0), 0),
      },
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function applyLearningRulesToSuggestions(suggestions, learningRules = []) {
  const activeRules = learningRules.filter((rule) => ["active", "trusted"].includes(rule.status));
  const rulesByTypeAndPattern = new Map();

  for (const rule of activeRules) {
    rulesByTypeAndPattern.set(`${rule.rule_type}:${rule.pattern_key}`, rule);
  }

  return suggestions.map((suggestion) => {
    const patternKey = suggestionPatternKey(suggestion);
    const suppressRule = rulesByTypeAndPattern.get(`suppress_suggestion_pattern:${patternKey}`);
    const trustRule = rulesByTypeAndPattern.get(`trust_suggestion_pattern:${patternKey}`);
    const matchedRule = suppressRule || trustRule;

    if (!matchedRule) {
      return {
        ...suggestion,
        learning_rule_effect: null,
        learning_rule_id: null,
        learning_rule_confidence: null,
      };
    }

    return {
      ...suggestion,
      learning_rule_effect: matchedRule.rule_type === "suppress_suggestion_pattern" ? "suppressed" : "trusted",
      learning_rule_id: matchedRule.id,
      learning_rule_confidence: matchedRule.confidence,
    };
  });
}
