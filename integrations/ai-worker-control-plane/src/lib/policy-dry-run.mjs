import { createId } from "./ids.mjs";
import { fromJson, migrate, openDatabase, toJson } from "./db.mjs";
import { listProjectPolicyRules } from "./policy-rules.mjs";
import { updatePolicyRuleReviewStatus } from "./policy-rules.mjs";

const DANGEROUS_TOOL_KEYWORDS = ["delete", "transfer", "payment", "refund", "send_email", "shell", "exec", "admin"];
const SENSITIVE_TEXT_KEYWORDS = ["password", "secret", "api_key", "token=", "ssn", "credit card"];
const INJECTION_TEXT_KEYWORDS = ["ignore previous", "system prompt", "developer message", "jailbreak"];

function dayRange(dateString) {
  const start = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid policy dry-run date: ${dateString}`);
  }

  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function includesAny(text, needles) {
  const lower = String(text || "").toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function parseRunForPolicy(row) {
  return {
    ...row,
    tools_used: fromJson(row.tools_used, []),
    metadata: fromJson(row.metadata, {}),
    failure_categories: fromJson(row.failure_categories, []),
    needs_human_review: Boolean(row.needs_human_review),
  };
}

function policyText(rule) {
  return [
    rule.name,
    rule.rule_type,
    rule.severity,
    rule.config_json?.proposed_control,
    rule.config_json?.expected_impact,
  ].filter(Boolean).join("\n").toLowerCase();
}

function policyIntent(rule) {
  const text = policyText(rule);

  return {
    privileged_tools: includesAny(text, ["privileged", "high-impact", "approval", "refund", "payment", "email", "tool"]),
    sensitive_data: includesAny(text, ["sensitive", "secret", "privacy", "credential", "redaction", "private"]),
    prompt_injection: includesAny(text, ["prompt injection", "jailbreak", "instruction", "system prompt"]),
    human_review: includesAny(text, ["human review", "approval", "reviewed", "gate"]),
    high_risk: rule.severity === "high",
  };
}

function matchedTools(run) {
  return (run.tools_used || []).filter((tool) => includesAny(tool, DANGEROUS_TOOL_KEYWORDS));
}

function matchRuleToRun(rule, run) {
  const intent = policyIntent(rule);
  const text = `${run.input || ""}\n${run.output || ""}`;
  const reasons = [];
  const tools = matchedTools(run);

  if (intent.privileged_tools && tools.length > 0) {
    reasons.push(`Matched privileged tools: ${tools.join(", ")}`);
  }

  if (intent.sensitive_data && includesAny(text, SENSITIVE_TEXT_KEYWORDS)) {
    reasons.push("Matched possible sensitive data in input or output.");
  }

  if (intent.prompt_injection && includesAny(text, INJECTION_TEXT_KEYWORDS)) {
    reasons.push("Matched prompt-injection or instruction-boundary language.");
  }

  const hasSpecificPolicySignal = reasons.length > 0;
  const genericPolicy = !intent.privileged_tools && !intent.sensitive_data && !intent.prompt_injection;

  if (intent.human_review && run.needs_human_review && (hasSpecificPolicySignal || genericPolicy)) {
    reasons.push("Matched an existing human-review requirement.");
  }

  if (intent.high_risk && Number(run.risk_score || 0) >= 75 && (hasSpecificPolicySignal || genericPolicy)) {
    reasons.push(`Matched high risk score ${run.risk_score}.`);
  }

  if (reasons.length === 0) {
    return null;
  }

  return {
    run_id: run.id,
    judgement_id: run.judgement_id || null,
    agent_id: run.agent_id,
    created_at: run.created_at,
    overall_status: run.overall_status || "unanalyzed",
    risk_score: Number(run.risk_score || 0),
    matched_tools: tools,
    reasons,
  };
}

function queryRunsWithJudgements(db, projectId, start, end) {
  return db.prepare(
    `SELECT
      r.*,
      j.id AS judgement_id,
      j.overall_status,
      j.risk_score,
      j.failure_categories,
      j.needs_human_review
     FROM agent_runs r
     LEFT JOIN run_judgements j ON j.agent_run_id = r.id
     WHERE r.project_id = ? AND r.created_at >= ? AND r.created_at < ?
     ORDER BY r.created_at ASC`
  ).all(projectId, start, end).map(parseRunForPolicy);
}

function dryRunLine(result) {
  const state = result.enabled ? "enabled rule" : "disabled draft";
  return `${result.name}: ${result.match_count} historical runs would match this ${state}; top match=${result.matches[0]?.run_id || "none"}`;
}

function evidenceMatchesFor(result) {
  return Array.isArray(result.evidence_matches) ? result.evidence_matches : (result.matches || []);
}

function summarizePersistedResult(result, matches) {
  return {
    policy_rule_id: result.policy_rule_id,
    name: result.name,
    rule_type: result.rule_type,
    severity: result.severity,
    enabled: Boolean(result.enabled),
    version: result.version,
    recommendation: result.recommendation,
    config_json: result.config_json,
    review_status: result.review_status || "draft_review",
    review_packet: result.review_packet || null,
    match_count: Number(result.match_count || 0),
    high_risk_match_count: matches.filter((match) => Number(match.risk_score || 0) >= 75).length,
    matched_run_ids: result.matched_run_ids || matches.map((match) => match.run_id),
  };
}

function riskBand(score) {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  if (score > 0) return "low";
  return "none";
}

function buildPolicyReviewPacket(rule, matches) {
  const highRiskMatches = matches.filter((match) => Number(match.risk_score || 0) >= 75);
  const humanReviewMatches = matches.filter((match) => (
    match.reasons || []
  ).some((reason) => String(reason).toLowerCase().includes("human-review")));
  const privilegedToolMatches = matches.filter((match) => (match.matched_tools || []).length > 0);
  const topSampleMatches = matches.slice(0, 5);
  const falsePositiveRisk = matches.length === 0
    ? "unknown"
    : highRiskMatches.length === matches.length
      ? "low"
      : highRiskMatches.length > 0
        ? "medium"
        : "high";
  const reviewReadiness = matches.length === 0
    ? "needs_more_data"
    : highRiskMatches.length > 0
      ? "high_priority_review"
      : "sample_review_required";
  const recommendedReviewStatus = matches.length === 0
    ? "draft_review"
    : highRiskMatches.length > 0
      ? "approved_for_dry_run"
      : "reviewed";
  const maxRiskScore = Math.max(0, ...matches.map((match) => Number(match.risk_score || 0)));

  return {
    policy_rule_id: rule.id,
    current_review_status: rule.review_status || "draft_review",
    review_readiness: reviewReadiness,
    recommended_review_status: recommendedReviewStatus,
    reviewer_decision_required: true,
    evidence_summary: {
      match_count: matches.length,
      high_risk_match_count: highRiskMatches.length,
      human_review_match_count: humanReviewMatches.length,
      privileged_tool_match_count: privilegedToolMatches.length,
      max_risk_score: maxRiskScore,
      max_risk_band: riskBand(maxRiskScore),
      false_positive_risk: falsePositiveRisk,
      sample_run_ids: topSampleMatches.map((match) => match.run_id),
    },
    required_review_samples: topSampleMatches.map((match) => ({
      run_id: match.run_id,
      judgement_id: match.judgement_id,
      risk_score: match.risk_score,
      overall_status: match.overall_status,
      matched_tools: match.matched_tools || [],
      reasons: match.reasons || [],
    })),
    evidence_requirements: [
      "Review top matched historical runs for true-positive vs false-positive behavior.",
      "Confirm whether matched tools or outputs should require human approval.",
      "Check whether high-risk matches map to the intended policy boundary.",
      "Record reviewer decision before any future enforcement discussion.",
    ],
    recommended_next_action: matches.length === 0
      ? "Collect more historical run evidence before moving this draft forward."
      : highRiskMatches.length > 0
        ? "Review high-risk matches and keep the draft in dry-run evidence mode."
        : "Review sample matches for false positives before considering repeated dry-run approval.",
    safety_boundary: "advisory_only_no_automatic_execution",
  };
}

function parseDryRunEvidenceRow(row) {
  return {
    ...row,
    summary_json: fromJson(row.summary_json, {}),
  };
}

function parsePolicyReviewTaskRow(row) {
  if (!row) return null;
  return {
    ...row,
    priority: Number(row.priority || 0),
    task: fromJson(row.task_json, {}),
  };
}

function parsePolicyReviewTaskEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: fromJson(row.evidence_json, {}),
  };
}

function parsePolicyRuleReviewCandidateRow(row) {
  if (!row) return null;
  return {
    ...row,
    candidate: fromJson(row.candidate_json, {}),
  };
}

function parsePolicyRuleReviewCandidateEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: fromJson(row.evidence_json, {}),
  };
}

const POLICY_REVIEW_TASK_TRANSITIONS = {
  open: new Set(["in_review", "needs_more_evidence", "completed", "rejected", "superseded"]),
  in_review: new Set(["needs_more_evidence", "completed", "rejected", "open", "superseded"]),
  needs_more_evidence: new Set(["in_review", "completed", "rejected", "superseded"]),
  completed: new Set(["in_review"]),
  rejected: new Set(["in_review"]),
  superseded: new Set([]),
};

function assertValidPolicyReviewTaskTransition(fromStatus, toStatus) {
  if (!POLICY_REVIEW_TASK_TRANSITIONS[fromStatus]?.has(toStatus)) {
    throw new Error(`Invalid policy review task transition: ${fromStatus} -> ${toStatus}`);
  }
}

const POLICY_REVIEW_CANDIDATE_TRANSITIONS = {
  pending: new Set(["accepted", "rejected"]),
  accepted: new Set([]),
  rejected: new Set([]),
};

function assertValidPolicyReviewCandidateTransition(fromStatus, toStatus) {
  if (!POLICY_REVIEW_CANDIDATE_TRANSITIONS[fromStatus]?.has(toStatus)) {
    throw new Error(`Invalid policy review candidate transition: ${fromStatus} -> ${toStatus}`);
  }
}

function nextPolicyReviewStatus(fromStatus, targetStatus) {
  if (fromStatus === targetStatus) return targetStatus;
  if (fromStatus === "draft_review" && targetStatus === "approved_for_dry_run") return "reviewed";
  if (fromStatus === "draft_review" && targetStatus === "ready_to_enable_later") return "reviewed";
  if (fromStatus === "reviewed" && targetStatus === "ready_to_enable_later") return "approved_for_dry_run";
  return targetStatus;
}

function createPolicyRuleReviewCandidateFromCompletedTask(db, { task, eventId, createdAt }) {
  if (task.recommended_review_status === "draft_review") {
    return null;
  }

  const existing = db.prepare(
    "SELECT id FROM policy_rule_review_candidates WHERE policy_review_task_id = ?"
  ).get(task.id);
  if (existing) {
    return parsePolicyRuleReviewCandidateRow(
      db.prepare("SELECT * FROM policy_rule_review_candidates WHERE id = ?").get(existing.id)
    );
  }

  const policyRule = db.prepare(
    "SELECT id, review_status, enabled FROM policy_rules WHERE id = ?"
  ).get(task.policy_rule_id);
  if (!policyRule) {
    return null;
  }

  const candidateId = createId("policy_candidate");
  const targetReviewStatus = task.recommended_review_status;
  const recommendedReviewStatus = nextPolicyReviewStatus(policyRule.review_status || "draft_review", targetReviewStatus);
  const candidate = {
    action_type: "policy_rule_review_status_change",
    policy_rule_id: task.policy_rule_id,
    policy_review_task_id: task.id,
    source_policy_review_task_event_id: eventId,
    from_review_status: policyRule.review_status || "draft_review",
    recommended_review_status: recommendedReviewStatus,
    target_review_status: targetReviewStatus,
    recommended_by: "completed_policy_review_task",
    review_readiness: task.review_readiness,
    evidence_summary: task.task?.evidence_summary || {},
    sample_run_ids: task.task?.sample_run_ids || [],
    reviewer_decision_required: true,
    policy_rule_enabled_after_candidate: false,
    safety_boundary: "advisory_only_no_automatic_execution",
  };

  db.prepare(
    `INSERT INTO policy_rule_review_candidates (
      id, project_id, policy_rule_id, policy_review_task_id,
      from_review_status, recommended_review_status, status,
      candidate_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    candidateId,
    task.project_id,
    task.policy_rule_id,
    task.id,
    candidate.from_review_status,
    candidate.recommended_review_status,
    "pending",
    toJson(candidate),
    createdAt,
    createdAt
  );

  return parsePolicyRuleReviewCandidateRow(
    db.prepare("SELECT * FROM policy_rule_review_candidates WHERE id = ?").get(candidateId)
  );
}


function priorityForReviewPacket(rule, packet) {
  const readiness = packet?.review_readiness || "needs_more_data";
  const summary = packet?.evidence_summary || {};
  const base = readiness === "high_priority_review"
    ? 90
    : readiness === "sample_review_required"
      ? 60
      : 30;
  const severityBoost = rule.severity === "high" ? 8 : rule.severity === "medium" ? 4 : 0;
  const highRiskBoost = Math.min(Number(summary.high_risk_match_count || 0) * 3, 12);
  return Math.min(100, base + severityBoost + highRiskBoost);
}

function buildPolicyReviewTask(rule, result, dryRunEvidence) {
  const packet = result.review_packet || {};
  const summary = packet.evidence_summary || {};
  return {
    title: `Review policy draft: ${result.name}`,
    policy_rule_id: result.policy_rule_id,
    policy_dry_run_id: dryRunEvidence?.policy_dry_run_id || null,
    report_id: dryRunEvidence?.report_id || null,
    review_readiness: packet.review_readiness || "needs_more_data",
    recommended_review_status: packet.recommended_review_status || "draft_review",
    priority: priorityForReviewPacket(rule, packet),
    reviewer: "operator",
    review_questions: [
      "Are the matched historical runs true positives for this policy boundary?",
      "Would this policy create noisy false positives for normal agent work?",
      "Should these matched tools or outputs require human approval in future enforcement phases?",
      "Is the dry-run sample strong enough to move the draft to the recommended review status?",
    ],
    required_review_samples: packet.required_review_samples || [],
    sample_run_ids: summary.sample_run_ids || [],
    evidence_requirements: packet.evidence_requirements || [],
    evidence_summary: summary,
    recommended_next_action: packet.recommended_next_action || result.recommendation,
    false_positive_risk: summary.false_positive_risk || "unknown",
    safety_boundary: "advisory_only_no_automatic_execution",
  };
}

export function createPolicyReviewTasksFromDryRunResults(db, {
  projectId,
  reportId,
  results,
  dryRunEvidence,
  createdAt,
}) {
  const rows = Array.isArray(results) ? results : [];
  const evidenceByPolicy = new Map((dryRunEvidence || []).map((item) => [item.policy_rule_id, item]));
  const created = [];

  for (const result of rows) {
    if (!result.review_packet?.reviewer_decision_required) continue;
    const rule = {
      id: result.policy_rule_id,
      severity: result.severity,
    };
    const evidence = evidenceByPolicy.get(result.policy_rule_id);
    const task = buildPolicyReviewTask(rule, result, evidence);
    const priority = task.priority;

    db.prepare(
      `UPDATE policy_review_tasks
       SET status = 'superseded', updated_at = ?
       WHERE project_id = ?
         AND policy_rule_id = ?
         AND status IN ('open', 'in_review')`
    ).run(createdAt, projectId, result.policy_rule_id);

    const taskId = createId("policy_task");
    db.prepare(
      `INSERT INTO policy_review_tasks (
        id, project_id, policy_rule_id, policy_dry_run_id, report_id,
        review_readiness, recommended_review_status, priority, status,
        task_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      taskId,
      projectId,
      result.policy_rule_id,
      evidence?.policy_dry_run_id || null,
      reportId || evidence?.report_id || null,
      task.review_readiness,
      task.recommended_review_status,
      priority,
      "open",
      toJson(task),
      createdAt,
      createdAt
    );

    created.push({
      id: taskId,
      project_id: projectId,
      policy_rule_id: result.policy_rule_id,
      policy_dry_run_id: evidence?.policy_dry_run_id || null,
      report_id: reportId || evidence?.report_id || null,
      review_readiness: task.review_readiness,
      recommended_review_status: task.recommended_review_status,
      priority,
      status: "open",
      task,
      created_at: createdAt,
      updated_at: createdAt,
    });
  }

  return created.sort((a, b) => b.priority - a.priority || a.policy_rule_id.localeCompare(b.policy_rule_id));
}

export function listProjectPolicyReviewTasks(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
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
    if (options.reportId) {
      clauses.push("report_id = ?");
      params.push(options.reportId);
    }
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    params.push(limit);
    return db.prepare(
      `SELECT *
       FROM policy_review_tasks
       WHERE ${clauses.join(" AND ")}
       ORDER BY priority DESC, created_at DESC
       LIMIT ?`
    ).all(...params).map(parsePolicyReviewTaskRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function getPolicyReviewTask(taskId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    return parsePolicyReviewTaskRow(db.prepare("SELECT * FROM policy_review_tasks WHERE id = ?").get(taskId));
  } finally {
    if (!options.db) db.close();
  }
}

export function updatePolicyReviewTaskStatus(taskId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const task = parsePolicyReviewTaskRow(db.prepare("SELECT * FROM policy_review_tasks WHERE id = ?").get(taskId));
    if (!task) throw new Error(`Policy review task not found: ${taskId}`);

    const toStatus = String(payload.status || payload.to_status || "").trim();
    if (!toStatus) throw new Error("policy review task status is required");
    assertValidPolicyReviewTaskTransition(task.status, toStatus);

    const createdAt = options.createdAt || new Date().toISOString();
    const actorType = String(payload.actor_type || options.actorType || "user");
    const actorId = payload.actor_id || options.actorId || null;
    const note = payload.note ? String(payload.note) : null;
    const evidence = {
      ...(payload.evidence_json || payload.evidence || {}),
      recommended_review_status: task.recommended_review_status,
      policy_rule_enabled_after_transition: false,
      safety_boundary: "advisory_only_no_automatic_execution",
    };
    const project = db.prepare(
      `SELECT o.id AS org_id
       FROM projects p
       JOIN organizations o ON o.id = p.org_id
       WHERE p.id = ?`
    ).get(task.project_id);
    const eventId = createId("policy_task_event");

    let reviewCandidate = null;
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE policy_review_tasks SET status = ?, updated_at = ? WHERE id = ?")
        .run(toStatus, createdAt, taskId);
      db.prepare(
        `INSERT INTO policy_review_task_events (
          id, policy_review_task_id, project_id, policy_rule_id, actor_type,
          actor_id, from_status, to_status, note, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        taskId,
        task.project_id,
        task.policy_rule_id,
        actorType,
        actorId,
        task.status,
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
          task.project_id,
          actorType,
          actorId,
          "policy_review_task.status_updated",
          "policy_review_task",
          taskId,
          toJson({
            policy_review_task_event_id: eventId,
            policy_rule_id: task.policy_rule_id,
            from_status: task.status,
            to_status: toStatus,
            recommended_review_status: task.recommended_review_status,
            policy_rule_enabled_after_transition: false,
            safety_boundary: "advisory_only_no_automatic_execution",
          }),
          createdAt
        );
      }
      if (toStatus === "completed") {
        reviewCandidate = createPolicyRuleReviewCandidateFromCompletedTask(db, {
          task,
          eventId,
          createdAt,
        });
        if (reviewCandidate && project) {
          db.prepare(
            `INSERT INTO audit_events (
              id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            createId("audit"),
            project.org_id,
            task.project_id,
            "system",
            null,
            "policy_rule.review_candidate_created",
            "policy_rule_review_candidate",
            reviewCandidate.id,
            toJson({
              policy_rule_id: task.policy_rule_id,
              policy_review_task_id: task.id,
              recommended_review_status: task.recommended_review_status,
              policy_rule_enabled_after_candidate: false,
              safety_boundary: "advisory_only_no_automatic_execution",
            }),
            createdAt
          );
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      policy_review_task: parsePolicyReviewTaskRow(db.prepare("SELECT * FROM policy_review_tasks WHERE id = ?").get(taskId)),
      policy_review_task_event: parsePolicyReviewTaskEventRow(db.prepare("SELECT * FROM policy_review_task_events WHERE id = ?").get(eventId)),
      policy_rule_review_candidate: reviewCandidate,
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function listProjectPolicyRuleReviewCandidates(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const clauses = ["project_id = ?"];
    const params = [projectId];
    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }
    if (options.policyRuleId) {
      clauses.push("policy_rule_id = ?");
      params.push(options.policyRuleId);
    }
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    params.push(limit);
    return db.prepare(
      `SELECT *
       FROM policy_rule_review_candidates
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parsePolicyRuleReviewCandidateRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function getPolicyRuleReviewCandidate(candidateId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    return parsePolicyRuleReviewCandidateRow(
      db.prepare("SELECT * FROM policy_rule_review_candidates WHERE id = ?").get(candidateId)
    );
  } finally {
    if (!options.db) db.close();
  }
}

export function updatePolicyRuleReviewCandidateStatus(candidateId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const candidate = parsePolicyRuleReviewCandidateRow(
      db.prepare("SELECT * FROM policy_rule_review_candidates WHERE id = ?").get(candidateId)
    );
    if (!candidate) throw new Error(`Policy review candidate not found: ${candidateId}`);

    const toStatus = String(payload.status || payload.to_status || "").trim();
    if (!toStatus) throw new Error("policy review candidate status is required");
    assertValidPolicyReviewCandidateTransition(candidate.status, toStatus);

    const createdAt = options.createdAt || new Date().toISOString();
    const actorType = String(payload.actor_type || options.actorType || "user");
    const actorId = payload.actor_id || options.actorId || null;
    const note = payload.note ? String(payload.note) : null;
    const evidence = {
      ...(payload.evidence_json || payload.evidence || {}),
      recommended_review_status: candidate.recommended_review_status,
      policy_rule_enabled_after_transition: false,
      safety_boundary: "advisory_only_no_automatic_execution",
    };
    const project = db.prepare(
      `SELECT o.id AS org_id
       FROM projects p
       JOIN organizations o ON o.id = p.org_id
       WHERE p.id = ?`
    ).get(candidate.project_id);
    const eventId = createId("policy_candidate_event");
    let policyRuleUpdate = null;

    db.exec("BEGIN");
    try {
      db.prepare("UPDATE policy_rule_review_candidates SET status = ?, updated_at = ? WHERE id = ?")
        .run(toStatus, createdAt, candidateId);
      db.prepare(
        `INSERT INTO policy_rule_review_candidate_events (
          id, policy_rule_review_candidate_id, project_id, policy_rule_id,
          actor_type, actor_id, from_status, to_status, note, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        candidateId,
        candidate.project_id,
        candidate.policy_rule_id,
        actorType,
        actorId,
        candidate.status,
        toStatus,
        note,
        toJson(evidence),
        createdAt
      );

      if (toStatus === "accepted") {
        policyRuleUpdate = updatePolicyRuleReviewStatus(candidate.policy_rule_id, {
          status: candidate.recommended_review_status,
          note: note || "Accepted policy review candidate.",
          evidence: {
            ...evidence,
            source_policy_rule_review_candidate_id: candidateId,
            source_policy_review_task_id: candidate.policy_review_task_id,
          },
          actor_type: actorType,
          actor_id: actorId,
        }, {
          db,
          skipMigrate: true,
          inTransaction: true,
          createdAt,
        });
      }

      if (project) {
        db.prepare(
          `INSERT INTO audit_events (
            id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          createId("audit"),
          project.org_id,
          candidate.project_id,
          actorType,
          actorId,
          "policy_rule.review_candidate_status_updated",
          "policy_rule_review_candidate",
          candidateId,
          toJson({
            policy_rule_review_candidate_event_id: eventId,
            policy_rule_id: candidate.policy_rule_id,
            from_status: candidate.status,
            to_status: toStatus,
            recommended_review_status: candidate.recommended_review_status,
            applied_policy_rule_status_change: Boolean(policyRuleUpdate),
            policy_rule_enabled_after_transition: false,
            safety_boundary: "advisory_only_no_automatic_execution",
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
      policy_rule_review_candidate: parsePolicyRuleReviewCandidateRow(
        db.prepare("SELECT * FROM policy_rule_review_candidates WHERE id = ?").get(candidateId)
      ),
      policy_rule_review_candidate_event: parsePolicyRuleReviewCandidateEventRow(
        db.prepare("SELECT * FROM policy_rule_review_candidate_events WHERE id = ?").get(eventId)
      ),
      policy_rule_update: policyRuleUpdate,
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function listProjectPolicyRuleReviewCandidateEvents(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    return db.prepare(
      `SELECT *
       FROM policy_rule_review_candidate_events
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(projectId, limit).map(parsePolicyRuleReviewCandidateEventRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function listPolicyReviewTaskEvents(taskId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    return db.prepare(
      `SELECT *
       FROM policy_review_task_events
       WHERE policy_review_task_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(taskId, limit).map(parsePolicyReviewTaskEventRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function listProjectPolicyReviewTaskEvents(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    return db.prepare(
      `SELECT *
       FROM policy_review_task_events
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(projectId, limit).map(parsePolicyReviewTaskEventRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function persistPolicyDryRunEvidence(db, {
  projectId,
  reportId,
  periodStart,
  periodEnd,
  results,
  createdAt,
}) {
  const rows = Array.isArray(results) ? results : [];
  const existing = db.prepare("SELECT id FROM policy_dry_runs WHERE report_id = ?").all(reportId);

  for (const row of existing) {
    db.prepare("DELETE FROM policy_dry_run_matches WHERE policy_dry_run_id = ?").run(row.id);
  }
  db.prepare("DELETE FROM policy_dry_runs WHERE report_id = ?").run(reportId);

  const persisted = [];
  const insertDryRun = db.prepare(
    `INSERT INTO policy_dry_runs (
      id, project_id, policy_rule_id, report_id, period_start, period_end,
      match_count, high_risk_match_count, summary_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMatch = db.prepare(
    `INSERT INTO policy_dry_run_matches (
      id, policy_dry_run_id, agent_run_id, judgement_id, risk_score,
      overall_status, matched_tools, reasons_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const result of rows) {
    const matches = evidenceMatchesFor(result);
    const summary = summarizePersistedResult(result, matches);
    const dryRunId = createId("policy_dry_run");
    const highRiskMatchCount = summary.high_risk_match_count;

    insertDryRun.run(
      dryRunId,
      projectId,
      result.policy_rule_id,
      reportId,
      periodStart,
      periodEnd,
      Number(result.match_count || matches.length || 0),
      highRiskMatchCount,
      toJson(summary),
      result.enabled ? "enabled_monitoring" : "draft_review",
      createdAt
    );

    for (const match of matches) {
      insertMatch.run(
        createId("policy_dry_run_match"),
        dryRunId,
        match.run_id,
        match.judgement_id || null,
        Number(match.risk_score || 0),
        match.overall_status || "unanalyzed",
        toJson(match.matched_tools || []),
        toJson(match.reasons || []),
        createdAt
      );
    }

    persisted.push({
      policy_dry_run_id: dryRunId,
      policy_rule_id: result.policy_rule_id,
      report_id: reportId,
      name: result.name,
      status: result.enabled ? "enabled_monitoring" : "draft_review",
      match_count: Number(result.match_count || matches.length || 0),
      high_risk_match_count: highRiskMatchCount,
      match_evidence_count: matches.length,
    });
  }

  return persisted;
}

export function listPolicyDryRunEvidence(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["d.project_id = ?"];
    const params = [projectId];

    if (options.reportId) {
      clauses.push("d.report_id = ?");
      params.push(options.reportId);
    }

    if (options.policyRuleId) {
      clauses.push("d.policy_rule_id = ?");
      params.push(options.policyRuleId);
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    params.push(limit);

    return db.prepare(
      `SELECT d.*, p.name AS policy_name, p.severity AS policy_severity
       FROM policy_dry_runs d
       JOIN policy_rules p ON p.id = d.policy_rule_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY d.created_at DESC, d.id ASC
       LIMIT ?`
    ).all(...params).map(parseDryRunEvidenceRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function dryRunPolicyRules(projectId, dateString, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const { start, end } = dayRange(dateString);
    const rules = listProjectPolicyRules(projectId, {
      db,
      skipMigrate: true,
      enabled: options.includeEnabled ? undefined : false,
      limit: options.limit || 100,
    });
    const runs = queryRunsWithJudgements(db, projectId, start, end);
    const results = rules.map((rule) => {
      const matches = runs
        .map((run) => matchRuleToRun(rule, run))
        .filter(Boolean)
        .sort((a, b) => Number(b.risk_score || 0) - Number(a.risk_score || 0) || a.run_id.localeCompare(b.run_id));

      return {
        policy_rule_id: rule.id,
        name: rule.name,
        rule_type: rule.rule_type,
        severity: rule.severity,
        enabled: Boolean(rule.enabled),
        review_status: rule.review_status || "draft_review",
        version: rule.version,
        config_json: rule.config_json,
        match_count: matches.length,
        matched_run_ids: matches.map((match) => match.run_id),
        matches: matches.slice(0, Number(options.matchLimit || 10)),
        review_packet: buildPolicyReviewPacket(rule, matches),
        ...(options.includeEvidenceMatches ? { evidence_matches: matches } : {}),
        recommendation: rule.enabled
          ? "Monitor enforced policy performance and false positives."
          : "Review the matched runs before enabling this policy as a human-review gate.",
      };
    });
    const matchedRunIds = new Set(results.flatMap((result) => result.matched_run_ids));
    const highRiskMatchedRunIds = new Set(
      results.flatMap((result) => result.matches.filter((match) => Number(match.risk_score || 0) >= 75).map((match) => match.run_id))
    );

    return {
      project_id: projectId,
      period_start: start,
      period_end: end,
      summary: {
        rule_count: rules.length,
        draft_rule_count: rules.filter((rule) => !rule.enabled).length,
        rules_with_matches: results.filter((result) => result.match_count > 0).length,
        total_matches: results.reduce((sum, result) => sum + result.match_count, 0),
        matched_run_count: matchedRunIds.size,
        high_risk_matched_run_count: highRiskMatchedRunIds.size,
      },
      results,
      markdown_lines: results.map(dryRunLine),
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
