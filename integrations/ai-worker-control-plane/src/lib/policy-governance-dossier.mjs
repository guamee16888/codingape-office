import { fromJson, migrate, openDatabase, toJson } from "./db.mjs";
import { createId } from "./ids.mjs";
import { getPolicyRule } from "./policy-rules.mjs";

const SAFETY_BOUNDARY = "advisory_only_no_automatic_execution";
const POLICY_WORK_ITEM_EVENT_TYPES = new Set([
  "acknowledged",
  "evidence_attached",
  "completed",
  "dismissed",
  "reopened",
  "note_added",
]);

function limitValue(value, fallback = 100) {
  return Math.max(1, Math.min(Number(value || fallback), 500));
}

function parsePolicyDryRunRow(row) {
  if (!row) return null;
  return {
    ...row,
    match_count: Number(row.match_count || 0),
    high_risk_match_count: Number(row.high_risk_match_count || 0),
    summary_json: fromJson(row.summary_json, {}),
  };
}

function parsePolicyDryRunMatchRow(row) {
  if (!row) return null;
  return {
    ...row,
    risk_score: Number(row.risk_score || 0),
    matched_tools: fromJson(row.matched_tools, []),
    reasons: fromJson(row.reasons_json, []),
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

function parseEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: fromJson(row.evidence_json, {}),
  };
}

function parseCandidateRow(row) {
  if (!row) return null;
  return {
    ...row,
    candidate: fromJson(row.candidate_json, {}),
  };
}

function parseAuditEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: fromJson(row.metadata, {}),
  };
}

function parseWorkItemEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: fromJson(row.evidence_json, {}),
    workbench_snapshot: fromJson(row.workbench_snapshot_json, {}),
  };
}

function parseWorkItemEffectivenessRow(row) {
  if (!row) return null;
  return {
    ...row,
    source_readiness_score: Number(row.source_readiness_score || 0),
    current_readiness_score: Number(row.current_readiness_score || 0),
    readiness_score_delta: Number(row.readiness_score_delta || 0),
    blocker_cleared: Boolean(row.blocker_cleared),
    effectiveness: fromJson(row.effectiveness_json, {}),
  };
}

function parseLearningRuleRow(row) {
  if (!row) return null;
  return {
    ...row,
    confidence: Number(row.confidence || 0),
    source_feedback_count: Number(row.source_feedback_count || 0),
    pattern_json: fromJson(row.pattern_json, {}),
    evidence_json: fromJson(row.evidence_json, {}),
  };
}

function parseSuggestionRow(row) {
  return row ? { ...row } : null;
}

function sourceFromPolicyRule(db, policyRule) {
  const config = policyRule?.config_json || {};
  if (config.source === "approved_suggestion" || config.suggestion_id) {
    const suggestion = parseSuggestionRow(db.prepare(
      "SELECT * FROM optimization_suggestions WHERE id = ?"
    ).get(config.suggestion_id));
    return {
      type: "approved_suggestion",
      suggestion_id: config.suggestion_id || null,
      suggestion,
      evidence: {
        human_feedback_required: true,
        created_from_approved_feedback: Boolean(suggestion && suggestion.status === "approved"),
      },
    };
  }

  if (config.source === "trusted_learning_rule" || config.source_learning_rule_id) {
    const learningRule = parseLearningRuleRow(db.prepare(
      "SELECT * FROM learning_rules WHERE id = ?"
    ).get(config.source_learning_rule_id));
    return {
      type: "trusted_learning_rule",
      learning_rule_id: config.source_learning_rule_id || null,
      learning_rule: learningRule,
      evidence: {
        trusted_rule_required: true,
        current_learning_rule_status: learningRule?.status || "unknown",
      },
    };
  }

  return {
    type: "manual_or_unknown",
    evidence: {
      reason: "No approved suggestion or trusted learning rule source found in policy config.",
    },
  };
}

function loadDryRuns(db, policyRuleId, limit) {
  const dryRuns = db.prepare(
    `SELECT *
     FROM policy_dry_runs
     WHERE policy_rule_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(policyRuleId, limit).map(parsePolicyDryRunRow);

  return dryRuns.map((dryRun) => {
    const matches = db.prepare(
      `SELECT *
       FROM policy_dry_run_matches
       WHERE policy_dry_run_id = ?
       ORDER BY risk_score DESC, created_at DESC`
    ).all(dryRun.id).map(parsePolicyDryRunMatchRow);
    return { ...dryRun, matches };
  });
}

function loadTasks(db, policyRuleId, limit) {
  const tasks = db.prepare(
    `SELECT *
     FROM policy_review_tasks
     WHERE policy_rule_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(policyRuleId, limit).map(parsePolicyReviewTaskRow);

  return tasks.map((task) => {
    const events = db.prepare(
      `SELECT *
       FROM policy_review_task_events
       WHERE policy_review_task_id = ?
       ORDER BY created_at ASC`
    ).all(task.id).map(parseEventRow);
    return { ...task, events };
  });
}

function loadCandidates(db, policyRuleId, limit) {
  const candidates = db.prepare(
    `SELECT *
     FROM policy_rule_review_candidates
     WHERE policy_rule_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(policyRuleId, limit).map(parseCandidateRow);

  return candidates.map((candidate) => {
    const events = db.prepare(
      `SELECT *
       FROM policy_rule_review_candidate_events
       WHERE policy_rule_review_candidate_id = ?
       ORDER BY created_at ASC`
    ).all(candidate.id).map(parseEventRow);
    return { ...candidate, events };
  });
}

function loadPolicyRuleEvents(db, policyRuleId, limit) {
  return db.prepare(
    `SELECT *
     FROM policy_rule_events
     WHERE policy_rule_id = ?
     ORDER BY created_at ASC
     LIMIT ?`
  ).all(policyRuleId, limit).map(parseEventRow);
}

function metadataReferences(metadata, ids) {
  const text = JSON.stringify(metadata || {});
  return ids.some((id) => id && text.includes(id));
}

function loadRelevantAuditEvents(db, policyRule, tasks, candidates, limit) {
  const ids = new Set([
    policyRule.id,
    ...tasks.map((task) => task.id),
    ...candidates.map((candidate) => candidate.id),
    ...tasks.map((task) => task.policy_dry_run_id).filter(Boolean),
    ...candidates.map((candidate) => candidate.policy_review_task_id).filter(Boolean),
  ]);
  const rows = db.prepare(
    `SELECT *
     FROM audit_events
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(policyRule.project_id, limit).map(parseAuditEventRow);

  return rows.filter((event) => (
    ids.has(event.target_id) ||
    event.target_id === policyRule.id ||
    metadataReferences(event.metadata, [...ids])
  ));
}

function summarizeDossier(policyRule, dryRuns, tasks, candidates, policyEvents, auditEvents) {
  const matchEvidenceCount = dryRuns.reduce((sum, item) => sum + item.matches.length, 0);
  const highRiskMatchCount = dryRuns.reduce((sum, item) => sum + Number(item.high_risk_match_count || 0), 0);
  const taskEventCount = tasks.reduce((sum, item) => sum + item.events.length, 0);
  const candidateEventCount = candidates.reduce((sum, item) => sum + item.events.length, 0);
  const latestTask = tasks[0] || null;
  const latestCandidate = candidates[0] || null;

  return {
    enabled: Boolean(policyRule.enabled),
    review_status: policyRule.review_status || "draft_review",
    dry_run_count: dryRuns.length,
    match_evidence_count: matchEvidenceCount,
    high_risk_match_count: highRiskMatchCount,
    review_task_count: tasks.length,
    review_task_event_count: taskEventCount,
    review_candidate_count: candidates.length,
    review_candidate_event_count: candidateEventCount,
    policy_rule_event_count: policyEvents.length,
    audit_event_count: auditEvents.length,
    latest_review_task_status: latestTask?.status || null,
    latest_candidate_status: latestCandidate?.status || null,
    safety_boundary: SAFETY_BOUNDARY,
  };
}

function nextReviewStatus(currentStatus) {
  if (currentStatus === "draft_review") return "reviewed";
  if (currentStatus === "reviewed") return "approved_for_dry_run";
  if (currentStatus === "approved_for_dry_run") return "ready_to_enable_later";
  return null;
}

function sourceIsVerified(source) {
  if (source.type === "approved_suggestion") {
    return Boolean(source.suggestion && source.suggestion.status === "approved");
  }
  if (source.type === "trusted_learning_rule") {
    return Boolean(source.learning_rule && source.learning_rule.status === "trusted");
  }
  return false;
}

function completedReviewTasks(tasks) {
  return tasks.filter((task) => task.status === "completed");
}

function acceptedCandidates(candidates) {
  return candidates.filter((candidate) => candidate.status === "accepted");
}

function pendingCandidates(candidates) {
  return candidates.filter((candidate) => candidate.status === "pending");
}

function matchedDryRuns(dryRuns) {
  return dryRuns.filter((dryRun) => Number(dryRun.match_count || 0) > 0 || (dryRun.matches || []).length > 0);
}

function acceptedCandidateTargets(candidates) {
  return acceptedCandidates(candidates).map((candidate) => ({
    candidate_id: candidate.id,
    recommended_review_status: candidate.recommended_review_status,
    target_review_status: candidate.candidate?.target_review_status || candidate.recommended_review_status,
    from_review_status: candidate.from_review_status,
  }));
}

function requirement(code, passed, description, evidence = {}) {
  return {
    code,
    passed: Boolean(passed),
    description,
    evidence,
  };
}

function readinessStatusFromRequirements({ policyRule, requirements, currentStatus, nextStatus }) {
  if (policyRule.enabled) return "blocked_policy_already_enabled";
  if (currentStatus === "rejected") return "blocked_policy_rejected";
  if (!nextStatus) return "phase1_terminal_review_state";
  if (requirements.every((item) => item.passed)) return "ready_for_next_review_status";
  return "blocked_missing_evidence";
}

function readinessScore(requirements, currentStatus) {
  if (currentStatus === "ready_to_enable_later") return 100;
  if (!requirements.length) return 0;
  const passed = requirements.filter((item) => item.passed).length;
  return Math.round((passed / requirements.length) * 100);
}

function buildAdvancementRequirements({ policyRule, source, dryRuns, tasks, candidates }) {
  const currentStatus = policyRule.review_status || "draft_review";
  const nextStatus = nextReviewStatus(currentStatus);
  const dryRunsWithMatches = matchedDryRuns(dryRuns);
  const completedTasks = completedReviewTasks(tasks);
  const pending = pendingCandidates(candidates);
  const accepted = acceptedCandidates(candidates);
  const targetAccepted = acceptedCandidateTargets(candidates);
  const baseRequirements = [
    requirement("policy_stays_disabled", !policyRule.enabled, "Policy remains disabled during Phase 1.", { enabled: Boolean(policyRule.enabled) }),
    requirement("verified_policy_source", sourceIsVerified(source), "Policy source is an approved suggestion or trusted learning rule.", { source_type: source.type }),
    requirement("dry_run_evidence_exists", dryRuns.length > 0, "At least one policy dry-run evidence batch exists.", { dry_run_count: dryRuns.length }),
    requirement("match_evidence_exists", dryRunsWithMatches.length > 0, "Dry-run evidence contains matched historical runs.", { matched_dry_run_count: dryRunsWithMatches.length }),
  ];

  if (currentStatus === "draft_review") {
    return [
      ...baseRequirements,
      requirement("human_review_task_exists", tasks.length > 0, "A human review task exists for the policy draft.", { review_task_count: tasks.length }),
      requirement("review_task_completed", completedTasks.length > 0, "At least one policy review task was completed.", { completed_review_task_count: completedTasks.length }),
      requirement("pending_or_accepted_candidate_exists", pending.length > 0 || accepted.length > 0, "A review candidate exists after completed review work.", {
        pending_candidate_count: pending.length,
        accepted_candidate_count: accepted.length,
      }),
    ];
  }

  if (currentStatus === "reviewed") {
    return [
      ...baseRequirements,
      requirement("reviewed_status_has_event", targetAccepted.some((item) => item.recommended_review_status === "reviewed"), "The reviewed status is backed by an accepted candidate event.", { accepted_candidate_targets: targetAccepted }),
      requirement("completed_review_task_exists", completedTasks.length > 0, "Completed review task evidence exists.", { completed_review_task_count: completedTasks.length }),
      requirement("next_step_target_recorded", targetAccepted.some((item) => item.target_review_status === "approved_for_dry_run"), "The accepted candidate preserved approved_for_dry_run as the target follow-up state.", { accepted_candidate_targets: targetAccepted }),
    ];
  }

  if (currentStatus === "approved_for_dry_run") {
    return [
      ...baseRequirements,
      requirement("multiple_dry_run_windows", dryRuns.length >= 2, "At least two dry-run windows support the policy before ready-to-enable review.", { dry_run_count: dryRuns.length }),
      requirement("no_open_review_tasks", tasks.every((task) => !["open", "in_review", "needs_more_evidence"].includes(task.status)), "No open policy review tasks remain.", { open_task_count: tasks.filter((task) => ["open", "in_review", "needs_more_evidence"].includes(task.status)).length }),
      requirement("human_enable_review_required", false, "Phase 1 requires a future human enable review before any enforcement discussion.", { phase_1_can_enable_policy: false }),
    ];
  }

  return baseRequirements;
}

function buildAdvancementBlockers(requirements) {
  return requirements
    .filter((item) => !item.passed)
    .map((item) => ({
      code: item.code,
      severity: item.code === "policy_stays_disabled" || item.code === "verified_policy_source" ? "high" : "medium",
      description: item.description,
      evidence: item.evidence,
    }));
}

function nextActionForAdvancement(status, nextStatus, blockers) {
  if (status === "ready_for_next_review_status" && nextStatus) {
    return `Human reviewer may consider moving this draft to ${nextStatus}.`;
  }
  if (status === "phase1_terminal_review_state") {
    return "Keep the policy disabled and retain the evidence for future enforcement design.";
  }
  if (blockers.length > 0) {
    return `Resolve ${blockers.length} evidence gap(s) before moving to the next review status.`;
  }
  return "Keep collecting advisory evidence.";
}

export function evaluatePolicyAdvancementReadiness({ policyRule, source, dryRuns, tasks, candidates }) {
  const currentStatus = policyRule.review_status || "draft_review";
  const nextStatus = nextReviewStatus(currentStatus);
  const requirements = buildAdvancementRequirements({ policyRule, source, dryRuns, tasks, candidates });
  const blockers = buildAdvancementBlockers(requirements);
  const status = readinessStatusFromRequirements({ policyRule, requirements, currentStatus, nextStatus });

  return {
    readiness_version: "2026-05-22.policy-advancement.v1",
    current_review_status: currentStatus,
    next_review_status: nextStatus,
    advancement_status: status,
    readiness_score: readinessScore(requirements, currentStatus),
    can_advance_review_status: status === "ready_for_next_review_status",
    can_enable_policy: false,
    can_enforce_policy: false,
    safety_boundary: SAFETY_BOUNDARY,
    requirements,
    blockers,
    next_action: nextActionForAdvancement(status, nextStatus, blockers),
  };
}

export function buildPolicyGovernanceDossier(policyRuleId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const policyRule = getPolicyRule(policyRuleId, { db, skipMigrate: true });
    if (!policyRule) return null;

    const limit = limitValue(options.limit);
    const source = sourceFromPolicyRule(db, policyRule);
    const dryRuns = loadDryRuns(db, policyRuleId, limit);
    const tasks = loadTasks(db, policyRuleId, limit);
    const candidates = loadCandidates(db, policyRuleId, limit);
    const policyRuleEvents = loadPolicyRuleEvents(db, policyRuleId, limit);
    const auditEvents = loadRelevantAuditEvents(db, policyRule, tasks, candidates, limit);
    const summary = summarizeDossier(policyRule, dryRuns, tasks, candidates, policyRuleEvents, auditEvents);
    const advancementReadiness = evaluatePolicyAdvancementReadiness({
      policyRule,
      source,
      dryRuns,
      tasks,
      candidates,
    });

    return {
      dossier_version: "2026-05-22.policy-governance.v1",
      dossier_type: "policy_governance_dossier",
      policy_rule_id: policyRule.id,
      project_id: policyRule.project_id,
      generated_at: options.generatedAt || new Date().toISOString(),
      safety_boundary: SAFETY_BOUNDARY,
      phase_1_boundary: {
        read_only: true,
        advisory_only: true,
        policy_enabled_after_dossier: Boolean(policyRule.enabled),
        automatic_execution_allowed: false,
        automatic_enforcement_allowed: false,
      },
      summary,
      advancement_readiness: advancementReadiness,
      policy_rule: policyRule,
      source,
      dry_runs: dryRuns,
      review_tasks: tasks,
      review_candidates: candidates,
      policy_rule_events: policyRuleEvents,
      audit_events: auditEvents,
      evidence_chain: {
        source_type: source.type,
        dry_run_ids: dryRuns.map((item) => item.id),
        match_evidence_ids: dryRuns.flatMap((item) => item.matches.map((match) => match.id)),
        review_task_ids: tasks.map((item) => item.id),
        review_task_event_ids: tasks.flatMap((item) => item.events.map((event) => event.id)),
        review_candidate_ids: candidates.map((item) => item.id),
        review_candidate_event_ids: candidates.flatMap((item) => item.events.map((event) => event.id)),
        policy_rule_event_ids: policyRuleEvents.map((item) => item.id),
        audit_event_ids: auditEvents.map((item) => item.id),
      },
      recommended_next_steps: [
        "Keep the policy disabled in Phase 1 until a human explicitly approves any later enforcement path.",
        "Review dry-run match samples and record false-positive decisions before moving beyond advisory evidence.",
        "Use this dossier as the audit trail for why the policy draft exists and how review status changed.",
      ],
    };
  } finally {
    if (!options.db) db.close();
  }
}

function lineForDryRun(dryRun) {
  return `- ${dryRun.id}: matches=${dryRun.match_count}, high_risk=${dryRun.high_risk_match_count}, status=${dryRun.status}, report=${dryRun.report_id}`;
}

function lineForTask(task) {
  return `- ${task.id}: status=${task.status}, readiness=${task.review_readiness}, recommended=${task.recommended_review_status}, events=${task.events.length}`;
}

function lineForCandidate(candidate) {
  return `- ${candidate.id}: status=${candidate.status}, ${candidate.from_review_status} -> ${candidate.recommended_review_status}, events=${candidate.events.length}`;
}

function lineForEvent(event) {
  return `- ${event.created_at}: ${event.from_status} -> ${event.to_status} (${event.actor_type}${event.actor_id ? `:${event.actor_id}` : ""})`;
}

function lineForAudit(event) {
  return `- ${event.created_at}: ${event.action} target=${event.target_type}/${event.target_id || "none"}`;
}

function lineForRequirement(item) {
  return `- ${item.passed ? "pass" : "gap"}: ${item.code} - ${item.description}`;
}

function lineForBlocker(item) {
  return `- ${item.severity}: ${item.code} - ${item.description}`;
}

function workItemForBlocker(blocker, context = {}) {
  const policyRuleId = context.policyRuleId;
  const projectId = context.projectId;
  const latestTask = context.latestTask;
  const byCode = {
    verified_policy_source: {
      action_type: "verify_policy_source",
      title: "Verify policy source before review advancement",
      operator_command: `Inspect policy source in governance dossier for ${policyRuleId}.`,
      evidence_required: ["Approved suggestion status or trusted learning rule status"],
    },
    dry_run_evidence_exists: {
      action_type: "run_policy_dry_run",
      title: "Generate policy dry-run evidence",
      operator_command: `Run nightly report or GET /api/projects/${projectId}/policy-dry-run?policy_rule_id=${policyRuleId}.`,
      evidence_required: ["At least one persisted policy_dry_runs row for this policy"],
    },
    match_evidence_exists: {
      action_type: "collect_matching_run_evidence",
      title: "Collect matched historical run evidence",
      operator_command: `Ingest more relevant agent runs, then rerun policy dry-run for ${policyRuleId}.`,
      evidence_required: ["At least one policy_dry_run_matches row with reasons and matched tools"],
    },
    human_review_task_exists: {
      action_type: "generate_review_task",
      title: "Generate human review task from dry-run packet",
      operator_command: "Run nightly report generation after dry-run evidence exists.",
      evidence_required: ["policy_review_tasks row with sample runs and review questions"],
    },
    review_task_completed: {
      action_type: "complete_review_task",
      title: "Complete policy review task with evidence",
      operator_command: latestTask?.id
        ? `PATCH /api/policy-review-tasks/${latestTask.id} with status=completed after reviewing samples.`
        : "Open the latest policy review task, review samples, and mark it completed with evidence.",
      evidence_required: ["Reviewer note", "True-positive/false-positive decision", "Reviewed sample run IDs"],
    },
    pending_or_accepted_candidate_exists: {
      action_type: "create_review_candidate_from_completed_task",
      title: "Create or inspect policy review candidate",
      operator_command: latestTask?.id
        ? `Complete policy review task ${latestTask.id}; the system will create a pending candidate if eligible.`
        : "Complete a policy review task to create a candidate.",
      evidence_required: ["policy_rule_review_candidates row remains pending or accepted"],
    },
    reviewed_status_has_event: {
      action_type: "accept_review_candidate",
      title: "Accept a valid review candidate",
      operator_command: "PATCH /api/policy-review-candidates/[candidateId] with status=accepted after human decision.",
      evidence_required: ["Accepted candidate event", "Policy rule event moving status to reviewed"],
    },
    completed_review_task_exists: {
      action_type: "complete_review_task",
      title: "Complete policy review task",
      operator_command: latestTask?.id
        ? `PATCH /api/policy-review-tasks/${latestTask.id} with status=completed.`
        : "Complete a policy review task with evidence.",
      evidence_required: ["Completed policy_review_tasks row"],
    },
    next_step_target_recorded: {
      action_type: "preserve_target_review_status",
      title: "Preserve target review status in candidate evidence",
      operator_command: "Regenerate candidate from a completed task whose packet recommends approved_for_dry_run.",
      evidence_required: ["candidate.target_review_status = approved_for_dry_run"],
    },
    multiple_dry_run_windows: {
      action_type: "collect_additional_dry_run_window",
      title: "Collect another dry-run window",
      operator_command: "Run at least one more nightly policy dry-run on a later evidence window.",
      evidence_required: ["Two or more policy_dry_runs rows for this policy"],
    },
    no_open_review_tasks: {
      action_type: "resolve_open_review_tasks",
      title: "Resolve open review tasks",
      operator_command: "Complete, reject, or supersede open review tasks after human review.",
      evidence_required: ["No open, in_review, or needs_more_evidence policy_review_tasks"],
    },
    human_enable_review_required: {
      action_type: "future_enable_review_required",
      title: "Future human enable review required",
      operator_command: "Do not enable in Phase 1; retain evidence for future enforcement design.",
      evidence_required: ["Human enable-review process in a later phase"],
    },
  };
  const template = byCode[blocker.code] || {
    action_type: "review_evidence_gap",
    title: `Resolve ${blocker.code}`,
    operator_command: "Review governance dossier and attach missing evidence.",
    evidence_required: ["Operator-reviewed evidence"],
  };

  return {
    id: `policy_work_${blocker.code}`,
    policy_rule_id: policyRuleId,
    blocker_code: blocker.code,
    priority: blocker.severity === "high" ? 90 : 60,
    severity: blocker.severity,
    status: "open",
    safety_boundary: SAFETY_BOUNDARY,
    mutates_state: false,
    can_enable_policy: false,
    ...template,
    blocker,
  };
}

function readyAdvancementWorkItem(dossier) {
  const readiness = dossier.advancement_readiness || {};
  if (!readiness.can_advance_review_status || !readiness.next_review_status) return null;
  return {
    id: "policy_work_consider_review_advancement",
    policy_rule_id: dossier.policy_rule_id,
    action_type: "consider_review_status_advancement",
    title: `Human review may consider ${readiness.next_review_status}`,
    priority: 80,
    severity: "medium",
    status: "ready_for_human_decision",
    operator_command: `PATCH /api/policy-rules/${dossier.policy_rule_id} with status=${readiness.next_review_status} only after human approval.`,
    evidence_required: [
      "Governance dossier reviewed",
      "Dry-run samples reviewed",
      "False-positive risk accepted by human reviewer",
    ],
    safety_boundary: SAFETY_BOUNDARY,
    mutates_state: false,
    can_enable_policy: false,
    can_enforce_policy: false,
  };
}

function listActivePolicyWorkItemLearningRules(db, projectId) {
  return db.prepare(
    `SELECT *
     FROM learning_rules
     WHERE project_id = ?
       AND status IN ('active', 'trusted')
       AND rule_type IN (
         'boost_policy_work_item_pattern',
         'monitor_policy_work_item_pattern',
         'deprioritize_policy_work_item_pattern',
         'suppress_policy_work_item_pattern'
       )
     ORDER BY confidence DESC, updated_at DESC
     LIMIT 200`
  ).all(projectId).map(parseLearningRuleRow);
}

function learningRuleMatchesWorkItem(rule, item) {
  const pattern = rule.pattern_json || {};
  if (pattern.target !== "policy_review_work_item_effectiveness") return false;
  if (pattern.blocker_code && pattern.blocker_code !== item.blocker_code) return false;
  if (pattern.action_type && pattern.action_type !== item.action_type) return false;
  const latestEventType = item.latest_event?.event_type || pattern.event_type;
  if (pattern.event_type && latestEventType && pattern.event_type !== latestEventType) return false;
  return true;
}

function adjustmentForPolicyWorkItemRule(rule) {
  const magnitude = Math.max(1, Math.round(Number(rule.confidence || 0) * 10));
  if (rule.rule_type === "boost_policy_work_item_pattern") return magnitude;
  if (rule.rule_type === "deprioritize_policy_work_item_pattern") return -magnitude;
  if (rule.rule_type === "suppress_policy_work_item_pattern") return -(magnitude + 8);
  return 0;
}

function applyPolicyWorkItemLearningRules(workItems, learningRules = []) {
  const activeRules = learningRules.filter((rule) => ["active", "trusted"].includes(rule.status));
  return workItems.map((item) => {
    const matchedRules = activeRules.filter((rule) => learningRuleMatchesWorkItem(rule, item));
    const adjustment = matchedRules.reduce((sum, rule) => sum + adjustmentForPolicyWorkItemRule(rule), 0);
    const priority = Math.max(1, Math.min(100, Number(item.priority || 0) + adjustment));
    return {
      ...item,
      priority,
      base_priority: item.priority,
      learning_priority_adjustment: {
        adjustment,
        matched_rule_count: matchedRules.length,
        reasons: matchedRules.map((rule) => ({
          learning_rule_id: rule.id,
          rule_type: rule.rule_type,
          confidence: rule.confidence,
          latest_effectiveness_status: rule.evidence_json?.latest_effectiveness_status || null,
        })),
        safety_boundary: SAFETY_BOUNDARY,
      },
    };
  });
}

export function buildPolicyReviewWorkbenchFromDossier(dossier, options = {}) {
  if (!dossier) return null;
  const existingEvents = Array.isArray(dossier.policy_review_work_item_events)
    ? dossier.policy_review_work_item_events
    : [];
  const latestEventByWorkItem = new Map();
  for (const event of existingEvents) {
    if (!latestEventByWorkItem.has(event.work_item_id)) {
      latestEventByWorkItem.set(event.work_item_id, event);
    }
  }
  const latestTask = dossier.review_tasks?.[0] || null;
  const blockerItems = (dossier.advancement_readiness?.blockers || []).map((blocker) => workItemForBlocker(blocker, {
    policyRuleId: dossier.policy_rule_id,
    projectId: dossier.project_id,
    latestTask,
  }));
  const readyItem = readyAdvancementWorkItem(dossier);
  const workItemsBeforeLearning = [...blockerItems, ...(readyItem ? [readyItem] : [])]
    .map((item) => {
      const events = existingEvents.filter((event) => event.work_item_id === item.id);
      const latestEvent = latestEventByWorkItem.get(item.id) || null;
      return {
        ...item,
        event_count: events.length,
        latest_event: latestEvent,
      };
    });
  const workItems = applyPolicyWorkItemLearningRules(workItemsBeforeLearning, options.learningRules || [])
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  return {
    workbench_version: "2026-05-22.policy-review-workbench.v1",
    policy_rule_id: dossier.policy_rule_id,
    project_id: dossier.project_id,
    generated_at: dossier.generated_at,
    review_status: dossier.policy_rule?.review_status || "draft_review",
    advancement_status: dossier.advancement_readiness?.advancement_status || "unknown",
    next_review_status: dossier.advancement_readiness?.next_review_status || null,
    readiness_score: dossier.advancement_readiness?.readiness_score ?? 0,
    summary: {
      open_work_item_count: workItems.filter((item) => item.status === "open").length,
      ready_decision_count: workItems.filter((item) => item.status === "ready_for_human_decision").length,
      blocker_count: dossier.advancement_readiness?.blockers?.length || 0,
      can_advance_review_status: Boolean(dossier.advancement_readiness?.can_advance_review_status),
      can_enable_policy: false,
      can_enforce_policy: false,
      safety_boundary: SAFETY_BOUNDARY,
      work_item_event_count: existingEvents.length,
      learning_rule_count: (options.learningRules || []).length,
    },
    work_items: workItems,
    work_item_events: existingEvents,
    source_dossier: {
      policy_rule_id: dossier.policy_rule_id,
      source_type: dossier.source?.type || "unknown",
      dry_run_count: dossier.summary?.dry_run_count || 0,
      match_evidence_count: dossier.summary?.match_evidence_count || 0,
      review_task_count: dossier.summary?.review_task_count || 0,
      review_candidate_count: dossier.summary?.review_candidate_count || 0,
      policy_rule_event_count: dossier.summary?.policy_rule_event_count || 0,
    },
    safety_boundary: SAFETY_BOUNDARY,
    read_only: true,
  };
}

export function buildPolicyReviewWorkbench(policyRuleId, options = {}) {
  const dossier = buildPolicyGovernanceDossier(policyRuleId, options);
  if (!dossier) return null;
  const db = options.db || openDatabase(options.dbPath);
  const shouldClose = !options.db;
  if (!options.skipMigrate && shouldClose) migrate(db);
  dossier.policy_review_work_item_events = listPolicyReviewWorkItemEvents(policyRuleId, {
    ...options,
    skipMigrate: true,
  });
  try {
    const learningRules = options.learningRules || listActivePolicyWorkItemLearningRules(db, dossier.project_id);
    return buildPolicyReviewWorkbenchFromDossier(dossier, { learningRules });
  } finally {
    if (shouldClose) db.close();
  }
}

export function listPolicyReviewWorkItemEvents(policyRuleId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = limitValue(options.limit, 100);
    return db.prepare(
      `SELECT *
       FROM policy_review_work_item_events
       WHERE policy_rule_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(policyRuleId, limit).map(parseWorkItemEventRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function listPolicyReviewWorkItemEffectiveness(policyRuleId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = limitValue(options.limit, 100);
    return db.prepare(
      `SELECT *
       FROM policy_review_work_item_effectiveness
       WHERE policy_rule_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(policyRuleId, limit).map(parseWorkItemEffectivenessRow);
  } finally {
    if (!options.db) db.close();
  }
}

function effectivenessStatusForWorkItem({ eventType, blockerCleared, scoreDelta }) {
  if (eventType === "dismissed") return "dismissed_without_action";
  if (blockerCleared && scoreDelta >= 0) return "blocker_cleared";
  if (scoreDelta > 0) return "readiness_improved_blocker_persisted";
  if (scoreDelta < 0) return "readiness_regressed_after_action";
  return "no_measurable_improvement";
}

function currentBlockerCodes(workbench) {
  return new Set((workbench.work_items || [])
    .map((item) => item.blocker_code)
    .filter(Boolean));
}

function buildWorkItemEffectivenessRow(event, currentWorkbench, createdAt) {
  const snapshot = event.workbench_snapshot || {};
  const sourceScore = Number(snapshot.readiness_score || 0);
  const currentScore = Number(currentWorkbench.readiness_score || 0);
  const scoreDelta = currentScore - sourceScore;
  const blockerCode = snapshot.work_item?.blocker_code || null;
  const currentCodes = currentBlockerCodes(currentWorkbench);
  const blockerCleared = blockerCode ? !currentCodes.has(blockerCode) : Boolean(currentWorkbench.summary?.can_advance_review_status);
  const status = effectivenessStatusForWorkItem({
    eventType: event.event_type,
    blockerCleared,
    scoreDelta,
  });
  const effectiveness = {
    source_event_id: event.id,
    work_item_id: event.work_item_id,
    action_type: event.action_type,
    event_type: event.event_type,
    blocker_code: blockerCode,
    source_advancement_status: snapshot.advancement_status || "unknown",
    current_advancement_status: currentWorkbench.advancement_status,
    source_readiness_score: sourceScore,
    current_readiness_score: currentScore,
    readiness_score_delta: scoreDelta,
    blocker_cleared: blockerCleared,
    remaining_blocker_codes: [...currentCodes],
    can_enable_policy: false,
    can_enforce_policy: false,
    safety_boundary: SAFETY_BOUNDARY,
  };

  return {
    id: createId("policy_work_effect"),
    project_id: event.project_id,
    policy_rule_id: event.policy_rule_id,
    source_event_id: event.id,
    work_item_id: event.work_item_id,
    action_type: event.action_type,
    event_type: event.event_type,
    source_readiness_score: sourceScore,
    current_readiness_score: currentScore,
    readiness_score_delta: scoreDelta,
    blocker_cleared: blockerCleared,
    effectiveness_status: status,
    effectiveness,
    created_at: createdAt,
  };
}

export function evaluatePolicyReviewWorkItemEffectiveness(policyRuleId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const currentWorkbench = buildPolicyReviewWorkbench(policyRuleId, {
      db,
      skipMigrate: true,
      limit: options.limit,
    });
    if (!currentWorkbench) return null;

    const events = listPolicyReviewWorkItemEvents(policyRuleId, {
      db,
      skipMigrate: true,
      limit: options.limit || 100,
    }).reverse();
    const createdAt = options.createdAt || new Date().toISOString();
    const rows = events.map((event) => buildWorkItemEffectivenessRow(event, currentWorkbench, createdAt));

    if (options.persist !== false) {
      const existing = db.prepare(
        "SELECT id FROM policy_review_work_item_effectiveness WHERE source_event_id = ?"
      );
      const insert = db.prepare(
        `INSERT INTO policy_review_work_item_effectiveness (
          id, project_id, policy_rule_id, source_event_id, work_item_id,
          action_type, event_type, source_readiness_score, current_readiness_score,
          readiness_score_delta, blocker_cleared, effectiveness_status,
          effectiveness_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const update = db.prepare(
        `UPDATE policy_review_work_item_effectiveness
         SET current_readiness_score = ?,
             readiness_score_delta = ?,
             blocker_cleared = ?,
             effectiveness_status = ?,
             effectiveness_json = ?,
             created_at = ?
         WHERE source_event_id = ?`
      );

      db.exec("BEGIN");
      try {
        for (const row of rows) {
          const prior = existing.get(row.source_event_id);
          if (prior) {
            update.run(
              row.current_readiness_score,
              row.readiness_score_delta,
              row.blocker_cleared ? 1 : 0,
              row.effectiveness_status,
              toJson(row.effectiveness),
              row.created_at,
              row.source_event_id
            );
          } else {
            insert.run(
              row.id,
              row.project_id,
              row.policy_rule_id,
              row.source_event_id,
              row.work_item_id,
              row.action_type,
              row.event_type,
              row.source_readiness_score,
              row.current_readiness_score,
              row.readiness_score_delta,
              row.blocker_cleared ? 1 : 0,
              row.effectiveness_status,
              toJson(row.effectiveness),
              row.created_at
            );
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }

    const persisted = options.persist === false
      ? rows.map((row) => ({ ...row, effectiveness_json: undefined }))
      : listPolicyReviewWorkItemEffectiveness(policyRuleId, {
        db,
        skipMigrate: true,
        limit: options.limit || 100,
      });
    return {
      policy_rule_id: policyRuleId,
      project_id: currentWorkbench.project_id,
      current_readiness_score: currentWorkbench.readiness_score,
      current_advancement_status: currentWorkbench.advancement_status,
      effectiveness_count: persisted.length,
      effectiveness: persisted,
      safety_boundary: SAFETY_BOUNDARY,
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function recordPolicyReviewWorkItemEvent(policyRuleId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const workbench = buildPolicyReviewWorkbench(policyRuleId, {
      db,
      skipMigrate: true,
      limit: options.limit,
    });
    if (!workbench) {
      throw new Error(`Policy rule not found: ${policyRuleId}`);
    }

    const workItemId = String(payload.work_item_id || payload.workItemId || "").trim();
    if (!workItemId) {
      throw new Error("work_item_id is required");
    }
    const workItem = (workbench.work_items || []).find((item) => item.id === workItemId);
    if (!workItem) {
      throw new Error(`Policy review work item not found in current workbench: ${workItemId}`);
    }

    const eventType = String(payload.event_type || payload.eventType || "").trim();
    if (!POLICY_WORK_ITEM_EVENT_TYPES.has(eventType)) {
      throw new Error(`Invalid policy review work item event type: ${eventType}`);
    }

    const createdAt = options.createdAt || new Date().toISOString();
    const actorType = String(payload.actor_type || options.actorType || "user");
    const actorId = payload.actor_id || options.actorId || null;
    const note = payload.note ? String(payload.note) : null;
    const evidence = {
      ...(payload.evidence_json || payload.evidence || {}),
      event_type: eventType,
      action_type: workItem.action_type,
      mutates_state: false,
      can_enable_policy: false,
      can_enforce_policy: false,
      safety_boundary: SAFETY_BOUNDARY,
    };
    const project = db.prepare(
      `SELECT o.id AS org_id
       FROM projects p
       JOIN organizations o ON o.id = p.org_id
       WHERE p.id = ?`
    ).get(workbench.project_id);
    const eventId = createId("policy_work_event");
    const snapshot = {
      workbench_version: workbench.workbench_version,
      advancement_status: workbench.advancement_status,
      readiness_score: workbench.readiness_score,
      work_item: workItem,
      summary: workbench.summary,
    };

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO policy_review_work_item_events (
          id, project_id, policy_rule_id, work_item_id, action_type,
          actor_type, actor_id, event_type, note, evidence_json,
          workbench_snapshot_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        workbench.project_id,
        policyRuleId,
        workItemId,
        workItem.action_type,
        actorType,
        actorId,
        eventType,
        note,
        toJson(evidence),
        toJson(snapshot),
        createdAt
      );

      if (project) {
        db.prepare(
          `INSERT INTO audit_events (
            id, org_id, project_id, actor_type, actor_id, action,
            target_type, target_id, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          createId("audit"),
          project.org_id,
          workbench.project_id,
          actorType,
          actorId,
          "policy_review_work_item.event_recorded",
          "policy_review_work_item",
          workItemId,
          toJson({
            policy_rule_id: policyRuleId,
            policy_review_work_item_event_id: eventId,
            event_type: eventType,
            action_type: workItem.action_type,
            mutates_state: false,
            can_enable_policy: false,
            can_enforce_policy: false,
            safety_boundary: SAFETY_BOUNDARY,
          }),
          createdAt
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const event = parseWorkItemEventRow(
      db.prepare("SELECT * FROM policy_review_work_item_events WHERE id = ?").get(eventId)
    );
    return {
      policy_review_work_item_event: event,
      policy_review_workbench: buildPolicyReviewWorkbench(policyRuleId, {
        db,
        skipMigrate: true,
        limit: options.limit,
      }),
    };
  } finally {
    if (!options.db) db.close();
  }
}

function lineForWorkItem(item) {
  return `- ${item.severity}: ${item.title} [${item.status}] command=${item.operator_command}`;
}

export function renderPolicyReviewWorkbenchMarkdown(workbench) {
  const summary = workbench.summary || {};
  return [
    "# Policy Review Workbench",
    "",
    `Policy rule: ${workbench.policy_rule_id}`,
    `Project: ${workbench.project_id}`,
    `Review status: ${workbench.review_status}`,
    `Advancement status: ${workbench.advancement_status}`,
    `Next review status: ${workbench.next_review_status || "none"}`,
    `Readiness score: ${workbench.readiness_score}/100`,
    "",
    "## Safety Boundary",
    "",
    `- Read only: ${workbench.read_only ? "true" : "false"}`,
    `- Can advance review status: ${summary.can_advance_review_status ? "true" : "false"}`,
    `- Can enable policy: ${summary.can_enable_policy ? "true" : "false"}`,
    `- Can enforce policy: ${summary.can_enforce_policy ? "true" : "false"}`,
    `- Work item events: ${summary.work_item_event_count || 0}`,
    `- Safety boundary: ${workbench.safety_boundary}`,
    "",
    "## Work Items",
    "",
    (workbench.work_items || []).length ? workbench.work_items.map(lineForWorkItem).join("\n") : "- None",
  ].join("\n");
}

export function renderPolicyGovernanceDossierMarkdown(dossier) {
  const summary = dossier.summary || {};
  const source = dossier.source || {};
  const readiness = dossier.advancement_readiness || {};

  return [
    "# Policy Governance Dossier",
    "",
    `Policy rule: ${dossier.policy_rule_id}`,
    `Project: ${dossier.project_id}`,
    `Generated at: ${dossier.generated_at}`,
    "",
    "## Phase 1 Safety Boundary",
    "",
    `- Safety boundary: ${dossier.safety_boundary}`,
    `- Enabled: ${summary.enabled ? "true" : "false"}`,
    `- Review status: ${summary.review_status}`,
    "- Automatic execution: false",
    "- Automatic enforcement: false",
    "",
    "## Source",
    "",
    `- Type: ${source.type || "unknown"}`,
    `- Suggestion: ${source.suggestion_id || "none"}`,
    `- Learning rule: ${source.learning_rule_id || "none"}`,
    "",
    "## Evidence Summary",
    "",
    `- Dry-runs: ${summary.dry_run_count || 0}`,
    `- Match evidence: ${summary.match_evidence_count || 0}`,
    `- High-risk matches: ${summary.high_risk_match_count || 0}`,
    `- Review tasks: ${summary.review_task_count || 0}`,
    `- Review task events: ${summary.review_task_event_count || 0}`,
    `- Review candidates: ${summary.review_candidate_count || 0}`,
    `- Review candidate events: ${summary.review_candidate_event_count || 0}`,
    `- Policy rule events: ${summary.policy_rule_event_count || 0}`,
    `- Audit events: ${summary.audit_event_count || 0}`,
    "",
    "## Policy Advancement Readiness",
    "",
    `- Current review status: ${readiness.current_review_status || "unknown"}`,
    `- Next review status: ${readiness.next_review_status || "none"}`,
    `- Advancement status: ${readiness.advancement_status || "unknown"}`,
    `- Readiness score: ${readiness.readiness_score ?? 0}/100`,
    `- Can advance review status: ${readiness.can_advance_review_status ? "true" : "false"}`,
    `- Can enable policy: ${readiness.can_enable_policy ? "true" : "false"}`,
    `- Safety boundary: ${readiness.safety_boundary || SAFETY_BOUNDARY}`,
    `- Next action: ${readiness.next_action || "Keep collecting advisory evidence."}`,
    "",
    "### Advancement Requirements",
    "",
    (readiness.requirements || []).length ? readiness.requirements.map(lineForRequirement).join("\n") : "- None",
    "",
    "### Advancement Blockers",
    "",
    (readiness.blockers || []).length ? readiness.blockers.map(lineForBlocker).join("\n") : "- None",
    "",
    "## Dry-Run Evidence",
    "",
    dossier.dry_runs.length ? dossier.dry_runs.map(lineForDryRun).join("\n") : "- None",
    "",
    "## Review Tasks",
    "",
    dossier.review_tasks.length ? dossier.review_tasks.map(lineForTask).join("\n") : "- None",
    "",
    "## Review Candidates",
    "",
    dossier.review_candidates.length ? dossier.review_candidates.map(lineForCandidate).join("\n") : "- None",
    "",
    "## Policy Rule Events",
    "",
    dossier.policy_rule_events.length ? dossier.policy_rule_events.map(lineForEvent).join("\n") : "- None",
    "",
    "## Audit Events",
    "",
    dossier.audit_events.length ? dossier.audit_events.map(lineForAudit).join("\n") : "- None",
    "",
    "## Recommended Next Steps",
    "",
    dossier.recommended_next_steps.map((item) => `- ${item}`).join("\n"),
  ].join("\n");
}
