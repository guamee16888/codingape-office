import { migrate, openDatabase } from "./db.mjs";
import {
  latestCertificationRoadmap as loadLatestCertificationRoadmap,
  listAutonomyCertificationRechecks,
} from "./autonomy-certification.mjs";
import { buildReportEvidencePack } from "./report-evidence.mjs";
import { getReport } from "./reports.mjs";

function verdictFromReport(reportJson = {}) {
  const score = reportJson.autonomy_readiness?.project_score || {};
  const highRisk = Number(reportJson.high_risk_count || 0);
  const incidents = (reportJson.incident_reports || []).filter((item) => !["verified", "dismissed"].includes(item.remediation_status));
  const governance = reportJson.data_governance?.summary || {};

  if (highRisk > 0 || incidents.length > 0 || score.readiness_status === "not_ready") {
    return {
      verdict: "not_ready_for_unattended_autonomy",
      label: "Not ready for unattended autonomy",
      severity: "high",
    };
  }

  if (
    score.readiness_status === "ready_with_monitoring" &&
    Number(governance.retention_due_count || 0) === 0 &&
    Number(reportJson.ingestion_health?.signature_coverage_rate || 0) >= 0.8
  ) {
    return {
      verdict: "ready_with_monitoring",
      label: "Ready with monitoring",
      severity: "low",
    };
  }

  return {
    verdict: "limited_autonomy_only",
    label: "Limited autonomy only",
    severity: "medium",
  };
}

function buildBlockers(reportJson = {}) {
  const blockers = [];
  const score = reportJson.autonomy_readiness?.project_score || {};
  const ingestion = reportJson.ingestion_health || {};
  const provenance = reportJson.data_provenance || {};
  const governance = reportJson.data_governance?.summary || {};
  const openIncidents = (reportJson.incident_reports || []).filter((item) => !["verified", "dismissed"].includes(item.remediation_status));

  if (score.readiness_status && score.readiness_status !== "ready_with_monitoring") {
    blockers.push(`Autonomy readiness status is ${score.readiness_status}.`);
  }

  if (Number(score.autonomy_readiness_score || 0) < 70) {
    blockers.push(`Autonomy readiness score is ${score.autonomy_readiness_score || 0}/100, below the enterprise readiness target.`);
  }

  if (Number(reportJson.high_risk_count || 0) > 0) {
    blockers.push(`${reportJson.high_risk_count} high-risk run(s) were found in the report period.`);
  }

  if (openIncidents.length > 0) {
    blockers.push(`${openIncidents.length} incident(s) remain open or not verified.`);
  }

  if (Number(ingestion.signature_coverage_rate || 0) < 0.8) {
    blockers.push(`Webhook signature coverage is ${((Number(ingestion.signature_coverage_rate || 0)) * 100).toFixed(1)}%.`);
  }

  if (["demo_data_present", "mixed_or_unknown", "no_runs"].includes(provenance.source_type)) {
    blockers.push(`Data provenance is ${provenance.source_type || "unknown"}.`);
  }

  if (Number(governance.retention_due_count || 0) > 0) {
    blockers.push(`${governance.retention_due_count} asset class(es) are due for retention review.`);
  }

  return blockers;
}

function buildStrengths(reportJson = {}, evidencePack = {}) {
  const strengths = [];

  if ((reportJson.source_run_ids || []).length > 0) {
    strengths.push(`${(reportJson.source_run_ids || []).length} source run trace(s) are linked to the report.`);
  }

  if (evidencePack.integrity?.evidence_pack_hash) {
    strengths.push(`Evidence pack hash is available: ${evidencePack.integrity.evidence_pack_hash}.`);
  }

  if (reportJson.data_governance?.mode === "advisory_only") {
    strengths.push("Data governance policy is present and advisory-only in Phase 1.");
  }

  if ((reportJson.eval_suggestions || []).length > 0 || (reportJson.eval_replay_gate || {}).has_eval_run) {
    strengths.push("Failure-to-eval loop is present.");
  }

  if (Number(reportJson.eval_coverage?.summary?.eval_case_count || 0) > 0) {
    strengths.push(`${reportJson.eval_coverage.summary.eval_case_count} eval case(s) are mapped to observed failures.`);
  }

  if ((reportJson.learning_rules || []).length > 0) {
    strengths.push(`${reportJson.learning_rules.length} feedback-derived learning rule(s) are active.`);
  }

  return strengths;
}

function latestAutonomyRemediationPlan(reportJson = {}) {
  const checks = reportJson.autonomy_gate_checks || [];
  const latest = checks[0]?.metadata_json?.remediation_plan;
  return latest || {
    plan_version: "none",
    summary: {
      open_item_count: 0,
      blocking_item_count: 0,
      critical_item_count: 0,
      high_item_count: 0,
      warning_item_count: 0,
    },
    items: [],
  };
}

function fallbackCertificationRoadmap() {
  return {
    roadmap_version: "none",
    current_score: 0,
    target_score: 60,
    target_autonomy_level: "L2",
    target_autonomy_label: "Supervised Execution",
    current_gate_status: "blocked",
    blocked_by: "none",
    estimated_score_after_plan: 0,
    hard_blockers: [],
    score_blockers: [],
    score_breakdown: { dimensions: {} },
    remediation_objectives: [],
    verification_requirements: [],
    recheck_command: "npm run local:autonomy-gate",
  };
}

function latestCertificationRoadmap(reportJson = {}, context = {}) {
  const roadmaps = reportJson.autonomy_certification_roadmaps || [];
  if (roadmaps[0]) return roadmaps[0];

  const agentId = context.agentId || reportJson.autonomy_readiness?.agent_scores?.[0]?.target_id;
  if (context.db && context.projectId && agentId) {
    const latest = loadLatestCertificationRoadmap(context.projectId, agentId, {
      db: context.db,
      skipMigrate: true,
    });
    if (latest?.roadmap_json) {
      return { roadmap_id: latest.id, ...latest.roadmap_json };
    }
  }

  return fallbackCertificationRoadmap();
}

function scoreDimensionLine(name, dimension = {}, weight) {
  const reasons = (dimension.reasons || []).join(" ");
  return `- ${name}: ${dimension.score ?? 0}/100, weight=${weight ?? 0}. ${reasons}`.trim();
}

function blockerLine(blocker) {
  return `- ${blocker.code}: current=${blocker.current}, target=${blocker.target}, severity=${blocker.severity}`;
}

function objectiveLine(objective) {
  const verification = (objective.verification_requirements || []).join("; ") || "new gate evidence";
  return `- ${objective.severity}: ${objective.title} (${objective.current_value} -> ${objective.target_value}, +${objective.expected_score_delta}) Evidence: ${verification}`;
}

function recheckLine(recheck) {
  const summary = recheck.recheck_summary || {};
  const taskSummary = summary.certification_evidence_task_summary || {};
  return `- ${recheck.previous_score ?? "none"} -> ${recheck.new_score}/${recheck.target_score}, gate=${recheck.new_gate_status}, metric=${summary.metric_validation_status || "unknown"}, evidence=${summary.evidence_requirement_status || "unknown"}, run_closure=${summary.run_closure_status || "unknown"}, evidence_tasks=${summary.certification_evidence_task_status || "unknown"} (${taskSummary.ready_task_count || 0} ready / ${taskSummary.pending_task_count || 0} pending / ${taskSummary.closure_recommended_count || 0} closure suggested), closure_ready=${summary.run_closure_ready_count || 0}, closure_blocked=${summary.run_closure_still_blocked_count || 0}, unresolved_verified=${summary.verified_but_unresolved_count || 0}, evidence_gaps=${summary.incomplete_evidence_review_count || 0} [${recheck.id}]`;
}

function metricConflictLine(item) {
  const signal = item.metric_signal || {};
  const blockers = [...(signal.matching_hard_blockers || []), ...(signal.matching_score_blockers || [])].slice(0, 6).join(", ");
  return `- ${item.objective_title}: ${item.validation_status}; still matching: ${blockers || "none"}`;
}

export function buildReadinessDossier(reportId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const report = getReport(reportId, { db, skipMigrate: true });
    if (!report) {
      return null;
    }

    const reportJson = report.content_json || {};
    const evidencePack = buildReportEvidencePack(reportId, {
      db,
      skipMigrate: true,
      redact: true,
    });
    const verdict = verdictFromReport(reportJson);
    const blockers = buildBlockers(reportJson);
    const strengths = buildStrengths(reportJson, evidencePack || {});
    const projectScore = reportJson.autonomy_readiness?.project_score || {};
    const remediationPlan = latestAutonomyRemediationPlan(reportJson);
    const certificationRoadmap = latestCertificationRoadmap(reportJson, {
      db,
      projectId: report.project_id,
    });
    const certificationRechecks = certificationRoadmap.agent_id
      ? listAutonomyCertificationRechecks(report.project_id, certificationRoadmap.agent_id, {
        db,
        skipMigrate: true,
        limit: 5,
      })
      : [];

    return {
      dossier_version: "2026-05-22.v1",
      report_id: report.id,
      project_id: report.project_id,
      period_start: report.period_start,
      period_end: report.period_end,
      verdict,
      executive_summary: {
        autonomy_readiness_score: projectScore.autonomy_readiness_score ?? 0,
        reliability_score: projectScore.reliability_score ?? 0,
        cost_efficiency_score: projectScore.cost_efficiency_score ?? 0,
        risk_exposure_score: projectScore.risk_exposure_score ?? 0,
        regression_stability_score: projectScore.regression_stability_score ?? 0,
        human_review_dependency_score: projectScore.human_review_dependency_score ?? 0,
        total_runs: reportJson.total_runs || 0,
        high_risk_count: reportJson.high_risk_count || 0,
        total_cost: reportJson.total_cost || 0,
      },
      trust_evidence: {
        evidence_pack_hash: evidencePack?.integrity?.evidence_pack_hash || null,
        data_provenance: reportJson.data_provenance || {},
        ingestion_health: reportJson.ingestion_health || {},
        data_governance: reportJson.data_governance || {},
        eval_coverage: reportJson.eval_coverage || {},
        incident_count: (reportJson.incident_reports || []).length,
        open_incident_count: (reportJson.incident_reports || []).filter((item) => !["verified", "dismissed"].includes(item.remediation_status)).length,
        eval_replay_gate: reportJson.eval_replay_gate || {},
      },
      blockers,
      strengths,
      autonomy_remediation_plan: remediationPlan,
      autonomy_certification_roadmap: certificationRoadmap,
      autonomy_certification_rechecks: certificationRechecks,
      recommended_next_steps: [
        blockers.length ? "Resolve the listed blockers before increasing autonomy." : "Keep monitoring and expand eval replay coverage.",
        "Export and verify a redacted evidence pack before external review.",
        "Convert repeated failures into eval cases and run replay before prompt or model changes.",
      ],
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function renderReadinessDossierMarkdown(dossier) {
  const evidence = dossier.trust_evidence || {};
  const summary = dossier.executive_summary || {};
  const roadmap = dossier.autonomy_certification_roadmap || {};
  const breakdown = roadmap.score_breakdown || {};
  const dimensions = breakdown.dimensions || {};
  const weights = breakdown.weights || {};
  const rechecks = dossier.autonomy_certification_rechecks || [];
  const metricConflicts = rechecks.flatMap((item) => item.recheck_summary?.verified_objective_validations || []);

  return [
    "# AI Agent Readiness Dossier",
    "",
    `Project: ${dossier.project_id}`,
    `Report: ${dossier.report_id}`,
    `Period: ${dossier.period_start} to ${dossier.period_end}`,
    "",
    "## Verdict",
    "",
    `- ${dossier.verdict.label}`,
    `- Severity: ${dossier.verdict.severity}`,
    "",
    "## Executive Summary",
    "",
    `- Autonomy readiness: ${summary.autonomy_readiness_score}/100`,
    `- Reliability: ${summary.reliability_score}/100`,
    `- Cost efficiency: ${summary.cost_efficiency_score}/100`,
    `- Risk exposure control: ${summary.risk_exposure_score}/100`,
    `- Regression stability: ${summary.regression_stability_score}/100`,
    `- Human review independence: ${summary.human_review_dependency_score}/100`,
    `- Runs reviewed: ${summary.total_runs}`,
    `- High-risk runs: ${summary.high_risk_count}`,
    "",
    "## Trust Evidence",
    "",
    `- Evidence pack hash: ${evidence.evidence_pack_hash || "none"}`,
    `- Data source type: ${evidence.data_provenance?.source_type || "unknown"}`,
    `- Signature coverage: ${((Number(evidence.ingestion_health?.signature_coverage_rate || 0)) * 100).toFixed(1)}%`,
    `- Data governance mode: ${evidence.data_governance?.mode || "unknown"}`,
    `- Eval coverage: ${((Number(evidence.eval_coverage?.summary?.failure_to_eval_ratio || 0)) * 100).toFixed(1)}% failure-to-eval`,
    `- Open incidents: ${evidence.open_incident_count || 0}`,
    "",
    "## Autonomy Remediation Plan",
    "",
    `- Open items: ${dossier.autonomy_remediation_plan?.summary?.open_item_count || 0}`,
    `- Blocking items: ${dossier.autonomy_remediation_plan?.summary?.blocking_item_count || 0}`,
    `- Critical items: ${dossier.autonomy_remediation_plan?.summary?.critical_item_count || 0}`,
    "",
    (dossier.autonomy_remediation_plan?.items || []).length
      ? dossier.autonomy_remediation_plan.items.map((item) => `- ${item.severity}: ${item.title} - ${item.action}`).join("\n")
      : "- None",
    "",
    "## Autonomy Certification Roadmap",
    "",
    `- Current score: ${roadmap.current_score ?? 0}/100`,
    `- Target: ${roadmap.target_autonomy_level || "L2"} ${roadmap.target_autonomy_label || ""} (${roadmap.target_score ?? 60}/100)`,
    `- Gate status: ${roadmap.current_gate_status || "blocked"}`,
    `- Certification state: ${roadmap.certification_state?.current_state || "unknown"}`,
    `- Human review requestable: ${roadmap.certification_state?.can_request_human_review ? "yes" : "no"}`,
    `- Automatic autonomy grant: ${roadmap.certification_state?.can_grant_autonomy ? "yes" : "no"}`,
    `- Blocked by: ${roadmap.blocked_by || "none"}`,
    `- Estimated after plan: ${roadmap.estimated_score_after_plan ?? roadmap.current_score ?? 0}/100`,
    `- Evidence hash: ${evidence.evidence_pack_hash || "none"}`,
    "",
    "### Why Blocked",
    "",
    (roadmap.hard_blockers || []).length
      ? ["Hard blockers:", (roadmap.hard_blockers || []).map(blockerLine).join("\n")].join("\n")
      : "Hard blockers:\n- None",
    "",
    (roadmap.score_blockers || []).length
      ? ["Score blockers:", (roadmap.score_blockers || []).map(blockerLine).join("\n")].join("\n")
      : "Score blockers:\n- None",
    "",
    "### Score Breakdown",
    "",
    [
      scoreDimensionLine("Reliability", dimensions.reliability_score, weights.reliability_score),
      scoreDimensionLine("Eval confidence", dimensions.eval_confidence_score, weights.eval_confidence_score),
      scoreDimensionLine("Risk control", dimensions.risk_control_score, weights.risk_control_score),
      scoreDimensionLine("Human review dependency", dimensions.human_review_dependency_score, weights.human_review_dependency_score),
      scoreDimensionLine("Incident score", dimensions.incident_score, weights.incident_score),
      scoreDimensionLine("Cost stability", dimensions.cost_stability_score, weights.cost_stability_score),
    ].join("\n"),
    "",
    "### Required Remediation Objectives",
    "",
    (roadmap.remediation_objectives || []).length
      ? (roadmap.remediation_objectives || []).map(objectiveLine).join("\n")
      : "- None",
    "",
    "### Recheck Plan",
    "",
    `- Re-run gate after objective evidence exists: ${roadmap.recheck_command || "npm run local:autonomy-gate"}`,
    "- Keep Phase 1 changes advisory-only until a human approves higher autonomy.",
    "",
    "### Recheck History",
    "",
    rechecks.length ? rechecks.map(recheckLine).join("\n") : "- None",
    "",
    "### Evidence and Metric Guardrails",
    "",
    metricConflicts.length ? metricConflicts.map(metricConflictLine).join("\n") : "- No verified-objective metric conflicts found.",
    "",
    "## Blockers",
    "",
    dossier.blockers.length ? dossier.blockers.map((item) => `- ${item}`).join("\n") : "- None",
    "",
    "## Strengths",
    "",
    dossier.strengths.length ? dossier.strengths.map((item) => `- ${item}`).join("\n") : "- None",
    "",
    "## Recommended Next Steps",
    "",
    dossier.recommended_next_steps.map((item) => `- ${item}`).join("\n"),
  ].join("\n");
}
