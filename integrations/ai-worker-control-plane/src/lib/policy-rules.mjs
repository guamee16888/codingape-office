import { createId } from "./ids.mjs";
import { fromJson, migrate, openDatabase, toJson } from "./db.mjs";

function nextPolicyRuleVersion(db, projectId, name, ruleType) {
  const row = db.prepare(
    `SELECT MAX(version) AS max_version
     FROM policy_rules
     WHERE project_id = ? AND name = ? AND rule_type = ?`
  ).get(projectId, name, ruleType);

  return Number(row?.max_version || 0) + 1;
}

function parsePolicyRuleRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    config_json: fromJson(row.config_json, {}),
    enabled: Boolean(row.enabled),
    review_status: row.review_status || "draft_review",
  };
}

function parsePolicyRuleEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: fromJson(row.evidence_json, {}),
  };
}

const POLICY_RULE_REVIEW_TRANSITIONS = {
  draft_review: new Set(["reviewed", "rejected"]),
  reviewed: new Set(["approved_for_dry_run", "rejected"]),
  approved_for_dry_run: new Set(["ready_to_enable_later", "reviewed", "rejected"]),
  ready_to_enable_later: new Set(["reviewed", "rejected"]),
  rejected: new Set(["reviewed"]),
};

function assertValidPolicyRuleReviewTransition(fromStatus, toStatus) {
  if (!POLICY_RULE_REVIEW_TRANSITIONS[fromStatus]?.has(toStatus)) {
    throw new Error(`Invalid policy rule review transition: ${fromStatus} -> ${toStatus}`);
  }
}

const LEARNING_RULE_POLICY_DRAFTS = {
  require_stronger_certification_evidence: {
    ruleType: "certification_evidence_quality",
    severity: "medium",
    title: "Require stronger evidence before trusting certification actions",
    proposedControl: "Require human review and stronger platform evidence before a certification remediation action is treated as credible.",
    expectedImpact: "Reduces false confidence from weak or unvalidated remediation evidence.",
  },
  flag_certification_action_no_metric_lift: {
    ruleType: "certification_metric_validation",
    severity: "medium",
    title: "Review certification actions that show no metric lift",
    proposedControl: "Require human review before repeating certification remediation actions that produced strong evidence but no measurable readiness improvement.",
    expectedImpact: "Prevents repeated low-impact remediation loops and keeps autonomy readiness tied to verified metric movement.",
  },
  suppress_certification_action_pattern: {
    ruleType: "certification_action_suppression",
    severity: "high",
    title: "Suppress risky certification action patterns until reviewed",
    proposedControl: "Require human review before using certification remediation action patterns that correlated with regressions or unsafe outcomes.",
    expectedImpact: "Prevents known risky remediation patterns from increasing autonomy readiness without operator approval.",
  },
};

function limitValue(value, fallback = 50) {
  return Math.max(1, Math.min(Number(value || fallback), 200));
}

function policyDraftConfigFromLearningRule(rule) {
  const template = LEARNING_RULE_POLICY_DRAFTS[rule?.rule_type];
  if (!template) {
    return null;
  }

  const pattern = rule.pattern_json || {};
  const evidence = rule.evidence_json || {};
  return {
    mode: "draft_only",
    source: "trusted_learning_rule",
    source_learning_rule_id: rule.id,
    source_rule_type: rule.rule_type,
    pattern,
    evidence,
    confidence: Number(rule.confidence || 0),
    proposed_control: template.proposedControl,
    expected_impact: template.expectedImpact,
    human_review_required: true,
    safety_boundary: "advisory_only_no_automatic_execution",
  };
}

function existingLearningRulePolicyDraft(db, projectId, learningRuleId) {
  const rows = db.prepare(
    `SELECT *
     FROM policy_rules
     WHERE project_id = ?`
  ).all(projectId);

  return rows.map(parsePolicyRuleRow).find((rule) => (
    rule.config_json?.source === "trusted_learning_rule" &&
    rule.config_json?.source_learning_rule_id === learningRuleId
  )) || null;
}

export function createPolicyRuleDraftFromApprovedSuggestion(db, { projectId, suggestionId, actorId = null, createdAt }) {
  const suggestion = db.prepare(
    `SELECT id, project_id, agent_id, type, severity, title, description, expected_impact, status
     FROM optimization_suggestions
     WHERE id = ? AND project_id = ?`
  ).get(suggestionId, projectId);

  if (!suggestion || suggestion.type !== "risk") {
    return null;
  }

  const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const ruleType = "risk_control";
  const name = suggestion.title || "Approved risk control draft";
  const version = nextPolicyRuleVersion(db, projectId, name, ruleType);
  const policyRuleId = createId("policy");
  const config = {
    mode: "draft_only",
    source: "approved_suggestion",
    suggestion_id: suggestion.id,
    agent_id: suggestion.agent_id,
    proposed_control: suggestion.description,
    expected_impact: suggestion.expected_impact || null,
    human_review_required: true,
  };

  db.prepare(
    `INSERT INTO policy_rules (
      id, project_id, name, rule_type, config_json, severity, enabled, version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    policyRuleId,
    projectId,
    name,
    ruleType,
    toJson(config),
    suggestion.severity || "medium",
    0,
    version,
    createdAt
  );

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
    "policy_rule.draft_created_from_approved_suggestion",
    "policy_rule",
    policyRuleId,
    toJson({ suggestion_id: suggestionId, enabled: false }),
    createdAt
  );

  return { policy_rule_id: policyRuleId };
}

export function createPolicyRuleDraftFromLearningRule(db, {
  projectId,
  learningRuleId,
  actorId = null,
  actorType = "system",
  createdAt,
}) {
  const rule = db.prepare(
    `SELECT *
     FROM learning_rules
     WHERE id = ? AND project_id = ?`
  ).get(learningRuleId, projectId);

  if (!rule) {
    return null;
  }

  const parsedRule = {
    ...rule,
    confidence: Number(rule.confidence || 0),
    source_feedback_count: Number(rule.source_feedback_count || 0),
    pattern_json: fromJson(rule.pattern_json, {}),
    evidence_json: fromJson(rule.evidence_json, {}),
  };

  if (parsedRule.status !== "trusted") {
    return {
      learning_rule_id: learningRuleId,
      created: false,
      skipped_reason: "learning_rule_not_trusted",
    };
  }

  const template = LEARNING_RULE_POLICY_DRAFTS[parsedRule.rule_type];
  const config = policyDraftConfigFromLearningRule(parsedRule);
  if (!template || !config) {
    return {
      learning_rule_id: learningRuleId,
      created: false,
      skipped_reason: "unsupported_learning_rule_type",
    };
  }

  const existing = existingLearningRulePolicyDraft(db, projectId, learningRuleId);
  if (existing) {
    return {
      learning_rule_id: learningRuleId,
      policy_rule_id: existing.id,
      created: false,
      skipped_reason: "policy_draft_already_exists",
    };
  }

  const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const name = `${template.title}: ${parsedRule.pattern_json?.blocker_code || parsedRule.pattern_json?.recommended_action || parsedRule.pattern_key}`;
  const version = nextPolicyRuleVersion(db, projectId, name, template.ruleType);
  const policyRuleId = createId("policy");
  const timestamp = createdAt || new Date().toISOString();

  db.prepare(
    `INSERT INTO policy_rules (
      id, project_id, name, rule_type, config_json, severity, enabled, version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    policyRuleId,
    projectId,
    name,
    template.ruleType,
    toJson(config),
    template.severity,
    0,
    version,
    timestamp
  );

  db.prepare(
    `INSERT INTO audit_events (
      id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    createId("audit"),
    project.org_id,
    projectId,
    actorType,
    actorId,
    "policy_rule.draft_created_from_learning_rule",
    "policy_rule",
    policyRuleId,
    toJson({
      learning_rule_id: learningRuleId,
      rule_type: parsedRule.rule_type,
      enabled: false,
      safety_boundary: "advisory_only_no_automatic_execution",
    }),
    timestamp
  );

  return {
    learning_rule_id: learningRuleId,
    policy_rule_id: policyRuleId,
    created: true,
  };
}

export function createPolicyRuleDraftsFromTrustedLearningRules(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const limit = limitValue(options.limit, 100);
    const rows = db.prepare(
      `SELECT id
       FROM learning_rules
       WHERE project_id = ?
         AND status = 'trusted'
       ORDER BY updated_at DESC, created_at DESC
       LIMIT ?`
    ).all(projectId, limit);

    const results = rows.map((row) => createPolicyRuleDraftFromLearningRule(db, {
      projectId,
      learningRuleId: row.id,
      actorId: options.actorId || null,
      actorType: options.actorType || "system",
      createdAt: options.createdAt,
    })).filter(Boolean);

    return {
      project_id: projectId,
      results,
      created_count: results.filter((item) => item.created).length,
      skipped_count: results.filter((item) => !item.created).length,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectPolicyRules(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?"];
    const params = [projectId];

    if (options.ruleType) {
      clauses.push("rule_type = ?");
      params.push(options.ruleType);
    }

    if (options.enabled !== undefined) {
      clauses.push("enabled = ?");
      params.push(options.enabled ? 1 : 0);
    }

    if (options.reviewStatus) {
      clauses.push("review_status = ?");
      params.push(options.reviewStatus);
    }

    const limit = limitValue(options.limit);
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM policy_rules
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parsePolicyRuleRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function getPolicyRule(policyRuleId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    return parsePolicyRuleRow(db.prepare("SELECT * FROM policy_rules WHERE id = ?").get(policyRuleId));
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function updatePolicyRuleReviewStatus(policyRuleId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const policyRule = parsePolicyRuleRow(db.prepare("SELECT * FROM policy_rules WHERE id = ?").get(policyRuleId));
    if (!policyRule) {
      throw new Error(`Policy rule not found: ${policyRuleId}`);
    }

    const toStatus = String(payload.review_status || payload.status || payload.to_status || "").trim();
    if (!toStatus) {
      throw new Error("policy rule review status is required");
    }
    assertValidPolicyRuleReviewTransition(policyRule.review_status, toStatus);

    const createdAt = options.createdAt || new Date().toISOString();
    const actorType = String(payload.actor_type || options.actorType || "user");
    const actorId = payload.actor_id || options.actorId || null;
    const note = payload.note ? String(payload.note) : null;
    const evidence = {
      ...(payload.evidence_json || payload.evidence || {}),
      enabled_after_transition: false,
      safety_boundary: "advisory_only_no_automatic_execution",
    };
    const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(policyRule.project_id);
    const eventId = createId("policy_event");

    const manageTransaction = !options.inTransaction;
    if (manageTransaction) db.exec("BEGIN");
    try {
      db.prepare("UPDATE policy_rules SET review_status = ?, updated_at = ?, enabled = 0 WHERE id = ?")
        .run(toStatus, createdAt, policyRuleId);
      db.prepare(
        `INSERT INTO policy_rule_events (
          id, policy_rule_id, project_id, actor_type, actor_id,
          from_status, to_status, note, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        policyRuleId,
        policyRule.project_id,
        actorType,
        actorId,
        policyRule.review_status,
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
          policyRule.project_id,
          actorType,
          actorId,
          "policy_rule.review_status_updated",
          "policy_rule",
          policyRuleId,
          toJson({
            policy_rule_event_id: eventId,
            from_status: policyRule.review_status,
            to_status: toStatus,
            enabled: false,
            safety_boundary: "advisory_only_no_automatic_execution",
            evidence,
          }),
          createdAt
        );
      }
      if (manageTransaction) db.exec("COMMIT");
    } catch (error) {
      if (manageTransaction) db.exec("ROLLBACK");
      throw error;
    }

    return {
      policy_rule: parsePolicyRuleRow(db.prepare("SELECT * FROM policy_rules WHERE id = ?").get(policyRuleId)),
      policy_rule_event: parsePolicyRuleEventRow(db.prepare("SELECT * FROM policy_rule_events WHERE id = ?").get(eventId)),
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listPolicyRuleEvents(policyRuleId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const limit = limitValue(options.limit);
    return db.prepare(
      `SELECT *
       FROM policy_rule_events
       WHERE policy_rule_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(policyRuleId, limit).map(parsePolicyRuleEventRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectPolicyRuleEvents(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const limit = limitValue(options.limit);
    return db.prepare(
      `SELECT *
       FROM policy_rule_events
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(projectId, limit).map(parsePolicyRuleEventRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
