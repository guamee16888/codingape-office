import { createId } from "./ids.mjs";
import { fromJson, migrate, nowIso, openDatabase, toJson } from "./db.mjs";
import { summarizeProjectEvalCoverage } from "./eval-coverage.mjs";
import { latestEvalReplayGate } from "./eval-replay.mjs";

function nextPromptVersion(db, projectId, agentId, promptName) {
  const row = db.prepare(
    `SELECT MAX(version) AS max_version
     FROM prompt_versions
     WHERE project_id = ? AND agent_id IS ? AND prompt_name = ?`
  ).get(projectId, agentId, promptName);

  return Number(row?.max_version || 0) + 1;
}

export function createPromptVersionFromApprovedSuggestion(db, { projectId, suggestionId, actorId = null, createdAt }) {
  const suggestion = db.prepare(
    `SELECT id, project_id, agent_id, type, title, description, expected_impact, status
     FROM optimization_suggestions
     WHERE id = ? AND project_id = ?`
  ).get(suggestionId, projectId);

  if (!suggestion || suggestion.type !== "prompt") {
    return null;
  }

  const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const promptName = suggestion.title || "Approved prompt suggestion";
  const version = nextPromptVersion(db, projectId, suggestion.agent_id, promptName);
  const promptVersionId = createId("prompt");
  const content = [
    `# ${promptName}`,
    "",
    suggestion.description,
    "",
    "Expected impact:",
    suggestion.expected_impact || "Not specified.",
    "",
    "Status: approved draft. Human review is still required before production use.",
  ].join("\n");

  db.prepare(
    `INSERT INTO prompt_versions (
      id, project_id, agent_id, prompt_name, content, version, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(promptVersionId, projectId, suggestion.agent_id, promptName, content, version, "approved_draft", createdAt);

  db.prepare("UPDATE optimization_suggestions SET status = ? WHERE id = ?").run("approved", suggestionId);

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
    "prompt_version.created_from_approved_suggestion",
    "prompt_version",
    promptVersionId,
    toJson({ suggestion_id: suggestionId }),
    createdAt
  );

  return { prompt_version_id: promptVersionId };
}

function promotionDecisionForGate(gate) {
  if (!gate?.has_eval_run) {
    return {
      decision: "blocked_missing_replay",
      status: "promotion_blocked",
      summary: "Prompt promotion blocked because no prompt-version-specific eval replay exists.",
    };
  }

  if (gate.gate_decision === "passed") {
    return {
      decision: "promotion_ready",
      status: "promotion_ready",
      summary: "Prompt draft is ready for human promotion approval based on the latest eval replay.",
    };
  }

  if (gate.gate_decision === "blocked_by_regression") {
    return {
      decision: "promotion_blocked",
      status: "promotion_blocked",
      summary: "Prompt promotion blocked because the latest eval replay contains regressions.",
    };
  }

  return {
    decision: "promotion_needs_review",
    status: "promotion_needs_review",
    summary: "Prompt promotion needs review because the latest eval replay did not fully pass.",
  };
}

function promotionDecisionForCoverage(evalCoverage) {
  const summary = evalCoverage?.summary || {};
  const regressionCount = Number(summary.regression_taxonomy_count || 0);
  const missingCount = Number(summary.missing_eval_taxonomy_count || 0);
  const notReplayedCount = Number(summary.not_replayed_taxonomy_count || 0);

  if (regressionCount > 0) {
    return {
      decision: "blocked_eval_coverage_regressions",
      status: "promotion_blocked",
      summary: "Prompt promotion blocked because covered failure taxonomies still have replay regressions.",
    };
  }

  if (missingCount > 0) {
    return {
      decision: "blocked_missing_eval_coverage",
      status: "promotion_blocked",
      summary: "Prompt promotion blocked because observed failure taxonomies do not yet have eval coverage.",
    };
  }

  if (notReplayedCount > 0) {
    return {
      decision: "blocked_unreplayed_eval_coverage",
      status: "promotion_blocked",
      summary: "Prompt promotion blocked because eval cases exist but have not been replayed.",
    };
  }

  return null;
}

function parsePromotionEvidenceRow(row) {
  return row ? {
    ...row,
    metadata_json: fromJson(row.metadata_json, {}),
  } : null;
}

export function checkPromptPromotionReadiness(projectId, promptVersionId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const promptVersion = db.prepare(
      `SELECT p.*, pr.org_id
       FROM prompt_versions p
       JOIN projects pr ON pr.id = p.project_id
       WHERE p.id = ? AND p.project_id = ?`
    ).get(promptVersionId, projectId);

    if (!promptVersion) {
      throw new Error(`Prompt version not found for project: ${promptVersionId}`);
    }

    const createdAt = options.createdAt || nowIso();
    const gate = latestEvalReplayGate(projectId, {
      db,
      skipMigrate: true,
      agentId: promptVersion.agent_id,
      promptVersionId,
      before: options.before,
    });
    const replayDecision = promotionDecisionForGate(gate);
    const evalCoverage = summarizeProjectEvalCoverage(projectId, { db, skipMigrate: true });
    const coverageDecision = replayDecision.status === "promotion_ready"
      ? promotionDecisionForCoverage(evalCoverage)
      : null;
    const decision = coverageDecision || replayDecision;
    const evidenceId = createId("evidence");
    const metadata = {
      prompt_version_id: promptVersionId,
      prompt_name: promptVersion.prompt_name,
      prompt_version: Number(promptVersion.version || 0),
      previous_status: promptVersion.status,
      promotion_decision: decision.decision,
      resulting_status: decision.status,
      required_eval_scope: "prompt_version",
      eval_replay_gate: gate,
      eval_coverage_gate: coverageDecision,
      eval_coverage: evalCoverage,
    };

    db.prepare(
      `INSERT INTO audit_evidence_items (
        id, org_id, project_id, agent_id, evidence_type, target_type, target_id,
        summary, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      evidenceId,
      promptVersion.org_id,
      projectId,
      promptVersion.agent_id,
      "prompt_promotion_check",
      "prompt_version",
      promptVersionId,
      decision.summary,
      toJson(metadata),
      createdAt
    );

    db.prepare("UPDATE prompt_versions SET status = ? WHERE id = ?").run(decision.status, promptVersionId);

    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      promptVersion.org_id,
      projectId,
      "system",
      options.actorId || null,
      "prompt_version.promotion_check_completed",
      "prompt_version",
      promptVersionId,
      toJson({ audit_evidence_item_id: evidenceId, ...metadata }),
      createdAt
    );

    return {
      prompt_version_id: promptVersionId,
      project_id: projectId,
      agent_id: promptVersion.agent_id,
      previous_status: promptVersion.status,
      status: decision.status,
      decision: decision.decision,
      summary: decision.summary,
      eval_replay_gate: gate,
      eval_coverage_gate: coverageDecision,
      eval_coverage: evalCoverage,
      audit_evidence_item_id: evidenceId,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectPromptPromotionChecks(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?", "evidence_type = 'prompt_promotion_check'"];
    const params = [projectId];

    if (options.promptVersionId) {
      clauses.push("target_id = ?");
      params.push(options.promptVersionId);
    }

    if (options.agentId) {
      clauses.push("agent_id = ?");
      params.push(options.agentId);
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM audit_evidence_items
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parsePromotionEvidenceRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
