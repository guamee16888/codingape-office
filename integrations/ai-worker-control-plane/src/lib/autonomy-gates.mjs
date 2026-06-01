import { createId } from "./ids.mjs";
import { fromJson, migrate, nowIso, openDatabase, toJson } from "./db.mjs";
import { summarizeProjectEvalCoverage } from "./eval-coverage.mjs";
import { latestEvalReplayGate } from "./eval-replay.mjs";

function parseScoreRow(row) {
  return row ? {
    ...row,
    score_reasons_json: fromJson(row.score_reasons_json, []),
  } : null;
}

function parseEvidenceRow(row) {
  return row ? {
    ...row,
    metadata_json: fromJson(row.metadata_json, {}),
  } : null;
}

function latestAgentScore(db, projectId, agentId) {
  return parseScoreRow(db.prepare(
    `SELECT *
     FROM reliability_scores
     WHERE project_id = ? AND target_type = 'agent' AND target_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(projectId, agentId));
}

function latestDataProvenanceForScore(db, projectId, score = null) {
  const row = score?.source_report_id
    ? db.prepare("SELECT content_json FROM reports WHERE id = ? AND project_id = ?").get(score.source_report_id, projectId)
    : db.prepare(
      `SELECT content_json
       FROM reports
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(projectId);
  const reportJson = fromJson(row?.content_json, {});
  return reportJson?.data_provenance || null;
}

function latestPolicyDryRunSummaryForAgent(db, projectId, agentId, reportId = null) {
  const resolvedReportId = reportId || db.prepare(
    `SELECT report_id
     FROM policy_dry_runs
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(projectId)?.report_id;

  if (!resolvedReportId) {
    return {
      has_policy_dry_run: false,
      report_id: null,
      matched_run_count: 0,
      high_risk_matched_run_count: 0,
    };
  }

  const row = db.prepare(
    `SELECT
       COUNT(m.id) AS matched_run_count,
       SUM(CASE WHEN m.overall_status = 'high_risk' OR m.risk_score >= 75 THEN 1 ELSE 0 END) AS high_risk_matched_run_count
     FROM policy_dry_runs d
     JOIN policy_dry_run_matches m ON m.policy_dry_run_id = d.id
     JOIN agent_runs r ON r.id = m.agent_run_id
     WHERE d.project_id = ? AND d.report_id = ? AND r.agent_id = ?`
  ).get(projectId, resolvedReportId, agentId);

  return {
    has_policy_dry_run: true,
    report_id: resolvedReportId,
    matched_run_count: Number(row?.matched_run_count || 0),
    high_risk_matched_run_count: Number(row?.high_risk_matched_run_count || 0),
  };
}

function provenanceGateSignals(dataProvenance = null) {
  const trust = dataProvenance?.evidence_trust_level || "insufficient";
  const blockers = [];
  const warnings = [];

  if (trust === "sample_only") {
    blockers.push("Data provenance is sample_only; console/onboarding sample runs cannot certify production autonomy.");
  } else if (trust === "local_development") {
    blockers.push("Data provenance is local_development; local Codex runs cannot certify customer production autonomy.");
  } else if (trust === "mixed_requires_review") {
    blockers.push("Data provenance is mixed_requires_review; mixed run sources must be reviewed before production autonomy certification.");
  } else if (trust === "untrusted_or_unknown") {
    blockers.push("Data provenance is untrusted_or_unknown; source metadata is insufficient for production autonomy certification.");
  } else if (trust === "production_with_metadata_gaps") {
    warnings.push("Data provenance is production-like but has metadata gaps; fix source metadata before formal certification.");
  } else if (trust !== "production_evidence") {
    blockers.push("Data provenance is insufficient; no certifiable production run evidence exists yet.");
  }

  for (const precondition of dataProvenance?.certification_preconditions || []) {
    if (precondition.status === "passed") continue;
    blockers.push(`Certification precondition failed: ${precondition.code} current=${precondition.current}, target=${precondition.target}.`);
  }

  return { blockers, warnings };
}

function gateDecision({ score, evalReplayGate, evalCoverage, policyDryRunSummary, dataProvenance }) {
  const blockers = [];
  const warnings = [];
  const provenanceSignals = provenanceGateSignals(dataProvenance);
  blockers.push(...provenanceSignals.blockers);
  warnings.push(...provenanceSignals.warnings);

  if (!score) {
    blockers.push("No reliability score exists for this agent yet.");
  } else {
    if (score.readiness_status === "not_ready" || score.readiness_status === "insufficient_data") {
      blockers.push(`Latest readiness status is ${score.readiness_status}.`);
    }

    if (Number(score.autonomy_readiness_score || 0) < 60) {
      blockers.push(`Autonomy readiness score is ${score.autonomy_readiness_score}/100, below the limited-autonomy threshold.`);
    }
  }

  if (evalReplayGate?.has_eval_run) {
    if (Number(evalReplayGate.regression_count || 0) > 0) {
      blockers.push(`Latest eval replay has ${evalReplayGate.regression_count} regressions.`);
    }

    if (Number(evalReplayGate.fail_count || 0) > 0) {
      warnings.push(`Latest eval replay has ${evalReplayGate.fail_count} failed cases.`);
    }
  } else {
    warnings.push("No eval replay gate has been run for this agent yet.");
  }

  const coverageSummary = evalCoverage?.summary || {};
  if (Number(coverageSummary.regression_taxonomy_count || 0) > 0) {
    blockers.push(`${coverageSummary.regression_taxonomy_count} failure taxonomies still have eval replay regressions.`);
  }

  if (Number(coverageSummary.missing_eval_taxonomy_count || 0) > 0) {
    blockers.push(`${coverageSummary.missing_eval_taxonomy_count} observed failure taxonomies have no eval coverage.`);
  }

  if (Number(coverageSummary.not_replayed_taxonomy_count || 0) > 0) {
    blockers.push(`${coverageSummary.not_replayed_taxonomy_count} covered failure taxonomies have not been replayed.`);
  }

  if (Number(policyDryRunSummary?.high_risk_matched_run_count || 0) > 0) {
    blockers.push(`${policyDryRunSummary.high_risk_matched_run_count} high-risk historical runs matched policy drafts.`);
  } else if (Number(policyDryRunSummary?.matched_run_count || 0) > 0) {
    warnings.push(`${policyDryRunSummary.matched_run_count} historical runs matched policy drafts.`);
  }

  if (blockers.length) {
    return {
      gate_decision: "blocked",
      autonomy_allowed: false,
      requires_human_review: true,
      summary: "Agent is blocked from unattended autonomy.",
      blockers,
      warnings,
    };
  }

  if (score?.readiness_status === "ready_with_monitoring" && !warnings.length) {
    return {
      gate_decision: "approved_with_monitoring",
      autonomy_allowed: true,
      requires_human_review: false,
      summary: "Agent can run autonomously with monitoring and audit logging.",
      blockers,
      warnings,
    };
  }

  return {
    gate_decision: "limited_autonomy",
    autonomy_allowed: false,
    requires_human_review: true,
    summary: "Agent may only run with human-review gates or limited autonomy.",
    blockers,
    warnings,
  };
}

function remediationItemForBlocker(blocker, context = {}) {
  const text = String(blocker || "");
  const score = context.score || {};

  if (text.includes("No reliability score")) {
    return {
      blocker,
      remediation_type: "generate_reliability_score",
      severity: "high",
      title: "Generate reliability score evidence",
      action: "Run a nightly health report or scoring job so this agent has persisted reliability evidence.",
      verification_evidence: ["reliability_scores row for the agent", "score_snapshots row tied to a report"],
      success_criteria: "Agent has a latest reliability score and score snapshot.",
      blocks_unattended_autonomy: true,
    };
  }

  if (text.includes("Data provenance") || text.includes("Certification precondition failed")) {
    return {
      blocker,
      remediation_type: "collect_production_run_evidence",
      severity: "high",
      title: "Collect certifiable production run evidence",
      action: "Ingest authenticated webhook/API runs from the real customer Agent and regenerate the report before using the gate for production autonomy certification.",
      verification_evidence: [
        "data_provenance.evidence_trust_level is production_evidence or production_with_metadata_gaps",
        "production_candidate_runs > 0",
        "console_sample_runs=0 in the certification window",
      ],
      success_criteria: "Latest autonomy gate has no data provenance blocker.",
      blocks_unattended_autonomy: true,
    };
  }

  if (text.includes("Latest readiness status") || text.includes("Autonomy readiness score")) {
    return {
      blocker,
      remediation_type: "raise_autonomy_readiness",
      severity: Number(score.autonomy_readiness_score || 0) < 40 ? "critical" : "high",
      title: "Raise autonomy readiness score",
      action: "Reduce high-risk runs, lower human-review dependency, improve reliability, and rerun the nightly report to produce a new score.",
      verification_evidence: ["new reliability_scores row", "autonomy_readiness_score >= 60 for limited autonomy", "readiness_status not not_ready"],
      success_criteria: "Latest score is at or above the limited-autonomy threshold and no longer reports not_ready.",
      blocks_unattended_autonomy: true,
    };
  }

  if (text.includes("eval replay has") && text.includes("regressions")) {
    return {
      blocker,
      remediation_type: "fix_eval_regressions",
      severity: "critical",
      title: "Fix replay regressions",
      action: "Review failing replay results, update the candidate prompt/workflow/model route in a test environment, then rerun eval backlog replay.",
      verification_evidence: ["latest eval_run gate_decision=passed", "regression_count=0"],
      success_criteria: "Latest eval replay has zero regressions.",
      blocks_unattended_autonomy: true,
    };
  }

  if (text.includes("no eval coverage")) {
    return {
      blocker,
      remediation_type: "create_eval_coverage",
      severity: "high",
      title: "Create missing eval coverage",
      action: "Turn representative failure cases into eval cases and keep them active before prompt, workflow, or model-route promotion.",
      verification_evidence: ["eval_cases rows linked to source failure_cases", "eval_coverage missing_eval_taxonomy_count=0"],
      success_criteria: "All observed failure taxonomies have eval cases.",
      blocks_unattended_autonomy: true,
    };
  }

  if (text.includes("have not been replayed")) {
    return {
      blocker,
      remediation_type: "run_eval_replay",
      severity: "high",
      title: "Replay existing eval coverage",
      action: "Run eval backlog replay with candidate outputs from a controlled test environment.",
      verification_evidence: ["eval_runs row", "replay_results rows", "eval_coverage not_replayed_taxonomy_count=0"],
      success_criteria: "All covered failure taxonomies have replay evidence.",
      blocks_unattended_autonomy: true,
    };
  }

  if (text.includes("policy drafts")) {
    return {
      blocker,
      remediation_type: "review_policy_dry_run",
      severity: "high",
      title: "Review policy dry-run matches",
      action: "Inspect matched historical runs, decide whether the policy should become a human-review gate, and rerun the report after review.",
      verification_evidence: ["policy_dry_run_matches reviewed", "policy rule status decision", "new autonomy gate check"],
      success_criteria: "High-risk policy matches are remediated, dismissed with evidence, or gated by human review.",
      blocks_unattended_autonomy: true,
    };
  }

  return {
    blocker,
    remediation_type: "manual_review",
    severity: "medium",
    title: "Review autonomy blocker",
    action: "Investigate this blocker and attach evidence before increasing autonomy.",
    verification_evidence: ["new audit_evidence_item", "updated autonomy gate check"],
    success_criteria: "The blocker no longer appears in the latest gate check.",
    blocks_unattended_autonomy: true,
  };
}

function remediationItemForWarning(warning) {
  const text = String(warning || "");

  if (text.includes("No eval replay gate")) {
    return {
      warning,
      remediation_type: "run_baseline_eval_replay",
      severity: "medium",
      title: "Run baseline eval replay",
      action: "Run replay for current eval cases before expanding autonomy.",
      verification_evidence: ["latest eval_run exists", "eval_replay_gate.has_eval_run=true"],
      success_criteria: "A replay gate exists for the agent.",
      blocks_unattended_autonomy: false,
    };
  }

  if (text.includes("failed cases")) {
    return {
      warning,
      remediation_type: "review_failed_eval_cases",
      severity: "medium",
      title: "Review failed eval cases",
      action: "Inspect failed replay cases and decide whether they are acceptable, need prompt changes, or should become blockers.",
      verification_evidence: ["replay_results reviewed", "new eval_run after fixes"],
      success_criteria: "Failed replay cases are resolved or accepted with evidence.",
      blocks_unattended_autonomy: false,
    };
  }

  return {
    warning,
    remediation_type: "manual_warning_review",
    severity: "low",
    title: "Review autonomy warning",
    action: "Review this warning before increasing autonomy.",
    verification_evidence: ["updated autonomy gate check"],
    success_criteria: "Warning is resolved or accepted with evidence.",
    blocks_unattended_autonomy: false,
  };
}

function buildAutonomyRemediationPlan(decision, context = {}) {
  const blockerItems = (decision.blockers || []).map((blocker) => remediationItemForBlocker(blocker, context));
  const warningItems = (decision.warnings || []).map(remediationItemForWarning);
  const deduped = [];
  const byType = new Map();

  for (const item of [...blockerItems, ...warningItems]) {
    const key = `${item.remediation_type}:${item.blocks_unattended_autonomy ? "blocker" : "warning"}`;
    const existing = byType.get(key);
    if (existing) {
      existing.related_blockers = [
        ...(existing.related_blockers || [existing.blocker].filter(Boolean)),
        item.blocker,
      ].filter(Boolean);
      existing.related_warnings = [
        ...(existing.related_warnings || [existing.warning].filter(Boolean)),
        item.warning,
      ].filter(Boolean);
      continue;
    }
    byType.set(key, item);
    deduped.push(item);
  }

  const items = deduped.map((item, index) => ({
    remediation_id: `autonomy_remediation:${context.agentId || "agent"}:${index + 1}`,
    rank: index + 1,
    status: "open",
    ...item,
  }));

  return {
    plan_version: "phase1_autonomy_remediation_v1",
    gate_decision: decision.gate_decision,
    autonomy_allowed: decision.autonomy_allowed,
    summary: {
      open_item_count: items.length,
      blocking_item_count: items.filter((item) => item.blocks_unattended_autonomy).length,
      critical_item_count: items.filter((item) => item.severity === "critical").length,
      high_item_count: items.filter((item) => item.severity === "high").length,
      warning_item_count: items.filter((item) => !item.blocks_unattended_autonomy).length,
    },
    items,
  };
}

export function checkAgentAutonomyGate(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const agent = db.prepare(
      `SELECT a.id, a.project_id, p.org_id
       FROM agents a
       JOIN projects p ON p.id = a.project_id
       WHERE a.id = ? AND a.project_id = ?`
    ).get(agentId, projectId);

    if (!agent) {
      throw new Error(`Agent not found in project: ${agentId}`);
    }

    const createdAt = options.createdAt || nowIso();
    const score = latestAgentScore(db, projectId, agentId);
    const dataProvenance = latestDataProvenanceForScore(db, projectId, score);
    const evalReplayGate = latestEvalReplayGate(projectId, {
      db,
      skipMigrate: true,
      agentId,
      before: options.before,
    });
    const policyDryRunSummary = latestPolicyDryRunSummaryForAgent(db, projectId, agentId, score?.source_report_id || null);
    const evalCoverage = summarizeProjectEvalCoverage(projectId, { db, skipMigrate: true });
    const decision = gateDecision({ score, evalReplayGate, evalCoverage, policyDryRunSummary, dataProvenance });
    const remediationPlan = buildAutonomyRemediationPlan(decision, {
      agentId,
      score,
      evalReplayGate,
      evalCoverage,
      policyDryRunSummary,
    });
    const evidenceId = createId("evidence");
    const metadata = {
      agent_id: agentId,
      gate_decision: decision.gate_decision,
      autonomy_allowed: decision.autonomy_allowed,
      requires_human_review: decision.requires_human_review,
      blockers: decision.blockers,
      warnings: decision.warnings,
      reliability_score: score,
      data_provenance: dataProvenance,
      eval_replay_gate: evalReplayGate,
      eval_coverage: evalCoverage,
      policy_dry_run_summary: policyDryRunSummary,
      remediation_plan: remediationPlan,
      gate_version: "phase1_autonomy_gate_v1",
    };

    db.prepare(
      `INSERT INTO audit_evidence_items (
        id, org_id, project_id, agent_id, evidence_type, target_type, target_id,
        summary, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      evidenceId,
      agent.org_id,
      projectId,
      agentId,
      "autonomy_gate_check",
      "agent",
      agentId,
      decision.summary,
      toJson(metadata),
      createdAt
    );

    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      agent.org_id,
      projectId,
      "system",
      options.actorId || null,
      "agent.autonomy_gate_check_completed",
      "agent",
      agentId,
      toJson({ audit_evidence_item_id: evidenceId, ...metadata }),
      createdAt
    );

    return {
      project_id: projectId,
      agent_id: agentId,
      audit_evidence_item_id: evidenceId,
      created_at: createdAt,
      ...decision,
      reliability_score: score,
      data_provenance: dataProvenance,
      eval_replay_gate: evalReplayGate,
      eval_coverage: evalCoverage,
      policy_dry_run_summary: policyDryRunSummary,
      remediation_plan: remediationPlan,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectAutonomyGateChecks(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?", "evidence_type = 'autonomy_gate_check'"];
    const params = [projectId];

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
    ).all(...params).map(parseEvidenceRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
