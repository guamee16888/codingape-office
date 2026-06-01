import { createId } from "./ids.mjs";
import { fromJson, migrate, nowIso, openDatabase, toJson } from "./db.mjs";
import { buildLearningInsights, persistLearningInsights } from "./learning-insights.mjs";
import {
  applyLearningRulesToSuggestions,
  buildLearningRuleReview,
  listProjectLearningRuleEvents,
  listProjectLearningRules,
  rebuildLearningRulesFromCertificationEffectiveness,
  rebuildLearningRulesFromFeedback,
  rebuildLearningRulesFromPolicyWorkItemEffectiveness,
} from "./learning-rules.mjs";
import {
  createPolicyReviewTasksFromDryRunResults,
  dryRunPolicyRules,
  listProjectPolicyRuleReviewCandidateEvents,
  listProjectPolicyRuleReviewCandidates,
  listProjectPolicyReviewTaskEvents,
  persistPolicyDryRunEvidence,
} from "./policy-dry-run.mjs";
import {
  createPolicyRuleDraftsFromTrustedLearningRules,
  listProjectPolicyRuleEvents,
  listProjectPolicyRules,
} from "./policy-rules.mjs";
import {
  listPolicyReviewWorkItemEffectiveness,
  listPolicyReviewWorkItemEvents,
} from "./policy-governance-dossier.mjs";
import { buildReliabilityScoreSet, persistReliabilityScores } from "./reliability-scores.mjs";
import { latestEvalReplayGate } from "./eval-replay.mjs";
import { listProjectPromptPromotionChecks } from "./prompt-versions.mjs";
import { listProjectAutonomyGateChecks } from "./autonomy-gates.mjs";
import {
  generateIncidentReportsForPeriod,
  listProjectIncidentRemediationEvents,
} from "./incident-reports.mjs";
import { summarizeProjectIngestionHealth } from "./ingestion-events.mjs";
import { summarizeProjectDataGovernance } from "./data-governance.mjs";
import { summarizeProjectEvalCoverage } from "./eval-coverage.mjs";
import { buildProjectEvalBacklog } from "./eval-backlog.mjs";
import {
  buildAndPersistCertificationRoadmap,
  listAutonomyCertificationRechecks,
  listCertificationActionQueue,
  listProjectCertificationActionEffectiveness,
  listProjectCertificationActionEvents,
  listCertificationEvidenceTasks,
  listCertificationReviewRequests,
} from "./autonomy-certification.mjs";
import {
  normalizeAutonomyLevel,
  productionCertificationPolicyForLevel,
} from "./certification-policies.mjs";

export function dayRange(dateString) {
  const start = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid report date: ${dateString}`);
  }

  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function previousDateString(dateString) {
  const start = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid report date: ${dateString}`);
  }

  return new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function topCounts(items, limit = 5) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function countsBy(items, key, preferredOrder = []) {
  const counts = new Map();
  for (const item of items) {
    const name = item[key] || "unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const orderIndex = new Map(preferredOrder.map((name, index) => [name, index]));
  return Array.from(counts.entries())
    .sort((a, b) => {
      const aIndex = orderIndex.has(a[0]) ? orderIndex.get(a[0]) : Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.has(b[0]) ? orderIndex.get(b[0]) : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex || b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([name, count]) => ({ name, count }));
}

function summarizeCostBy(rows, keyOrGetter, limit = 10) {
  const groups = new Map();

  for (const row of rows) {
    const value = typeof keyOrGetter === "function" ? keyOrGetter(row) : row[keyOrGetter];
    const name = value || "unknown";
    const existing = groups.get(name) || { name, run_count: 0, total_cost: 0, total_latency: 0 };
    existing.run_count += 1;
    existing.total_cost += Number(row.cost || 0);
    existing.total_latency += Number(row.latency || 0);
    groups.set(name, existing);
  }

  return Array.from(groups.values())
    .map((item) => ({
      ...item,
      total_cost: Number(item.total_cost.toFixed(6)),
      average_cost: Number((item.run_count ? item.total_cost / item.run_count : 0).toFixed(6)),
      average_latency: Number((item.run_count ? item.total_latency / item.run_count : 0).toFixed(3)),
    }))
    .sort((a, b) => b.total_cost - a.total_cost)
    .slice(0, limit);
}

function bulletList(items, fallback = "- None") {
  if (!items.length) {
    return fallback;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function actionLine(action, runId) {
  return `${action.title} (${action.severity}, ${action.type}, status=${action.status}) - ${action.expected_impact || "No impact estimate"} [run: ${runId}, suggestion: ${action.suggestion_id}]`;
}

function nextActionLine(action) {
  const target = action.suggestion_id
    ? ` [run: ${action.run_id}, suggestion: ${action.suggestion_id}]`
    : ` [run: ${action.run_id}]`;
  return `${action.priority.toUpperCase()} - ${action.title}: ${action.reason}${target}`;
}

function costBreakdownLine(item) {
  return `${item.name}: $${item.total_cost.toFixed(4)} across ${item.run_count} runs, avg $${item.average_cost.toFixed(4)}, avg latency ${item.average_latency}s`;
}

function runTaskType(row) {
  const metadata = fromJson(row.metadata, {});
  return metadata.task_type || metadata.taskType || metadata.workflow_type || metadata.workflowType || "unknown";
}

function incrementCount(map, key) {
  const name = key || "unknown";
  map.set(name, (map.get(name) || 0) + 1);
}

function mapToSortedCounts(map) {
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const CERTIFIABLE_PROVENANCE_LEVELS = new Set([
  "production_evidence",
  "production_with_metadata_gaps",
]);

function summarizeDataProvenance(db, projectId, start, end, runRows, options = {}) {
  const productionCertificationPolicy = options.productionCertificationPolicy || productionCertificationPolicyForLevel(options.targetAutonomyLevel || "L2");
  const metadataSources = new Map();
  const ingestionSources = new Map();
  let localAdapterRuns = 0;
  let demoLikeRuns = 0;
  let consoleSampleRuns = 0;
  let unknownSourceRuns = 0;
  let tokenCostUnknownRuns = 0;

  for (const row of runRows) {
    const metadata = fromJson(row.metadata, {});
    const source = metadata.source || "unknown";
    incrementCount(metadataSources, source);

    if (source === "local_real_data_adapter") {
      localAdapterRuns += 1;
    }

    if (source === "console_sample_run") {
      consoleSampleRuns += 1;
    }

    if (metadata.token_cost_known === false) {
      tokenCostUnknownRuns += 1;
    }

    if (source === "unknown") {
      unknownSourceRuns += 1;
    }

    if (
      String(row.run_id_external || "").startsWith("demo_") ||
      source === "demo" ||
      source === "console_sample_run" ||
      metadata.demo === true ||
      metadata.onboarding_sample === true
    ) {
      demoLikeRuns += 1;
    }
  }

  const auditRows = db.prepare(
    `SELECT target_id, metadata
     FROM audit_events
     WHERE project_id = ?
       AND action IN ('agent_run.ingested', 'agent_run.duplicate_ignored')
       AND created_at >= ?
       AND created_at < ?`
  ).all(projectId, start, end);

  for (const row of auditRows) {
    const metadata = fromJson(row.metadata, {});
    incrementCount(ingestionSources, metadata.ingestion_source || "unknown");
  }

  const auditByRunId = new Map(auditRows.map((row) => [row.target_id, fromJson(row.metadata, {})]));
  let productionCandidateRuns = 0;
  let apiKeyAuthenticatedRuns = 0;
  let signatureVerifiedRuns = 0;
  for (const row of runRows) {
    const metadata = fromJson(row.metadata, {});
    const source = metadata.source || "unknown";
    const auditMetadata = auditByRunId.get(row.id) || {};
    const ingestionSource = auditMetadata.ingestion_source || "unknown";
    const productionIngested = ["webhook", "api"].includes(ingestionSource);
    const sampleLike = (
      String(row.run_id_external || "").startsWith("demo_") ||
      source === "demo" ||
      source === "console_sample_run" ||
      metadata.demo === true ||
      metadata.onboarding_sample === true
    );
    if (productionIngested && !sampleLike && source !== "local_real_data_adapter") {
      productionCandidateRuns += 1;
    }
    if (auditMetadata.api_key_id) {
      apiKeyAuthenticatedRuns += 1;
    }
    if (auditMetadata.signature_verified) {
      signatureVerifiedRuns += 1;
    }
  }

  const webhookOrApiEvents = auditRows.filter((row) => {
    const source = fromJson(row.metadata, {}).ingestion_source;
    return ["webhook", "api"].includes(source);
  }).length;
  const sourceType = demoLikeRuns > 0
    ? "demo_data_present"
    : localAdapterRuns === runRows.length && runRows.length > 0
      ? "local_workspace"
      : webhookOrApiEvents > 0
        ? "webhook_or_api"
        : runRows.length > 0
          ? "mixed_or_unknown"
          : "no_runs";

  const evidenceTrustLevel = (() => {
    if (runRows.length === 0) return "insufficient";
    if (productionCandidateRuns > 0 && demoLikeRuns === 0 && localAdapterRuns === 0 && unknownSourceRuns === 0) {
      return "production_evidence";
    }
    if (productionCandidateRuns > 0 && demoLikeRuns === 0 && localAdapterRuns === 0) {
      return "production_with_metadata_gaps";
    }
    if (productionCandidateRuns > 0) {
      return "mixed_requires_review";
    }
    if (localAdapterRuns === runRows.length) return "local_development";
    if (demoLikeRuns === runRows.length) return "sample_only";
    return "untrusted_or_unknown";
  })();

  const readinessEvidenceStatus = {
    production_evidence: "usable_for_customer_readiness",
    production_with_metadata_gaps: "usable_but_source_metadata_should_be_fixed",
    mixed_requires_review: "do_not_use_for_certification_without_source_review",
    local_development: "development_only_not_customer_production",
    sample_only: "onboarding_sample_not_customer_production",
    untrusted_or_unknown: "insufficient_source_evidence",
    insufficient: "no_run_evidence",
  }[evidenceTrustLevel];

  const apiKeyAuthenticationCoverageRate = productionCandidateRuns
    ? apiKeyAuthenticatedRuns / productionCandidateRuns
    : 0;
  const signatureVerificationCoverageRate = productionCandidateRuns
    ? signatureVerifiedRuns / productionCandidateRuns
    : 0;
  const certificationPreconditions = [
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
  const certificationEvidenceReady = (
    CERTIFIABLE_PROVENANCE_LEVELS.has(evidenceTrustLevel) &&
    certificationPreconditions.every((item) => item.status === "passed")
  );

  const confidenceNote = {
    demo_data_present: "Report includes demo-like runs. Do not treat it as customer production evidence.",
    local_workspace: "Report is based on local workspace runs captured by the Codex/local adapter.",
    webhook_or_api: "Report includes runs received through authenticated webhook/API ingestion.",
    mixed_or_unknown: "Report includes runs with mixed or unknown source metadata.",
    no_runs: "No runs were found for this report period.",
  }[sourceType];

  return {
    source_type: sourceType,
    evidence_trust_level: evidenceTrustLevel,
    readiness_evidence_status: readinessEvidenceStatus,
    total_runs: runRows.length,
    production_candidate_runs: productionCandidateRuns,
    api_key_authenticated_runs: apiKeyAuthenticatedRuns,
    signature_verified_runs: signatureVerifiedRuns,
    api_key_authentication_coverage_rate: Number(apiKeyAuthenticationCoverageRate.toFixed(6)),
    signature_verification_coverage_rate: Number(signatureVerificationCoverageRate.toFixed(6)),
    production_certification_policy: productionCertificationPolicy,
    certification_preconditions: certificationPreconditions,
    certification_evidence_ready: certificationEvidenceReady,
    local_adapter_runs: localAdapterRuns,
    console_sample_runs: consoleSampleRuns,
    demo_like_runs: demoLikeRuns,
    unknown_source_runs: unknownSourceRuns,
    token_cost_unknown_runs: tokenCostUnknownRuns,
    metadata_sources: mapToSortedCounts(metadataSources),
    ingestion_sources: mapToSortedCounts(ingestionSources),
    confidence_note: confidenceNote,
  };
}

function dataProvenanceLines(summary = {}) {
  const sourceCounts = (summary.metadata_sources || []).map((item) => `${item.name}: ${item.count}`).join(", ") || "none";
  const ingestionCounts = (summary.ingestion_sources || []).map((item) => `${item.name}: ${item.count}`).join(", ") || "none";

  return [
    `Source type: ${summary.source_type || "unknown"}`,
    `Evidence trust level: ${summary.evidence_trust_level || "unknown"}`,
    `Readiness evidence status: ${summary.readiness_evidence_status || "unknown"}`,
    `Total runs in report period: ${summary.total_runs || 0}`,
    `Production candidate runs: ${summary.production_candidate_runs || 0}`,
    `API-key authenticated runs: ${summary.api_key_authenticated_runs || 0}`,
    `Signature-verified runs: ${summary.signature_verified_runs || 0}`,
    `API-key authentication coverage: ${((summary.api_key_authentication_coverage_rate || 0) * 100).toFixed(1)}%`,
    `Signature verification coverage: ${((summary.signature_verification_coverage_rate || 0) * 100).toFixed(1)}%`,
    `Certification evidence ready: ${summary.certification_evidence_ready ? "yes" : "no"}`,
    `Local adapter runs: ${summary.local_adapter_runs || 0}`,
    `Console sample runs: ${summary.console_sample_runs || 0}`,
    `Demo-like runs: ${summary.demo_like_runs || 0}`,
    `Unknown-source runs: ${summary.unknown_source_runs || 0}`,
    `Runs without known token cost: ${summary.token_cost_unknown_runs || 0}`,
    `Run metadata sources: ${sourceCounts}`,
    `Ingestion audit sources: ${ingestionCounts}`,
    `Confidence note: ${summary.confidence_note || "No source note available."}`,
  ];
}

function severityRank(value) {
  if (value === "high") return 0;
  if (value === "medium") return 1;
  return 2;
}

function isActionableSuggestion(action) {
  return !["rejected", "wrong", "not_useful"].includes(action.status) && action.learning_rule_effect !== "suppressed";
}

function summarizeCostOpportunity(costActions) {
  const byRun = new Map();

  for (const action of costActions) {
    if (!byRun.has(action.run_id)) {
      byRun.set(action.run_id, Number(action.source_run_cost || 0));
    }
  }

  const affectedCost = Array.from(byRun.values()).reduce((sum, cost) => sum + cost, 0);
  const estimatedSavingsRate = 0.2;
  const estimatedDailySavings = affectedCost * estimatedSavingsRate;

  return {
    affected_run_count: byRun.size,
    affected_cost: Number(affectedCost.toFixed(6)),
    estimated_savings_rate: estimatedSavingsRate,
    estimated_daily_savings: Number(estimatedDailySavings.toFixed(6)),
    estimated_monthly_savings: Number((estimatedDailySavings * 30).toFixed(6)),
    assumption: "Phase 1 heuristic: reviewable cost optimizations assume a conservative 20% savings on affected daily run cost.",
  };
}

function buildNextActions({ humanReviewRows, costActions, promptActions, evalActions, policyDryRunResults = [] }) {
  const actions = [];

  for (const row of humanReviewRows.slice(0, 3)) {
    actions.push({
      priority: "high",
      type: "human_review",
      title: "Review high-risk agent run",
      reason: `Risk score ${row.risk_score}, status ${row.overall_status}`,
      run_id: row.run_id,
      suggestion_id: null,
    });
  }

  const sortedCostActions = [...costActions]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || Number(b.source_run_cost || 0) - Number(a.source_run_cost || 0));
  for (const action of sortedCostActions.slice(0, 3)) {
    actions.push({
      priority: action.severity === "high" ? "high" : "medium",
      type: "cost_optimization",
      title: action.title,
      reason: action.expected_impact || "Review cost optimization opportunity.",
      run_id: action.run_id,
      suggestion_id: action.suggestion_id,
    });
  }

  const sortedPromptActions = [...promptActions].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  for (const action of sortedPromptActions.slice(0, 3)) {
    actions.push({
      priority: action.severity === "high" ? "high" : "medium",
      type: action.type === "tool" ? "tool_improvement" : "prompt_improvement",
      title: action.title,
      reason: action.expected_impact || "Review prompt or tool improvement.",
      run_id: action.run_id,
      suggestion_id: action.suggestion_id,
    });
  }

  for (const action of evalActions.slice(0, 2)) {
    actions.push({
      priority: "low",
      type: "eval_case",
      title: action.title,
      reason: "Convert failure evidence into a regression asset.",
      run_id: action.run_id,
      suggestion_id: action.suggestion_id,
    });
  }

  for (const result of policyDryRunResults.filter((item) => !item.enabled && item.match_count > 0).slice(0, 3)) {
    actions.push({
      priority: result.severity === "high" ? "high" : "medium",
      type: "policy_review",
      title: `Review policy draft: ${result.name}`,
      reason: `${result.match_count} historical runs would match this disabled policy draft.`,
      run_id: result.matches[0]?.run_id || null,
      suggestion_id: result.config_json?.suggestion_id || null,
      policy_rule_id: result.policy_rule_id,
    });
  }

  return actions.slice(0, 10);
}

function baseMetrics(runRows, judgementRows) {
  const totalRuns = runRows.length;
  const totalCost = runRows.reduce((sum, run) => sum + Number(run.cost || 0), 0);
  const successCount = judgementRows.filter((row) => row.overall_status === "success").length;
  const failureCount = judgementRows.filter((row) => ["failure", "partial_failure"].includes(row.overall_status)).length;
  const highRiskCount = judgementRows.filter((row) => row.overall_status === "high_risk" || Number(row.risk_score || 0) >= 75).length;

  return {
    total_runs: totalRuns,
    success_count: successCount,
    failure_count: failureCount,
    high_risk_count: highRiskCount,
    total_cost: Number(totalCost.toFixed(6)),
    average_cost_per_run: Number((totalRuns ? totalCost / totalRuns : 0).toFixed(6)),
    success_rate: Number((totalRuns ? successCount / totalRuns : 0).toFixed(6)),
    failure_rate: Number((totalRuns ? failureCount / totalRuns : 0).toFixed(6)),
    high_risk_rate: Number((totalRuns ? highRiskCount / totalRuns : 0).toFixed(6)),
  };
}

function queryRunsForRange(db, projectId, start, end) {
  return db.prepare(
    `SELECT * FROM agent_runs
     WHERE project_id = ? AND created_at >= ? AND created_at < ?
     ORDER BY created_at ASC`
  ).all(projectId, start, end);
}

function queryJudgementsForRange(db, projectId, start, end) {
  return db.prepare(
    `SELECT
      r.id AS run_id,
      r.agent_id,
      r.model,
      r.provider,
      r.cost,
      r.latency,
      r.status AS run_status,
      j.id AS judgement_id,
      j.overall_status,
      j.success_score,
      j.risk_score,
      j.cost_score,
      j.failure_categories,
      j.recommended_actions,
      j.evidence,
      j.reasoning_summary,
      j.needs_human_review
     FROM agent_runs r
     LEFT JOIN run_judgements j ON j.agent_run_id = r.id
     WHERE r.project_id = ? AND r.created_at >= ? AND r.created_at < ?
    ORDER BY r.created_at ASC`
  ).all(projectId, start, end);
}

function queryEvalCaseCountsByAgent(db, projectId) {
  return new Map(db.prepare(
    `SELECT agent_id, COUNT(*) AS count
     FROM eval_cases
     WHERE project_id = ?
     GROUP BY agent_id`
  ).all(projectId).map((row) => [row.agent_id, Number(row.count || 0)]));
}

function queryFailureTaxonomyCounts(db, projectId, start, end, limit = 10) {
  return db.prepare(
    `SELECT
      COALESCE(f.taxonomy_code, 'unknown_failure') AS name,
      COUNT(*) AS count,
      AVG(COALESCE(f.taxonomy_confidence, 0)) AS average_confidence
     FROM failure_cases f
     JOIN agent_runs r ON r.id = f.agent_run_id
     WHERE r.project_id = ? AND r.created_at >= ? AND r.created_at < ?
     GROUP BY COALESCE(f.taxonomy_code, 'unknown_failure')
     ORDER BY count DESC, average_confidence DESC, name ASC
     LIMIT ?`
  ).all(projectId, start, end, limit).map((row) => ({
    name: row.name,
    count: Number(row.count || 0),
    average_confidence: Number(Number(row.average_confidence || 0).toFixed(3)),
  }));
}

function metricDelta(current, previous, key) {
  const currentValue = Number(current[key] || 0);
  const previousValue = Number(previous[key] || 0);
  return Number((currentValue - previousValue).toFixed(6));
}

function ratePct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function signedNumber(value, digits = 0) {
  const number = Number(value || 0);
  const fixed = number.toFixed(digits);
  return number > 0 ? `+${fixed}` : fixed;
}

function buildPreviousDayComparison({ dateString, currentMetrics, previousMetrics }) {
  const previousDate = previousDateString(dateString);
  const delta = {
    total_runs: metricDelta(currentMetrics, previousMetrics, "total_runs"),
    success_count: metricDelta(currentMetrics, previousMetrics, "success_count"),
    failure_count: metricDelta(currentMetrics, previousMetrics, "failure_count"),
    high_risk_count: metricDelta(currentMetrics, previousMetrics, "high_risk_count"),
    total_cost: metricDelta(currentMetrics, previousMetrics, "total_cost"),
    average_cost_per_run: metricDelta(currentMetrics, previousMetrics, "average_cost_per_run"),
    success_rate: metricDelta(currentMetrics, previousMetrics, "success_rate"),
    failure_rate: metricDelta(currentMetrics, previousMetrics, "failure_rate"),
    high_risk_rate: metricDelta(currentMetrics, previousMetrics, "high_risk_rate"),
  };

  return {
    previous_date: previousDate,
    has_previous_data: previousMetrics.total_runs > 0,
    current: currentMetrics,
    previous: previousMetrics,
    delta,
  };
}

function countOne(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.count || 0);
}

function learningAssetSummary(db, projectId) {
  const feedbackRows = db.prepare(
    `SELECT feedback_type AS name, COUNT(*) AS count
     FROM user_feedback
     WHERE project_id = ?
     GROUP BY feedback_type
     ORDER BY count DESC, feedback_type ASC`
  ).all(projectId).map((row) => ({ name: row.name, count: Number(row.count || 0) }));

  const suggestionRows = db.prepare(
    `SELECT status AS name, COUNT(*) AS count
     FROM optimization_suggestions
     WHERE project_id = ?
     GROUP BY status
     ORDER BY count DESC, status ASC`
  ).all(projectId).map((row) => ({ name: row.name, count: Number(row.count || 0) }));

  return {
    agent_run_traces: countOne(db, "SELECT COUNT(*) AS count FROM agent_runs WHERE project_id = ?", projectId),
    outcome_labels: countOne(
      db,
      `SELECT COUNT(*) AS count
       FROM run_judgements j
       JOIN agent_runs r ON r.id = j.agent_run_id
       WHERE r.project_id = ?`,
      projectId
    ),
    failure_cases: countOne(
      db,
      `SELECT COUNT(*) AS count
       FROM failure_cases f
       JOIN agent_runs r ON r.id = f.agent_run_id
       WHERE r.project_id = ?`,
      projectId
    ),
    failure_taxonomies: countOne(db, "SELECT COUNT(*) AS count FROM failure_taxonomies"),
    cost_events: countOne(
      db,
      `SELECT COUNT(*) AS count
       FROM cost_events c
       JOIN agent_runs r ON r.id = c.agent_run_id
       WHERE r.project_id = ?`,
      projectId
    ),
    eval_cases: countOne(db, "SELECT COUNT(*) AS count FROM eval_cases WHERE project_id = ?", projectId),
    optimization_suggestions: countOne(db, "SELECT COUNT(*) AS count FROM optimization_suggestions WHERE project_id = ?", projectId),
    user_feedback_labels: countOne(db, "SELECT COUNT(*) AS count FROM user_feedback WHERE project_id = ?", projectId),
    learning_insights: countOne(db, "SELECT COUNT(*) AS count FROM learning_insights WHERE project_id = ?", projectId),
    learning_rule_events: countOne(db, "SELECT COUNT(*) AS count FROM learning_rule_events WHERE project_id = ?", projectId),
    policy_rules: countOne(db, "SELECT COUNT(*) AS count FROM policy_rules WHERE project_id = ?", projectId),
    policy_rule_events: countOne(db, "SELECT COUNT(*) AS count FROM policy_rule_events WHERE project_id = ?", projectId),
    policy_review_tasks: countOne(db, "SELECT COUNT(*) AS count FROM policy_review_tasks WHERE project_id = ?", projectId),
    policy_review_task_events: countOne(db, "SELECT COUNT(*) AS count FROM policy_review_task_events WHERE project_id = ?", projectId),
    policy_review_work_item_events: countOne(db, "SELECT COUNT(*) AS count FROM policy_review_work_item_events WHERE project_id = ?", projectId),
    policy_review_work_item_effectiveness: countOne(db, "SELECT COUNT(*) AS count FROM policy_review_work_item_effectiveness WHERE project_id = ?", projectId),
    policy_rule_review_candidates: countOne(db, "SELECT COUNT(*) AS count FROM policy_rule_review_candidates WHERE project_id = ?", projectId),
    policy_rule_review_candidate_events: countOne(db, "SELECT COUNT(*) AS count FROM policy_rule_review_candidate_events WHERE project_id = ?", projectId),
    prompt_versions: countOne(db, "SELECT COUNT(*) AS count FROM prompt_versions WHERE project_id = ?", projectId),
    prompt_promotion_checks: countOne(
      db,
      `SELECT COUNT(*) AS count
       FROM audit_evidence_items
       WHERE project_id = ? AND evidence_type = 'prompt_promotion_check'`,
      projectId
    ),
    autonomy_gate_checks: countOne(
      db,
      `SELECT COUNT(*) AS count
       FROM audit_evidence_items
       WHERE project_id = ? AND evidence_type = 'autonomy_gate_check'`,
      projectId
    ),
    remediation_objectives: countOne(db, "SELECT COUNT(*) AS count FROM remediation_objectives WHERE project_id = ?", projectId),
    remediation_objective_events: countOne(db, "SELECT COUNT(*) AS count FROM remediation_objective_events WHERE project_id = ?", projectId),
    objective_metric_validations: countOne(db, "SELECT COUNT(*) AS count FROM objective_metric_validations WHERE project_id = ?", projectId),
    objective_run_closure_assessments: countOne(db, "SELECT COUNT(*) AS count FROM objective_run_closure_assessments WHERE project_id = ?", projectId),
    certification_evidence_tasks: countOne(db, "SELECT COUNT(*) AS count FROM certification_evidence_tasks WHERE project_id = ?", projectId),
    certification_evidence_task_events: countOne(db, "SELECT COUNT(*) AS count FROM certification_evidence_task_events WHERE project_id = ?", projectId),
    certification_action_queue: countOne(db, "SELECT COUNT(*) AS count FROM certification_action_queue WHERE project_id = ?", projectId),
    certification_action_events: countOne(db, "SELECT COUNT(*) AS count FROM certification_action_events WHERE project_id = ?", projectId),
    certification_action_effectiveness: countOne(db, "SELECT COUNT(*) AS count FROM certification_action_effectiveness WHERE project_id = ?", projectId),
    autonomy_certification_roadmaps: countOne(db, "SELECT COUNT(*) AS count FROM autonomy_certification_roadmaps WHERE project_id = ?", projectId),
    autonomy_gate_rechecks: countOne(db, "SELECT COUNT(*) AS count FROM autonomy_gate_recheck_history WHERE project_id = ?", projectId),
    learning_rules: countOne(db, "SELECT COUNT(*) AS count FROM learning_rules WHERE project_id = ?", projectId),
    reliability_scores: countOne(db, "SELECT COUNT(*) AS count FROM reliability_scores WHERE project_id = ?", projectId),
    score_snapshots: countOne(db, "SELECT COUNT(*) AS count FROM score_snapshots WHERE project_id = ?", projectId),
    policy_dry_runs: countOne(db, "SELECT COUNT(*) AS count FROM policy_dry_runs WHERE project_id = ?", projectId),
    policy_dry_run_matches: countOne(
      db,
      `SELECT COUNT(*) AS count
       FROM policy_dry_run_matches m
       JOIN policy_dry_runs d ON d.id = m.policy_dry_run_id
       WHERE d.project_id = ?`,
      projectId
    ),
    reports: countOne(db, "SELECT COUNT(*) AS count FROM reports WHERE project_id = ?", projectId),
    audit_events: countOne(db, "SELECT COUNT(*) AS count FROM audit_events WHERE project_id = ?", projectId),
    eval_runs: countOne(db, "SELECT COUNT(*) AS count FROM eval_runs WHERE project_id = ?", projectId),
    replay_results: countOne(
      db,
      `SELECT COUNT(*) AS count
       FROM replay_results rr
       JOIN eval_runs er ON er.id = rr.eval_run_id
       WHERE er.project_id = ?`,
      projectId
    ),
    model_route_policies: countOne(db, "SELECT COUNT(*) AS count FROM model_route_policies WHERE project_id = ?", projectId),
    incident_reports: countOne(db, "SELECT COUNT(*) AS count FROM incident_reports WHERE project_id = ?", projectId),
    incident_remediation_events: countOne(db, "SELECT COUNT(*) AS count FROM incident_remediation_events WHERE project_id = ?", projectId),
    audit_evidence_items: countOne(db, "SELECT COUNT(*) AS count FROM audit_evidence_items WHERE project_id = ?", projectId),
    anonymized_benchmark_patterns: countOne(db, "SELECT COUNT(*) AS count FROM anonymized_benchmark_patterns"),
    feedback_by_type: feedbackRows,
    suggestions_by_status: suggestionRows,
  };
}

function assetSummaryLines(summary) {
  return [
    `Agent run traces: ${summary.agent_run_traces}`,
    `Outcome labels: ${summary.outcome_labels}`,
    `Failure cases: ${summary.failure_cases}`,
    `Failure taxonomies: ${summary.failure_taxonomies}`,
    `Cost events: ${summary.cost_events}`,
    `Eval cases: ${summary.eval_cases}`,
    `Optimization suggestions: ${summary.optimization_suggestions}`,
    `User feedback labels: ${summary.user_feedback_labels}`,
    `Learning insights: ${summary.learning_insights}`,
    `Policy rules: ${summary.policy_rules}`,
    `Policy rule review events: ${summary.policy_rule_events}`,
    `Policy review tasks: ${summary.policy_review_tasks}`,
    `Policy review task events: ${summary.policy_review_task_events}`,
    `Policy review work item events: ${summary.policy_review_work_item_events}`,
    `Policy review work item effectiveness: ${summary.policy_review_work_item_effectiveness}`,
    `Policy rule review candidates: ${summary.policy_rule_review_candidates}`,
    `Policy rule review candidate events: ${summary.policy_rule_review_candidate_events}`,
    `Policy dry-runs: ${summary.policy_dry_runs}`,
    `Policy dry-run match evidence: ${summary.policy_dry_run_matches}`,
    `Prompt versions: ${summary.prompt_versions}`,
    `Prompt promotion checks: ${summary.prompt_promotion_checks}`,
    `Autonomy gate checks: ${summary.autonomy_gate_checks}`,
    `Autonomy certification roadmaps: ${summary.autonomy_certification_roadmaps}`,
    `Remediation objectives: ${summary.remediation_objectives}`,
    `Remediation objective events: ${summary.remediation_objective_events}`,
    `Objective metric validations: ${summary.objective_metric_validations}`,
    `Objective run-closure assessments: ${summary.objective_run_closure_assessments}`,
    `Certification evidence tasks: ${summary.certification_evidence_tasks}`,
    `Certification evidence task events: ${summary.certification_evidence_task_events}`,
    `Certification action queue: ${summary.certification_action_queue}`,
    `Certification action events: ${summary.certification_action_events}`,
    `Autonomy gate rechecks: ${summary.autonomy_gate_rechecks}`,
    `Learning rules: ${summary.learning_rules}`,
    `Reliability scores: ${summary.reliability_scores}`,
    `Score snapshots: ${summary.score_snapshots}`,
    `Eval runs: ${summary.eval_runs}`,
    `Replay results: ${summary.replay_results}`,
    `Model route policies: ${summary.model_route_policies}`,
    `Incident reports: ${summary.incident_reports}`,
    `Incident remediation events: ${summary.incident_remediation_events}`,
    `Audit evidence items: ${summary.audit_evidence_items}`,
    `Anonymized benchmark patterns: ${summary.anonymized_benchmark_patterns}`,
    `Reports generated: ${summary.reports}`,
    `Audit events: ${summary.audit_events}`,
  ];
}

function feedbackSummaryLines(summary) {
  const feedback = summary.feedback_by_type.length
    ? summary.feedback_by_type.map((item) => `${item.name}: ${item.count}`).join(", ")
    : "none";
  const suggestions = summary.suggestions_by_status.length
    ? summary.suggestions_by_status.map((item) => `${item.name}: ${item.count}`).join(", ")
    : "none";

  return [
    `Feedback labels by type: ${feedback}`,
    `Suggestions by status: ${suggestions}`,
  ];
}

function recentFailurePatterns(db, projectId, endIso, dayCount = 7) {
  const end = new Date(endIso);
  const start = new Date(end.getTime() - dayCount * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(
    `SELECT
      f.category,
      f.severity,
      f.agent_run_id,
      r.agent_id,
      r.created_at
     FROM failure_cases f
     JOIN agent_runs r ON r.id = f.agent_run_id
     WHERE r.project_id = ? AND r.created_at >= ? AND r.created_at < ?
     ORDER BY r.created_at ASC`
  ).all(projectId, start, endIso);

  const groups = new Map();
  for (const row of rows) {
    const existing = groups.get(row.category) || {
      category: row.category,
      case_count: 0,
      run_ids: new Set(),
      agent_ids: new Set(),
      severities: new Set(),
      first_seen_at: row.created_at,
      last_seen_at: row.created_at,
    };

    existing.case_count += 1;
    existing.run_ids.add(row.agent_run_id);
    existing.agent_ids.add(row.agent_id);
    existing.severities.add(row.severity);
    existing.first_seen_at = existing.first_seen_at < row.created_at ? existing.first_seen_at : row.created_at;
    existing.last_seen_at = existing.last_seen_at > row.created_at ? existing.last_seen_at : row.created_at;
    groups.set(row.category, existing);
  }

  return Array.from(groups.values())
    .filter((item) => item.case_count >= 2)
    .map((item) => ({
      category: item.category,
      case_count: item.case_count,
      run_count: item.run_ids.size,
      agent_count: item.agent_ids.size,
      severities: Array.from(item.severities).sort((a, b) => severityRank(a) - severityRank(b)),
      first_seen_at: item.first_seen_at,
      last_seen_at: item.last_seen_at,
      recommendation: "Treat as a recurring failure pattern. Promote at least one representative run into an eval case and review prompt/tool fallback rules.",
    }))
    .sort((a, b) => b.case_count - a.case_count || a.category.localeCompare(b.category))
    .slice(0, 10);
}

function recurringPatternLine(pattern) {
  return `${pattern.category}: ${pattern.case_count} cases across ${pattern.run_count} runs and ${pattern.agent_count} agents, severities=${pattern.severities.join("/")}, last_seen=${pattern.last_seen_at}`;
}

function learningInsightLine(insight) {
  return `${String(insight.severity).toUpperCase()} - ${insight.title}: ${insight.recommended_action} [insight: ${insight.id}]`;
}

function learningRuleLine(rule) {
  const effect = rule.rule_type === "suppress_suggestion_pattern"
    ? "suppress"
    : rule.rule_type === "trust_suggestion_pattern"
      ? "trust"
      : "certification";
  const pattern = rule.pattern_json || {};
  const target = pattern.suggestion_type || pattern.recommended_action || pattern.blocker_code || "pattern";
  return `${effect.toUpperCase()} - ${target} "${pattern.title || pattern.blocker_code || rule.pattern_key}" with confidence ${Number(rule.confidence || 0).toFixed(2)} [rule: ${rule.id}]`;
}

function learningRuleReviewLine(rule) {
  const source = rule.review?.source || "unknown";
  const affected = Number(rule.review?.affected_action_count || 0) + Number(rule.review?.affected_policy_work_item_count || 0);
  return `${rule.rule_type}: source=${source}, decision=${rule.review?.suggested_review_decision || "unknown"}, affected=${affected}, confidence=${Number(rule.confidence || 0).toFixed(2)} [rule: ${rule.id}]`;
}

function policyDryRunLine(result) {
  const state = result.enabled ? "enabled rule" : "disabled draft";
  const topMatch = result.matches[0]
    ? `${result.matches[0].run_id}, risk=${result.matches[0].risk_score}`
    : "none";
  const review = result.review_packet
    ? `review=${result.review_packet.review_readiness}, recommended=${result.review_packet.recommended_review_status}`
    : "review=unknown";
  return `${result.name}: ${result.match_count} historical runs would match this ${state}; top match=${topMatch}; ${review} [policy: ${result.policy_rule_id}]`;
}

function policyReviewPacketLine(result) {
  const packet = result.review_packet;
  if (!packet) {
    return `${result.name}: no review packet [policy: ${result.policy_rule_id}]`;
  }
  return `${result.name}: readiness=${packet.review_readiness}, recommended_status=${packet.recommended_review_status}, samples=${packet.evidence_summary.sample_run_ids.join(", ") || "none"}, false_positive_risk=${packet.evidence_summary.false_positive_risk} [policy: ${result.policy_rule_id}]`;
}

function policyReviewTaskLine(task) {
  return `${task.task?.title || "Review policy draft"}: priority=${task.priority}, readiness=${task.review_readiness}, recommended=${task.recommended_review_status}, samples=${(task.task?.sample_run_ids || []).join(", ") || "none"} [task: ${task.id}, policy: ${task.policy_rule_id}]`;
}

function policyReviewWorkItemEventLine(event) {
  return `${event.work_item_id}: ${event.event_type}, actor=${event.actor_type}${event.actor_id ? `/${event.actor_id}` : ""}, mutates_state=${event.evidence?.mutates_state ? "true" : "false"} [event: ${event.id}, policy: ${event.policy_rule_id}]`;
}

function policyReviewWorkItemEffectivenessLine(item) {
  return `${item.work_item_id}: ${item.effectiveness_status}, score=${item.source_readiness_score} -> ${item.current_readiness_score} (${item.readiness_score_delta >= 0 ? "+" : ""}${item.readiness_score_delta}), blocker_cleared=${item.blocker_cleared ? "true" : "false"} [effectiveness: ${item.id}, event: ${item.policy_review_work_item_event_id}]`;
}

function policyRuleReviewCandidateLine(candidate) {
  return `${candidate.policy_rule_id}: ${candidate.from_review_status} -> ${candidate.recommended_review_status}, status=${candidate.status}, reviewer_required=${candidate.candidate?.reviewer_decision_required ? "yes" : "no"} [candidate: ${candidate.id}, task: ${candidate.policy_review_task_id}]`;
}

function publicPolicyDryRunResult(result) {
  const { evidence_matches: _evidenceMatches, ...publicResult } = result;
  return publicResult;
}

function policyDryRunEvidenceLine(evidence) {
  return `${evidence.name}: ${evidence.match_evidence_count} stored match evidence rows, ${evidence.high_risk_match_count} high-risk [dry-run: ${evidence.policy_dry_run_id}, policy: ${evidence.policy_rule_id}]`;
}

function evalReplayGateLines(gate) {
  if (!gate?.has_eval_run) {
    return ["No eval replay has been run yet."];
  }

  return [
    `Latest eval run: ${gate.eval_run_id}`,
    `Gate decision: ${gate.gate_decision}`,
    `Cases: ${gate.total_cases}`,
    `Passed: ${gate.pass_count}`,
    `Failed: ${gate.fail_count}`,
    `Regressions: ${gate.regression_count}`,
    `Pass rate: ${(Number(gate.pass_rate || 0) * 100).toFixed(1)}%`,
  ];
}

function promptPromotionCheckLine(item) {
  const metadata = item.metadata_json || {};
  const coverageGate = metadata.eval_coverage_gate?.decision
    ? `, coverage_gate=${metadata.eval_coverage_gate.decision}`
    : "";
  const coverageSummary = metadata.eval_coverage?.summary
    ? `, coverage missing=${metadata.eval_coverage.summary.missing_eval_taxonomy_count || 0}, unreplayed=${metadata.eval_coverage.summary.not_replayed_taxonomy_count || 0}, regressions=${metadata.eval_coverage.summary.regression_taxonomy_count || 0}`
    : "";
  return `${metadata.prompt_name || item.target_id}: ${metadata.promotion_decision || "unknown"} -> ${metadata.resulting_status || "unknown"}${coverageGate}${coverageSummary} [evidence: ${item.id}, prompt: ${item.target_id}]`;
}

function autonomyGateCheckLine(item) {
  const metadata = item.metadata_json || {};
  const blockers = metadata.blockers?.length ? `, blockers=${metadata.blockers.length}` : "";
  const remediation = metadata.remediation_plan?.summary
    ? `, remediation open=${metadata.remediation_plan.summary.open_item_count || 0}, blocking=${metadata.remediation_plan.summary.blocking_item_count || 0}`
    : "";
  const coverage = metadata.eval_coverage?.summary
    ? `, coverage missing=${metadata.eval_coverage.summary.missing_eval_taxonomy_count || 0}, unreplayed=${metadata.eval_coverage.summary.not_replayed_taxonomy_count || 0}, regressions=${metadata.eval_coverage.summary.regression_taxonomy_count || 0}`
    : "";
  return `${item.target_id}: ${metadata.gate_decision || "unknown"}, allowed=${Boolean(metadata.autonomy_allowed)}${blockers}${remediation}${coverage} [evidence: ${item.id}]`;
}

function autonomyRemediationLine(item) {
  return `${String(item.severity || "medium").toUpperCase()} - ${item.title}: ${item.action} Verify with ${item.verification_evidence?.join(", ") || "updated gate evidence"} [${item.remediation_id}]`;
}

function incidentReportLine(item) {
  const runs = (item.related_run_ids || []).join(", ");
  return `${item.title} (${item.severity}, status=${item.remediation_status}, root=${item.root_cause_category || "unknown"}) [incident: ${item.id}, runs: ${runs}]`;
}

function incidentRemediationEventLine(item) {
  const note = item.note ? `, note=${item.note}` : "";
  return `${item.incident_report_id}: ${item.from_status} -> ${item.to_status} by ${item.actor_type}${item.actor_id ? `:${item.actor_id}` : ""}${note} [event: ${item.id}]`;
}

function ingestionHealthLines(health = {}) {
  return [
    `Accepted ingestion events: ${health.accepted_events || 0}`,
    `Duplicate retry events: ${health.duplicate_events || 0}`,
    `Signature coverage: ${((health.signature_coverage_rate || 0) * 100).toFixed(1)}%`,
    `Duplicate rate: ${((health.duplicate_rate || 0) * 100).toFixed(1)}%`,
    `Last ingested at: ${health.last_ingested_at || "none"}`,
    `Active ingestion keys observed: ${(health.api_keys || []).length}`,
  ];
}

function dataGovernanceLines(governance = {}) {
  const summary = governance.summary || {};
  return [
    `Policy mode: ${governance.mode || "unknown"}`,
    `Policy version: ${governance.policy_version || "unknown"}`,
    `Total governed records: ${summary.total_records || 0}`,
    `Assets within policy: ${summary.within_policy_count || 0}`,
    `Assets due for archive review: ${summary.archive_due_count || 0}`,
    `Assets due for retention review: ${summary.retention_due_count || 0}`,
    `Guardrail: ${(governance.guardrails || [])[0] || "Phase 1 is advisory only."}`,
  ];
}

function evalCoverageLines(coverage = {}) {
  const summary = coverage.summary || {};
  return [
    `Taxonomies with failures: ${summary.taxonomy_count || 0}`,
    `Failure cases: ${summary.failure_count || 0}`,
    `Eval cases: ${summary.eval_case_count || 0}`,
    `Failure-to-eval ratio: ${((summary.failure_to_eval_ratio || 0) * 100).toFixed(1)}%`,
    `Replay coverage: ${((summary.replay_coverage_rate || 0) * 100).toFixed(1)}%`,
    `Missing eval taxonomies: ${summary.missing_eval_taxonomy_count || 0}`,
    `Not replayed taxonomies: ${summary.not_replayed_taxonomy_count || 0}`,
    `Regression taxonomies: ${summary.regression_taxonomy_count || 0}`,
  ];
}

function evalBacklogLine(item) {
  return `${String(item.priority || "low").toUpperCase()} - ${item.taxonomy_code}: ${item.blocker_type}, failures=${item.failure_count}, evals=${item.eval_case_count}, replayed=${item.replayed_case_count}, regressions=${item.regression_count}. Next: ${item.next_step}`;
}

function evalBacklogSummaryLines(backlog = {}) {
  const summary = backlog.summary || {};
  return [
    `Open eval backlog items: ${summary.open_item_count || 0}`,
    `Critical items: ${summary.critical_item_count || 0}`,
    `Missing eval coverage: ${summary.missing_eval_count || 0}`,
    `Needs replay: ${summary.needs_replay_count || 0}`,
    `Replay regressions: ${summary.regression_count || 0}`,
    `Autonomy blockers: ${summary.autonomy_blocker_count || 0}`,
    `Prompt promotion blockers: ${summary.prompt_promotion_blocker_count || 0}`,
  ];
}

function scoreSummaryLine(score) {
  return `${score.target_type}:${score.target_id} autonomy=${score.autonomy_readiness_score}/100, reliability=${score.reliability_score}/100, risk_control=${score.risk_exposure_score}/100, status=${score.readiness_status} [score: ${score.id}]`;
}

function scoreReasonLine(reason) {
  return reason;
}

function certificationRoadmapLine(roadmap) {
  return `${roadmap.agent_id}: score=${roadmap.current_score}/${roadmap.target_score}, target=${roadmap.target_autonomy_level}, gate=${roadmap.current_gate_status}, state=${roadmap.certification_state?.current_state || "unknown"}, blocked_by=${roadmap.blocked_by}, estimated_after=${roadmap.estimated_score_after_plan}`;
}

function scoreBreakdownLine(roadmap) {
  const dimensions = roadmap.score_breakdown?.dimensions || {};
  return [
    `Reliability ${dimensions.reliability_score?.score ?? 0}`,
    `Eval confidence ${dimensions.eval_confidence_score?.score ?? 0}`,
    `Risk control ${dimensions.risk_control_score?.score ?? 0}`,
    `Human review ${dimensions.human_review_dependency_score?.score ?? 0}`,
    `Incident ${dimensions.incident_score?.score ?? 0}`,
    `Cost stability ${dimensions.cost_stability_score?.score ?? 0}`,
  ].join(", ");
}

function certificationObjectiveLine(objective) {
  return `${String(objective.severity || "medium").toUpperCase()} - ${objective.title}: ${objective.current_value} -> ${objective.target_value}, +${objective.expected_score_delta} expected points. Verify: ${(objective.verification_requirements || []).join("; ")}`;
}

function certificationReviewRequestLine(request) {
  return `${request.agent_id}: status=${request.request_status}, state=${request.certification_state}, score=${request.current_score}/${request.target_score}, reviewer_decision=${request.reviewer_decision?.decision || "none"}, audit_evidence=${request.audit_evidence_item_id || "none"} [request: ${request.id}]`;
}

function certificationEvidenceTaskLine(task) {
  return `${task.agent_id}: ${task.severity} ${task.task_type} - ${task.title}, status=${task.status}, evidence=${(task.required_evidence || []).join("; ")} [task: ${task.id}]`;
}

function certificationActionQueueLine(action) {
  return `${action.agent_id}: priority=${action.priority}, action=${action.recommended_action}, blocker=${action.blocker_code}, task=${action.certification_evidence_task_id || "none"}, status=${action.status}, reason=${action.reason} [action: ${action.id}]`;
}

function trendLine(label, current, previous, delta, options = {}) {
  if (options.rate) {
    return `${label}: ${ratePct(current)} vs ${ratePct(previous)} previous (${signedNumber(delta * 100, 1)} pp)`;
  }

  if (options.money) {
    return `${label}: $${Number(current || 0).toFixed(4)} vs $${Number(previous || 0).toFixed(4)} previous (${signedNumber(delta, 4)})`;
  }

  return `${label}: ${current} vs ${previous} previous (${signedNumber(delta)})`;
}

export function generateNightlyReport(projectId, dateString, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const reportId = createId("report");
    const createdAt = options.createdAt || nowIso();
    const { start, end } = dayRange(dateString);
    const previousRange = dayRange(previousDateString(dateString));
    const runRows = queryRunsForRange(db, projectId, start, end);
    const judgementRows = queryJudgementsForRange(db, projectId, start, end);
    const evalCountsByAgent = queryEvalCaseCountsByAgent(db, projectId);
    const evalCaseCount = Array.from(evalCountsByAgent.values()).reduce((sum, count) => sum + count, 0);
    const evalReplayGate = latestEvalReplayGate(projectId, { db, skipMigrate: true, before: end });
    const previousRunRows = queryRunsForRange(db, projectId, previousRange.start, previousRange.end);
    const previousJudgementRows = queryJudgementsForRange(db, projectId, previousRange.start, previousRange.end);

    const rawSuggestionRows = db.prepare(
      `SELECT
        s.id AS suggestion_id,
        s.type,
        s.severity,
        s.title,
        s.description,
        s.expected_impact,
        s.status,
        s.agent_id,
        s.source_run_judgement_id AS judgement_id,
        r.id AS run_id,
        r.cost AS source_run_cost,
        r.model AS source_run_model,
        r.metadata AS source_run_metadata
       FROM optimization_suggestions s
       JOIN run_judgements j ON j.id = s.source_run_judgement_id
       JOIN agent_runs r ON r.id = j.agent_run_id
       WHERE s.project_id = ? AND r.created_at >= ? AND r.created_at < ?
       ORDER BY s.created_at ASC`
    ).all(projectId, start, end);
    rebuildLearningRulesFromFeedback(db, { projectId, createdAt });
    rebuildLearningRulesFromCertificationEffectiveness(db, { projectId, createdAt });
    rebuildLearningRulesFromPolicyWorkItemEffectiveness(db, { projectId, createdAt });
    const learningRules = listProjectLearningRules(projectId, {
      db,
      skipMigrate: true,
      statuses: ["active", "trusted"],
      limit: 200,
    });
    const learningRuleEvents = listProjectLearningRuleEvents(projectId, {
      db,
      skipMigrate: true,
      limit: 50,
    });
    const learningRuleReview = buildLearningRuleReview(projectId, {
      db,
      skipMigrate: true,
      statuses: ["active", "trusted"],
      limit: 200,
    });
    const learningRulePolicyDrafts = createPolicyRuleDraftsFromTrustedLearningRules(projectId, {
      db,
      skipMigrate: true,
      createdAt,
      actorType: "system",
    });
    const policyRuleEvents = listProjectPolicyRuleEvents(projectId, {
      db,
      skipMigrate: true,
      limit: 50,
    });
    const suggestionRows = applyLearningRulesToSuggestions(rawSuggestionRows, learningRules);

    const currentMetrics = baseMetrics(runRows, judgementRows);
    const previousMetrics = baseMetrics(previousRunRows, previousJudgementRows);
    const previousDayComparison = buildPreviousDayComparison({
      dateString,
      currentMetrics,
      previousMetrics,
    });
    const totalRuns = currentMetrics.total_runs;
    const totalCost = currentMetrics.total_cost;
    const successCount = currentMetrics.success_count;
    const failureCount = currentMetrics.failure_count;
    const highRiskCount = currentMetrics.high_risk_count;
    const costByModel = summarizeCostBy(runRows, "model");
    const costByAgent = summarizeCostBy(runRows, "agent_id");
    const costByTaskType = summarizeCostBy(runRows, runTaskType);
    const topExpensiveRuns = runRows
      .map((row) => ({
        run_id: row.id,
        agent_id: row.agent_id,
        model: row.model,
        task_type: runTaskType(row),
        status: row.status,
        cost: Number(Number(row.cost || 0).toFixed(6)),
        latency: Number(Number(row.latency || 0).toFixed(3)),
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    const allCategories = judgementRows.flatMap((row) => fromJson(row.failure_categories, []));
    const traceItems = judgementRows.map((row) => ({
      run_id: row.run_id,
      judgement_id: row.judgement_id,
      agent_id: row.agent_id,
      status: row.overall_status || "unanalyzed",
      evidence: fromJson(row.evidence, []),
    }));

    const costActions = suggestionRows.filter((action) => action.type === "cost");
    const promptActions = suggestionRows.filter((action) => action.type === "prompt" || action.type === "tool");
    const riskActions = suggestionRows.filter((action) => action.type === "risk");
    const evalActions = suggestionRows.filter((action) => action.type === "eval");
    const actionableCostActions = costActions.filter(isActionableSuggestion);
    const actionablePromptActions = promptActions.filter(isActionableSuggestion);
    const actionableRiskActions = riskActions.filter(isActionableSuggestion);
    const actionableEvalActions = evalActions.filter(isActionableSuggestion);
    const riskyRows = judgementRows
      .filter((row) => row.overall_status === "high_risk" || Number(row.risk_score || 0) >= 75)
      .slice(0, 10);
    const humanReviewRows = judgementRows
      .filter((row) => Boolean(row.needs_human_review))
      .slice(0, 10);

    const topFailureCategories = topCounts(allCategories);
    const topFailureTaxonomies = queryFailureTaxonomyCounts(db, projectId, start, end);
    const promptPromotionChecks = listProjectPromptPromotionChecks(projectId, {
      db,
      skipMigrate: true,
      limit: 5,
    });
    const autonomyGateChecks = listProjectAutonomyGateChecks(projectId, {
      db,
      skipMigrate: true,
      limit: 1,
    });
    const suggestionSeverityCounts = countsBy(suggestionRows, "severity", ["high", "medium", "low"]);
    const suggestionStatusCounts = countsBy(suggestionRows, "status", ["open", "approved", "useful", "not_useful", "rejected", "wrong"]);
    const costOpportunity = summarizeCostOpportunity(actionableCostActions);
    const recurringFailurePatterns = recentFailurePatterns(db, projectId, end);
    const incidentReports = generateIncidentReportsForPeriod(projectId, start, end, {
      db,
      skipMigrate: true,
      createdAt,
    });
    const incidentRemediationEvents = listProjectIncidentRemediationEvents(projectId, {
      db,
      skipMigrate: true,
      incidentIds: incidentReports.map((incident) => incident.id),
      limit: 20,
    });
    const ingestionHealth = summarizeProjectIngestionHealth(projectId, {
      db,
      skipMigrate: true,
      from: start,
      to: end,
    });
    const targetAutonomyLevel = normalizeAutonomyLevel(options.targetAutonomyLevel || "L2");
    const productionCertificationPolicy = productionCertificationPolicyForLevel(targetAutonomyLevel);
    const dataProvenance = summarizeDataProvenance(db, projectId, start, end, runRows, {
      targetAutonomyLevel,
      productionCertificationPolicy,
    });
    const dataGovernance = summarizeProjectDataGovernance(projectId, {
      db,
      skipMigrate: true,
      asOf: createdAt,
    });
    const evalCoverage = summarizeProjectEvalCoverage(projectId, {
      db,
      skipMigrate: true,
    });
    const evalBacklog = buildProjectEvalBacklog(projectId, {
      db,
      skipMigrate: true,
      evalCoverage,
    });
    const policyDryRun = dryRunPolicyRules(projectId, dateString, {
      db,
      skipMigrate: true,
      includeEnabled: false,
      includeEvidenceMatches: true,
      matchLimit: 10,
    });
    const publicPolicyDryRunResults = policyDryRun.results.map(publicPolicyDryRunResult);
    const policyDryRunEvidenceCount = policyDryRun.results.length;
    const policyDryRunMatchEvidenceCount = policyDryRun.results.reduce(
      (sum, result) => sum + (result.evidence_matches || result.matches || []).length,
      0
    );
    const reliabilityScoreSet = buildReliabilityScoreSet({
      projectId,
      reportId,
      periodStart: start,
      periodEnd: end,
      judgementRows,
      evalCaseCount,
      evalCountsByAgent,
      evalReplayGate,
      policyDryRunSummary: policyDryRun.summary,
      createdAt,
    });
    const learningInsightsBeforePersist = buildLearningInsights(db, {
      projectId,
      reportId,
      periodStart: start,
      periodEnd: end,
      recurringFailurePatterns,
      costOpportunity,
      createdAt,
    });
    const learningAssetsBeforeReport = learningAssetSummary(db, projectId);
    const learningAssets = {
      ...learningAssetsBeforeReport,
      learning_insights: learningAssetsBeforeReport.learning_insights + learningInsightsBeforePersist.length,
      reliability_scores: learningAssetsBeforeReport.reliability_scores + reliabilityScoreSet.all_scores.length,
      score_snapshots: learningAssetsBeforeReport.score_snapshots + reliabilityScoreSet.all_scores.length,
      policy_dry_runs: learningAssetsBeforeReport.policy_dry_runs + policyDryRunEvidenceCount,
      policy_dry_run_matches: learningAssetsBeforeReport.policy_dry_run_matches + policyDryRunMatchEvidenceCount,
      policy_review_tasks: learningAssetsBeforeReport.policy_review_tasks + publicPolicyDryRunResults.length,
      reports: learningAssetsBeforeReport.reports + 1,
    };
    const nextActions = buildNextActions({
      humanReviewRows,
      costActions: actionableCostActions,
      promptActions: actionablePromptActions,
      evalActions: actionableEvalActions,
      policyDryRunResults: publicPolicyDryRunResults,
    });
    const markdown = [
      `# Agent Nightly Health Report`,
      ``,
      `Project: ${projectId}`,
      `Period: ${start} to ${end}`,
      ``,
      `## Executive Summary`,
      ``,
      `- Total runs: ${totalRuns}`,
      `- Success: ${successCount}`,
      `- Failed or partial: ${failureCount}`,
      `- High risk: ${highRiskCount}`,
      `- Total cost: $${totalCost.toFixed(4)}`,
      ``,
      `## Autonomy Readiness`,
      ``,
      `- Decision: ${reliabilityScoreSet.project_score.autonomy_decision}`,
      `- Autonomy readiness: ${reliabilityScoreSet.project_score.autonomy_readiness_score}/100`,
      `- Reliability: ${reliabilityScoreSet.project_score.reliability_score}/100`,
      `- Cost efficiency: ${reliabilityScoreSet.project_score.cost_efficiency_score}/100`,
      `- Risk exposure control: ${reliabilityScoreSet.project_score.risk_exposure_score}/100`,
      `- Regression stability: ${reliabilityScoreSet.project_score.regression_stability_score}/100`,
      `- Human review independence: ${reliabilityScoreSet.project_score.human_review_dependency_score}/100`,
      `- Readiness status: ${reliabilityScoreSet.project_score.readiness_status}`,
      ``,
      `### Score Reasons`,
      ``,
      bulletList(reliabilityScoreSet.project_score.score_reasons.map(scoreReasonLine)),
      ``,
      `### Agent Scores`,
      ``,
      bulletList(reliabilityScoreSet.agent_scores.map(scoreSummaryLine)),
      ``,
      `## Eval Replay Gate`,
      ``,
      bulletList(evalReplayGateLines(evalReplayGate)),
      ``,
      `## Prompt Promotion Checks`,
      ``,
      bulletList(promptPromotionChecks.map(promptPromotionCheckLine)),
      ``,
      `## Autonomy Gate Checks`,
      ``,
      bulletList(autonomyGateChecks.map(autonomyGateCheckLine)),
      ``,
      `## Autonomy Remediation Plan`,
      ``,
      bulletList(autonomyGateChecks.flatMap((check) => check.metadata_json?.remediation_plan?.items || []).map(autonomyRemediationLine)),
      ``,
      `## Incident Reports`,
      ``,
      bulletList(incidentReports.map(incidentReportLine)),
      ``,
      `## Incident Remediation Timeline`,
      ``,
      bulletList(incidentRemediationEvents.map(incidentRemediationEventLine)),
      ``,
      `## Ingestion Health`,
      ``,
      bulletList(ingestionHealthLines(ingestionHealth)),
      ``,
      `## Data Provenance`,
      ``,
      bulletList(dataProvenanceLines(dataProvenance)),
      ``,
      `## Data Governance`,
      ``,
      bulletList(dataGovernanceLines(dataGovernance)),
      ``,
      `## Eval Coverage Map`,
      ``,
      bulletList(evalCoverageLines(evalCoverage)),
      ``,
      `## Eval Backlog`,
      ``,
      bulletList(evalBacklogSummaryLines(evalBacklog)),
      ``,
      `### Eval Backlog Items`,
      ``,
      bulletList(evalBacklog.items.map(evalBacklogLine)),
      ``,
      `## Previous Day Comparison`,
      ``,
      previousDayComparison.has_previous_data
        ? bulletList([
          trendLine("Total runs", currentMetrics.total_runs, previousMetrics.total_runs, previousDayComparison.delta.total_runs),
          trendLine("Success rate", currentMetrics.success_rate, previousMetrics.success_rate, previousDayComparison.delta.success_rate, { rate: true }),
          trendLine("Failure rate", currentMetrics.failure_rate, previousMetrics.failure_rate, previousDayComparison.delta.failure_rate, { rate: true }),
          trendLine("High-risk rate", currentMetrics.high_risk_rate, previousMetrics.high_risk_rate, previousDayComparison.delta.high_risk_rate, { rate: true }),
          trendLine("Total cost", currentMetrics.total_cost, previousMetrics.total_cost, previousDayComparison.delta.total_cost, { money: true }),
        ])
        : `- No previous day runs found for ${previousDayComparison.previous_date}.`,
      ``,
      `## Tomorrow Action Plan`,
      ``,
      bulletList(nextActions.map(nextActionLine)),
      ``,
      `## Compounding Data Assets`,
      ``,
      bulletList(assetSummaryLines(learningAssets)),
      ``,
      `### Feedback Memory`,
      ``,
      bulletList(feedbackSummaryLines(learningAssets)),
      ``,
      `### Recurring Failure Patterns (7 days)`,
      ``,
      bulletList(recurringFailurePatterns.map(recurringPatternLine)),
      ``,
      `## Self-Evolution Memory`,
      ``,
      bulletList(learningInsightsBeforePersist.map(learningInsightLine)),
      ``,
      `### Feedback-Derived Learning Rules`,
      ``,
      bulletList(learningRules.map(learningRuleLine)),
      ``,
      `### Policy Learning Review`,
      ``,
      bulletList((learningRuleReview.learning_rule_review || []).map(learningRuleReviewLine)),
      ``,
      `### Learning Rule Policy Drafts`,
      ``,
      bulletList((learningRulePolicyDrafts.results || []).map((item) => (
        item.created
          ? `${item.learning_rule_id}: created disabled policy draft ${item.policy_rule_id}`
          : `${item.learning_rule_id}: skipped (${item.skipped_reason})`
      ))),
      ``,
      `## Policy Draft Dry Run`,
      ``,
      `- Draft rules: ${policyDryRun.summary.draft_rule_count}`,
      `- Rules with matches: ${policyDryRun.summary.rules_with_matches}`,
      `- Matched historical runs: ${policyDryRun.summary.matched_run_count}`,
      `- High-risk matched runs: ${policyDryRun.summary.high_risk_matched_run_count}`,
      ``,
      bulletList(publicPolicyDryRunResults.map(policyDryRunLine)),
      ``,
      `### Policy Draft Review Packets`,
      ``,
      bulletList(publicPolicyDryRunResults.map(policyReviewPacketLine)),
      ``,
      `### Policy Rule Review Events`,
      ``,
      bulletList(policyRuleEvents.map((event) => `${event.policy_rule_id}: ${event.from_status} -> ${event.to_status}, actor=${event.actor_type}${event.actor_id ? `/${event.actor_id}` : ""} [event: ${event.id}]`)),
      ``,
      `## Top Failure Categories`,
      ``,
      bulletList(topFailureCategories.map((item) => `${item.name}: ${item.count}`)),
      ``,
      `## Top Failure Taxonomy`,
      ``,
      bulletList(topFailureTaxonomies.map((item) => `${item.name}: ${item.count}, confidence=${item.average_confidence}`)),
      ``,
      `## Top Risky Outputs`,
      ``,
      bulletList(riskyRows.map((row) => `${row.run_id}: ${row.reasoning_summary || "High-risk run needs review"}`)),
      ``,
      `## Cost Summary`,
      ``,
      `- Total cost: $${totalCost.toFixed(4)}`,
      `- Average cost per run: $${totalRuns ? (totalCost / totalRuns).toFixed(4) : "0.0000"}`,
      `- Projected 30-day cost at this rate: $${(totalCost * 30).toFixed(4)}`,
      ``,
      `### Cost By Model`,
      ``,
      bulletList(costByModel.map(costBreakdownLine)),
      ``,
      `### Cost By Agent`,
      ``,
      bulletList(costByAgent.map(costBreakdownLine)),
      ``,
      `### Cost By Task Type`,
      ``,
      bulletList(costByTaskType.map(costBreakdownLine)),
      ``,
      `### Top Expensive Runs`,
      ``,
      bulletList(topExpensiveRuns.map((run) => `${run.run_id}: $${run.cost.toFixed(4)}, model=${run.model}, agent=${run.agent_id}, task=${run.task_type}, latency=${run.latency}s, status=${run.status}`)),
      ``,
      `### Cost Opportunity`,
      ``,
      `- Affected runs: ${costOpportunity.affected_run_count}`,
      `- Affected daily cost: $${costOpportunity.affected_cost.toFixed(4)}`,
      `- Estimated daily savings: $${costOpportunity.estimated_daily_savings.toFixed(4)}`,
      `- Estimated 30-day savings: $${costOpportunity.estimated_monthly_savings.toFixed(4)}`,
      `- Assumption: ${costOpportunity.assumption}`,
      ``,
      `## Cost Optimization Suggestions`,
      ``,
      bulletList(costActions.slice(0, 10).map((action) => actionLine(action, action.run_id))),
      ``,
      `## Prompt and Tool Improvement Suggestions`,
      ``,
      bulletList(promptActions.slice(0, 10).map((action) => actionLine(action, action.run_id))),
      ``,
      `## Risk Governance Suggestions`,
      ``,
      bulletList(riskActions.slice(0, 10).map((action) => actionLine(action, action.run_id))),
      ``,
      `## Suggested Eval Cases`,
      ``,
      bulletList(evalActions.slice(0, 10).map((action) => `${action.title} [source run: ${action.run_id}]`)),
      ``,
      `## Human Review Required`,
      ``,
      bulletList(humanReviewRows.map((row) => `${row.run_id}: risk=${row.risk_score}, status=${row.overall_status}`)),
      ``,
      `## Suggestion Quality Signals`,
      ``,
      `### By Severity`,
      ``,
      bulletList(suggestionSeverityCounts.map((item) => `${item.name}: ${item.count}`)),
      ``,
      `### By Status`,
      ``,
      bulletList(suggestionStatusCounts.map((item) => `${item.name}: ${item.count}`)),
      ``,
      `## Traceability`,
      ``,
      bulletList(traceItems.map((item) => `${item.run_id}: judgement=${item.judgement_id || "missing"}, agent=${item.agent_id}, status=${item.status}`)),
      ``,
      `## Evidence Notes`,
      ``,
      `Every item above is derived from stored agent_runs and run_judgements for this period.`,
    ].join("\n");

    const reportJson = {
      project_id: projectId,
      period_start: start,
      period_end: end,
      total_runs: totalRuns,
      success_count: successCount,
      failure_count: failureCount,
      high_risk_count: highRiskCount,
      total_cost: currentMetrics.total_cost,
      average_cost_per_run: currentMetrics.average_cost_per_run,
      success_rate: currentMetrics.success_rate,
      failure_rate: currentMetrics.failure_rate,
      high_risk_rate: currentMetrics.high_risk_rate,
      previous_day_comparison: previousDayComparison,
      cost_by_model: costByModel,
      cost_by_agent: costByAgent,
      cost_by_task_type: costByTaskType,
      top_expensive_runs: topExpensiveRuns,
      projected_30_day_cost: Number((totalCost * 30).toFixed(6)),
      cost_opportunity: costOpportunity,
      learning_assets: learningAssets,
      recurring_failure_patterns: recurringFailurePatterns,
      learning_insights: learningInsightsBeforePersist,
      learning_rules: learningRules,
      learning_rule_review: learningRuleReview,
      learning_rule_events: learningRuleEvents,
      learning_rule_policy_drafts: learningRulePolicyDrafts,
      policy_rule_events: policyRuleEvents,
      autonomy_readiness: {
        project_score: reliabilityScoreSet.project_score,
        agent_scores: reliabilityScoreSet.agent_scores,
      },
      eval_replay_gate: evalReplayGate,
      prompt_promotion_checks: promptPromotionChecks,
      autonomy_gate_checks: autonomyGateChecks,
      incident_reports: incidentReports,
      incident_remediation_events: incidentRemediationEvents,
      ingestion_health: ingestionHealth,
      data_provenance: dataProvenance,
      data_governance: dataGovernance,
      eval_coverage: evalCoverage,
      eval_backlog: evalBacklog,
      policy_dry_run_summary: policyDryRun.summary,
      policy_dry_run_results: publicPolicyDryRunResults,
      policy_dry_run_evidence: [],
      suggestions_suppressed_by_learning_rules: suggestionRows.filter((action) => action.learning_rule_effect === "suppressed").length,
      trusted_suggestion_patterns: suggestionRows.filter((action) => action.learning_rule_effect === "trusted").length,
      suggestion_severity_counts: suggestionSeverityCounts,
      suggestion_status_counts: suggestionStatusCounts,
      next_actions: nextActions,
      top_failure_categories: topFailureCategories,
      top_failure_taxonomies: topFailureTaxonomies,
      cost_suggestions: costActions,
      actionable_cost_suggestions: actionableCostActions,
      prompt_suggestions: promptActions,
      actionable_prompt_suggestions: actionablePromptActions,
      risk_suggestions: riskActions,
      actionable_risk_suggestions: actionableRiskActions,
      eval_suggestions: evalActions,
      actionable_eval_suggestions: actionableEvalActions,
      human_review_required: humanReviewRows.map((row) => row.run_id),
      trace_items: traceItems,
      source_run_ids: runRows.map((row) => row.id),
      source_judgement_ids: judgementRows.map((row) => row.judgement_id).filter(Boolean),
    };

    db.prepare(
      `INSERT INTO reports (
        id, project_id, report_type, period_start, period_end, content_markdown, content_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(reportId, projectId, "nightly_health", start, end, markdown, toJson(reportJson), createdAt);

    const policyDryRunEvidence = persistPolicyDryRunEvidence(db, {
      projectId,
      reportId,
      periodStart: start,
      periodEnd: end,
      results: policyDryRun.results,
      createdAt,
    });
    const policyReviewTasks = createPolicyReviewTasksFromDryRunResults(db, {
      projectId,
      reportId,
      results: publicPolicyDryRunResults,
      dryRunEvidence: policyDryRunEvidence,
      createdAt,
    });
    const policyReviewTaskEvents = listProjectPolicyReviewTaskEvents(projectId, {
      db,
      skipMigrate: true,
      limit: 50,
    });
    const policyRuleReviewCandidates = listProjectPolicyRuleReviewCandidates(projectId, {
      db,
      skipMigrate: true,
      limit: 50,
    });
    const policyRuleReviewCandidateEvents = listProjectPolicyRuleReviewCandidateEvents(projectId, {
      db,
      skipMigrate: true,
      limit: 50,
    });
    const policyRuleIds = listProjectPolicyRules(projectId, {
      db,
      skipMigrate: true,
      limit: 100,
    }).map((rule) => rule.id);
    const policyReviewWorkItemEvents = policyRuleIds.flatMap((policyRuleId) => listPolicyReviewWorkItemEvents(policyRuleId, {
      db,
      skipMigrate: true,
      limit: 50,
    }));
    const policyReviewWorkItemEffectiveness = policyRuleIds.flatMap((policyRuleId) => listPolicyReviewWorkItemEffectiveness(policyRuleId, {
      db,
      skipMigrate: true,
      limit: 50,
    }));
    const persistedReliabilityScores = persistReliabilityScores(db, reliabilityScoreSet);
    const certificationRoadmaps = reliabilityScoreSet.agent_scores.map((score) => buildAndPersistCertificationRoadmap(projectId, score.target_id, {
      db,
      skipMigrate: true,
      reportId,
      dataProvenance,
      windowStart: start,
      windowEnd: end,
      targetAutonomyLevel,
      createdAt,
    }));
    const certificationRechecks = certificationRoadmaps.flatMap((roadmap) => listAutonomyCertificationRechecks(projectId, roadmap.agent_id, {
      db,
      skipMigrate: true,
      limit: 5,
    }));
    const certificationReviewRequests = certificationRoadmaps.flatMap((roadmap) => listCertificationReviewRequests(projectId, roadmap.agent_id, {
      db,
      skipMigrate: true,
      limit: 5,
    }));
    const certificationEvidenceTasks = certificationRoadmaps.flatMap((roadmap) => listCertificationEvidenceTasks(projectId, roadmap.agent_id, {
      db,
      skipMigrate: true,
      limit: 20,
    }));
    const certificationActionQueue = certificationRoadmaps.flatMap((roadmap) => listCertificationActionQueue(projectId, roadmap.agent_id, {
      db,
      skipMigrate: true,
      limit: 20,
      statuses: ["open", "in_progress", "evidence_attached", "reopened", "resolved"],
    }));
    const certificationActionEvents = certificationRoadmaps.flatMap((roadmap) => listProjectCertificationActionEvents(projectId, roadmap.agent_id, {
      db,
      skipMigrate: true,
      limit: 20,
    }));
    const certificationActionEffectiveness = certificationRoadmaps.flatMap((roadmap) => listProjectCertificationActionEffectiveness(projectId, roadmap.agent_id, {
      db,
      skipMigrate: true,
      limit: 20,
    }));
    reportJson.policy_dry_run_evidence = policyDryRunEvidence;
    reportJson.policy_review_tasks = policyReviewTasks;
    reportJson.policy_review_task_events = policyReviewTaskEvents;
    reportJson.policy_review_work_item_events = policyReviewWorkItemEvents;
    reportJson.policy_review_work_item_effectiveness = policyReviewWorkItemEffectiveness;
    reportJson.policy_rule_review_candidates = policyRuleReviewCandidates;
    reportJson.policy_rule_review_candidate_events = policyRuleReviewCandidateEvents;
    reportJson.reliability_score_evidence = persistedReliabilityScores;
    reportJson.autonomy_certification_roadmaps = certificationRoadmaps;
    reportJson.autonomy_certification_rechecks = certificationRechecks;
    reportJson.certification_review_requests = certificationReviewRequests;
    reportJson.certification_evidence_tasks = certificationEvidenceTasks;
    reportJson.certification_action_queue = certificationActionQueue;
    reportJson.certification_action_events = certificationActionEvents;
    reportJson.certification_action_effectiveness = certificationActionEffectiveness;
    const finalMarkdown = [
      markdown,
      ``,
      `### Policy Dry-Run Evidence`,
      ``,
      bulletList(policyDryRunEvidence.map(policyDryRunEvidenceLine)),
      ``,
      `### Policy Review Task Queue`,
      ``,
      bulletList(policyReviewTasks.map(policyReviewTaskLine)),
      ``,
      `### Policy Review Task Events`,
      ``,
      bulletList(policyReviewTaskEvents.map((event) => `${event.policy_review_task_id}: ${event.from_status} -> ${event.to_status}, actor=${event.actor_type}${event.actor_id ? `/${event.actor_id}` : ""} [event: ${event.id}]`)),
      ``,
      `### Policy Review Work Item Events`,
      ``,
      bulletList(policyReviewWorkItemEvents.map(policyReviewWorkItemEventLine)),
      ``,
      `### Policy Review Work Item Effectiveness`,
      ``,
      bulletList(policyReviewWorkItemEffectiveness.map(policyReviewWorkItemEffectivenessLine)),
      ``,
      `### Policy Rule Review Candidates`,
      ``,
      bulletList(policyRuleReviewCandidates.map(policyRuleReviewCandidateLine)),
      ``,
      `### Policy Rule Review Candidate Events`,
      ``,
      bulletList(policyRuleReviewCandidateEvents.map((event) => `${event.policy_rule_review_candidate_id}: ${event.from_status} -> ${event.to_status}, actor=${event.actor_type}${event.actor_id ? `/${event.actor_id}` : ""} [event: ${event.id}]`)),
      ``,
      `### Reliability Score Evidence`,
      ``,
      bulletList(persistedReliabilityScores.map((score) => `${score.target_type}:${score.target_id} persisted as ${score.score_id} with snapshot ${score.snapshot_id}`)),
      ``,
      `## Autonomy Certification Roadmap`,
      ``,
      bulletList(certificationRoadmaps.map(certificationRoadmapLine)),
      ``,
      `### Certification Score Breakdown`,
      ``,
      bulletList(certificationRoadmaps.map(scoreBreakdownLine)),
      ``,
      `### Certification Remediation Objectives`,
      ``,
      bulletList(certificationRoadmaps.flatMap((roadmap) => roadmap.remediation_objectives || []).map(certificationObjectiveLine)),
      ``,
      `### Certification Recheck History`,
      ``,
      bulletList(certificationRechecks.map((item) => `${item.agent_id}: ${item.previous_score ?? "none"} -> ${item.new_score}/${item.target_score}, gate=${item.new_gate_status}, blocked_by=${item.new_blocked_by}, evidence=${item.recheck_summary?.evidence_requirement_status || "unknown"}, metrics=${item.recheck_summary?.metric_validation_status || "unknown"} [recheck: ${item.id}]`)),
      ``,
      `### Certification Review Requests`,
      ``,
      bulletList(certificationReviewRequests.map(certificationReviewRequestLine)),
      ``,
      `### Certification Evidence Tasks`,
      ``,
      bulletList(certificationEvidenceTasks.map(certificationEvidenceTaskLine)),
      ``,
      `### Certification Action Queue`,
      ``,
      bulletList(certificationActionQueue.map(certificationActionQueueLine)),
    ].join("\n");

    db.prepare("UPDATE reports SET content_markdown = ?, content_json = ? WHERE id = ?")
      .run(finalMarkdown, toJson(reportJson), reportId);

    persistLearningInsights(db, learningInsightsBeforePersist);

    return { report_id: reportId, markdown: finalMarkdown, json: reportJson };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function getReport(reportId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId);
    if (!row) {
      return null;
    }

    return {
      ...row,
      content_json: fromJson(row.content_json, {}),
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listReportsForProject(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
    return db.prepare(
      `SELECT id, project_id, report_type, period_start, period_end, created_at
       FROM reports
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(projectId, limit);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
