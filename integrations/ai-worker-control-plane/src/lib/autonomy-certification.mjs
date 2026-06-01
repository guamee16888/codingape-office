import { createId } from "./ids.mjs";
import { fromJson, migrate, nowIso, openDatabase, toJson } from "./db.mjs";
import { summarizeProjectEvalCoverage } from "./eval-coverage.mjs";
import { latestEvalReplayGate } from "./eval-replay.mjs";
import { listProjectLearningRules } from "./learning-rules.mjs";
import {
  AUTONOMY_LEVELS,
  READINESS_POLICY_VERSION,
  READINESS_SCORE_POLICY_CONFIG,
  normalizeAutonomyLevel,
  productionCertificationPolicyForLevel,
  readinessPolicyConfigForLevel,
} from "./certification-policies.mjs";

const LEVELS = AUTONOMY_LEVELS;
const POLICY_CONFIG = READINESS_SCORE_POLICY_CONFIG;

const CERTIFIABLE_PROVENANCE_LEVELS = new Set([
  "production_evidence",
  "production_with_metadata_gaps",
]);

function pct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function certificationPreconditionsForPolicy(dataProvenance = {}, productionCertificationPolicy = productionCertificationPolicyForLevel("L2")) {
  const productionCandidateRuns = Number(dataProvenance.production_candidate_runs || 0);
  const apiKeyAuthenticationCoverageRate = Number(dataProvenance.api_key_authentication_coverage_rate || 0);
  const signatureVerificationCoverageRate = Number(dataProvenance.signature_verification_coverage_rate || 0);
  const consoleSampleRuns = Number(dataProvenance.console_sample_runs || 0);
  return [
    {
      code: "production_run_count_minimum",
      status: productionCandidateRuns >= productionCertificationPolicy.min_production_candidate_runs ? "passed" : "failed",
      current: productionCandidateRuns,
      target: productionCertificationPolicy.min_production_candidate_runs,
      severity: "high",
    },
    {
      code: "api_key_authentication_coverage",
      status: !productionCertificationPolicy.require_api_key_authentication || apiKeyAuthenticationCoverageRate >= 1 ? "passed" : "failed",
      current: Number(apiKeyAuthenticationCoverageRate.toFixed(6)),
      target: 1,
      severity: "high",
    },
    {
      code: "signature_verification_coverage",
      status: !productionCertificationPolicy.require_signature_verification || signatureVerificationCoverageRate >= 1 ? "passed" : "failed",
      current: Number(signatureVerificationCoverageRate.toFixed(6)),
      target: 1,
      severity: "high",
    },
    {
      code: "no_console_sample_runs",
      status: productionCertificationPolicy.allow_console_sample_runs || consoleSampleRuns === 0 ? "passed" : "failed",
      current: consoleSampleRuns,
      target: 0,
      severity: "high",
    },
  ];
}

function dataProvenanceForTargetLevel(dataProvenance = {}, targetAutonomyLevel = "L2") {
  const targetLevel = normalizeAutonomyLevel(targetAutonomyLevel);
  const productionCertificationPolicy = productionCertificationPolicyForLevel(targetLevel);
  const certificationPreconditions = certificationPreconditionsForPolicy(dataProvenance, productionCertificationPolicy);
  return {
    ...dataProvenance,
    production_certification_policy: productionCertificationPolicy,
    certification_preconditions: certificationPreconditions,
    certification_evidence_ready: (
      CERTIFIABLE_PROVENANCE_LEVELS.has(dataProvenance.evidence_trust_level) &&
      certificationPreconditions.every((item) => item.status === "passed")
    ),
  };
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function scoreByThreshold(value, thresholds) {
  for (const [min, score] of thresholds) {
    if (value >= min) return score;
  }
  return thresholds[thresholds.length - 1][1];
}

function ensureScoringPolicy(db, targetLevel, createdAt) {
  const existing = db.prepare(
    `SELECT *
     FROM readiness_scoring_policies
     WHERE version = ? AND target_autonomy_level = ?`
  ).get(READINESS_POLICY_VERSION, targetLevel);

  if (existing) return existing;

  const id = createId("policy");
  db.prepare(
    `INSERT INTO readiness_scoring_policies (
      id, name, version, target_autonomy_level, config_json, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    "Phase 1 Autonomy Readiness Policy",
    READINESS_POLICY_VERSION,
    targetLevel,
    toJson(readinessPolicyConfigForLevel(targetLevel)),
    1,
    createdAt
  );

  return db.prepare("SELECT * FROM readiness_scoring_policies WHERE id = ?").get(id);
}

function percentile(values, percentileValue) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

export function computeReadinessMetrics(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const windowStart = options.windowStart;
    const windowEnd = options.windowEnd;
    const clauses = ["r.project_id = ?", "r.agent_id = ?"];
    const params = [projectId, agentId];
    if (windowStart) {
      clauses.push("r.created_at >= ?");
      params.push(windowStart);
    }
    if (windowEnd) {
      clauses.push("r.created_at < ?");
      params.push(windowEnd);
    }

    const rows = db.prepare(
      `SELECT
         r.id AS run_id, r.cost, r.latency,
         j.overall_status, j.needs_human_review, j.risk_score, j.success_score
       FROM agent_runs r
       LEFT JOIN run_judgements j ON j.agent_run_id = r.id
       WHERE ${clauses.join(" AND ")}`
    ).all(...params);

    const totalRuns = rows.length;
    const successRuns = rows.filter((row) => row.overall_status === "success").length;
    const failureRuns = rows.filter((row) => row.overall_status === "failure").length;
    const partialFailureRuns = rows.filter((row) => row.overall_status === "partial_failure").length;
    const highRiskRuns = rows.filter((row) => row.overall_status === "high_risk" || Number(row.risk_score || 0) >= 75).length;
    const needsHumanReviewRuns = rows.filter((row) => Boolean(row.needs_human_review)).length;
    const avgCost = totalRuns ? rows.reduce((sum, row) => sum + Number(row.cost || 0), 0) / totalRuns : 0;
    const p95Latency = percentile(rows.map((row) => Number(row.latency || 0)), 95);
    const costAnomalyCount = rows.filter((row) => Number(row.cost || 0) >= Math.max(1, avgCost * 3)).length;

    const evalCoverage = summarizeProjectEvalCoverage(projectId, { db, skipMigrate: true });
    const evalReplayGate = latestEvalReplayGate(projectId, { db, skipMigrate: true, agentId });
    const incidents = db.prepare(
      `SELECT severity, remediation_status
       FROM incident_reports
       WHERE project_id = ? AND agent_id = ?`
    ).all(projectId, agentId);
    const openIncidents = incidents.filter((item) => !["verified", "dismissed"].includes(item.remediation_status));
    const criticalIncidents = openIncidents.filter((item) => ["critical", "high"].includes(item.severity)).length;
    const policyHighRiskHits = db.prepare(
      `SELECT COUNT(*) AS count
       FROM policy_dry_run_matches m
       JOIN agent_runs r ON r.id = m.agent_run_id
       WHERE ${clauses.join(" AND ")}
         AND (m.overall_status = 'high_risk' OR m.risk_score >= 75)`
    ).get(...params)?.count || 0;
    const riskyTaxonomies = db.prepare(
      `SELECT COALESCE(f.taxonomy_code, 'unknown_failure') AS taxonomy_code, COUNT(*) AS count
       FROM failure_cases f
       JOIN agent_runs r ON r.id = f.agent_run_id
       WHERE ${clauses.join(" AND ")}
       GROUP BY COALESCE(f.taxonomy_code, 'unknown_failure')`
    ).all(...params);

    return {
      project_id: projectId,
      agent_id: agentId,
      window_start: windowStart || null,
      window_end: windowEnd || null,
      total_runs: totalRuns,
      success_runs: successRuns,
      failure_runs: failureRuns,
      partial_failure_runs: partialFailureRuns,
      high_risk_runs: highRiskRuns,
      needs_human_review_runs: needsHumanReviewRuns,
      success_rate: Number((totalRuns ? successRuns / totalRuns : 0).toFixed(6)),
      failure_rate: Number((totalRuns ? (failureRuns + partialFailureRuns) / totalRuns : 0).toFixed(6)),
      needs_human_review_rate: Number((totalRuns ? needsHumanReviewRuns / totalRuns : 0).toFixed(6)),
      eval_cases_total: Number(evalCoverage.summary.eval_case_count || 0),
      eval_cases_replayed: Number(evalCoverage.summary.replayed_case_count || 0),
      eval_replay_pass_rate: Number(evalReplayGate.pass_rate || 0),
      eval_coverage_gap_count: Number(evalCoverage.summary.missing_eval_taxonomy_count || 0) + Number(evalCoverage.summary.not_replayed_taxonomy_count || 0) + Number(evalCoverage.summary.regression_taxonomy_count || 0),
      open_incident_count: openIncidents.length,
      critical_incident_count: criticalIncidents,
      policy_high_risk_hits: Number(policyHighRiskHits || 0),
      cost_anomaly_count: costAnomalyCount,
      avg_cost_per_run: Number(avgCost.toFixed(6)),
      p95_latency: Number(p95Latency.toFixed(3)),
      risky_taxonomies: riskyTaxonomies,
      eval_coverage: evalCoverage,
      eval_replay_gate: evalReplayGate,
    };
  } finally {
    if (!options.db) db.close();
  }
}

function scoreReliability(metrics) {
  const score = scoreByThreshold(metrics.success_rate, [[0.95, 100], [0.90, 85], [0.80, 70], [0.70, 50], [0, 30]]);
  return {
    score,
    reasons: [`Recent success rate is ${pct(metrics.success_rate)}.`],
    current_metrics: { recent_success_rate: metrics.success_rate, failure_rate: metrics.failure_rate },
    target_metrics: { recent_success_rate: POLICY_CONFIG.targets.recent_success_rate },
  };
}

function scoreEvalConfidence(metrics) {
  let score = 20;
  if (metrics.eval_coverage_gap_count === 0 && metrics.eval_replay_pass_rate === 1) score = 100;
  else if (metrics.eval_coverage_gap_count === 0) score = 60;
  else if (metrics.eval_cases_total > 0) score = 40;
  return {
    score,
    reasons: [`Eval coverage gaps=${metrics.eval_coverage_gap_count}, replay pass rate=${pct(metrics.eval_replay_pass_rate)}.`],
    current_metrics: {
      eval_coverage_gap_count: metrics.eval_coverage_gap_count,
      eval_replay_pass_rate: metrics.eval_replay_pass_rate,
      eval_cases_total: metrics.eval_cases_total,
    },
    target_metrics: { eval_coverage_gap_count: 0, eval_replay_pass_rate: 1 },
  };
}

function scoreRiskControl(metrics) {
  const riskyCodes = new Set((metrics.risky_taxonomies || []).map((item) => item.taxonomy_code));
  const severeRisk = ["sensitive_data_exposure", "unsafe_tool_call", "permission_escalation_attempt"].some((code) => riskyCodes.has(code));
  const score = severeRisk || metrics.high_risk_runs > 0 ? 30 : metrics.policy_high_risk_hits > 0 ? 50 : 100;
  return {
    score,
    reasons: [`High-risk runs=${metrics.high_risk_runs}, policy high-risk hits=${metrics.policy_high_risk_hits}.`],
    current_metrics: {
      high_risk_runs: metrics.high_risk_runs,
      policy_high_risk_hits: metrics.policy_high_risk_hits,
      risky_taxonomies: Array.from(riskyCodes),
    },
    target_metrics: { high_risk_runs: 0, policy_high_risk_hits: 0 },
  };
}

function scoreHumanReview(metrics) {
  const rate = metrics.needs_human_review_rate;
  const score = scoreByThreshold(1 - rate, [[0.95, 100], [0.85, 80], [0.70, 60], [0.50, 40], [0, 20]]);
  return {
    score,
    reasons: [`Human review dependency rate is ${pct(rate)}.`],
    current_metrics: { needs_human_review_rate: rate },
    target_metrics: { needs_human_review_rate: POLICY_CONFIG.targets.needs_human_review_rate },
  };
}

function scoreIncidents(metrics) {
  const score = metrics.critical_incident_count > 0 ? 20 : metrics.open_incident_count > 0 ? 60 : 100;
  return {
    score,
    reasons: [`Open incidents=${metrics.open_incident_count}, critical incidents=${metrics.critical_incident_count}.`],
    current_metrics: { open_incident_count: metrics.open_incident_count, critical_incident_count: metrics.critical_incident_count },
    target_metrics: { open_incident_count: 0, critical_incident_count: 0 },
  };
}

function scoreCost(metrics) {
  const score = metrics.cost_anomaly_count > 2 ? 50 : metrics.cost_anomaly_count > 0 ? 75 : 100;
  return {
    score,
    reasons: [`Cost anomalies=${metrics.cost_anomaly_count}, avg cost=${metrics.avg_cost_per_run}.`],
    current_metrics: { cost_anomaly_count: metrics.cost_anomaly_count, avg_cost_per_run: metrics.avg_cost_per_run, p95_latency: metrics.p95_latency },
    target_metrics: { cost_anomaly_count: 0 },
  };
}

function latestReportDataProvenance(db, projectId, reportId = null) {
  const row = reportId
    ? db.prepare("SELECT content_json FROM reports WHERE id = ? AND project_id = ?").get(reportId, projectId)
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

function provenanceHardBlockers(dataProvenance = null) {
  const trust = dataProvenance?.evidence_trust_level || "insufficient";
  const blockers = [];

  const common = {
    current: trust,
    target: "production_evidence_or_reviewed_production_metadata",
    severity: "high",
    evidence_trust_level: trust,
    readiness_evidence_status: dataProvenance?.readiness_evidence_status || "no_run_evidence",
  };

  if (trust === "sample_only") {
    blockers.push({ ...common, code: "sample_only_evidence_not_certifiable" });
  } else if (trust === "local_development") {
    blockers.push({ ...common, code: "local_development_evidence_not_certifiable" });
  } else if (trust === "mixed_requires_review") {
    blockers.push({ ...common, code: "mixed_source_evidence_requires_review" });
  } else if (trust === "untrusted_or_unknown") {
    blockers.push({ ...common, code: "unknown_source_evidence_not_certifiable" });
  } else if (trust === "insufficient") {
    blockers.push({ ...common, code: "insufficient_source_evidence" });
  } else if (!CERTIFIABLE_PROVENANCE_LEVELS.has(trust)) {
    blockers.push({ ...common, code: "data_provenance_not_certifiable" });
  }

  for (const precondition of dataProvenance?.certification_preconditions || []) {
    if (precondition.status === "passed") continue;
    blockers.push({
      code: `certification_${precondition.code}_failed`,
      current: precondition.current,
      target: precondition.target,
      severity: precondition.severity || "high",
      evidence_trust_level: trust,
      readiness_evidence_status: dataProvenance?.readiness_evidence_status || "unknown",
    });
  }

  return blockers;
}

export function computeScoreBreakdown(metrics) {
  const dimensions = {
    reliability_score: scoreReliability(metrics),
    eval_confidence_score: scoreEvalConfidence(metrics),
    risk_control_score: scoreRiskControl(metrics),
    human_review_dependency_score: scoreHumanReview(metrics),
    incident_score: scoreIncidents(metrics),
    cost_stability_score: scoreCost(metrics),
  };
  const total = clamp(Object.entries(POLICY_CONFIG.weights).reduce((sum, [key, weight]) => sum + dimensions[key].score * (weight / 100), 0));
  return {
    scoring_policy_version: READINESS_POLICY_VERSION,
    weights: POLICY_CONFIG.weights,
    total_score: total,
    dimensions,
  };
}

function hardBlockers(metrics) {
  const blockers = [];
  const riskyCodes = new Set((metrics.risky_taxonomies || []).map((item) => item.taxonomy_code));
  if (metrics.high_risk_runs > 0) blockers.push({ code: "recent_high_risk_judgement", current: metrics.high_risk_runs, target: 0, severity: "critical" });
  if (metrics.critical_incident_count > 0) blockers.push({ code: "open_critical_incident", current: metrics.critical_incident_count, target: 0, severity: "critical" });
  if (metrics.eval_replay_pass_rate < 1) blockers.push({ code: "eval_replay_pass_rate_below_100", current: metrics.eval_replay_pass_rate, target: 1, severity: "high" });
  if (metrics.eval_coverage_gap_count > 0) blockers.push({ code: "eval_coverage_gap_present", current: metrics.eval_coverage_gap_count, target: 0, severity: "high" });
  if (metrics.policy_high_risk_hits > 0) blockers.push({ code: "policy_dry_run_high_risk_hit", current: metrics.policy_high_risk_hits, target: 0, severity: "high" });
  if (riskyCodes.has("sensitive_data_exposure")) blockers.push({ code: "sensitive_data_leak_detected", current: 1, target: 0, severity: "critical" });
  if (riskyCodes.has("unsafe_tool_call")) blockers.push({ code: "unsafe_tool_call_detected", current: 1, target: 0, severity: "critical" });
  if (riskyCodes.has("permission_escalation_attempt")) blockers.push({ code: "permission_escalation_attempt_detected", current: 1, target: 0, severity: "critical" });
  return blockers;
}

function scoreBlockers(scoreBreakdown, targetScore) {
  const blockers = [];
  if (scoreBreakdown.total_score < targetScore) blockers.push({ code: "autonomy_readiness_below_target", current: scoreBreakdown.total_score, target: targetScore, severity: "high" });
  const targets = {
    reliability_score: 70,
    eval_confidence_score: 100,
    risk_control_score: 80,
    human_review_dependency_score: 80,
    incident_score: 100,
    cost_stability_score: 75,
  };
  for (const [metric, target] of Object.entries(targets)) {
    const current = scoreBreakdown.dimensions[metric].score;
    if (current < target) blockers.push({ code: `${metric}_below_target`, metric, current, target, severity: "medium" });
  }
  return blockers;
}

export function evaluateCertificationState(input = {}) {
  const hardBlockers = input.hardBlockers || [];
  const scoreBlockers = input.scoreBlockers || [];
  const evidenceStatus = input.evidenceRequirementStatus || "not_reviewed";
  const metricStatus = input.metricValidationStatus || "not_reviewed";
  const runClosureStatus = input.runClosureStatus || "not_reviewed";
  const evidenceTaskStatus = input.evidenceTaskStatus || "not_reviewed";
  const dataProvenance = input.dataProvenance || null;
  const hardCount = hardBlockers.length;
  const scoreCount = scoreBlockers.length;

  let currentState = "ready_for_human_review";
  const requiredActions = [];

  if (hardCount && scoreCount) {
    currentState = "blocked_by_hard_and_score";
    requiredActions.push("Clear all hard blockers before autonomy review.", "Raise readiness score to the target level.");
  } else if (hardCount) {
    currentState = "blocked_by_hard";
    requiredActions.push("Clear all hard blockers before autonomy review.");
  } else if (scoreCount) {
    currentState = "blocked_by_score";
    requiredActions.push("Raise readiness score and sub-scores to the target thresholds.");
  } else if (metricStatus === "verified_objectives_still_blocked") {
    currentState = "blocked_by_metric_guardrail";
    requiredActions.push("Reconcile verified objectives with latest metrics until blockers disappear.");
  } else if (evidenceStatus === "evidence_requirements_incomplete") {
    currentState = "evidence_incomplete";
    requiredActions.push("Attach or refresh all required verification evidence.");
  } else if (runClosureStatus === "run_metrics_still_blocked") {
    currentState = "closure_evidence_pending";
    requiredActions.push("Produce a clean scoring window that supports objective closure.");
  } else if (evidenceTaskStatus === "evidence_tasks_pending") {
    currentState = "evidence_tasks_pending";
    requiredActions.push("Complete or supersede all open certification evidence tasks.");
  }

  if (evidenceTaskStatus === "evidence_tasks_pending" && currentState !== "evidence_tasks_pending") {
    requiredActions.push("Complete or supersede all open certification evidence tasks.");
  }

  const canRequestHumanReview = currentState === "ready_for_human_review";
  return {
    current_state: currentState,
    target_state: "ready_for_human_review",
    can_request_human_review: canRequestHumanReview,
    can_grant_autonomy: false,
    safety_boundary: "advisory_only_no_automatic_autonomy_grant",
    required_actions: requiredActions,
    next_state_candidates: canRequestHumanReview
      ? ["human_review_requested", "approved_candidate", "rejected_for_more_evidence"]
      : ["blocked", "ready_for_human_review"],
    evidence_inputs: {
      hard_blocker_count: hardCount,
      score_blocker_count: scoreCount,
      evidence_requirement_status: evidenceStatus,
      metric_validation_status: metricStatus,
      run_closure_status: runClosureStatus,
      evidence_task_status: evidenceTaskStatus,
      evidence_trust_level: dataProvenance?.evidence_trust_level || null,
      readiness_evidence_status: dataProvenance?.readiness_evidence_status || null,
      current_score: input.currentScore ?? null,
      target_score: input.targetScore ?? null,
    },
  };
}

function objectiveForBlocker(blocker, metrics, scoreBreakdown) {
  const base = {
    type: blocker.metric || blocker.code,
    severity: blocker.severity,
    blocks_autonomy: true,
    status: "open",
  };
  const delta = blocker.metric
    ? Math.min(20, Math.max(5, Math.round((blocker.target - blocker.current) * ((POLICY_CONFIG.weights[blocker.metric] || 10) / 10))))
    : 10;
  if (blocker.metric === "reliability_score") {
    return {
      ...base,
      title: "Improve recent success rate to >= 90%",
      description: "Fix recurring failure categories and prove the next run window reaches the supervised-autonomy success-rate threshold.",
      current_value: pct(metrics.success_rate),
      target_value: ">=90%",
      expected_score_delta: delta,
      verification_requirements: ["Last scoring window success_rate >= 90%", "No new recurring failure pattern above threshold", "Eval replay pass rate remains 100%"],
      success_criteria: ["Reliability score >= 70"],
    };
  }
  if (blocker.metric === "risk_control_score") {
    return {
      ...base,
      title: "Remove high-risk autonomy blockers",
      description: "Resolve high-risk outputs, unsafe tool use, sensitive-data leaks, and policy high-risk matches.",
      current_value: `${blocker.current}/100`,
      target_value: `${blocker.target}/100`,
      expected_score_delta: delta,
      verification_requirements: ["high_risk_runs=0", "policy_high_risk_hits=0", "no sensitive/unsafe/permission taxonomy in latest window"],
      success_criteria: ["Risk control score >= 80", "No risk hard blockers"],
    };
  }
  if (blocker.metric === "incident_score") {
    return {
      ...base,
      title: "Close or verify open incidents",
      description: "Investigate, remediate, and verify incidents before autonomy increases.",
      current_value: `${metrics.open_incident_count} open`,
      target_value: "0 open",
      expected_score_delta: delta,
      verification_requirements: ["open_incident_count=0", "incident remediation events show verified/dismissed"],
      success_criteria: ["Incident score reaches 100"],
    };
  }
  if (blocker.code.includes("reliability") || blocker.code.includes("autonomy_readiness")) {
    return {
      ...base,
      title: "Improve recent success rate and readiness score",
      description: "Fix recurring failure modes, keep eval replay passing, and produce a new score snapshot.",
      current_value: `${scoreBreakdown.total_score}/100`,
      target_value: `${LEVELS.L2.target_score}/100`,
      expected_score_delta: Math.max(delta, LEVELS.L2.target_score - scoreBreakdown.total_score),
      verification_requirements: ["New readiness_score_snapshots row", "Autonomy Readiness Score >= 60", "No hard blockers in latest gate"],
      success_criteria: ["Latest gate has no hard blockers", "Score blocker autonomy_readiness_below_target is absent"],
    };
  }
  if (blocker.code.includes("eval")) {
    return {
      ...base,
      title: "Restore full eval confidence",
      description: "Clear eval coverage gaps and keep replay pass rate at 100%.",
      current_value: `gaps=${metrics.eval_coverage_gap_count}, pass=${pct(metrics.eval_replay_pass_rate)}`,
      target_value: "gaps=0, pass=100%",
      expected_score_delta: delta,
      verification_requirements: ["eval_coverage_gap_count=0", "eval_replay_pass_rate=100%", "latest eval_run gate_decision=passed"],
      success_criteria: ["Eval confidence score reaches 100"],
    };
  }
  if (blocker.code.includes("risk") || blocker.code.includes("sensitive") || blocker.code.includes("unsafe") || blocker.code.includes("permission")) {
    return {
      ...base,
      title: "Remove high-risk autonomy blockers",
      description: "Resolve high-risk outputs, unsafe tool use, sensitive-data leaks, and policy high-risk matches.",
      current_value: `${blocker.current}`,
      target_value: `${blocker.target}`,
      expected_score_delta: delta,
      verification_requirements: ["high_risk_runs=0", "policy_high_risk_hits=0", "no sensitive/unsafe/permission taxonomy in latest window"],
      success_criteria: ["Risk control score >= 80", "No risk hard blockers"],
    };
  }
  if (blocker.code.includes("human_review")) {
    return {
      ...base,
      title: "Reduce human review dependency",
      description: "Improve prompt/tool reliability so routine runs no longer require human review.",
      current_value: pct(metrics.needs_human_review_rate),
      target_value: "<=15%",
      expected_score_delta: delta,
      verification_requirements: ["needs_human_review_rate <= 15%", "new gate check"],
      success_criteria: ["Human review dependency score >= 80"],
    };
  }
  if (blocker.code.includes("incident")) {
    return {
      ...base,
      title: "Close or verify open incidents",
      description: "Investigate, remediate, and verify incidents before autonomy increases.",
      current_value: `${metrics.open_incident_count} open`,
      target_value: "0 open",
      expected_score_delta: delta,
      verification_requirements: ["open_incident_count=0", "incident remediation events show verified/dismissed"],
      success_criteria: ["Incident score reaches 100"],
    };
  }
  if (
    blocker.code.includes("evidence_not_certifiable") ||
    blocker.code.includes("source_evidence") ||
    blocker.code.includes("data_provenance") ||
    blocker.code.includes("mixed_source") ||
    blocker.code.includes("certification_production_run_count") ||
    blocker.code.includes("certification_api_key_authentication") ||
    blocker.code.includes("certification_signature_verification") ||
    blocker.code.includes("certification_no_console_sample")
  ) {
    return {
      ...base,
      title: "Replace non-production evidence with production run traces",
      description: "Collect authenticated webhook/API runs from the real customer Agent before using the score for autonomy certification.",
      current_value: `${blocker.current}`,
      target_value: `${blocker.target}`,
      expected_score_delta: 10,
      verification_requirements: [
        "production_candidate_runs > 0",
        "evidence_trust_level is production_evidence or production_with_metadata_gaps",
        "console_sample_runs=0 for the certification window",
      ],
      success_criteria: ["No data provenance hard blocker in latest gate"],
    };
  }
  return {
    ...base,
    title: "Stabilize cost and latency",
    description: "Remove severe cost or latency anomalies before autonomy increases.",
    current_value: `${metrics.cost_anomaly_count} anomalies`,
    target_value: "0 anomalies",
    expected_score_delta: delta,
    verification_requirements: ["cost_anomaly_count=0", "new nightly report"],
    success_criteria: ["Cost stability score >= 75"],
  };
}

function severityRank(severity) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[severity] || 0;
}

function mergeUnique(left = [], right = []) {
  return Array.from(new Set([...left, ...right]));
}

function dedupeObjectives(objectives = []) {
  const byTitle = new Map();
  for (const objective of objectives) {
    const key = objective.title;
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, objective);
      continue;
    }

    byTitle.set(key, {
      ...existing,
      severity: severityRank(objective.severity) > severityRank(existing.severity) ? objective.severity : existing.severity,
      type: existing.type === objective.type ? existing.type : `${existing.type},${objective.type}`,
      expected_score_delta: Math.min(30, Number(existing.expected_score_delta || 0) + Number(objective.expected_score_delta || 0)),
      verification_requirements: mergeUnique(existing.verification_requirements, objective.verification_requirements),
      success_criteria: mergeUnique(existing.success_criteria, objective.success_criteria),
      blocks_autonomy: existing.blocks_autonomy || objective.blocks_autonomy,
    });
  }

  return Array.from(byTitle.values());
}

export function generateCertificationRoadmap(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const createdAt = options.createdAt || nowIso();
    const targetLevel = normalizeAutonomyLevel(options.targetAutonomyLevel || "L2");
    const target = LEVELS[targetLevel] || LEVELS.L2;
    const agent = db.prepare(
      `SELECT a.id, p.org_id
       FROM agents a
       JOIN projects p ON p.id = a.project_id
       WHERE a.id = ? AND a.project_id = ?`
    ).get(agentId, projectId);
    if (!agent) throw new Error(`Agent not found in project: ${agentId}`);

    const policy = ensureScoringPolicy(db, targetLevel, createdAt);
    const metrics = computeReadinessMetrics(projectId, agentId, {
      db,
      skipMigrate: true,
      windowStart: options.windowStart,
      windowEnd: options.windowEnd,
    });
    const dataProvenance = dataProvenanceForTargetLevel(
      options.dataProvenance || latestReportDataProvenance(db, projectId, options.reportId || null),
      targetLevel
    );
    metrics.data_provenance = dataProvenance;
    const scoreBreakdown = computeScoreBreakdown(metrics);
    const hard = [...provenanceHardBlockers(dataProvenance), ...hardBlockers(metrics)];
    const score = scoreBlockers(scoreBreakdown, target.target_score);
    const gateStatus = hard.length || score.length ? "blocked" : "eligible_for_recheck";
    const blockedBy = hard.length && score.length ? "both" : hard.length ? "hard_blockers" : score.length ? "score_blockers" : "none";
    const objectives = dedupeObjectives([...hard, ...score].map((blocker) => objectiveForBlocker(blocker, metrics, scoreBreakdown)));
    const estimatedScore = clamp(scoreBreakdown.total_score + objectives.reduce((sum, item) => sum + Number(item.expected_score_delta || 0), 0));
    const certificationState = evaluateCertificationState({
      hardBlockers: hard,
      scoreBlockers: score,
      currentScore: scoreBreakdown.total_score,
      targetScore: target.target_score,
      dataProvenance,
    });
    const roadmap = {
      roadmap_version: "phase1_autonomy_certification_v1",
      agent_id: agentId,
      current_score: scoreBreakdown.total_score,
      target_score: target.target_score,
      target_autonomy_level: targetLevel,
      target_autonomy_label: target.label,
      current_gate_status: gateStatus,
      blocked_by: blockedBy,
      estimated_score_after_plan: estimatedScore,
      hard_blockers: hard,
      score_blockers: score,
      certification_state: certificationState,
      score_breakdown: scoreBreakdown,
      metric_snapshot: metrics,
      data_provenance: dataProvenance,
      remediation_objectives: objectives,
      verification_requirements: objectives.flatMap((item) => item.verification_requirements),
      recheck_command: "npm run local:autonomy-gate",
    };

    return { project_id: projectId, org_id: agent.org_id, agent_id: agentId, scoring_policy: policy, roadmap };
  } finally {
    if (!options.db) db.close();
  }
}

export function persistCertificationRoadmap(db, certification, options = {}) {
  const createdAt = options.createdAt || nowIso();
  const { roadmap, org_id: orgId, project_id: projectId, agent_id: agentId, scoring_policy: policy } = certification;
  const metricId = createId("metric_snapshot");
  const scoreId = createId("readiness_score");
  const gateId = createId("gate_result");
  const roadmapId = createId("roadmap");
  const metrics = roadmap.metric_snapshot;
  const scores = roadmap.score_breakdown;
  const carriedVerifiedObjectives = new Map(
    db.prepare(
      `SELECT *
       FROM remediation_objectives
       WHERE project_id = ? AND agent_id = ? AND status = 'verified'`
    ).all(projectId, agentId).map(parseObjectiveRow).map((objective) => [objective.title, objective])
  );
  if (roadmap.remediation_objectives.length) {
    const supersedeCandidates = db.prepare(
      `SELECT *
       FROM remediation_objectives
       WHERE project_id = ? AND agent_id = ?
         AND status IN ('open', 'evidence_attached', 'reopened', 'rejected')`
    ).all(projectId, agentId).map(parseObjectiveRow);
    const eventInsert = db.prepare(
      `INSERT INTO remediation_objective_events (
        id, remediation_objective_id, org_id, project_id, agent_id, gate_result_id,
        actor_type, actor_id, from_status, to_status, note, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const auditInsert = db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const objective of supersedeCandidates) {
      db.prepare("UPDATE remediation_objectives SET status = 'superseded', updated_at = ? WHERE id = ?")
        .run(createdAt, objective.id);
      const eventId = createId("objective_event");
      const evidence = {
        reason: "new_certification_roadmap_superseded_prior_active_objective",
        new_gate_result_id: gateId,
        new_objective_title: objective.title,
      };
      eventInsert.run(
        eventId,
        objective.id,
        objective.org_id,
        objective.project_id,
        objective.agent_id,
        objective.gate_result_id,
        "system",
        "autonomy_certification",
        objective.status,
        "superseded",
        "A newer certification roadmap generated a replacement objective.",
        toJson(evidence),
        createdAt
      );
      auditInsert.run(
        createId("audit"),
        objective.org_id,
        objective.project_id,
        "system",
        "autonomy_certification",
        "remediation_objective.superseded",
        "remediation_objective",
        objective.id,
        toJson({ remediation_objective_event_id: eventId, ...evidence }),
        createdAt
      );
    }
  }

  db.prepare(
    `INSERT INTO readiness_metric_snapshots (
      id, org_id, project_id, agent_id, window_start, window_end,
      total_runs, success_runs, failure_runs, partial_failure_runs, high_risk_runs,
      needs_human_review_runs, eval_cases_total, eval_cases_replayed, eval_replay_pass_rate,
      eval_coverage_gap_count, open_incident_count, critical_incident_count,
      policy_high_risk_hits, cost_anomaly_count, avg_cost_per_run, p95_latency,
      metrics_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    metricId, orgId, projectId, agentId, metrics.window_start || "", metrics.window_end || "",
    metrics.total_runs, metrics.success_runs, metrics.failure_runs, metrics.partial_failure_runs, metrics.high_risk_runs,
    metrics.needs_human_review_runs, metrics.eval_cases_total, metrics.eval_cases_replayed, metrics.eval_replay_pass_rate,
    metrics.eval_coverage_gap_count, metrics.open_incident_count, metrics.critical_incident_count,
    metrics.policy_high_risk_hits, metrics.cost_anomaly_count, metrics.avg_cost_per_run, metrics.p95_latency,
    toJson(metrics), createdAt
  );

  db.prepare(
    `INSERT INTO readiness_score_snapshots (
      id, org_id, project_id, agent_id, metric_snapshot_id, scoring_policy_id,
      scoring_policy_version, target_autonomy_level, total_score, reliability_score,
      eval_confidence_score, risk_control_score, human_review_dependency_score,
      incident_score, cost_stability_score, score_reasons_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    scoreId, orgId, projectId, agentId, metricId, policy.id,
    policy.version, roadmap.target_autonomy_level, scores.total_score,
    scores.dimensions.reliability_score.score,
    scores.dimensions.eval_confidence_score.score,
    scores.dimensions.risk_control_score.score,
    scores.dimensions.human_review_dependency_score.score,
    scores.dimensions.incident_score.score,
    scores.dimensions.cost_stability_score.score,
    toJson(Object.values(scores.dimensions).flatMap((item) => item.reasons)),
    createdAt
  );

  db.prepare(
    `INSERT INTO autonomy_gate_results (
      id, org_id, project_id, agent_id, score_snapshot_id, target_autonomy_level,
      gate_status, blocked_by, hard_blockers_json, score_blockers_json, gate_reasons_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    gateId, orgId, projectId, agentId, scoreId, roadmap.target_autonomy_level,
    roadmap.current_gate_status, roadmap.blocked_by, toJson(roadmap.hard_blockers),
    toJson(roadmap.score_blockers), toJson([...roadmap.hard_blockers, ...roadmap.score_blockers]), createdAt
  );

  const insertObjective = db.prepare(
    `INSERT INTO remediation_objectives (
      id, org_id, project_id, agent_id, gate_result_id, type, severity, title, description,
      current_value, target_value, expected_score_delta, blocks_autonomy,
      verification_requirements_json, success_criteria_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const persistedObjectives = roadmap.remediation_objectives.map((objective) => {
    const carried = carriedVerifiedObjectives.get(objective.title);
    return carried
      ? { ...objective, id: carried.id, status: carried.status, carried_forward_from_objective_id: carried.id }
      : { ...objective, id: createId("objective") };
  });
  for (const objective of persistedObjectives.filter((item) => !item.carried_forward_from_objective_id)) {
    insertObjective.run(
      objective.id, orgId, projectId, agentId, gateId, objective.type, objective.severity,
      objective.title, objective.description, objective.current_value, objective.target_value,
      objective.expected_score_delta, objective.blocks_autonomy ? 1 : 0,
      toJson(objective.verification_requirements), toJson(objective.success_criteria),
      objective.status || "open", createdAt, createdAt
    );
  }

  const persistedRoadmap = {
    ...roadmap,
    metric_snapshot_id: metricId,
    score_snapshot_id: scoreId,
    gate_result_id: gateId,
    remediation_objectives: persistedObjectives,
  };
  db.prepare(
    `INSERT INTO autonomy_certification_roadmaps (
      id, org_id, project_id, agent_id, gate_result_id, current_score, target_score,
      target_autonomy_level, estimated_score_after_completion, roadmap_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    roadmapId, orgId, projectId, agentId, gateId, roadmap.current_score, roadmap.target_score,
    roadmap.target_autonomy_level, roadmap.estimated_score_after_plan, toJson(persistedRoadmap),
    roadmap.current_gate_status === "blocked" ? "open" : "eligible", createdAt, createdAt
  );

  return { roadmap_id: roadmapId, org_id: orgId, project_id: projectId, agent_id: agentId, ...persistedRoadmap };
}

export function buildAndPersistCertificationRoadmap(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const certification = generateCertificationRoadmap(projectId, agentId, { ...options, db, skipMigrate: true });
    return persistCertificationRoadmap(db, certification, options);
  } finally {
    if (!options.db) db.close();
  }
}

export function latestCertificationRoadmap(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const row = db.prepare(
      `SELECT *
       FROM autonomy_certification_roadmaps
       WHERE project_id = ? AND agent_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(projectId, agentId);
    return row ? { ...row, roadmap_json: fromJson(row.roadmap_json, {}) } : null;
  } finally {
    if (!options.db) db.close();
  }
}

function parseObjectiveRow(row) {
  if (!row) return null;
  return {
    ...row,
    blocks_autonomy: Boolean(row.blocks_autonomy),
    verification_requirements: fromJson(row.verification_requirements_json, []),
    success_criteria: fromJson(row.success_criteria_json, []),
  };
}

function parseObjectiveEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence_json: fromJson(row.evidence_json, {}),
  };
}

function parseRecheckRow(row) {
  if (!row) return null;
  return {
    ...row,
    objective_status_summary: fromJson(row.objective_status_summary_json, {}),
    recheck_summary: fromJson(row.recheck_summary_json, {}),
  };
}

function parseObjectiveMetricValidationRow(row) {
  if (!row) return null;
  return {
    ...row,
    metric_signal: fromJson(row.metric_signal_json, {}),
  };
}

function parseObjectiveEvidenceReviewRow(row) {
  if (!row) return null;
  return {
    ...row,
    review_json: fromJson(row.review_json, {}),
  };
}

function parseObjectiveRunClosureAssessmentRow(row) {
  if (!row) return null;
  return {
    ...row,
    metric_evidence: fromJson(row.metric_evidence_json, {}),
  };
}

function parseCertificationReviewRequestRow(row) {
  if (!row) return null;
  return {
    ...row,
    review_packet: fromJson(row.review_packet_json, {}),
    required_signoffs: fromJson(row.required_signoffs_json, []),
    reviewer_decision: fromJson(row.reviewer_decision_json, {}),
  };
}

function parseCertificationReviewDecisionRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: fromJson(row.evidence_json, {}),
  };
}

function parseCertificationEvidenceTaskRow(row) {
  if (!row) return null;
  return {
    ...row,
    required_evidence: fromJson(row.required_evidence_json, []),
    success_criteria: fromJson(row.success_criteria_json, []),
  };
}

function parseCertificationEvidenceTaskEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: fromJson(row.evidence_json, {}),
  };
}

function parseCertificationActionQueueRow(row) {
  if (!row) return null;
  return {
    ...row,
    action: fromJson(row.action_json, {}),
  };
}

function parseCertificationActionEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: fromJson(row.evidence_json, {}),
  };
}

function parseCertificationActionEffectivenessRow(row) {
  if (!row) return null;
  return {
    ...row,
    blocker_persisted: Boolean(row.blocker_persisted),
    effectiveness: fromJson(row.effectiveness_json, {}),
  };
}

function enrichCertificationActionEventWithEvidenceQuality(event, nowIsoString = nowIso()) {
  if (!event) return null;
  const quality = scoreCertificationActionEvidence({
    event_status: event.to_status,
    evidence: event.evidence,
    created_at: event.created_at,
  }, nowIsoString);
  return {
    ...event,
    evidence_quality_score: quality.score,
    evidence_quality_level: quality.level,
    evidence_quality_reasons: quality.reasons,
    evidence_quality_factors: quality.factors,
  };
}

const OBJECTIVE_STATUS_TRANSITIONS = {
  open: new Set(["evidence_attached", "verified", "rejected", "superseded"]),
  evidence_attached: new Set(["verified", "rejected", "superseded", "open"]),
  verified: new Set(["reopened", "superseded"]),
  rejected: new Set(["reopened", "superseded"]),
  reopened: new Set(["evidence_attached", "verified", "rejected", "superseded"]),
  superseded: new Set([]),
};

const EVIDENCE_TASK_STATUS_TRANSITIONS = {
  open: new Set(["evidence_attached", "verified", "rejected", "closed", "superseded"]),
  evidence_attached: new Set(["verified", "rejected", "open", "closed", "superseded"]),
  verified: new Set(["closed", "reopened", "superseded"]),
  rejected: new Set(["reopened", "superseded"]),
  closed: new Set(["reopened", "superseded"]),
  reopened: new Set(["evidence_attached", "verified", "rejected", "closed", "superseded"]),
  superseded: new Set([]),
};

const CERTIFICATION_ACTION_STATUS_TRANSITIONS = {
  open: new Set(["in_progress", "evidence_attached", "resolved", "dismissed", "superseded"]),
  in_progress: new Set(["evidence_attached", "resolved", "dismissed", "open", "superseded"]),
  evidence_attached: new Set(["in_progress", "resolved", "dismissed", "open", "superseded"]),
  resolved: new Set(["reopened", "superseded"]),
  dismissed: new Set(["reopened", "superseded"]),
  reopened: new Set(["in_progress", "evidence_attached", "resolved", "dismissed", "superseded"]),
  superseded: new Set([]),
};

const CERTIFICATION_EVIDENCE_TARGET_TYPES = new Set([
  "external",
  "incident_report",
  "eval_run",
  "recheck",
  "report",
  "evidence_pack",
]);

function assertValidCertificationActionTransition(fromStatus, toStatus) {
  if (!toStatus) {
    throw new Error("Certification action status is required");
  }

  if (fromStatus === toStatus) {
    return;
  }

  const allowed = CERTIFICATION_ACTION_STATUS_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.has(toStatus)) {
    throw new Error(`Invalid certification action transition: ${fromStatus} -> ${toStatus}`);
  }
}

function validateCertificationActionEvidenceTarget(db, action, evidence = {}, toStatus) {
  const targetType = String(evidence.evidence_target_type || "external").trim();
  const targetId = evidence.evidence_target_id ? String(evidence.evidence_target_id).trim() : null;

  if (!CERTIFICATION_EVIDENCE_TARGET_TYPES.has(targetType)) {
    throw new Error(`Unsupported certification action evidence target type: ${targetType}`);
  }

  if (targetType === "external") {
    return {
      ...evidence,
      evidence_target_type: targetType,
      evidence_target_id: targetId,
      evidence_target_validated: Boolean(evidence.evidence_ref),
      evidence_target_validation: "external_reference_not_platform_verified",
    };
  }

  if (toStatus === "evidence_attached" && !targetId) {
    throw new Error("Certification action evidence target id is required for platform evidence targets.");
  }

  if (!targetId) {
    return {
      ...evidence,
      evidence_target_type: targetType,
      evidence_target_id: null,
      evidence_target_validated: false,
      evidence_target_validation: "platform_target_not_provided",
    };
  }

  const tableChecks = {
    incident_report: {
      query: "SELECT id, project_id, agent_id FROM incident_reports WHERE id = ?",
      validate: (row) => row.project_id === action.project_id && (!row.agent_id || row.agent_id === action.agent_id),
    },
    eval_run: {
      query: "SELECT id, project_id, agent_id FROM eval_runs WHERE id = ?",
      validate: (row) => row.project_id === action.project_id && row.agent_id === action.agent_id,
    },
    recheck: {
      query: "SELECT id, project_id, agent_id FROM autonomy_gate_recheck_history WHERE id = ?",
      validate: (row) => row.project_id === action.project_id && row.agent_id === action.agent_id,
    },
    report: {
      query: "SELECT id, project_id, NULL AS agent_id FROM reports WHERE id = ?",
      validate: (row) => row.project_id === action.project_id,
    },
    evidence_pack: {
      query: "SELECT id, project_id, NULL AS agent_id FROM reports WHERE id = ?",
      validate: (row) => row.project_id === action.project_id,
    },
  };
  const check = tableChecks[targetType];
  const row = check ? db.prepare(check.query).get(targetId) : null;
  if (!row) {
    throw new Error(`Certification action evidence target not found: ${targetType}:${targetId}`);
  }
  if (!check.validate(row)) {
    throw new Error(`Certification action evidence target does not belong to this action: ${targetType}:${targetId}`);
  }

  return {
    ...evidence,
    evidence_target_type: targetType,
    evidence_target_id: targetId,
    evidence_target_validated: true,
    evidence_target_validation: "platform_target_verified",
  };
}

function assertValidEvidenceTaskTransition(fromStatus, toStatus) {
  if (!toStatus) {
    throw new Error("Evidence task status is required");
  }

  if (fromStatus === toStatus) {
    return;
  }

  const allowed = EVIDENCE_TASK_STATUS_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.has(toStatus)) {
    throw new Error(`Invalid certification evidence task transition: ${fromStatus} -> ${toStatus}`);
  }
}

function assertValidObjectiveTransition(fromStatus, toStatus) {
  if (!toStatus) {
    throw new Error("Objective status is required");
  }

  if (fromStatus === toStatus) {
    return;
  }

  const allowed = OBJECTIVE_STATUS_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.has(toStatus)) {
    throw new Error(`Invalid remediation objective transition: ${fromStatus} -> ${toStatus}`);
  }
}

export function getRemediationObjective(objectiveId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    return parseObjectiveRow(db.prepare("SELECT * FROM remediation_objectives WHERE id = ?").get(objectiveId));
  } finally {
    if (!options.db) db.close();
  }
}

export function updateRemediationObjectiveStatus(objectiveId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const row = db.prepare("SELECT * FROM remediation_objectives WHERE id = ?").get(objectiveId);
    if (!row) throw new Error(`Remediation objective not found: ${objectiveId}`);
    const objective = parseObjectiveRow(row);
    const toStatus = String(payload.status || payload.to_status || "").trim();
    assertValidObjectiveTransition(objective.status, toStatus);

    const createdAt = options.createdAt || nowIso();
    const actorType = String(payload.actor_type || options.actorType || "user");
    const actorId = payload.actor_id || options.actorId || null;
    const note = payload.note ? String(payload.note) : null;
    const evidence = payload.evidence_json || payload.evidence || {};
    const eventId = createId("objective_event");

    db.exec("BEGIN");
    try {
      db.prepare("UPDATE remediation_objectives SET status = ?, updated_at = ? WHERE id = ?")
        .run(toStatus, createdAt, objectiveId);

      db.prepare(
        `INSERT INTO remediation_objective_events (
          id, remediation_objective_id, org_id, project_id, agent_id, gate_result_id,
          actor_type, actor_id, from_status, to_status, note, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        objectiveId,
        objective.org_id,
        objective.project_id,
        objective.agent_id,
        objective.gate_result_id,
        actorType,
        actorId,
        objective.status,
        toStatus,
        note,
        toJson(evidence),
        createdAt
      );

      db.prepare(
        `INSERT INTO audit_events (
          id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        createId("audit"),
        objective.org_id,
        objective.project_id,
        actorType,
        actorId,
        "remediation_objective.status_updated",
        "remediation_objective",
        objectiveId,
        toJson({
          from_status: objective.status,
          to_status: toStatus,
          note,
          evidence,
          remediation_objective_event_id: eventId,
          gate_result_id: objective.gate_result_id,
        }),
        createdAt
      );

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      objective: getRemediationObjective(objectiveId, { db, skipMigrate: true }),
      objective_event: parseObjectiveEventRow(db.prepare(
        "SELECT * FROM remediation_objective_events WHERE id = ?"
      ).get(eventId)),
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function listRemediationObjectiveEvents(objectiveId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));
    return db.prepare(
      `SELECT *
       FROM remediation_objective_events
       WHERE remediation_objective_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(objectiveId, limit).map(parseObjectiveEventRow);
  } finally {
    if (!options.db) db.close();
  }
}

function requirementKey(requirement) {
  return String(requirement || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function evidenceRequirementKeys(evidence = {}) {
  const keys = new Set();
  for (const value of [
    evidence.requirement_key,
    evidence.requirement,
    evidence.verification_requirement,
    evidence.evidence_type,
  ]) {
    if (value) keys.add(requirementKey(value));
  }

  for (const value of evidence.requirement_keys || evidence.requirements || []) {
    keys.add(requirementKey(value));
  }

  return keys;
}

function evaluateRequirement(requirement, objective, events, asOf) {
  const key = requirementKey(requirement);
  const candidates = events.filter((event) => {
    const evidence = event.evidence_json || {};
    return evidenceRequirementKeys(evidence).has(key);
  });

  if (!candidates.length) {
    return {
      requirement,
      requirement_key: key,
      status: "missing",
      evidence_event_id: null,
      reason: "No attached evidence matched this requirement.",
    };
  }

  const latest = candidates[0];
  const evidence = latest.evidence_json || {};
  if (evidence.applies_to_objective_id && evidence.applies_to_objective_id !== objective.id) {
    return {
      requirement,
      requirement_key: key,
      status: "mismatched_objective",
      evidence_event_id: latest.id,
      reason: "Attached evidence points to a different remediation objective.",
    };
  }

  if (evidence.expires_at && new Date(evidence.expires_at).getTime() < new Date(asOf).getTime()) {
    return {
      requirement,
      requirement_key: key,
      status: "expired",
      evidence_event_id: latest.id,
      reason: "Attached evidence is expired.",
    };
  }

  if (["satisfied", "cleared", "verified"].includes(evidence.metric_status || evidence.status)) {
    return {
      requirement,
      requirement_key: key,
      status: "satisfied",
      evidence_event_id: latest.id,
      reason: "Attached evidence explicitly satisfies the requirement.",
    };
  }

  return {
    requirement,
    requirement_key: key,
    status: "attached_but_unverified",
    evidence_event_id: latest.id,
    reason: "Evidence is attached but does not explicitly mark the metric as satisfied.",
  };
}

export function reviewObjectiveEvidenceRequirements(objectiveId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const objective = getRemediationObjective(objectiveId, { db, skipMigrate: true });
    if (!objective) throw new Error(`Remediation objective not found: ${objectiveId}`);
    const asOf = options.asOf || options.createdAt || nowIso();
    const events = listRemediationObjectiveEvents(objectiveId, { db, skipMigrate: true, limit: 100 });
    const requirements = objective.verification_requirements || [];
    const items = requirements.map((requirement) => evaluateRequirement(requirement, objective, events, asOf));
    const missingCount = items.filter((item) => item.status === "missing").length;
    const expiredCount = items.filter((item) => item.status === "expired").length;
    const mismatchedCount = items.filter((item) => item.status === "mismatched_objective").length;
    const satisfiedCount = items.filter((item) => item.status === "satisfied").length;
    const attachedButUnverifiedCount = items.filter((item) => item.status === "attached_but_unverified").length;
    const reviewStatus = missingCount || expiredCount || mismatchedCount
      ? "requirements_incomplete"
      : attachedButUnverifiedCount
        ? "evidence_attached_but_unverified"
        : "requirements_satisfied";
    const review = {
      objective_id: objective.id,
      objective_title: objective.title,
      review_status: reviewStatus,
      as_of: asOf,
      satisfied_count: satisfiedCount,
      missing_count: missingCount,
      expired_count: expiredCount,
      mismatched_count: mismatchedCount,
      attached_but_unverified_count: attachedButUnverifiedCount,
      requirements: items,
    };

    if (options.persist) {
      const id = createId("objective_evidence_review");
      db.prepare(
        `INSERT INTO objective_evidence_reviews (
          id, remediation_objective_id, org_id, project_id, agent_id,
          review_status, satisfied_count, missing_count, expired_count,
          mismatched_count, review_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        objective.id,
        objective.org_id,
        objective.project_id,
        objective.agent_id,
        reviewStatus,
        satisfiedCount,
        missingCount,
        expiredCount,
        mismatchedCount,
        toJson(review),
        asOf
      );
      return { evidence_review_id: id, ...review };
    }

    return review;
  } finally {
    if (!options.db) db.close();
  }
}

export function listObjectiveEvidenceReviews(objectiveId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
    return db.prepare(
      `SELECT *
       FROM objective_evidence_reviews
       WHERE remediation_objective_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(objectiveId, limit).map(parseObjectiveEvidenceReviewRow);
  } finally {
    if (!options.db) db.close();
  }
}

function objectiveStatusSummary(db, projectId, agentId) {
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS count
     FROM remediation_objectives
     WHERE project_id = ? AND agent_id = ?
     GROUP BY status
     ORDER BY status`
  ).all(projectId, agentId);

  return {
    total: rows.reduce((sum, row) => sum + Number(row.count || 0), 0),
    by_status: rows.map((row) => ({ status: row.status, count: Number(row.count || 0) })),
  };
}

function activeObjectivesForClosure(db, projectId, agentId) {
  return db.prepare(
    `SELECT *
     FROM remediation_objectives
     WHERE project_id = ? AND agent_id = ? AND status != 'superseded'
     ORDER BY updated_at DESC`
  ).all(projectId, agentId).map(parseObjectiveRow);
}

function assessObjectiveFromRunMetrics(objective, roadmap) {
  const metrics = roadmap.metric_snapshot || {};
  const riskyCodes = new Set((metrics.risky_taxonomies || []).map((item) => item.taxonomy_code));
  const metricEvidence = {
    window_start: metrics.window_start,
    window_end: metrics.window_end,
    total_runs: metrics.total_runs,
    success_rate: metrics.success_rate,
    high_risk_runs: metrics.high_risk_runs,
    policy_high_risk_hits: metrics.policy_high_risk_hits,
    risky_taxonomies: Array.from(riskyCodes),
    needs_human_review_rate: metrics.needs_human_review_rate,
    open_incident_count: metrics.open_incident_count,
    critical_incident_count: metrics.critical_incident_count,
    eval_replay_pass_rate: metrics.eval_replay_pass_rate,
    eval_coverage_gap_count: metrics.eval_coverage_gap_count,
    total_score: roadmap.current_score,
    target_score: roadmap.target_score,
    hard_blocker_count: (roadmap.hard_blockers || []).length,
  };

  if (!metrics.total_runs) {
    return {
      closure_status: "insufficient_run_evidence",
      current_value: "0 runs",
      target_value: objective.target_value,
      metric_evidence: metricEvidence,
    };
  }

  if (objective.title === "Remove high-risk autonomy blockers") {
    const closed = metrics.high_risk_runs === 0 &&
      metrics.policy_high_risk_hits === 0 &&
      !["sensitive_data_exposure", "unsafe_tool_call", "permission_escalation_attempt"].some((code) => riskyCodes.has(code));
    return {
      closure_status: closed ? "closure_ready" : "still_blocked",
      current_value: `high_risk=${metrics.high_risk_runs}, policy_hits=${metrics.policy_high_risk_hits}`,
      target_value: "high_risk=0, policy_hits=0, risky_taxonomies=0",
      metric_evidence: metricEvidence,
    };
  }

  if (objective.title === "Improve recent success rate to >= 90%") {
    const closed = Number(metrics.success_rate || 0) >= POLICY_CONFIG.targets.recent_success_rate &&
      Number(metrics.eval_replay_pass_rate || 0) === 1;
    return {
      closure_status: closed ? "closure_ready" : "still_blocked",
      current_value: `success_rate=${pct(metrics.success_rate)}, eval_replay=${pct(metrics.eval_replay_pass_rate)}`,
      target_value: "success_rate>=90%, eval_replay=100%",
      metric_evidence: metricEvidence,
    };
  }

  if (objective.title === "Reduce human review dependency") {
    const closed = Number(metrics.needs_human_review_rate || 0) <= POLICY_CONFIG.targets.needs_human_review_rate;
    return {
      closure_status: closed ? "closure_ready" : "still_blocked",
      current_value: `needs_human_review_rate=${pct(metrics.needs_human_review_rate)}`,
      target_value: "needs_human_review_rate<=15%",
      metric_evidence: metricEvidence,
    };
  }

  if (objective.title === "Close or verify open incidents") {
    const closed = metrics.open_incident_count === 0 && metrics.critical_incident_count === 0;
    return {
      closure_status: closed ? "closure_ready" : "still_blocked",
      current_value: `open=${metrics.open_incident_count}, critical=${metrics.critical_incident_count}`,
      target_value: "open=0, critical=0",
      metric_evidence: metricEvidence,
    };
  }

  if (objective.title === "Improve recent success rate and readiness score") {
    const closed = roadmap.current_score >= roadmap.target_score && (roadmap.hard_blockers || []).length === 0;
    return {
      closure_status: closed ? "closure_ready" : "still_blocked",
      current_value: `${roadmap.current_score}/100, hard_blockers=${(roadmap.hard_blockers || []).length}`,
      target_value: `${roadmap.target_score}/100, hard_blockers=0`,
      metric_evidence: metricEvidence,
    };
  }

  return {
    closure_status: "not_metric_closable",
    current_value: objective.current_value,
    target_value: objective.target_value,
    metric_evidence: metricEvidence,
  };
}

function verifiedObjectiveMetricValidations(db, projectId, agentId, newRoadmap) {
  const verifiedObjectives = db.prepare(
    `SELECT *
     FROM remediation_objectives
     WHERE project_id = ? AND agent_id = ? AND status = 'verified'
     ORDER BY updated_at DESC`
  ).all(projectId, agentId).map(parseObjectiveRow);

  const newObjectives = newRoadmap.remediation_objectives || [];
  const newObjectiveTitles = new Set(newObjectives.map((item) => item.title));
  const hardBlockerCodes = new Set((newRoadmap.hard_blockers || []).map((item) => item.code));
  const scoreBlockerCodes = new Set((newRoadmap.score_blockers || []).map((item) => item.code));

  return verifiedObjectives.map((objective) => {
    const sameObjectiveStillRequired = newObjectiveTitles.has(objective.title);
    const riskStillBlocked = objective.title === "Remove high-risk autonomy blockers" && (
      hardBlockerCodes.has("recent_high_risk_judgement") ||
      hardBlockerCodes.has("sensitive_data_leak_detected") ||
      hardBlockerCodes.has("unsafe_tool_call_detected") ||
      hardBlockerCodes.has("permission_escalation_attempt_detected") ||
      scoreBlockerCodes.has("risk_control_score_below_target")
    );
    const incidentStillBlocked = objective.title === "Close or verify open incidents" && (
      hardBlockerCodes.has("open_critical_incident") ||
      scoreBlockerCodes.has("incident_score_below_target")
    );
    const reliabilityStillBlocked = (
      objective.title === "Improve recent success rate to >= 90%" ||
      objective.title === "Improve recent success rate and readiness score"
    ) && (
      scoreBlockerCodes.has("reliability_score_below_target") ||
      scoreBlockerCodes.has("autonomy_readiness_below_target")
    );
    const humanReviewStillBlocked = objective.title === "Reduce human review dependency" &&
      scoreBlockerCodes.has("human_review_dependency_score_below_target");
    const unresolved = sameObjectiveStillRequired || riskStillBlocked || incidentStillBlocked || reliabilityStillBlocked || humanReviewStillBlocked;

    return {
      remediation_objective_id: objective.id,
      objective_title: objective.title,
      objective_status: objective.status,
      validation_status: unresolved ? "verified_but_metric_unresolved" : "verified_and_metric_cleared",
      metric_signal: {
        same_objective_still_required: sameObjectiveStillRequired,
        matching_hard_blockers: Array.from(hardBlockerCodes),
        matching_score_blockers: Array.from(scoreBlockerCodes),
        new_score: newRoadmap.current_score,
        target_score: newRoadmap.target_score,
        new_gate_status: newRoadmap.current_gate_status,
        new_blocked_by: newRoadmap.blocked_by,
      },
    };
  });
}

function evaluateEvidenceTaskCriterion(criterion, context = {}) {
  const value = String(criterion || "").trim();
  const hardBlockerCodes = new Set((context.roadmap?.hard_blockers || []).map((item) => item.code));
  const scoreBlockerCodes = new Set((context.roadmap?.score_blockers || []).map((item) => item.code));
  const dimensions = context.roadmap?.score_breakdown?.dimensions || {};
  if (value.startsWith("hard_blocker_absent:")) {
    const code = value.slice("hard_blocker_absent:".length);
    return { criterion: value, satisfied: !hardBlockerCodes.has(code), evidence: { hard_blocker_code: code } };
  }
  if (value.startsWith("score_blocker_absent:")) {
    const code = value.slice("score_blocker_absent:".length);
    return { criterion: value, satisfied: !scoreBlockerCodes.has(code), evidence: { score_blocker_code: code } };
  }
  const scoreBlockerTextMatch = value.match(/score blocker ([a-z0-9_]+) is absent/i);
  if (scoreBlockerTextMatch) {
    const code = scoreBlockerTextMatch[1];
    return { criterion: value, satisfied: !scoreBlockerCodes.has(code), evidence: { score_blocker_code: code, matched_rule: "score_blocker_text_absent" } };
  }
  if (value.startsWith("evidence_requirement_status=")) {
    const expected = value.slice("evidence_requirement_status=".length);
    return { criterion: value, satisfied: context.evidenceRequirementStatus === expected, evidence: { current: context.evidenceRequirementStatus, expected } };
  }
  if (value.startsWith("metric_validation_status=")) {
    const expected = value.slice("metric_validation_status=".length);
    return { criterion: value, satisfied: context.metricValidationStatus === expected, evidence: { current: context.metricValidationStatus, expected } };
  }
  if (value.startsWith("run_closure_status=")) {
    const expected = value.slice("run_closure_status=".length);
    return { criterion: value, satisfied: context.runClosureStatus === expected, evidence: { current: context.runClosureStatus, expected } };
  }

  const normalized = value.toLowerCase();
  const checks = [
    ["latest gate has no hard blockers", () => (context.roadmap?.hard_blockers || []).length === 0],
    ["no hard blockers", () => (context.roadmap?.hard_blockers || []).length === 0],
    ["risk control score >= 80", () => Number(dimensions.risk_control_score?.score || 0) >= 80],
    ["reliability score >= 70", () => Number(dimensions.reliability_score?.score || 0) >= 70],
    ["incident score reaches 100", () => Number(dimensions.incident_score?.score || 0) >= 100],
    ["eval confidence score reaches 100", () => Number(dimensions.eval_confidence_score?.score || 0) >= 100],
    ["human review dependency score >= 80", () => Number(dimensions.human_review_dependency_score?.score || 0) >= 80],
    ["cost stability score >= 75", () => Number(dimensions.cost_stability_score?.score || 0) >= 75],
  ];
  for (const [needle, check] of checks) {
    if (normalized.includes(needle)) {
      return { criterion: value, satisfied: check(), evidence: { matched_rule: needle } };
    }
  }

  return { criterion: value, satisfied: false, evidence: { reason: "criterion_not_machine_evaluable" } };
}

function latestValidatedCertificationActionEvidenceByBlocker(db, projectId, agentId) {
  const rows = db.prepare(
    `SELECT
       q.blocker_code,
       q.id AS certification_action_id,
       q.recommended_action,
       e.id AS event_id,
       e.to_status,
       e.note,
       e.evidence_json,
       e.created_at
     FROM certification_action_events e
     JOIN certification_action_queue q ON q.id = e.certification_action_id
     WHERE e.project_id = ?
       AND e.agent_id = ?
     ORDER BY e.created_at DESC`
  ).all(projectId, agentId);

  const byBlocker = new Map();
  for (const row of rows) {
    const evidence = fromJson(row.evidence_json, {});
    if (
      row.to_status !== "evidence_attached" &&
      row.to_status !== "resolved"
    ) {
      continue;
    }
    if (!evidence.evidence_target_validated) {
      continue;
    }
    if (!byBlocker.has(row.blocker_code)) {
      byBlocker.set(row.blocker_code, {
        blocker_code: row.blocker_code,
        certification_action_id: row.certification_action_id,
        recommended_action: row.recommended_action,
        event_id: row.event_id,
        event_status: row.to_status,
        evidence,
        note: row.note,
        created_at: row.created_at,
      });
    }
  }

  return byBlocker;
}

function scoreCertificationActionEvidence(record, nowIsoString = nowIso()) {
  if (!record || !record.evidence) {
    return {
      score: 0,
      level: "none",
      reasons: ["no_validated_action_evidence"],
      factors: {
        target_type: null,
        event_status: null,
        platform_validated: false,
        age_days: null,
      },
    };
  }

  const evidence = record.evidence || {};
  const hasEvidencePayload = Boolean(
    evidence.evidence_ref ||
    evidence.evidence_target_id ||
    evidence.evidence_target_type ||
    evidence.evidence_target_validated
  );
  if (!hasEvidencePayload) {
    return {
      score: 0,
      level: "none",
      reasons: ["no_action_evidence_payload"],
      factors: {
        target_type: null,
        event_status: record.event_status || null,
        platform_validated: false,
        age_days: null,
      },
    };
  }
  const targetType = evidence.evidence_target_type || "external";
  const platformValidated = Boolean(evidence.evidence_target_validated);
  const typeScores = {
    external: 30,
    report: 60,
    recheck: 70,
    incident_report: 75,
    eval_run: 85,
    evidence_pack: 90,
  };
  const reasons = [];
  let score = platformValidated
    ? Number(typeScores[targetType] ?? 60)
    : Number(typeScores.external);

  if (platformValidated) {
    reasons.push(`platform_validated_${targetType}`);
  } else {
    reasons.push("external_or_unverified_evidence");
  }

  if (record.event_status === "resolved") {
    score += 10;
    reasons.push("resolved_action_bonus");
  } else if (record.event_status === "evidence_attached") {
    reasons.push("evidence_attached_pending_metric_recheck");
  }

  const createdAtMs = Date.parse(record.created_at || "");
  const nowMs = Date.parse(nowIsoString || "");
  const ageDays = Number.isFinite(createdAtMs) && Number.isFinite(nowMs)
    ? Math.max(0, Math.floor((nowMs - createdAtMs) / 86400000))
    : null;
  let stale = false;
  if (ageDays !== null) {
    if (ageDays > 30) {
      score -= 30;
      stale = true;
      reasons.push("evidence_older_than_30_days");
    } else if (ageDays > 14) {
      score -= 15;
      reasons.push("evidence_older_than_14_days");
    } else if (ageDays > 7) {
      score -= 5;
      reasons.push("evidence_older_than_7_days");
    } else {
      reasons.push("evidence_recent");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = stale
    ? "stale"
    : score >= 80
      ? "strong"
      : score >= 60
        ? "moderate"
        : score >= 30
          ? "weak"
          : "none";

  return {
    score,
    level,
    reasons,
    factors: {
      target_type: targetType,
      event_status: record.event_status || null,
      platform_validated: platformValidated,
      age_days: ageDays,
    },
  };
}

function evaluateBlockerEvidenceSignal({ hasTask, hasAttachedEvidence, hasValidatedActionEvidence, evidenceQuality, closureRecommendedCount }) {
  if (!hasTask) {
    return {
      status: "missing_evidence_task",
      action_type: "generate_evidence_task",
      title: "Generate evidence task",
      reason: "This blocker has no evidence task coverage.",
      accepts_evidence_for_recheck: false,
    };
  }
  if (closureRecommendedCount > 0) {
    return {
      status: "closure_ready",
      action_type: "submit_for_human_closure",
      title: "Submit task for human closure",
      reason: "At least one task satisfies machine-evaluable closure criteria.",
      accepts_evidence_for_recheck: true,
    };
  }
  if (hasValidatedActionEvidence && Number(evidenceQuality?.score || 0) >= 60) {
    return {
      status: Number(evidenceQuality?.score || 0) >= 80
        ? "strong_evidence_metric_unresolved"
        : "platform_evidence_metric_unresolved",
      action_type: "rework_remediation",
      title: "Rework remediation evidence",
      reason: "Validated evidence is strong enough to review, but the blocker is still present in the latest recheck.",
      accepts_evidence_for_recheck: true,
    };
  }
  if (hasAttachedEvidence) {
    return {
      status: "evidence_quality_insufficient",
      action_type: "strengthen_evidence",
      title: "Strengthen certification evidence",
      reason: "Evidence exists, but it is weak, unvalidated, stale, or not linked to a platform evidence target.",
      accepts_evidence_for_recheck: false,
    };
  }
  return {
    status: "evidence_missing",
    action_type: "attach_evidence",
    title: "Attach required evidence",
    reason: "A task exists but has no attached evidence yet.",
    accepts_evidence_for_recheck: false,
  };
}

function summarizeCertificationEvidenceTasksForRecheck(db, projectId, agentId, context = {}) {
  const tasks = db.prepare(
    `SELECT *
     FROM certification_evidence_tasks
     WHERE project_id = ? AND agent_id = ?
       AND status != 'superseded'
     ORDER BY updated_at DESC, created_at DESC`
  ).all(projectId, agentId).map(parseCertificationEvidenceTaskRow);

  const byStatus = {};
  for (const task of tasks) {
    byStatus[task.status] = (byStatus[task.status] || 0) + 1;
  }

  const taskRows = tasks.map((task) => {
    const latestEvent = parseCertificationEvidenceTaskEventRow(db.prepare(
      `SELECT *
       FROM certification_evidence_task_events
       WHERE certification_evidence_task_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(task.id));
    const criteriaEvaluations = (task.success_criteria || []).map((criterion) => evaluateEvidenceTaskCriterion(criterion, context));
    const machineEvaluableCount = criteriaEvaluations.filter((item) => item.evidence?.reason !== "criterion_not_machine_evaluable").length;
    const satisfiedCount = criteriaEvaluations.filter((item) => item.satisfied).length;
    const closureRecommended = task.status !== "closed" &&
      task.status !== "verified" &&
      machineEvaluableCount > 0 &&
      satisfiedCount === criteriaEvaluations.length;

    return {
      id: task.id,
      task_type: task.task_type,
      severity: task.severity,
      title: task.title,
      status: task.status,
      source_signal: task.source_signal,
      required_evidence: task.required_evidence,
      success_criteria: task.success_criteria,
      latest_event_id: latestEvent?.id || null,
      latest_event_status: latestEvent?.to_status || null,
      latest_event_evidence: latestEvent?.evidence || {},
      criteria_evaluations: criteriaEvaluations,
      criteria_satisfied_count: satisfiedCount,
      criteria_total_count: criteriaEvaluations.length,
      closure_recommended: closureRecommended,
      closure_recommendation_reason: closureRecommended
        ? "All machine-evaluable success criteria are satisfied by the latest recheck. Submit for human closure."
        : null,
      updated_at: task.updated_at,
    };
  });

  const pendingStatuses = new Set(["open", "evidence_attached", "rejected", "reopened"]);
  const readyStatuses = new Set(["verified", "closed"]);
  const pendingTasks = taskRows.filter((task) => pendingStatuses.has(task.status));
  const readyTasks = taskRows.filter((task) => readyStatuses.has(task.status));
  const attachedButUnverifiedTasks = taskRows.filter((task) => task.status === "evidence_attached");
  const rejectedTasks = taskRows.filter((task) => task.status === "rejected");
  const closureRecommendedTasks = taskRows.filter((task) => task.closure_recommended);
  const blockerSignals = [
    ...(context.roadmap?.hard_blockers || []).map((blocker) => ({ ...blocker, blocker_type: "hard_blocker" })),
    ...(context.roadmap?.score_blockers || []).map((blocker) => ({ ...blocker, blocker_type: "score_blocker" })),
  ];
  const evidenceQualityNow = context.createdAt || context.now || nowIso();
  const validatedActionEvidenceByBlocker = latestValidatedCertificationActionEvidenceByBlocker(db, projectId, agentId);
  const blockerTaskCoverage = blockerSignals.map((blocker) => {
    const matchingTasks = taskRows.filter((task) => task.source_signal === blocker.code);
    const rawValidatedActionEvidence = validatedActionEvidenceByBlocker.get(blocker.code) || null;
    const evidenceQuality = scoreCertificationActionEvidence(rawValidatedActionEvidence, evidenceQualityNow);
    const validatedActionEvidence = rawValidatedActionEvidence
      ? {
        ...rawValidatedActionEvidence,
        evidence_quality_score: evidenceQuality.score,
        evidence_quality_level: evidenceQuality.level,
        evidence_quality_reasons: evidenceQuality.reasons,
        evidence_quality_factors: evidenceQuality.factors,
      }
      : null;
    const statusCounts = matchingTasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});
    const hasAttachedEvidence = matchingTasks.some((task) => (
      task.latest_event_id ||
      task.status === "evidence_attached" ||
      task.status === "verified" ||
      task.status === "closed"
    )) || Boolean(validatedActionEvidence);
    const hasValidatedActionEvidence = Boolean(validatedActionEvidence);
    const closureRecommendedCount = matchingTasks.filter((task) => task.closure_recommended).length;
    const readyTaskCount = matchingTasks.filter((task) => readyStatuses.has(task.status)).length;
    const openTaskCount = matchingTasks.filter((task) => pendingStatuses.has(task.status)).length;
    const evidenceSignal = evaluateBlockerEvidenceSignal({
      hasTask: matchingTasks.length > 0,
      hasAttachedEvidence,
      hasValidatedActionEvidence,
      evidenceQuality,
      closureRecommendedCount,
    });
    const nextAction = {
      action_type: evidenceSignal.action_type,
      title: evidenceSignal.title,
      reason: evidenceSignal.reason,
    };
    return {
      blocker_type: blocker.blocker_type,
      code: blocker.code,
      severity: blocker.severity,
      current: blocker.current,
      target: blocker.target,
      metric: blocker.metric || null,
      has_task: matchingTasks.length > 0,
      task_count: matchingTasks.length,
      status_counts: statusCounts,
      open_task_count: openTaskCount,
      ready_task_count: readyTaskCount,
      closure_recommended_count: closureRecommendedCount,
      has_attached_evidence: hasAttachedEvidence,
      has_validated_action_evidence: hasValidatedActionEvidence,
      validated_action_evidence: validatedActionEvidence,
      validated_action_evidence_quality_score: evidenceQuality.score,
      validated_action_evidence_quality_level: evidenceQuality.level,
      validated_action_evidence_quality_reasons: evidenceQuality.reasons,
      evidence_recheck_signal: {
        status: evidenceSignal.status,
        accepts_evidence_for_recheck: evidenceSignal.accepts_evidence_for_recheck,
        quality_score: evidenceQuality.score,
        quality_level: evidenceQuality.level,
        reason: evidenceSignal.reason,
      },
      evidence_attached_but_blocker_still_present: hasAttachedEvidence,
      next_action: nextAction,
      tasks: matchingTasks.slice(0, 5).map((task) => ({
        id: task.id,
        status: task.status,
        task_type: task.task_type,
        title: task.title,
        latest_event_id: task.latest_event_id,
        closure_recommended: task.closure_recommended,
        criteria_satisfied_count: task.criteria_satisfied_count,
        criteria_total_count: task.criteria_total_count,
      })),
    };
  });
  const uncoveredBlockers = blockerTaskCoverage.filter((item) => !item.has_task);
  const attachedButStillBlocked = blockerTaskCoverage.filter((item) => item.evidence_attached_but_blocker_still_present);
  const validatedActionEvidenceCoverage = blockerTaskCoverage.filter((item) => item.has_validated_action_evidence);
  const evidenceSignalCounts = blockerTaskCoverage.reduce((acc, item) => {
    const key = item.evidence_recheck_signal?.status || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const validatedQualityScores = validatedActionEvidenceCoverage
    .map((item) => Number(item.validated_action_evidence_quality_score || 0))
    .filter((score) => score > 0);
  const validatedQualityAverage = validatedQualityScores.length
    ? Math.round(validatedQualityScores.reduce((sum, score) => sum + score, 0) / validatedQualityScores.length)
    : 0;
  const nextActionCounts = blockerTaskCoverage.reduce((acc, item) => {
    const key = item.next_action?.action_type || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const taskReviewStatus = !taskRows.length
    ? "no_evidence_tasks"
    : pendingTasks.length
      ? "evidence_tasks_pending"
      : "evidence_tasks_ready";

  return {
    task_review_status: taskReviewStatus,
    total_task_count: taskRows.length,
    pending_task_count: pendingTasks.length,
    ready_task_count: readyTasks.length,
    verified_task_count: Number(byStatus.verified || 0),
    closed_task_count: Number(byStatus.closed || 0),
    open_task_count: Number(byStatus.open || 0),
    attached_but_unverified_task_count: attachedButUnverifiedTasks.length,
    rejected_task_count: rejectedTasks.length,
    closure_recommended_count: closureRecommendedTasks.length,
    blocker_task_coverage_status: uncoveredBlockers.length
      ? "blockers_missing_evidence_tasks"
      : attachedButStillBlocked.length
        ? "blockers_have_tasks_but_still_present"
        : "blockers_covered",
    blocker_task_coverage: blockerTaskCoverage,
    uncovered_blocker_count: uncoveredBlockers.length,
    attached_evidence_but_still_blocked_count: attachedButStillBlocked.length,
    validated_action_evidence_count: validatedActionEvidenceCoverage.length,
    validated_action_evidence_quality_average: validatedQualityAverage,
    strong_validated_action_evidence_count: validatedActionEvidenceCoverage.filter((item) => item.validated_action_evidence_quality_level === "strong").length,
    weak_validated_action_evidence_count: validatedActionEvidenceCoverage.filter((item) => item.validated_action_evidence_quality_level === "weak" || item.validated_action_evidence_quality_level === "stale").length,
    evidence_recheck_signal_counts: evidenceSignalCounts,
    validated_action_evidence_coverage: validatedActionEvidenceCoverage.map((item) => ({
      blocker_type: item.blocker_type,
      code: item.code,
      severity: item.severity,
      evidence: item.validated_action_evidence,
      evidence_quality_score: item.validated_action_evidence_quality_score,
      evidence_quality_level: item.validated_action_evidence_quality_level,
      evidence_quality_reasons: item.validated_action_evidence_quality_reasons,
      evidence_recheck_signal: item.evidence_recheck_signal,
    })),
    blocker_next_action_counts: nextActionCounts,
    by_status: byStatus,
    pending_tasks: pendingTasks.slice(0, 10),
    ready_tasks: readyTasks.slice(0, 10),
    closure_recommended_tasks: closureRecommendedTasks.slice(0, 10),
  };
}

function learningRuleMatchesCoverage(rule, coverage) {
  const pattern = rule.pattern_json || {};
  if (pattern.target !== "certification_action_effectiveness") return false;
  if (pattern.blocker_code && pattern.blocker_code !== coverage.code) return false;
  const allowActionDrift = new Set([
    "flag_certification_action_no_metric_lift",
    "require_stronger_certification_evidence",
  ]).has(rule.rule_type);
  if (!allowActionDrift && pattern.recommended_action && pattern.recommended_action !== coverage.next_action?.action_type) return false;
  if (pattern.evidence_quality_level && pattern.evidence_quality_level !== coverage.validated_action_evidence_quality_level) return false;
  return true;
}

function learningPriorityAdjustmentForCoverage(coverage, learningRules = []) {
  const matchedRules = learningRules.filter((rule) => learningRuleMatchesCoverage(rule, coverage));
  let adjustment = 0;
  const reasons = [];
  for (const rule of matchedRules) {
    const confidence = Number(rule.confidence || 0);
    const delta = {
      boost_certification_action_pattern: 15,
      monitor_certification_action_pattern: -3,
      require_stronger_certification_evidence: coverage.next_action?.action_type === "strengthen_evidence" ? 10 : -6,
      flag_certification_action_no_metric_lift: -12,
      suppress_certification_action_pattern: -20,
    }[rule.rule_type] || 0;
    const weightedDelta = Math.round(delta * confidence);
    adjustment += weightedDelta;
    reasons.push({
      learning_rule_id: rule.id,
      rule_type: rule.rule_type,
      confidence,
      delta: weightedDelta,
      evidence: rule.evidence_json || {},
    });
  }

  return {
    adjustment,
    matched_rule_count: matchedRules.length,
    reasons,
  };
}

function priorityForCertificationAction(coverage, learningRules = []) {
  const severityBase = { critical: 100, high: 80, medium: 60, low: 40 }[coverage.severity] || 50;
  const actionBoost = {
    rework_remediation: 15,
    generate_evidence_task: 10,
    strengthen_evidence: 8,
    attach_evidence: 5,
    submit_for_human_closure: 0,
  }[coverage.next_action?.action_type] || 0;
  const learningAdjustment = learningPriorityAdjustmentForCoverage(coverage, learningRules);
  return Math.max(0, severityBase + actionBoost + learningAdjustment.adjustment);
}

function buildCertificationActionQueueItems(evidenceTaskSummary, context = {}) {
  const learningRules = context.learningRules || [];
  return (evidenceTaskSummary.blocker_task_coverage || []).map((coverage) => {
    const firstTask = (coverage.tasks || [])[0] || null;
    const learningPriorityAdjustment = learningPriorityAdjustmentForCoverage(coverage, learningRules);
    return {
      id: createId("cert_action"),
      org_id: context.orgId,
      project_id: context.projectId,
      agent_id: context.agentId,
      autonomy_gate_recheck_history_id: context.recheckId,
      blocker_type: coverage.blocker_type,
      blocker_code: coverage.code,
      certification_evidence_task_id: firstTask?.id || null,
      recommended_action: coverage.next_action?.action_type || "unknown",
      priority: priorityForCertificationAction(coverage, learningRules),
      severity: coverage.severity || "medium",
      reason: coverage.next_action?.reason || "No action reason available.",
      status: "open",
      action: {
        title: coverage.next_action?.title || "Review blocker",
        blocker: {
          type: coverage.blocker_type,
          code: coverage.code,
          current: coverage.current,
          target: coverage.target,
          metric: coverage.metric,
        },
        task_coverage: {
          has_task: coverage.has_task,
          task_count: coverage.task_count,
          open_task_count: coverage.open_task_count,
          ready_task_count: coverage.ready_task_count,
          closure_recommended_count: coverage.closure_recommended_count,
          has_attached_evidence: coverage.has_attached_evidence,
          has_validated_action_evidence: coverage.has_validated_action_evidence,
          validated_action_evidence: coverage.validated_action_evidence,
          validated_action_evidence_quality_score: coverage.validated_action_evidence_quality_score,
          validated_action_evidence_quality_level: coverage.validated_action_evidence_quality_level,
          validated_action_evidence_quality_reasons: coverage.validated_action_evidence_quality_reasons,
          evidence_recheck_signal: coverage.evidence_recheck_signal,
          learning_priority_adjustment: learningPriorityAdjustment,
          tasks: coverage.tasks || [],
        },
        learning_priority_adjustment: learningPriorityAdjustment,
        safety_boundary: "advisory_only_no_automatic_execution",
      },
    };
  }).sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
}

function latestActionEvidenceQuality(db, actionId, createdAt) {
  const events = db.prepare(
    `SELECT *
     FROM certification_action_events
     WHERE certification_action_id = ?
     ORDER BY created_at DESC
     LIMIT 10`
  ).all(actionId).map(parseCertificationActionEventRow);
  const event = events.find((item) => {
    const evidence = item?.evidence || {};
    return Boolean(
      evidence.evidence_ref ||
      evidence.evidence_target_id ||
      evidence.evidence_target_type ||
      evidence.evidence_target_validated
    );
  }) || events[0] || null;
  if (!event) {
    return {
      score: 0,
      level: "none",
      reasons: ["no_action_event"],
      factors: {},
    };
  }
  return scoreCertificationActionEvidence({
    event_status: event.to_status,
    evidence: event.evidence,
    created_at: event.created_at,
  }, createdAt);
}

function effectivenessStatusForAction({ blockerPersisted, scoreDelta, evidenceQualityScore, actionStatus }) {
  if (!blockerPersisted) return "blocker_cleared";
  if (scoreDelta > 0) return "score_improved_blocker_persisted";
  if (scoreDelta < 0) return "regressed_after_action";
  if (Number(evidenceQualityScore || 0) < 60) return "evidence_not_credible";
  if (["evidence_attached", "resolved"].includes(actionStatus)) return "strong_evidence_no_metric_improvement";
  return "no_measurable_improvement";
}

function recordCertificationActionEffectiveness(db, projectId, agentId, context = {}) {
  const {
    recheckId,
    roadmap,
    evidenceTaskSummary,
    createdAt,
  } = context;
  const currentBlockerCodes = new Set([
    ...(roadmap.hard_blockers || []).map((item) => item.code),
    ...(roadmap.score_blockers || []).map((item) => item.code),
  ]);
  const coverageByCode = new Map((evidenceTaskSummary.blocker_task_coverage || []).map((item) => [item.code, item]));
  const candidateActions = db.prepare(
    `SELECT *
     FROM certification_action_queue
     WHERE project_id = ?
       AND agent_id = ?
       AND autonomy_gate_recheck_history_id != ?
       AND status IN ('in_progress', 'evidence_attached', 'resolved', 'dismissed', 'reopened')
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 50`
  ).all(projectId, agentId, recheckId).map(parseCertificationActionQueueRow);
  const existing = db.prepare(
    `SELECT COUNT(*) AS count
     FROM certification_action_effectiveness
     WHERE certification_action_id = ? AND evaluation_recheck_id = ?`
  );
  const sourceRecheck = db.prepare("SELECT * FROM autonomy_gate_recheck_history WHERE id = ?");
  const insert = db.prepare(
    `INSERT INTO certification_action_effectiveness (
      id, certification_action_id, org_id, project_id, agent_id,
      source_recheck_id, evaluation_recheck_id, blocker_code, recommended_action,
      action_status, evidence_quality_score, evidence_quality_level,
      previous_score, new_score, score_delta, blocker_persisted,
      effectiveness_status, effectiveness_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const rows = [];
  for (const action of candidateActions) {
    if (existing.get(action.id, recheckId).count > 0) continue;
    const source = parseRecheckRow(sourceRecheck.get(action.autonomy_gate_recheck_history_id));
    const previousScore = source?.new_score ?? source?.recheck_summary?.new_score ?? null;
    const newScore = Number(roadmap.current_score || 0);
    const scoreDelta = newScore - Number(previousScore ?? newScore);
    const blockerPersisted = currentBlockerCodes.has(action.blocker_code);
    const currentCoverage = coverageByCode.get(action.blocker_code) || null;
    const eventQuality = latestActionEvidenceQuality(db, action.id, createdAt);
    const coverageQualityScore = Number(currentCoverage?.validated_action_evidence_quality_score || 0);
    const quality = coverageQualityScore > Number(eventQuality.score || 0)
      ? {
        score: coverageQualityScore,
        level: currentCoverage.validated_action_evidence_quality_level || "none",
        reasons: currentCoverage.validated_action_evidence_quality_reasons || ["coverage_validated_action_evidence_fallback"],
        factors: currentCoverage.validated_action_evidence?.evidence_quality_factors || {},
      }
      : eventQuality;
    const effectivenessStatus = effectivenessStatusForAction({
      blockerPersisted,
      scoreDelta,
      evidenceQualityScore: quality.score,
      actionStatus: action.status,
    });
    const effectiveness = {
      blocker_code: action.blocker_code,
      recommended_action: action.recommended_action,
      source_recheck_id: action.autonomy_gate_recheck_history_id,
      evaluation_recheck_id: recheckId,
      previous_score: previousScore,
      new_score: newScore,
      score_delta: scoreDelta,
      blocker_persisted: blockerPersisted,
      evidence_quality_score: quality.score,
      evidence_quality_level: quality.level,
      evidence_quality_reasons: quality.reasons,
      current_evidence_recheck_signal: currentCoverage?.evidence_recheck_signal || null,
      learning_signal: blockerPersisted
        ? "action_did_not_clear_blocker"
        : "action_cleared_blocker",
      safety_boundary: "advisory_only_no_automatic_execution",
    };
    const row = {
      id: createId("cert_action_effect"),
      certification_action_id: action.id,
      org_id: action.org_id,
      project_id: action.project_id,
      agent_id: action.agent_id,
      source_recheck_id: action.autonomy_gate_recheck_history_id,
      evaluation_recheck_id: recheckId,
      blocker_code: action.blocker_code,
      recommended_action: action.recommended_action,
      action_status: action.status,
      evidence_quality_score: quality.score,
      evidence_quality_level: quality.level,
      previous_score: previousScore,
      new_score: newScore,
      score_delta: scoreDelta,
      blocker_persisted: blockerPersisted,
      effectiveness_status: effectivenessStatus,
      effectiveness,
      created_at: createdAt,
    };
    insert.run(
      row.id,
      row.certification_action_id,
      row.org_id,
      row.project_id,
      row.agent_id,
      row.source_recheck_id,
      row.evaluation_recheck_id,
      row.blocker_code,
      row.recommended_action,
      row.action_status,
      row.evidence_quality_score,
      row.evidence_quality_level,
      row.previous_score,
      row.new_score,
      row.score_delta,
      row.blocker_persisted ? 1 : 0,
      row.effectiveness_status,
      toJson(row.effectiveness),
      row.created_at
    );
    rows.push(row);
  }
  return rows;
}

export function runAutonomyCertificationRecheck(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const previous = latestCertificationRoadmap(projectId, agentId, { db, skipMigrate: true });
    const createdAt = options.createdAt || nowIso();
    const roadmap = buildAndPersistCertificationRoadmap(projectId, agentId, {
      ...options,
      db,
      skipMigrate: true,
      createdAt,
    });
    const statusSummary = objectiveStatusSummary(db, projectId, agentId);
    const recheckId = createId("recheck");
    const previousJson = previous?.roadmap_json || null;
    const objectiveValidations = verifiedObjectiveMetricValidations(db, projectId, agentId, roadmap);
    const unresolvedVerifiedObjectives = objectiveValidations.filter((item) => item.validation_status === "verified_but_metric_unresolved");
    const evidenceReviews = db.prepare(
      `SELECT id FROM remediation_objectives
       WHERE project_id = ? AND agent_id = ? AND status IN ('evidence_attached', 'verified')`
    ).all(projectId, agentId).map((row) => reviewObjectiveEvidenceRequirements(row.id, {
      db,
      skipMigrate: true,
      persist: true,
      createdAt,
    }));
    const incompleteEvidenceReviews = evidenceReviews.filter((item) => item.review_status !== "requirements_satisfied");
    const closureAssessments = activeObjectivesForClosure(db, projectId, agentId)
      .map((objective) => ({
        remediation_objective_id: objective.id,
        objective_title: objective.title,
        ...assessObjectiveFromRunMetrics(objective, roadmap),
      }));
    const closureReadyCount = closureAssessments.filter((item) => item.closure_status === "closure_ready").length;
    const stillBlockedClosureCount = closureAssessments.filter((item) => item.closure_status === "still_blocked").length;
    const metricValidationStatus = unresolvedVerifiedObjectives.length ? "verified_objectives_still_blocked" : "no_verified_metric_conflicts";
    const evidenceRequirementStatus = incompleteEvidenceReviews.length ? "evidence_requirements_incomplete" : "evidence_requirements_satisfied";
    const runClosureStatus = closureReadyCount && !stillBlockedClosureCount ? "run_metrics_support_closure" : stillBlockedClosureCount ? "run_metrics_still_blocked" : "run_metrics_not_enough_evidence";
    const evidenceTaskSummary = summarizeCertificationEvidenceTasksForRecheck(db, projectId, agentId, {
      roadmap,
      metricValidationStatus,
      evidenceRequirementStatus,
      runClosureStatus,
      createdAt,
    });
    const activeLearningRules = listProjectLearningRules(projectId, {
      db,
      skipMigrate: true,
      statuses: ["active", "trusted"],
      limit: 200,
    });
    const certificationActionQueue = buildCertificationActionQueueItems(evidenceTaskSummary, {
      orgId: roadmap.org_id,
      projectId,
      agentId,
      recheckId,
      learningRules: activeLearningRules,
    });
    const certificationState = evaluateCertificationState({
      hardBlockers: roadmap.hard_blockers,
      scoreBlockers: roadmap.score_blockers,
      metricValidationStatus,
      evidenceRequirementStatus,
      runClosureStatus,
      evidenceTaskStatus: evidenceTaskSummary.task_review_status,
      currentScore: roadmap.current_score,
      targetScore: roadmap.target_score,
    });
    const summary = {
      previous_score: previousJson?.current_score ?? null,
      new_score: roadmap.current_score,
      score_delta: roadmap.current_score - Number(previousJson?.current_score ?? roadmap.current_score),
      target_score: roadmap.target_score,
      previous_gate_status: previousJson?.current_gate_status ?? null,
      new_gate_status: roadmap.current_gate_status,
      previous_blocked_by: previousJson?.blocked_by ?? null,
      new_blocked_by: roadmap.blocked_by,
      hard_blocker_count: roadmap.hard_blockers.length,
      score_blocker_count: roadmap.score_blockers.length,
      remediation_objective_count: roadmap.remediation_objectives.length,
      objective_status_summary: statusSummary,
      verified_objective_count: objectiveValidations.length,
      verified_but_unresolved_count: unresolvedVerifiedObjectives.length,
      metric_validation_status: metricValidationStatus,
      verified_objective_validations: objectiveValidations,
      evidence_review_count: evidenceReviews.length,
      incomplete_evidence_review_count: incompleteEvidenceReviews.length,
      evidence_requirement_status: evidenceRequirementStatus,
      run_closure_assessment_count: closureAssessments.length,
      run_closure_ready_count: closureReadyCount,
      run_closure_still_blocked_count: stillBlockedClosureCount,
      run_closure_status: runClosureStatus,
      certification_evidence_task_status: evidenceTaskSummary.task_review_status,
      certification_evidence_task_summary: evidenceTaskSummary,
      certification_action_queue_count: certificationActionQueue.length,
      certification_action_queue: certificationActionQueue,
      certification_action_learning_rule_count: activeLearningRules.filter((rule) => (rule.pattern_json || {}).target === "certification_action_effectiveness").length,
      certification_state: certificationState,
    };

    db.prepare(
      `INSERT INTO autonomy_gate_recheck_history (
        id, org_id, project_id, agent_id, previous_roadmap_id, new_roadmap_id,
        previous_score, new_score, target_score, score_delta,
        previous_gate_status, new_gate_status, previous_blocked_by, new_blocked_by,
        objective_status_summary_json, recheck_summary_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      recheckId,
      roadmap.org_id,
      projectId,
      agentId,
      previous?.id || previous?.roadmap_id || null,
      roadmap.roadmap_id,
      previousJson?.current_score ?? null,
      roadmap.current_score,
      roadmap.target_score,
      summary.score_delta,
      previousJson?.current_gate_status ?? null,
      roadmap.current_gate_status,
      previousJson?.blocked_by ?? null,
      roadmap.blocked_by,
      toJson(statusSummary),
      toJson(summary),
      createdAt
    );

    const certificationActionEffectiveness = recordCertificationActionEffectiveness(db, projectId, agentId, {
      recheckId,
      roadmap,
      evidenceTaskSummary,
      createdAt,
    });
    summary.certification_action_effectiveness_count = certificationActionEffectiveness.length;
    summary.certification_action_effectiveness = certificationActionEffectiveness;
    db.prepare("UPDATE autonomy_gate_recheck_history SET recheck_summary_json = ? WHERE id = ?")
      .run(toJson(summary), recheckId);

    const insertMetricValidation = db.prepare(
      `INSERT INTO objective_metric_validations (
        id, remediation_objective_id, autonomy_gate_recheck_history_id,
        org_id, project_id, agent_id, objective_title, objective_status,
        validation_status, metric_signal_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const validation of objectiveValidations) {
      insertMetricValidation.run(
        createId("objective_metric_validation"),
        validation.remediation_objective_id,
        recheckId,
        roadmap.org_id,
        projectId,
        agentId,
        validation.objective_title,
        validation.objective_status,
        validation.validation_status,
        toJson(validation.metric_signal),
        createdAt
      );
    }

    const insertClosureAssessment = db.prepare(
      `INSERT INTO objective_run_closure_assessments (
        id, remediation_objective_id, autonomy_gate_recheck_history_id,
        org_id, project_id, agent_id, objective_title, closure_status,
        current_value, target_value, metric_evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const assessment of closureAssessments) {
      insertClosureAssessment.run(
        createId("objective_run_closure"),
        assessment.remediation_objective_id,
        recheckId,
        roadmap.org_id,
        projectId,
        agentId,
        assessment.objective_title,
        assessment.closure_status,
        assessment.current_value,
        assessment.target_value,
        toJson(assessment.metric_evidence),
        createdAt
      );
    }

    const insertCertificationAction = db.prepare(
      `INSERT INTO certification_action_queue (
        id, org_id, project_id, agent_id, autonomy_gate_recheck_history_id,
        blocker_type, blocker_code, certification_evidence_task_id,
        recommended_action, priority, severity, reason, status, action_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const findPreviousActiveCertificationActions = db.prepare(
      `SELECT *
       FROM certification_action_queue
       WHERE project_id = ?
         AND agent_id = ?
         AND blocker_code = ?
         AND COALESCE(certification_evidence_task_id, '') = COALESCE(?, '')
         AND status IN ('open', 'in_progress', 'evidence_attached', 'reopened')`
    );
    const supersedeCertificationAction = db.prepare(
      "UPDATE certification_action_queue SET status = 'superseded', updated_at = ? WHERE id = ?"
    );
    const insertCertificationActionEvent = db.prepare(
      `INSERT INTO certification_action_events (
        id, certification_action_id, org_id, project_id, agent_id,
        actor_type, actor_id, from_status, to_status, note, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertCertificationActionAudit = db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const action of certificationActionQueue) {
      const previousOpenActions = findPreviousActiveCertificationActions.all(
        action.project_id,
        action.agent_id,
        action.blocker_code,
        action.certification_evidence_task_id
      ).map(parseCertificationActionQueueRow);
      for (const previousAction of previousOpenActions) {
        const eventId = createId("cert_action_event");
        const evidence = {
          superseded_by_recheck_id: recheckId,
          superseded_by_certification_action_id: action.id,
          safety_boundary: "advisory_only_no_automatic_execution",
        };
        supersedeCertificationAction.run(createdAt, previousAction.id);
        insertCertificationActionEvent.run(
          eventId,
          previousAction.id,
          previousAction.org_id,
          previousAction.project_id,
          previousAction.agent_id,
          "system",
          null,
          previousAction.status,
          "superseded",
          "Superseded by a newer autonomy certification recheck for the same blocker.",
          toJson(evidence),
          createdAt
        );
        insertCertificationActionAudit.run(
          createId("audit"),
          previousAction.org_id,
          previousAction.project_id,
          "system",
          null,
          "certification_action.superseded",
          "certification_action",
          previousAction.id,
          toJson({
            certification_action_event_id: eventId,
            from_status: previousAction.status,
            to_status: "superseded",
            blocker_code: previousAction.blocker_code,
            recommended_action: previousAction.recommended_action,
            evidence,
          }),
          createdAt
        );
      }
      insertCertificationAction.run(
        action.id,
        action.org_id,
        action.project_id,
        action.agent_id,
        action.autonomy_gate_recheck_history_id,
        action.blocker_type,
        action.blocker_code,
        action.certification_evidence_task_id,
        action.recommended_action,
        action.priority,
        action.severity,
        action.reason,
        action.status,
        toJson(action.action),
        createdAt,
        createdAt
      );
    }

    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      roadmap.org_id,
      projectId,
      options.actorType || "system",
      options.actorId || null,
      "autonomy_certification.rechecked",
      "agent",
      agentId,
      toJson({ autonomy_gate_recheck_history_id: recheckId, ...summary }),
      createdAt
    );

    return {
      recheck: parseRecheckRow(db.prepare("SELECT * FROM autonomy_gate_recheck_history WHERE id = ?").get(recheckId)),
      previous_roadmap: previousJson,
      new_roadmap: roadmap,
      objective_metric_validations: objectiveValidations,
      objective_evidence_reviews: evidenceReviews,
      objective_run_closure_assessments: closureAssessments,
      certification_evidence_task_summary: evidenceTaskSummary,
      certification_action_queue: certificationActionQueue,
      certification_action_effectiveness: certificationActionEffectiveness,
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function listCertificationActionQueue(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    const status = options.status || null;
    const clauses = ["project_id = ?", "agent_id = ?"];
    const params = [projectId, agentId];
    if (options.recheckId) {
      clauses.push("autonomy_gate_recheck_history_id = ?");
      params.push(options.recheckId);
    }
    if (status) {
      clauses.push("status = ?");
      params.push(status);
    }
    if (Array.isArray(options.statuses) && options.statuses.length) {
      clauses.push(`status IN (${options.statuses.map(() => "?").join(", ")})`);
      params.push(...options.statuses);
    }
    return db.prepare(
      `SELECT *
       FROM certification_action_queue
       WHERE ${clauses.join(" AND ")}
       ORDER BY priority DESC, created_at DESC
       LIMIT ?`
    ).all(...params, limit).map(parseCertificationActionQueueRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function getCertificationAction(actionId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    return parseCertificationActionQueueRow(
      db.prepare("SELECT * FROM certification_action_queue WHERE id = ?").get(actionId)
    );
  } finally {
    if (!options.db) db.close();
  }
}

export function updateCertificationActionStatus(actionId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const action = parseCertificationActionQueueRow(
      db.prepare("SELECT * FROM certification_action_queue WHERE id = ?").get(actionId)
    );
    if (!action) throw new Error(`Certification action not found: ${actionId}`);

    const toStatus = String(payload.status || payload.to_status || "").trim();
    assertValidCertificationActionTransition(action.status, toStatus);
    const createdAt = options.createdAt || nowIso();
    const actorType = String(payload.actor_type || options.actorType || "user");
    const actorId = payload.actor_id || options.actorId || null;
    const note = payload.note ? String(payload.note) : null;
    const evidence = validateCertificationActionEvidenceTarget(db, action, {
      ...(payload.evidence_json || payload.evidence || {}),
      safety_boundary: "advisory_only_no_automatic_execution",
    }, toStatus);
    const eventId = createId("cert_action_event");

    db.exec("BEGIN");
    try {
      db.prepare("UPDATE certification_action_queue SET status = ?, updated_at = ? WHERE id = ?")
        .run(toStatus, createdAt, actionId);

      db.prepare(
        `INSERT INTO certification_action_events (
          id, certification_action_id, org_id, project_id, agent_id,
          actor_type, actor_id, from_status, to_status, note, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        actionId,
        action.org_id,
        action.project_id,
        action.agent_id,
        actorType,
        actorId,
        action.status,
        toStatus,
        note,
        toJson(evidence),
        createdAt
      );

      db.prepare(
        `INSERT INTO audit_events (
          id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        createId("audit"),
        action.org_id,
        action.project_id,
        actorType,
        actorId,
        "certification_action.status_updated",
        "certification_action",
        actionId,
        toJson({
          certification_action_event_id: eventId,
          from_status: action.status,
          to_status: toStatus,
          blocker_code: action.blocker_code,
          recommended_action: action.recommended_action,
          evidence,
        }),
        createdAt
      );

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      action: parseCertificationActionQueueRow(db.prepare("SELECT * FROM certification_action_queue WHERE id = ?").get(actionId)),
      action_event: parseCertificationActionEventRow(
        db.prepare("SELECT * FROM certification_action_events WHERE id = ?").get(eventId)
      ),
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function listCertificationActionEvents(actionId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));
    return db.prepare(
      `SELECT *
       FROM certification_action_events
       WHERE certification_action_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(actionId, limit)
      .map(parseCertificationActionEventRow)
      .map((event) => enrichCertificationActionEventWithEvidenceQuality(event, options.createdAt || options.now || nowIso()));
  } finally {
    if (!options.db) db.close();
  }
}

export function listProjectCertificationActionEvents(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    const clauses = ["project_id = ?", "agent_id = ?"];
    const params = [projectId, agentId];
    if (options.actionId) {
      clauses.push("certification_action_id = ?");
      params.push(options.actionId);
    }
    return db.prepare(
      `SELECT *
       FROM certification_action_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params, limit)
      .map(parseCertificationActionEventRow)
      .map((event) => enrichCertificationActionEventWithEvidenceQuality(event, options.createdAt || options.now || nowIso()));
  } finally {
    if (!options.db) db.close();
  }
}

export function listProjectCertificationActionEffectiveness(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    const clauses = ["project_id = ?", "agent_id = ?"];
    const params = [projectId, agentId];
    if (options.recheckId) {
      clauses.push("evaluation_recheck_id = ?");
      params.push(options.recheckId);
    }
    if (options.actionId) {
      clauses.push("certification_action_id = ?");
      params.push(options.actionId);
    }
    return db.prepare(
      `SELECT *
       FROM certification_action_effectiveness
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params, limit).map(parseCertificationActionEffectivenessRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function listObjectiveRunClosureAssessments(recheckId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    return db.prepare(
      `SELECT *
       FROM objective_run_closure_assessments
       WHERE autonomy_gate_recheck_history_id = ?
       ORDER BY created_at DESC`
    ).all(recheckId).map(parseObjectiveRunClosureAssessmentRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function listObjectiveMetricValidations(recheckId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    return db.prepare(
      `SELECT *
       FROM objective_metric_validations
       WHERE autonomy_gate_recheck_history_id = ?
       ORDER BY created_at DESC`
    ).all(recheckId).map(parseObjectiveMetricValidationRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function listAutonomyCertificationRechecks(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
    return db.prepare(
      `SELECT *
       FROM autonomy_gate_recheck_history
       WHERE project_id = ? AND agent_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(projectId, agentId, limit).map(parseRecheckRow);
  } finally {
    if (!options.db) db.close();
  }
}

function buildCertificationReviewPacket(roadmapRow) {
  const roadmap = roadmapRow?.roadmap_json || {};
  const state = roadmap.certification_state || {};
  const objectives = roadmap.remediation_objectives || [];
  return {
    packet_version: "phase1_human_review_request_v1",
    roadmap_id: roadmapRow.id,
    gate_result_id: roadmap.gate_result_id || roadmapRow.gate_result_id || null,
    agent_id: roadmap.agent_id || roadmapRow.agent_id,
    target_autonomy_level: roadmap.target_autonomy_level || roadmapRow.target_autonomy_level,
    target_autonomy_label: roadmap.target_autonomy_label || null,
    current_score: roadmap.current_score ?? roadmapRow.current_score,
    target_score: roadmap.target_score ?? roadmapRow.target_score,
    certification_state: state,
    gate: {
      status: roadmap.current_gate_status || "unknown",
      blocked_by: roadmap.blocked_by || "unknown",
      hard_blockers: roadmap.hard_blockers || [],
      score_blockers: roadmap.score_blockers || [],
    },
    score_breakdown: roadmap.score_breakdown || {},
    remediation_objectives: objectives.map((objective) => ({
      id: objective.id,
      title: objective.title,
      status: objective.status || "open",
      current_value: objective.current_value,
      target_value: objective.target_value,
      expected_score_delta: objective.expected_score_delta,
      verification_requirements: objective.verification_requirements || [],
      success_criteria: objective.success_criteria || [],
    })),
    evidence_inputs: state.evidence_inputs || {},
    required_signoffs: [
      "Owner confirms the latest certification roadmap reflects the intended target autonomy level.",
      "Reviewer confirms all hard blockers are absent or explicitly blocked from autonomy.",
      "Reviewer confirms eval replay, evidence requirements, and run-closure evidence are acceptable.",
      "Reviewer acknowledges Phase 1 does not grant production autonomy automatically.",
    ],
    safety_boundary: "advisory_only_no_automatic_autonomy_grant",
  };
}

export function requestCertificationReview(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const createdAt = options.createdAt || nowIso();
    const roadmapRow = latestCertificationRoadmap(projectId, agentId, { db, skipMigrate: true });
    if (!roadmapRow) throw new Error(`Certification roadmap not found for agent: ${agentId}`);

    const roadmap = roadmapRow.roadmap_json || {};
    const state = roadmap.certification_state || evaluateCertificationState({
      hardBlockers: roadmap.hard_blockers || [],
      scoreBlockers: roadmap.score_blockers || [],
      currentScore: roadmap.current_score,
      targetScore: roadmap.target_score,
    });
    const packet = buildCertificationReviewPacket(roadmapRow);
    const requestStatus = state.can_request_human_review ? "pending_human_review" : "blocked_not_ready";
    const requestId = createId("cert_review");
    const evidenceId = createId("evidence");
    const requiredSignoffs = packet.required_signoffs;
    const summary = requestStatus === "pending_human_review"
      ? "Certification review request is ready for human review."
      : `Certification review request blocked: ${state.current_state || "unknown"}.`;

    db.prepare(
      `INSERT INTO audit_evidence_items (
        id, org_id, project_id, agent_id, evidence_type, target_type, target_id,
        summary, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      evidenceId,
      roadmapRow.org_id,
      projectId,
      agentId,
      "certification_review_request",
      "autonomy_certification_roadmap",
      roadmapRow.id,
      summary,
      toJson({
        certification_review_request_id: requestId,
        request_status: requestStatus,
        certification_state: state,
        review_packet: packet,
      }),
      createdAt
    );

    db.prepare(
      `INSERT INTO certification_review_requests (
        id, org_id, project_id, agent_id, roadmap_id, gate_result_id, audit_evidence_item_id,
        requested_by_actor_type, requested_by_actor_id, request_status, certification_state,
        target_autonomy_level, current_score, target_score, review_packet_json,
        required_signoffs_json, reviewer_decision_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      requestId,
      roadmapRow.org_id,
      projectId,
      agentId,
      roadmapRow.id,
      roadmap.gate_result_id || roadmapRow.gate_result_id || null,
      evidenceId,
      options.actorType || "operator",
      options.actorId || null,
      requestStatus,
      state.current_state || "unknown",
      roadmap.target_autonomy_level || roadmapRow.target_autonomy_level,
      roadmap.current_score ?? roadmapRow.current_score,
      roadmap.target_score ?? roadmapRow.target_score,
      toJson(packet),
      toJson(requiredSignoffs),
      toJson({}),
      createdAt,
      createdAt
    );

    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      roadmapRow.org_id,
      projectId,
      options.actorType || "operator",
      options.actorId || null,
      requestStatus === "pending_human_review"
        ? "certification_review.requested"
        : "certification_review.request_blocked",
      "certification_review_request",
      requestId,
      toJson({ audit_evidence_item_id: evidenceId, certification_state: state, request_status: requestStatus }),
      createdAt
    );

    return parseCertificationReviewRequestRow(
      db.prepare("SELECT * FROM certification_review_requests WHERE id = ?").get(requestId)
    );
  } finally {
    if (!options.db) db.close();
  }
}

export function listCertificationReviewRequests(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
    return db.prepare(
      `SELECT *
       FROM certification_review_requests
       WHERE project_id = ? AND agent_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(projectId, agentId, limit).map(parseCertificationReviewRequestRow);
  } finally {
    if (!options.db) db.close();
  }
}

const REVIEW_DECISION_TO_STATUS = {
  approve_candidate: "approved_candidate",
  reject: "rejected",
  request_more_evidence: "more_evidence_requested",
};

function evidenceTaskKey(task) {
  return `${task.task_type}:${task.source_signal}:${task.title}`;
}

function dedupeEvidenceTasks(tasks = []) {
  const byKey = new Map();
  for (const task of tasks) {
    const key = evidenceTaskKey(task);
    if (!byKey.has(key)) byKey.set(key, task);
  }
  return Array.from(byKey.values());
}

function evidenceTasksForReviewRequest(request, decisionId = null) {
  const packet = request.review_packet || {};
  const tasks = [];
  const push = (task) => tasks.push({
    severity: task.severity || "medium",
    status: "open",
    required_evidence: task.required_evidence || [],
    success_criteria: task.success_criteria || [],
    ...task,
  });

  for (const blocker of packet.gate?.hard_blockers || []) {
    push({
      task_type: "hard_blocker_clearance",
      severity: blocker.severity || "high",
      title: `Clear hard blocker: ${blocker.code}`,
      description: "Produce evidence that this hard blocker is no longer present in the latest autonomy gate.",
      source_signal: blocker.code,
      required_evidence: ["new autonomy certification recheck", "latest hard_blockers list does not include this code", "supporting run/judgement evidence"],
      success_criteria: [`hard_blocker_absent:${blocker.code}`],
    });
  }

  for (const blocker of packet.gate?.score_blockers || []) {
    push({
      task_type: "score_blocker_improvement",
      severity: blocker.severity || "medium",
      title: `Improve score blocker: ${blocker.code}`,
      description: "Raise the related score dimension or total readiness score to the target threshold.",
      source_signal: blocker.code,
      required_evidence: ["new readiness_score_snapshots row", "new autonomy certification recheck", "score blocker absent or above target"],
      success_criteria: [`score_blocker_absent:${blocker.code}`],
    });
  }

  for (const objective of packet.remediation_objectives || []) {
    if (objective.status === "verified") continue;
    push({
      task_type: "objective_evidence",
      severity: "medium",
      title: `Verify objective: ${objective.title}`,
      description: "Attach and review evidence for this remediation objective.",
      source_signal: objective.id || objective.title,
      required_evidence: objective.verification_requirements || ["objective evidence attachment"],
      success_criteria: objective.success_criteria || ["objective status verified", "evidence requirements satisfied"],
    });
  }

  const inputs = packet.evidence_inputs || {};
  if (Number(inputs.incomplete_evidence_review_count || 0) > 0 || request.certification_state === "evidence_incomplete") {
    push({
      task_type: "evidence_requirement_review",
      severity: "high",
      title: "Satisfy missing evidence requirements",
      description: "Review objective evidence requirements and attach missing, unexpired, matching proof.",
      source_signal: "evidence_requirements_incomplete",
      required_evidence: ["objective_evidence_reviews show requirements_satisfied", "missing_count=0", "expired_count=0", "mismatched_count=0"],
      success_criteria: ["evidence_requirement_status=evidence_requirements_satisfied"],
    });
  }
  if (Number(inputs.verified_but_unresolved_count || 0) > 0 || request.certification_state === "blocked_by_metric_guardrail") {
    push({
      task_type: "metric_guardrail_resolution",
      severity: "high",
      title: "Resolve verified-but-unresolved metric conflicts",
      description: "Make latest metrics prove that verified objectives actually cleared their blockers.",
      source_signal: "verified_objectives_still_blocked",
      required_evidence: ["objective_metric_validations show verified_and_metric_cleared", "new gate no longer contains matching blockers"],
      success_criteria: ["metric_validation_status=no_verified_metric_conflicts"],
    });
  }
  if (Number(inputs.run_closure_still_blocked_count || 0) > 0 || request.certification_state === "closure_evidence_pending") {
    push({
      task_type: "clean_run_window",
      severity: "high",
      title: "Produce a clean run window for closure",
      description: "Record enough fresh runs to show objectives are closure-ready under the scoring window.",
      source_signal: "run_metrics_still_blocked",
      required_evidence: ["new run window", "objective_run_closure_assessments show closure_ready", "no still_blocked closure assessment"],
      success_criteria: ["run_closure_status=run_metrics_support_closure"],
    });
  }

  return dedupeEvidenceTasks(tasks).map((task) => ({
    ...task,
    id: createId("evidence_task"),
    certification_review_request_id: request.id,
    certification_review_decision_id: decisionId,
    org_id: request.org_id,
    project_id: request.project_id,
    agent_id: request.agent_id,
    roadmap_id: request.roadmap_id,
  }));
}

export function submitCertificationReviewDecision(reviewRequestId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const createdAt = options.createdAt || nowIso();
    const request = parseCertificationReviewRequestRow(
      db.prepare("SELECT * FROM certification_review_requests WHERE id = ?").get(reviewRequestId)
    );
    if (!request) throw new Error(`Certification review request not found: ${reviewRequestId}`);

    const decision = payload.decision;
    const toStatus = REVIEW_DECISION_TO_STATUS[decision];
    if (!toStatus) {
      throw new Error("Invalid certification review decision. Use approve_candidate, reject, or request_more_evidence.");
    }
    if (decision === "approve_candidate" && request.request_status !== "pending_human_review") {
      throw new Error("Cannot approve a certification request that is not pending human review.");
    }
    if (decision === "approve_candidate" && request.certification_state !== "ready_for_human_review") {
      throw new Error("Cannot approve candidate unless certification state is ready_for_human_review.");
    }

    const decisionId = createId("cert_decision");
    const evidence = {
      ...(payload.evidence || {}),
      review_packet_version: request.review_packet?.packet_version,
      safety_boundary: "advisory_only_no_automatic_autonomy_grant",
      can_grant_autonomy: false,
    };
    const summary = payload.summary || (
      decision === "approve_candidate"
        ? "Reviewer approved this agent as an autonomy candidate. Production autonomy is still not granted by Phase 1."
        : decision === "request_more_evidence"
          ? "Reviewer requested more evidence before autonomy certification can proceed."
          : "Reviewer rejected the autonomy certification request."
    );

    db.prepare(
      `INSERT INTO certification_review_decisions (
        id, certification_review_request_id, org_id, project_id, agent_id, roadmap_id,
        reviewer_actor_type, reviewer_actor_id, decision, from_status, to_status,
        decision_summary, decision_rationale, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      decisionId,
      reviewRequestId,
      request.org_id,
      request.project_id,
      request.agent_id,
      request.roadmap_id,
      payload.reviewerActorType || options.actorType || "reviewer",
      payload.reviewerActorId || options.actorId || null,
      decision,
      request.request_status,
      toStatus,
      summary,
      payload.rationale || null,
      toJson(evidence),
      createdAt
    );

    const reviewerDecision = {
      latest_decision_id: decisionId,
      decision,
      status: toStatus,
      summary,
      rationale: payload.rationale || null,
      reviewer_actor_type: payload.reviewerActorType || options.actorType || "reviewer",
      reviewer_actor_id: payload.reviewerActorId || options.actorId || null,
      decided_at: createdAt,
      safety_boundary: "advisory_only_no_automatic_autonomy_grant",
      can_grant_autonomy: false,
    };

    db.prepare(
      "UPDATE certification_review_requests SET request_status = ?, reviewer_decision_json = ?, updated_at = ? WHERE id = ?"
    ).run(toStatus, toJson(reviewerDecision), createdAt, reviewRequestId);

    const evidenceTasks = decision === "request_more_evidence"
      ? evidenceTasksForReviewRequest(request, decisionId)
      : [];
    const insertEvidenceTask = db.prepare(
      `INSERT INTO certification_evidence_tasks (
        id, certification_review_request_id, certification_review_decision_id,
        org_id, project_id, agent_id, roadmap_id, task_type, severity, title,
        description, source_signal, required_evidence_json, success_criteria_json,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const task of evidenceTasks) {
      insertEvidenceTask.run(
        task.id,
        task.certification_review_request_id,
        task.certification_review_decision_id,
        task.org_id,
        task.project_id,
        task.agent_id,
        task.roadmap_id,
        task.task_type,
        task.severity,
        task.title,
        task.description,
        task.source_signal,
        toJson(task.required_evidence),
        toJson(task.success_criteria),
        task.status,
        createdAt,
        createdAt
      );
    }

    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      request.org_id,
      request.project_id,
      payload.reviewerActorType || options.actorType || "reviewer",
      payload.reviewerActorId || options.actorId || null,
      `certification_review.${decision}`,
      "certification_review_request",
      reviewRequestId,
      toJson({ certification_review_decision_id: decisionId, ...reviewerDecision }),
      createdAt
    );

    return {
      request: parseCertificationReviewRequestRow(db.prepare("SELECT * FROM certification_review_requests WHERE id = ?").get(reviewRequestId)),
      decision: parseCertificationReviewDecisionRow(db.prepare("SELECT * FROM certification_review_decisions WHERE id = ?").get(decisionId)),
      evidence_tasks: evidenceTasks,
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function listCertificationReviewDecisions(reviewRequestId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    return db.prepare(
      `SELECT *
       FROM certification_review_decisions
       WHERE certification_review_request_id = ?
       ORDER BY created_at DESC`
    ).all(reviewRequestId).map(parseCertificationReviewDecisionRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function listCertificationEvidenceTasks(projectId, agentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    const status = options.status || null;
    const clauses = ["project_id = ?", "agent_id = ?"];
    const params = [projectId, agentId];
    if (status) {
      clauses.push("status = ?");
      params.push(status);
    }
    return db.prepare(
      `SELECT *
       FROM certification_evidence_tasks
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params, limit).map(parseCertificationEvidenceTaskRow);
  } finally {
    if (!options.db) db.close();
  }
}

export function updateCertificationEvidenceTaskStatus(taskId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const task = parseCertificationEvidenceTaskRow(
      db.prepare("SELECT * FROM certification_evidence_tasks WHERE id = ?").get(taskId)
    );
    if (!task) throw new Error(`Certification evidence task not found: ${taskId}`);

    const toStatus = String(payload.status || payload.to_status || "").trim();
    assertValidEvidenceTaskTransition(task.status, toStatus);
    const createdAt = options.createdAt || nowIso();
    const actorType = String(payload.actor_type || options.actorType || "user");
    const actorId = payload.actor_id || options.actorId || null;
    const note = payload.note ? String(payload.note) : null;
    let evidence = payload.evidence_json || payload.evidence || {};
    const eventId = createId("evidence_task_event");

    if (toStatus === "closed" && payload.require_closure_recommendation) {
      const recheckId = payload.recheck_id || evidence.recheck_id || evidence.closure_basis_recheck_id || null;
      const recheck = recheckId
        ? parseRecheckRow(db.prepare("SELECT * FROM autonomy_gate_recheck_history WHERE id = ?").get(recheckId))
        : parseRecheckRow(db.prepare(
          `SELECT *
           FROM autonomy_gate_recheck_history
           WHERE project_id = ? AND agent_id = ?
           ORDER BY created_at DESC
           LIMIT 1`
        ).get(task.project_id, task.agent_id));
      const recommendedTask = (recheck?.recheck_summary?.certification_evidence_task_summary?.closure_recommended_tasks || [])
        .find((item) => item.id === taskId);
      if (!recommendedTask) {
        throw new Error("Cannot close certification evidence task without a matching closure recommendation from a recheck.");
      }
      evidence = {
        ...evidence,
        closure_basis_recheck_id: recheck.id,
        closure_recommended: true,
        closure_recommendation_reason: recommendedTask.closure_recommendation_reason,
        criteria_evaluations: recommendedTask.criteria_evaluations || [],
        criteria_satisfied_count: recommendedTask.criteria_satisfied_count || 0,
        criteria_total_count: recommendedTask.criteria_total_count || 0,
        safety_boundary: "human_closure_only_no_automatic_autonomy_grant",
      };
    }

    db.exec("BEGIN");
    try {
      db.prepare("UPDATE certification_evidence_tasks SET status = ?, updated_at = ? WHERE id = ?")
        .run(toStatus, createdAt, taskId);

      db.prepare(
        `INSERT INTO certification_evidence_task_events (
          id, certification_evidence_task_id, certification_review_request_id,
          org_id, project_id, agent_id, actor_type, actor_id,
          from_status, to_status, note, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        taskId,
        task.certification_review_request_id,
        task.org_id,
        task.project_id,
        task.agent_id,
        actorType,
        actorId,
        task.status,
        toStatus,
        note,
        toJson(evidence),
        createdAt
      );

      db.prepare(
        `INSERT INTO audit_events (
          id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        createId("audit"),
        task.org_id,
        task.project_id,
        actorType,
        actorId,
        "certification_evidence_task.status_updated",
        "certification_evidence_task",
        taskId,
        toJson({ certification_evidence_task_event_id: eventId, from_status: task.status, to_status: toStatus, evidence }),
        createdAt
      );

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      task: parseCertificationEvidenceTaskRow(db.prepare("SELECT * FROM certification_evidence_tasks WHERE id = ?").get(taskId)),
      task_event: parseCertificationEvidenceTaskEventRow(
        db.prepare("SELECT * FROM certification_evidence_task_events WHERE id = ?").get(eventId)
      ),
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function listCertificationEvidenceTaskEvents(taskId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
    return db.prepare(
      `SELECT *
       FROM certification_evidence_task_events
       WHERE certification_evidence_task_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(taskId, limit).map(parseCertificationEvidenceTaskEventRow);
  } finally {
    if (!options.db) db.close();
  }
}
