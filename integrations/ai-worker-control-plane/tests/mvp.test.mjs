import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fromJson, migrate, openDatabase } from "../src/lib/db.mjs";
import { ingestAgentRun, getAgentRun } from "../src/lib/runs.mjs";
import { analyzeRun, getRunJudgement } from "../src/lib/judge.mjs";
import { generateNightlyReport, getReport, listReportsForProject } from "../src/lib/reports.mjs";
import { buildReportEvidencePack, recordReportEvidencePackExport, verifyEvidencePackIntegrity } from "../src/lib/report-evidence.mjs";
import { summarizeProjectDataGovernance } from "../src/lib/data-governance.mjs";
import { buildReadinessDossier, renderReadinessDossierMarkdown } from "../src/lib/readiness-dossier.mjs";
import {
  buildPolicyGovernanceDossier,
  buildPolicyReviewWorkbench,
  buildPolicyReviewWorkbenchFromDossier,
  evaluatePolicyReviewWorkItemEffectiveness,
  listPolicyReviewWorkItemEffectiveness,
  listPolicyReviewWorkItemEvents,
  recordPolicyReviewWorkItemEvent,
  renderPolicyGovernanceDossierMarkdown,
  renderPolicyReviewWorkbenchMarkdown,
} from "../src/lib/policy-governance-dossier.mjs";
import { summarizeProjectEvalCoverage } from "../src/lib/eval-coverage.mjs";
import { buildProjectEvalBacklog } from "../src/lib/eval-backlog.mjs";
import { runEvalBacklogReplay } from "../src/lib/eval-backlog-replay.mjs";
import { storeFeedback } from "../src/lib/feedback.mjs";
import {
  authenticateIngestionApiKey,
  AuthError,
  createProjectIngestionApiKey,
  listProjectIngestionApiKeys,
  revokeIngestionApiKey,
  signWebhookPayload,
  verifyWebhookSignature,
} from "../src/lib/api-keys.mjs";
import { createAgent, createProject } from "../src/lib/projects.mjs";
import { runNightlyHealthCheck, runNightlyHealthChecksForDate } from "../src/lib/nightly.mjs";
import { createHttpWebhookProvider, deliverReport, listProjectReportDeliveries, listReportDeliveries } from "../src/lib/report-delivery.mjs";
import { getReportHtml, markdownToHtml, renderReportHtml } from "../src/lib/report-rendering.mjs";
import { renderOperatorConsoleHtml } from "../src/lib/operator-console-rendering.mjs";
import { buildOnboardingChecklist, buildOperatorConsolePageHtml, createConsoleAgent, createConsoleProject, createConsoleSampleRun } from "../src/lib/operator-console-page.mjs";
import { reportMarkdownForLocale } from "../src/lib/i18n.mjs";
import { bootstrapLocalWorkspace, recordLocalAgentRun } from "../src/lib/local-workspace.mjs";
import { buildLocalPreviewResult } from "../src/lib/local-preview.mjs";
import { runRetryQueue } from "../src/lib/retries.mjs";
import { listProjectJobEvents } from "../src/lib/job-events.mjs";
import { listProjectIngestionEvents, summarizeProjectIngestionHealth } from "../src/lib/ingestion-events.mjs";
import { listProjectOperationalFailures } from "../src/lib/operations.mjs";
import { listProjectLearningInsights } from "../src/lib/learning-insights.mjs";
import { buildLearningRuleReview, listLearningRuleEvents, listProjectLearningRules, updateLearningRuleStatus } from "../src/lib/learning-rules.mjs";
import {
  dryRunPolicyRules,
  listPolicyDryRunEvidence,
  listPolicyReviewTaskEvents,
  listProjectPolicyRuleReviewCandidateEvents,
  listProjectPolicyRuleReviewCandidates,
  listProjectPolicyReviewTasks,
  updatePolicyRuleReviewCandidateStatus,
  updatePolicyReviewTaskStatus,
} from "../src/lib/policy-dry-run.mjs";
import {
  createPolicyRuleDraftFromLearningRule,
  listPolicyRuleEvents,
  listProjectPolicyRules,
  updatePolicyRuleReviewStatus,
} from "../src/lib/policy-rules.mjs";
import { getEvalRun, listProjectEvalRuns, runEvalReplay } from "../src/lib/eval-replay.mjs";
import { checkPromptPromotionReadiness, listProjectPromptPromotionChecks } from "../src/lib/prompt-versions.mjs";
import { checkAgentAutonomyGate, listProjectAutonomyGateChecks } from "../src/lib/autonomy-gates.mjs";
import {
  buildAndPersistCertificationRoadmap,
  evaluateCertificationState,
  getCertificationAction,
  listCertificationActionQueue,
  listCertificationActionEvents,
  listCertificationEvidenceTasks,
  listCertificationEvidenceTaskEvents,
  listProjectCertificationActionEffectiveness,
  listProjectCertificationActionEvents,
  listAutonomyCertificationRechecks,
  listObjectiveEvidenceReviews,
  listObjectiveMetricValidations,
  listObjectiveRunClosureAssessments,
  listCertificationReviewDecisions,
  listCertificationReviewRequests,
  listRemediationObjectiveEvents,
  requestCertificationReview,
  reviewObjectiveEvidenceRequirements,
  runAutonomyCertificationRecheck,
  submitCertificationReviewDecision,
  updateCertificationActionStatus,
  updateCertificationEvidenceTaskStatus,
  updateRemediationObjectiveStatus,
} from "../src/lib/autonomy-certification.mjs";
import {
  listIncidentRemediationEvents,
  listProjectIncidentRemediationEvents,
  listProjectIncidentReports,
  updateIncidentRemediation,
} from "../src/lib/incident-reports.mjs";
import { runDemoScenario } from "../src/lib/demo-scenario.mjs";
import {
  getRunJudgementByRunId,
  getRunTrace,
  listProjectEvalCases,
  listProjectFailureCases,
  listProjectRuns,
  listProjectSuggestions,
} from "../src/lib/assets.mjs";
import {
  createReportSubscription,
  deliveryTargetsForProject,
  listReportSubscriptions,
  updateReportSubscription,
} from "../src/lib/report-subscriptions.mjs";
import { ValidationError, validateReportDeliveryPayload, validateRunPayload } from "../src/lib/validation.mjs";
import {
  READINESS_POLICY_VERSION,
  productionCertificationPolicyForLevel,
} from "../src/lib/certification-policies.mjs";

function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "aiwc-"));
  const dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  migrate(db);

  return {
    dir,
    dbPath,
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function sampleRun(overrides = {}) {
  return {
    project_id: "project_alpha",
    agent_id: "agent_support",
    run_id_external: "external_1",
    input: "Help the user check an order.",
    output: "Order status returned successfully.",
    model: "gpt-5.5",
    provider: "openai",
    tools_used: ["order_lookup"],
    cost: 0.12,
    latency: 8.4,
    status: "completed",
    metadata: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
    ...overrides,
  };
}

test("run validation rejects missing required fields", () => {
  assert.throws(
    () => validateRunPayload({ project_id: "project_alpha" }),
    ValidationError
  );
});

test("certification state machine keeps autonomy advisory-only", () => {
  const hardAndScore = evaluateCertificationState({
    hardBlockers: [{ code: "recent_high_risk_judgement" }],
    scoreBlockers: [{ code: "autonomy_readiness_below_target" }],
    currentScore: 49,
    targetScore: 60,
  });
  assert.equal(hardAndScore.current_state, "blocked_by_hard_and_score");
  assert.equal(hardAndScore.can_request_human_review, false);
  assert.equal(hardAndScore.can_grant_autonomy, false);

  const ready = evaluateCertificationState({
    hardBlockers: [],
    scoreBlockers: [],
    evidenceRequirementStatus: "evidence_requirements_satisfied",
    metricValidationStatus: "no_verified_metric_conflicts",
    runClosureStatus: "run_metrics_support_closure",
    currentScore: 82,
    targetScore: 60,
  });
  assert.equal(ready.current_state, "ready_for_human_review");
  assert.equal(ready.can_request_human_review, true);
  assert.equal(ready.can_grant_autonomy, false);

  const evidenceIncomplete = evaluateCertificationState({
    hardBlockers: [],
    scoreBlockers: [],
    evidenceRequirementStatus: "evidence_requirements_incomplete",
  });
  assert.equal(evidenceIncomplete.current_state, "evidence_incomplete");
  assert.equal(evidenceIncomplete.required_actions.length >= 1, true);
});

test("ingestAgentRun stores a valid run and returns run_id", () => {
  const { db, cleanup } = createTestDb();

  try {
    const result = ingestAgentRun(sampleRun(), { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" });
    assert.match(result.run_id, /^run_/);

    const stored = getAgentRun(result.run_id, { db, skipMigrate: true });
    assert.equal(stored.project_id, "project_alpha");
    assert.deepEqual(stored.tools_used, ["order_lookup"]);
  } finally {
    cleanup();
  }
});

test("ingestAgentRun is idempotent by project agent and external run id", () => {
  const { db, cleanup } = createTestDb();

  try {
    const first = ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
    });
    const retry = ingestAgentRun(sampleRun({ output: "Retried sender payload" }), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:01:00.000Z",
    });

    assert.equal(retry.run_id, first.run_id);
    assert.equal(first.deduplicated, false);
    assert.equal(retry.deduplicated, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get().count, 1);
    const duplicateAudit = db.prepare("SELECT metadata FROM audit_events WHERE action = ?").get("agent_run.duplicate_ignored");
    assert.ok(duplicateAudit);
    assert.equal(fromJson(duplicateAudit.metadata).deduplicated, true);
  } finally {
    cleanup();
  }
});

test("ingestion audit metadata records key signature and source evidence", () => {
  const { db, cleanup } = createTestDb();

  try {
    const result = ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
      authContext: {
        api_key_id: "key_live_123",
        source: "webhook",
        signature: {
          verified: true,
          required: true,
          age_seconds: 1.25,
        },
      },
    });

    const audit = db.prepare("SELECT metadata FROM audit_events WHERE action = ? AND target_id = ?")
      .get("agent_run.ingested", result.run_id);
    const metadata = fromJson(audit.metadata);
    assert.equal(metadata.api_key_id, "key_live_123");
    assert.equal(metadata.signature_verified, true);
    assert.equal(metadata.signature_required, true);
    assert.equal(metadata.signature_age_seconds, 1.25);
    assert.equal(metadata.ingestion_source, "webhook");
    assert.equal(metadata.deduplicated, false);
  } finally {
    cleanup();
  }
});

test("project ingestion events expose signed and deduplicated intake evidence", () => {
  const { db, cleanup } = createTestDb();

  try {
    const first = ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
      authContext: {
        api_key_id: "key_live_123",
        source: "webhook",
        signature: { verified: true, required: true, age_seconds: 0.5 },
      },
    });
    ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:01:00.000Z",
      authContext: {
        api_key_id: "key_live_123",
        source: "webhook",
        signature: { verified: true, required: true, age_seconds: 1 },
      },
    });

    const events = listProjectIngestionEvents("project_alpha", { db, skipMigrate: true });
    assert.equal(events.length, 2);
    assert.equal(events[0].action, "agent_run.duplicate_ignored");
    assert.equal(events[0].target_id, first.run_id);
    assert.equal(events[0].metadata.deduplicated, true);
    assert.equal(events[0].metadata.signature_verified, true);
    assert.equal(events[1].metadata.api_key_id, "key_live_123");

    const deduplicated = listProjectIngestionEvents("project_alpha", {
      db,
      skipMigrate: true,
      deduplicated: true,
    });
    assert.equal(deduplicated.length, 1);
    assert.equal(deduplicated[0].action, "agent_run.duplicate_ignored");

    const signed = listProjectIngestionEvents("project_alpha", {
      db,
      skipMigrate: true,
      signatureVerified: true,
    });
    assert.equal(signed.length, 2);
  } finally {
    cleanup();
  }
});

test("project ingestion health summarizes signature coverage and retry duplicates", () => {
  const { db, cleanup } = createTestDb();

  try {
    ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
      authContext: {
        api_key_id: "key_live_123",
        source: "webhook",
        signature: { verified: true, required: true, age_seconds: 0.5 },
      },
    });
    ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:01:00.000Z",
      authContext: {
        api_key_id: "key_live_123",
        source: "webhook",
        signature: { verified: true, required: true, age_seconds: 1 },
      },
    });
    ingestAgentRun(sampleRun({ run_id_external: "external_unsigned" }), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:02:00.000Z",
      authContext: {
        api_key_id: "key_live_456",
        source: "webhook",
        signature: { verified: false, required: false },
      },
    });

    const health = summarizeProjectIngestionHealth("project_alpha", {
      db,
      skipMigrate: true,
      from: "2026-05-21T00:00:00.000Z",
      to: "2026-05-22T00:00:00.000Z",
    });

    assert.equal(health.total_events, 3);
    assert.equal(health.accepted_events, 2);
    assert.equal(health.duplicate_events, 1);
    assert.equal(health.signed_events, 2);
    assert.equal(health.unsigned_events, 1);
    assert.equal(health.signature_coverage_rate, 0.666667);
    assert.equal(health.duplicate_rate, 0.333333);
    assert.equal(health.api_keys.length, 2);
    assert.equal(health.api_keys[0].api_key_id, "key_live_123");
  } finally {
    cleanup();
  }
});

test("createProject returns a one-time ingestion API key hash-backed record", () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject(
      { name: "Support Agents", org_name: "Acme AI" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" }
    );

    assert.match(project.project_id, /^project_/);
    assert.match(project.org_id, /^org_/);
    assert.match(project.ingestion_api_key, /^aiwc_live_/);

    const storedKey = db.prepare("SELECT key_hash, key_prefix FROM ingestion_api_keys WHERE id = ?").get(project.ingestion_api_key_id);
    assert.equal(storedKey.key_prefix, project.ingestion_api_key_prefix);
    assert.notEqual(storedKey.key_hash, project.ingestion_api_key);
  } finally {
    cleanup();
  }
});

test("createAgent binds an agent to an existing project", () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject(
      { name: "Support Agents" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" }
    );
    const agent = createAgent(
      { project_id: project.project_id, name: "Support Triage", environment: "production" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:05:00.000Z" }
    );

    assert.match(agent.agent_id, /^agent_/);
    const stored = db.prepare("SELECT name, environment FROM agents WHERE id = ?").get(agent.agent_id);
    assert.equal(stored.name, "Support Triage");
    assert.equal(stored.environment, "production");
  } finally {
    cleanup();
  }
});

test("ingestion API key authenticates project ingestion and rejects wrong keys", () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject(
      { name: "Support Agents" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" }
    );

    const auth = authenticateIngestionApiKey(project.project_id, project.ingestion_api_key, {
      db,
      skipMigrate: true,
      usedAt: "2026-05-21T10:00:00.000Z",
    });

    assert.equal(auth.project_id, project.project_id);
    assert.throws(
      () => authenticateIngestionApiKey(project.project_id, "aiwc_live_wrong", { db, skipMigrate: true }),
      AuthError
    );

    const storedKey = db.prepare("SELECT last_used_at FROM ingestion_api_keys WHERE id = ?").get(project.ingestion_api_key_id);
    assert.equal(storedKey.last_used_at, "2026-05-21T10:00:00.000Z");
  } finally {
    cleanup();
  }
});

test("webhook signatures verify body timestamp and reject tampering", () => {
  const apiKey = "aiwc_live_test_secret";
  const timestamp = "1779408000";
  const body = JSON.stringify(sampleRun());
  const signature = signWebhookPayload(apiKey, body, timestamp);
  const headers = new Headers({
    "x-aiwc-timestamp": timestamp,
    "x-aiwc-signature": signature,
  });

  const verified = verifyWebhookSignature({
    apiKey,
    body,
    headers,
    now: 1779408000 * 1000,
  });

  assert.equal(verified.verified, true);
  assert.throws(
    () => verifyWebhookSignature({
      apiKey,
      body: body.replace("completed", "failed"),
      headers,
      now: 1779408000 * 1000,
    }),
    /Invalid webhook signature/
  );
  assert.throws(
    () => verifyWebhookSignature({
      apiKey,
      body,
      headers,
      now: (1779408000 + 301) * 1000,
    }),
    /timestamp outside tolerance/
  );
  assert.equal(
    verifyWebhookSignature({
      apiKey,
      body,
      headers: new Headers(),
      required: false,
    }).verified,
    false
  );
  assert.throws(
    () => verifyWebhookSignature({
      apiKey,
      body,
      headers: new Headers(),
      required: true,
    }),
    /Missing webhook signature/
  );
});

test("project ingestion API keys can be rotated and listed without secrets", () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject(
      { name: "Support Agents" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" }
    );
    const rotated = createProjectIngestionApiKey(
      project.project_id,
      { name: "Rotated key" },
      { db, skipMigrate: true, createdAt: "2026-05-21T10:00:00.000Z" }
    );

    assert.match(rotated.api_key, /^aiwc_live_/);
    assert.equal(rotated.name, "Rotated key");

    const auth = authenticateIngestionApiKey(project.project_id, rotated.api_key, {
      db,
      skipMigrate: true,
      usedAt: "2026-05-21T10:05:00.000Z",
    });
    assert.equal(auth.api_key_id, rotated.api_key_id);

    const keys = listProjectIngestionApiKeys(project.project_id, { db, skipMigrate: true });
    assert.equal(keys.length, 2);
    assert.equal(keys[0].name, "Rotated key");
    assert.equal(keys[0].status, "active");
    assert.equal(keys[0].api_key, undefined);
    assert.equal(keys[0].key_hash, undefined);
  } finally {
    cleanup();
  }
});

test("revoked ingestion API keys no longer authenticate", () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject(
      { name: "Support Agents" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" }
    );
    const rotated = createProjectIngestionApiKey(
      project.project_id,
      { name: "Temporary key" },
      { db, skipMigrate: true, createdAt: "2026-05-21T10:00:00.000Z" }
    );
    const revoked = revokeIngestionApiKey(rotated.api_key_id, {
      db,
      skipMigrate: true,
      revokedAt: "2026-05-21T11:00:00.000Z",
    });

    assert.equal(revoked.status, "revoked");
    assert.equal(revoked.revoked_at, "2026-05-21T11:00:00.000Z");

    assert.throws(
      () => authenticateIngestionApiKey(project.project_id, rotated.api_key, { db, skipMigrate: true }),
      AuthError
    );

    const originalAuth = authenticateIngestionApiKey(project.project_id, project.ingestion_api_key, { db, skipMigrate: true });
    assert.equal(originalAuth.project_id, project.project_id);
  } finally {
    cleanup();
  }
});

test("authenticated ingestion path requires an existing project and agent", () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject(
      { name: "Support Agents" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" }
    );
    const agent = createAgent(
      { project_id: project.project_id, name: "Support Triage" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:05:00.000Z" }
    );

    const result = ingestAgentRun(
      sampleRun({ project_id: project.project_id, agent_id: agent.agent_id }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );
    assert.match(result.run_id, /^run_/);

    assert.throws(
      () => ingestAgentRun(
        sampleRun({ project_id: project.project_id, agent_id: "agent_missing" }),
        { db, skipMigrate: true, requireExistingScope: true }
      ),
      /Agent not found/
    );
  } finally {
    cleanup();
  }
});

test("analyzeRun stores structured judgement and derived assets", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({ output: "Failed with timeout", cost: 1.25, status: "failed" }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    const result = await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
      judgeClient: async () => ({
        overall_status: "failure",
        success_score: 20,
        risk_score: 30,
        cost_efficiency_score: 35,
        failure_categories: ["tool_error", "cost_anomaly"],
        summary: "The order lookup failed and the run was expensive.",
        evidence: ["The run status was failed.", "Cost exceeded threshold."],
        recommended_actions: [
          {
            type: "tool_fallback",
            severity: "medium",
            title: "Add lookup timeout fallback",
            description: "Retry or degrade gracefully when order lookup times out.",
            expected_impact: "Improves completion rate.",
          },
          {
            type: "cost_optimization",
            severity: "medium",
            title: "Route simple lookups to a smaller model",
            description: "Use a cheaper model for deterministic order lookup flows.",
            expected_impact: "Reduces recurring LLM cost.",
          },
          {
            type: "eval_case",
            severity: "low",
            title: "Create regression case",
            description: "Replay this timeout case after prompt/tool changes.",
            expected_impact: "Prevents repeated regressions.",
          },
        ],
        needs_human_review: false,
      }),
    });

    assert.match(result.judgement_id, /^judgement_/);

    const stored = getRunJudgement(result.judgement_id, { db, skipMigrate: true });
    assert.equal(stored.overall_status, "failure");
    assert.deepEqual(stored.failure_categories, ["tool_error", "cost_anomaly"]);

    const failures = db.prepare("SELECT COUNT(*) AS count FROM failure_cases").get();
    const suggestions = db.prepare("SELECT COUNT(*) AS count FROM optimization_suggestions").get();
    const evals = db.prepare("SELECT COUNT(*) AS count FROM eval_cases").get();
    assert.equal(failures.count, 2);
    assert.equal(suggestions.count, 3);
    assert.equal(evals.count, 1);

    const taxonomyCount = db.prepare("SELECT COUNT(*) AS count FROM failure_taxonomies").get();
    assert.ok(taxonomyCount.count >= 10);
    const taxonomyCodes = db.prepare("SELECT taxonomy_code FROM failure_cases ORDER BY taxonomy_code ASC").all().map((row) => row.taxonomy_code);
    assert.deepEqual(taxonomyCodes, ["cost_overrun_loop", "workflow_state_drift"]);
    const taxonomyEvidence = db.prepare("SELECT taxonomy_evidence_json FROM failure_cases WHERE taxonomy_code = ?").get("workflow_state_drift");
    assert.ok(JSON.parse(taxonomyEvidence.taxonomy_evidence_json).some((item) => item.includes("timeout")));
    const filteredFailureCases = listProjectFailureCases("project_alpha", {
      db,
      skipMigrate: true,
      taxonomyCode: "workflow_state_drift",
    });
    assert.equal(filteredFailureCases.length, 1);
    assert.equal(filteredFailureCases[0].taxonomy_code, "workflow_state_drift");
  } finally {
    cleanup();
  }
});

test("analyzeRun is idempotent by default", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
    });

    const first = await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
    });
    const second = await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:10:00.000Z",
    });

    assert.equal(second.judgement_id, first.judgement_id);
    assert.equal(second.skipped, true);

    const count = db.prepare("SELECT COUNT(*) AS count FROM run_judgements").get();
    assert.equal(count.count, 1);
  } finally {
    cleanup();
  }
});

test("generateNightlyReport summarizes runs, costs, suggestions, and review items", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const previous = ingestAgentRun(
      sampleRun({
        run_id_external: "previous_day_success",
        output: "Completed normally.",
        cost: 1.0,
        metadata: { prompt_tokens: 400, completion_tokens: 100, total_tokens: 500, task_type: "refund_ops" },
      }),
      { db, skipMigrate: true, createdAt: "2026-05-20T02:00:00.000Z" }
    );
    await analyzeRun(previous.run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-20T02:01:00.000Z",
      judgeClient: async () => ({
        overall_status: "success",
        success_score: 95,
        risk_score: 5,
        cost_efficiency_score: 85,
        failure_categories: [],
        summary: "Previous day run completed successfully.",
        evidence: ["The run completed normally."],
        recommended_actions: [],
        needs_human_review: false,
      }),
    });

    const { run_id } = ingestAgentRun(
      sampleRun({
        output: "password token=abc was included and transfer_admin was called",
        tools_used: ["transfer_admin"],
        cost: 2.5,
        metadata: { prompt_tokens: 900, completion_tokens: 200, total_tokens: 1100, task_type: "refund_ops" },
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T02:00:00.000Z" }
    );

    await analyzeRun(run_id, { db, skipMigrate: true, createdAt: "2026-05-21T02:01:00.000Z" });

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    assert.match(report.report_id, /^report_/);
    assert.equal(report.json.total_runs, 1);
    assert.equal(report.json.high_risk_count, 1);
    assert.equal(report.json.average_cost_per_run, 2.5);
    assert.equal(report.json.success_rate, 0);
    assert.equal(report.json.high_risk_rate, 1);
    assert.equal(report.json.previous_day_comparison.has_previous_data, true);
    assert.equal(report.json.previous_day_comparison.previous_date, "2026-05-20");
    assert.equal(report.json.previous_day_comparison.previous.total_runs, 1);
    assert.equal(report.json.previous_day_comparison.delta.total_cost, 1.5);
    assert.equal(report.json.previous_day_comparison.delta.success_rate, -1);
    assert.equal(report.json.cost_by_model[0].name, "gpt-5.5");
    assert.equal(report.json.cost_by_task_type[0].name, "refund_ops");
    assert.equal(report.json.top_expensive_runs[0].run_id, run_id);
    assert.equal(report.json.top_expensive_runs[0].task_type, "refund_ops");
    assert.equal(report.json.projected_30_day_cost, 75);
    assert.equal(report.json.cost_opportunity.affected_run_count, 1);
    assert.equal(report.json.cost_opportunity.estimated_daily_savings, 0.5);
    assert.equal(report.json.learning_assets.agent_run_traces, 2);
    assert.equal(report.json.learning_assets.outcome_labels, 2);
    assert.ok(report.json.learning_assets.failure_cases >= 1);
    assert.ok(report.json.learning_assets.failure_taxonomies >= 10);
    assert.equal(report.json.learning_assets.cost_events, 2);
    assert.ok(report.json.learning_assets.learning_insights >= 1);
    assert.equal(report.json.learning_assets.policy_rules, 0);
    assert.equal(report.json.learning_assets.reliability_scores, 2);
    assert.equal(report.json.learning_assets.score_snapshots, 2);
    assert.equal(report.json.learning_assets.reports, 1);
    assert.ok(report.json.learning_assets.audit_events >= 4);
    assert.equal(report.json.ingestion_health.total_events, 1);
    assert.equal(report.json.ingestion_health.accepted_events, 1);
    assert.equal(report.json.ingestion_health.duplicate_events, 0);
    assert.equal(report.json.data_provenance.source_type, "webhook_or_api");
    assert.equal(report.json.data_provenance.evidence_trust_level, "production_with_metadata_gaps");
    assert.equal(report.json.data_provenance.readiness_evidence_status, "usable_but_source_metadata_should_be_fixed");
    assert.equal(report.json.data_provenance.total_runs, 1);
    assert.equal(report.json.data_provenance.production_candidate_runs, 1);
    assert.equal(report.json.data_provenance.console_sample_runs, 0);
    assert.equal(report.json.data_provenance.unknown_source_runs, 1);
    assert.equal(report.json.data_provenance.certification_evidence_ready, false);
    assert.deepEqual(
      report.json.data_provenance.production_certification_policy,
      productionCertificationPolicyForLevel("L2")
    );
    assert.equal(report.json.data_provenance.api_key_authentication_coverage_rate, 0);
    assert.equal(report.json.data_provenance.signature_verification_coverage_rate, 0);
    assert.equal(report.json.data_governance.mode, "advisory_only");
    assert.ok(report.json.data_governance.summary.total_records > 0);
    assert.ok(report.json.eval_coverage.summary.failure_count >= 1);
    assert.ok(report.json.eval_coverage.summary.eval_case_count >= 1);
    assert.ok(report.json.eval_backlog.summary.open_item_count >= 1);
    assert.ok(report.json.eval_backlog.items[0].representative_failures.length >= 1);
    assert.equal(report.json.autonomy_readiness.project_score.target_type, "project");
    assert.equal(report.json.autonomy_readiness.project_score.target_id, "project_alpha");
    assert.equal(report.json.autonomy_readiness.project_score.readiness_status, "not_ready");
    assert.ok(report.json.autonomy_readiness.project_score.autonomy_readiness_score < 60);
    assert.equal(report.json.autonomy_readiness.agent_scores.length, 1);
    assert.equal(report.json.autonomy_certification_roadmaps.length, 1);
    assert.equal(report.json.autonomy_certification_roadmaps[0].target_autonomy_level, "L2");
    assert.equal(report.json.autonomy_certification_roadmaps[0].target_score, 60);
    assert.equal(report.json.autonomy_certification_roadmaps[0].current_gate_status, "blocked");
    assert.equal(report.json.autonomy_certification_roadmaps[0].blocked_by, "both");
    assert.equal(report.json.autonomy_certification_roadmaps[0].certification_state.current_state, "blocked_by_hard_and_score");
    assert.equal(report.json.autonomy_certification_roadmaps[0].certification_state.can_grant_autonomy, false);
    assert.equal(report.json.autonomy_certification_roadmaps[0].data_provenance.evidence_trust_level, "production_with_metadata_gaps");
    assert.equal(report.json.autonomy_certification_roadmaps[0].certification_state.evidence_inputs.evidence_trust_level, "production_with_metadata_gaps");
    assert.ok(report.json.autonomy_certification_roadmaps[0].hard_blockers.some((item) => item.code === "certification_production_run_count_minimum_failed"));
    assert.ok(report.json.autonomy_certification_roadmaps[0].hard_blockers.some((item) => item.code === "certification_api_key_authentication_coverage_failed"));
    assert.ok(report.json.autonomy_certification_roadmaps[0].hard_blockers.some((item) => item.code === "certification_signature_verification_coverage_failed"));
    assert.match(renderOperatorConsoleHtml({ report_json: report.json }, { locale: "zh-CN" }), /认证状态/);
    assert.equal(report.json.autonomy_certification_roadmaps[0].score_breakdown.scoring_policy_version, READINESS_POLICY_VERSION);
    assert.equal(report.json.autonomy_certification_roadmaps[0].score_breakdown.dimensions.eval_confidence_score.score, 40);
    assert.ok(report.json.autonomy_certification_roadmaps[0].hard_blockers.some((item) => item.code === "recent_high_risk_judgement"));
    assert.ok(report.json.autonomy_certification_roadmaps[0].score_blockers.some((item) => item.code === "autonomy_readiness_below_target"));
    assert.ok(report.json.autonomy_certification_roadmaps[0].remediation_objectives.length >= 1);
    assert.ok(report.json.autonomy_certification_roadmaps[0].remediation_objectives.every((item) => item.current_value));
    assert.ok(report.json.autonomy_certification_roadmaps[0].remediation_objectives.every((item) => item.target_value));
    assert.ok(report.json.autonomy_certification_roadmaps[0].remediation_objectives.every((item) => Number(item.expected_score_delta) > 0));
    assert.ok(report.json.autonomy_certification_roadmaps[0].remediation_objectives.every((item) => item.verification_requirements.length >= 1));
    assert.ok(report.json.autonomy_certification_roadmaps[0].remediation_objectives.every((item) => item.success_criteria.length >= 1));
    assert.equal(report.json.reliability_score_evidence.length, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reliability_scores WHERE source_report_id = ?").get(report.report_id).count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM score_snapshots WHERE report_id = ?").get(report.report_id).count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM readiness_metric_snapshots WHERE project_id = ?").get("project_alpha").count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM readiness_score_snapshots WHERE project_id = ? AND scoring_policy_version = ?").get("project_alpha", READINESS_POLICY_VERSION).count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM autonomy_gate_results WHERE project_id = ?").get("project_alpha").count, 1);
    assert.ok(db.prepare("SELECT COUNT(*) AS count FROM remediation_objectives WHERE project_id = ?").get("project_alpha").count >= 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM autonomy_certification_roadmaps WHERE project_id = ?").get("project_alpha").count, 1);
    const storedPolicy = db.prepare("SELECT config_json FROM readiness_scoring_policies WHERE version = ? AND target_autonomy_level = ?").get(READINESS_POLICY_VERSION, "L2");
    assert.ok(storedPolicy);
    assert.deepEqual(fromJson(storedPolicy.config_json).production_certification_policy, productionCertificationPolicyForLevel("L2"));

    const objectiveId = report.json.autonomy_certification_roadmaps[0].remediation_objectives[0].id;
    const attached = updateRemediationObjectiveStatus(objectiveId, {
      status: "evidence_attached",
      note: "Attached high-risk review evidence.",
      evidence: { evidence_ref: "unit://risk-review" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:10:00.000Z",
    });
    assert.equal(attached.objective.status, "evidence_attached");
    assert.equal(attached.objective_event.from_status, "open");
    assert.equal(attached.objective_event.to_status, "evidence_attached");
    assert.equal(listRemediationObjectiveEvents(objectiveId, { db, skipMigrate: true }).length, 1);
    const missingReview = reviewObjectiveEvidenceRequirements(objectiveId, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:11:00.000Z",
    });
    assert.equal(missingReview.review_status, "requirements_incomplete");
    assert.ok(missingReview.missing_count >= 1);

    const verified = updateRemediationObjectiveStatus(objectiveId, {
      status: "verified",
      evidence: {
        evidence_ref: "unit://verified",
        requirement: report.json.autonomy_certification_roadmaps[0].remediation_objectives[0].verification_requirements[0],
        metric_status: "cleared",
      },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:12:00.000Z",
    });
    assert.equal(verified.objective.status, "verified");
    assert.equal(listRemediationObjectiveEvents(objectiveId, { db, skipMigrate: true }).length, 2);
    const partialReview = reviewObjectiveEvidenceRequirements(objectiveId, {
      db,
      skipMigrate: true,
      persist: true,
      createdAt: "2026-05-22T00:13:00.000Z",
    });
    assert.equal(partialReview.review_status, "requirements_incomplete");
    assert.equal(listObjectiveEvidenceReviews(objectiveId, { db, skipMigrate: true }).length, 1);

    const recheck = runAutonomyCertificationRecheck("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      targetAutonomyLevel: "L2",
      createdAt: "2026-05-22T00:15:00.000Z",
    });
    assert.match(recheck.recheck.id, /^recheck_/);
    assert.equal(recheck.recheck.previous_score, report.json.autonomy_certification_roadmaps[0].current_score);
    assert.equal(recheck.recheck.target_score, 60);
    assert.equal(recheck.recheck.objective_status_summary.by_status.some((item) => item.status === "verified"), true);
    assert.equal(recheck.recheck.recheck_summary.metric_validation_status, "verified_objectives_still_blocked");
    assert.equal(recheck.recheck.recheck_summary.verified_but_unresolved_count, 1);
    assert.equal(recheck.recheck.recheck_summary.evidence_requirement_status, "evidence_requirements_incomplete");
    assert.ok(recheck.recheck.recheck_summary.incomplete_evidence_review_count >= 1);
    assert.equal(recheck.recheck.recheck_summary.run_closure_status, "run_metrics_still_blocked");
    assert.equal(recheck.recheck.recheck_summary.certification_state.current_state, "blocked_by_hard_and_score");
    assert.equal(recheck.recheck.recheck_summary.certification_state.can_request_human_review, false);
    assert.ok(recheck.recheck.recheck_summary.run_closure_still_blocked_count >= 1);
    assert.ok(recheck.objective_evidence_reviews.some((item) => item.review_status === "requirements_incomplete"));
    assert.ok(recheck.objective_run_closure_assessments.some((item) => item.closure_status === "still_blocked"));
    assert.equal(recheck.objective_metric_validations[0].validation_status, "verified_but_metric_unresolved");
    assert.equal(listObjectiveMetricValidations(recheck.recheck.id, { db, skipMigrate: true }).length, 1);
    assert.ok(listObjectiveRunClosureAssessments(recheck.recheck.id, { db, skipMigrate: true }).length >= 1);
    assert.equal(listAutonomyCertificationRechecks("project_alpha", "agent_support", { db, skipMigrate: true }).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM autonomy_gate_recheck_history WHERE project_id = ?").get("project_alpha").count, 1);
    assert.ok(db.prepare("SELECT COUNT(*) AS count FROM remediation_objective_events WHERE project_id = ?").get("project_alpha").count >= 2);
    assert.ok(db.prepare("SELECT COUNT(*) AS count FROM remediation_objectives WHERE project_id = ? AND status = 'superseded'").get("project_alpha").count >= 1);
    assert.ok(db.prepare("SELECT COUNT(*) AS count FROM remediation_objectives WHERE project_id = ? AND agent_id = ? AND status != 'superseded'").get("project_alpha", "agent_support").count <= 9);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM objective_metric_validations WHERE project_id = ?").get("project_alpha").count, 1);
    assert.ok(db.prepare("SELECT COUNT(*) AS count FROM objective_evidence_reviews WHERE project_id = ?").get("project_alpha").count >= 2);
    assert.ok(db.prepare("SELECT COUNT(*) AS count FROM objective_run_closure_assessments WHERE project_id = ?").get("project_alpha").count >= 1);
    const reviewRequest = requestCertificationReview("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      actorType: "test",
      actorId: "operator",
      createdAt: "2026-05-22T00:18:00.000Z",
    });
    assert.match(reviewRequest.id, /^cert_review_/);
    assert.equal(reviewRequest.request_status, "blocked_not_ready");
    assert.equal(reviewRequest.certification_state, "blocked_by_hard_and_score");
    assert.equal(reviewRequest.review_packet.safety_boundary, "advisory_only_no_automatic_autonomy_grant");
    assert.ok(reviewRequest.required_signoffs.length >= 1);
    assert.match(reviewRequest.audit_evidence_item_id, /^evidence_/);
    assert.equal(listCertificationReviewRequests("project_alpha", "agent_support", { db, skipMigrate: true }).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM certification_review_requests WHERE project_id = ?").get("project_alpha").count, 1);
    assert.throws(
      () => submitCertificationReviewDecision(reviewRequest.id, {
        decision: "approve_candidate",
        reviewerActorType: "test",
        reviewerActorId: "reviewer",
      }, { db, skipMigrate: true }),
      /not pending human review/
    );
    const decision = submitCertificationReviewDecision(reviewRequest.id, {
      decision: "request_more_evidence",
      reviewerActorType: "test",
      reviewerActorId: "reviewer",
      rationale: "High-risk blockers and incomplete evidence remain.",
      evidence: { checklist: "unit://review-checklist" },
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:19:00.000Z",
    });
    assert.match(decision.decision.id, /^cert_decision_/);
    assert.equal(decision.decision.to_status, "more_evidence_requested");
    assert.equal(decision.request.request_status, "more_evidence_requested");
    assert.equal(decision.request.reviewer_decision.can_grant_autonomy, false);
    assert.ok(decision.evidence_tasks.length >= 1);
    assert.ok(decision.evidence_tasks.some((item) => item.task_type === "hard_blocker_clearance"));
    assert.ok(decision.evidence_tasks.some((item) => item.task_type === "score_blocker_improvement"));
    assert.ok(decision.evidence_tasks.every((item) => item.required_evidence.length >= 1));
    assert.equal(listCertificationReviewDecisions(reviewRequest.id, { db, skipMigrate: true }).length, 1);
    assert.equal(listCertificationEvidenceTasks("project_alpha", "agent_support", { db, skipMigrate: true }).length, decision.evidence_tasks.length);
    const firstEvidenceTaskId = decision.evidence_tasks[0].id;
    const attachedTask = updateCertificationEvidenceTaskStatus(firstEvidenceTaskId, {
      status: "evidence_attached",
      note: "Attached clean-window evidence draft.",
      evidence: { evidence_ref: "unit://evidence-task" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:19:30.000Z",
    });
    assert.equal(attachedTask.task.status, "evidence_attached");
    assert.equal(attachedTask.task_event.from_status, "open");
    assert.equal(attachedTask.task_event.to_status, "evidence_attached");
    const verifiedTask = updateCertificationEvidenceTaskStatus(firstEvidenceTaskId, {
      status: "verified",
      note: "Task evidence verified for review purposes.",
      evidence: { metric_status: "ready_for_recheck" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:19:40.000Z",
    });
    assert.equal(verifiedTask.task.status, "verified");
    assert.equal(listCertificationEvidenceTaskEvents(firstEvidenceTaskId, { db, skipMigrate: true }).length, 2);
    assert.throws(
      () => updateCertificationEvidenceTaskStatus(firstEvidenceTaskId, { status: "evidence_attached" }, { db, skipMigrate: true }),
      /Invalid certification evidence task transition/
    );
    const taskAwareRecheck = runAutonomyCertificationRecheck("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      targetAutonomyLevel: "L2",
      createdAt: "2026-05-22T00:19:50.000Z",
    });
    assert.equal(taskAwareRecheck.certification_evidence_task_summary.task_review_status, "evidence_tasks_pending");
    assert.equal(taskAwareRecheck.certification_evidence_task_summary.verified_task_count, 1);
    assert.equal(taskAwareRecheck.certification_evidence_task_summary.ready_task_count, 1);
    assert.ok(taskAwareRecheck.certification_evidence_task_summary.pending_task_count >= 1);
    assert.equal(taskAwareRecheck.certification_evidence_task_summary.closure_recommended_count, 0);
    assert.equal(taskAwareRecheck.certification_evidence_task_summary.uncovered_blocker_count, 0);
    assert.ok(taskAwareRecheck.certification_evidence_task_summary.attached_evidence_but_still_blocked_count >= 1);
    assert.ok(taskAwareRecheck.certification_evidence_task_summary.blocker_task_coverage.some((item) => (
      item.has_task &&
      item.has_attached_evidence &&
      item.next_action.action_type === "strengthen_evidence" &&
      item.evidence_recheck_signal.status === "evidence_quality_insufficient"
    )));
    assert.ok(taskAwareRecheck.certification_evidence_task_summary.blocker_task_coverage.some((item) => (
      item.code === "open_critical_incident" &&
      item.has_task &&
      !item.has_attached_evidence &&
      item.next_action.action_type === "attach_evidence"
    )));
    assert.ok(taskAwareRecheck.certification_evidence_task_summary.blocker_next_action_counts.strengthen_evidence >= 1);
    assert.ok(taskAwareRecheck.certification_evidence_task_summary.blocker_next_action_counts.attach_evidence >= 1);
    assert.ok(taskAwareRecheck.certification_evidence_task_summary.evidence_recheck_signal_counts.evidence_quality_insufficient >= 1);
    assert.equal(taskAwareRecheck.certification_action_queue.length, taskAwareRecheck.certification_evidence_task_summary.blocker_task_coverage.length);
    assert.ok(taskAwareRecheck.certification_action_queue.some((item) => item.recommended_action === "strengthen_evidence"));
    assert.ok(taskAwareRecheck.certification_action_queue.some((item) => item.recommended_action === "attach_evidence"));
    assert.equal(
      listCertificationActionQueue("project_alpha", "agent_support", {
        db,
        skipMigrate: true,
        recheckId: taskAwareRecheck.recheck.id,
      }).length,
      taskAwareRecheck.certification_action_queue.length
    );
    const topCertificationAction = taskAwareRecheck.certification_action_queue[0];
    assert.equal(
      getCertificationAction(topCertificationAction.id, { db, skipMigrate: true }).blocker_code,
      topCertificationAction.blocker_code
    );
    const startedCertificationAction = updateCertificationActionStatus(topCertificationAction.id, {
      status: "in_progress",
      note: "Operator started the next certification action.",
      evidence: { source: "test_operator_console" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:19:55.000Z",
    });
    assert.equal(startedCertificationAction.action.status, "in_progress");
    assert.equal(startedCertificationAction.action_event.from_status, "open");
    assert.equal(startedCertificationAction.action_event.to_status, "in_progress");
    assert.equal(startedCertificationAction.action_event.evidence.safety_boundary, "advisory_only_no_automatic_execution");
    const attachedCertificationAction = updateCertificationActionStatus(topCertificationAction.id, {
      status: "evidence_attached",
      note: "Operator attached blocker evidence for later human review.",
      evidence: {
        evidence_ref: "evidence://certification-action/top",
        evidence_target_type: "recheck",
        evidence_target_id: taskAwareRecheck.recheck.id,
      },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:19:56.000Z",
    });
    assert.equal(attachedCertificationAction.action.status, "evidence_attached");
    assert.equal(attachedCertificationAction.action_event.evidence.evidence_target_validated, true);
    assert.equal(attachedCertificationAction.action_event.evidence.evidence_target_validation, "platform_target_verified");
    assert.throws(
      () => updateCertificationActionStatus(topCertificationAction.id, {
        status: "in_progress",
        evidence: {
          evidence_ref: "evidence://missing-eval",
          evidence_target_type: "eval_run",
          evidence_target_id: "eval_run_missing",
        },
      }, { db, skipMigrate: true }),
      /evidence target not found/
    );
    const certificationActionEvents = listCertificationActionEvents(topCertificationAction.id, {
      db,
      skipMigrate: true,
    });
    assert.equal(certificationActionEvents.length, 2);
    assert.ok(listProjectCertificationActionEvents("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
    }).length >= 2);
    assert.equal(certificationActionEvents[0].to_status, "evidence_attached");
    assert.ok(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = ? AND target_id = ?")
      .get("certification_action.status_updated", topCertificationAction.id).count >= 2);
    const resolvedCertificationAction = updateCertificationActionStatus(topCertificationAction.id, {
      status: "resolved",
      note: "Action resolved as an advisory certification task.",
      evidence: { verifier: "test" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:19:57.000Z",
    });
    assert.equal(resolvedCertificationAction.action.status, "resolved");
    assert.throws(
      () => updateCertificationActionStatus(topCertificationAction.id, { status: "evidence_attached" }, { db, skipMigrate: true }),
      /Invalid certification action transition/
    );
    const actionEvidenceAwareRecheck = runAutonomyCertificationRecheck("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      targetAutonomyLevel: "L2",
      createdAt: "2026-05-22T00:19:58.000Z",
    });
    assert.ok(actionEvidenceAwareRecheck.certification_evidence_task_summary.validated_action_evidence_count >= 1);
    assert.ok(actionEvidenceAwareRecheck.certification_evidence_task_summary.validated_action_evidence_coverage.some((item) => (
      item.code === topCertificationAction.blocker_code &&
      item.evidence.evidence.evidence_target_validated === true
    )));
    const validatedActionCoverage = actionEvidenceAwareRecheck.certification_evidence_task_summary.validated_action_evidence_coverage.find((item) => (
      item.code === topCertificationAction.blocker_code
    ));
    assert.ok(validatedActionCoverage.evidence_quality_score >= 60);
    assert.ok(["moderate", "strong"].includes(validatedActionCoverage.evidence_quality_level));
    assert.ok(["platform_evidence_metric_unresolved", "strong_evidence_metric_unresolved"].includes(validatedActionCoverage.evidence_recheck_signal.status));
    assert.equal(validatedActionCoverage.evidence_recheck_signal.accepts_evidence_for_recheck, true);
    assert.ok(actionEvidenceAwareRecheck.certification_evidence_task_summary.validated_action_evidence_quality_average > 0);
    assert.ok(actionEvidenceAwareRecheck.certification_evidence_task_summary.strong_validated_action_evidence_count >= 0);
    assert.ok(actionEvidenceAwareRecheck.certification_evidence_task_summary.weak_validated_action_evidence_count >= 0);
    assert.ok(actionEvidenceAwareRecheck.certification_evidence_task_summary.blocker_task_coverage.some((item) => (
      item.code === topCertificationAction.blocker_code &&
      item.has_validated_action_evidence &&
      item.validated_action_evidence.evidence.evidence_target_id === taskAwareRecheck.recheck.id &&
      item.validated_action_evidence.evidence_quality_score >= 60 &&
      item.next_action.action_type === "rework_remediation" &&
      item.evidence_recheck_signal.accepts_evidence_for_recheck
    )));
    assert.ok(actionEvidenceAwareRecheck.certification_action_effectiveness.length >= 1);
    const actionEffectiveness = actionEvidenceAwareRecheck.certification_action_effectiveness.find((item) => (
      item.certification_action_id === topCertificationAction.id
    ));
    assert.equal(actionEffectiveness.blocker_code, topCertificationAction.blocker_code);
    assert.equal(actionEffectiveness.blocker_persisted, true);
    assert.equal(actionEffectiveness.effectiveness_status, "strong_evidence_no_metric_improvement");
    assert.ok(actionEffectiveness.evidence_quality_score >= 60);
    assert.equal(actionEffectiveness.score_delta, 0);
    assert.ok(listProjectCertificationActionEffectiveness("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      recheckId: actionEvidenceAwareRecheck.recheck.id,
    }).some((item) => item.certification_action_id === topCertificationAction.id));
    assert.throws(
      () => updateCertificationEvidenceTaskStatus(firstEvidenceTaskId, {
        status: "closed",
        require_closure_recommendation: true,
        recheck_id: taskAwareRecheck.recheck.id,
      }, { db, skipMigrate: true }),
      /without a matching closure recommendation/
    );
    assert.equal(taskAwareRecheck.recheck.recheck_summary.certification_evidence_task_status, "evidence_tasks_pending");
    assert.equal(taskAwareRecheck.recheck.recheck_summary.certification_evidence_task_summary.verified_task_count, 1);
    const reportAfterRecheck = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:20:00.000Z",
    });
    assert.ok(reportAfterRecheck.json.autonomy_certification_rechecks.length >= 1);
    assert.equal(reportAfterRecheck.json.certification_review_requests.length, 1);
    assert.equal(reportAfterRecheck.json.certification_review_requests[0].request_status, "more_evidence_requested");
    assert.ok(reportAfterRecheck.json.certification_evidence_tasks.length >= 1);
    assert.ok(reportAfterRecheck.json.learning_assets.certification_evidence_tasks >= decision.evidence_tasks.length);
    assert.equal(reportAfterRecheck.json.learning_assets.certification_evidence_task_events, 2);
    assert.ok(reportAfterRecheck.json.learning_assets.certification_action_queue >= taskAwareRecheck.certification_action_queue.length);
    assert.ok(reportAfterRecheck.json.learning_assets.certification_action_events >= 3);
    assert.ok(reportAfterRecheck.json.learning_assets.certification_action_effectiveness >= 1);
    assert.ok(reportAfterRecheck.json.certification_action_events.length >= 3);
    assert.ok(reportAfterRecheck.json.certification_action_effectiveness.some((item) => item.effectiveness_status === "strong_evidence_no_metric_improvement"));
    assert.ok(reportAfterRecheck.json.learning_rules.some((rule) => (
      rule.rule_type === "flag_certification_action_no_metric_lift" &&
      rule.pattern_json.target === "certification_action_effectiveness" &&
      rule.evidence_json.latest_effectiveness_status === "strong_evidence_no_metric_improvement"
    )));
    const learningAdjustedRecheck = runAutonomyCertificationRecheck("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      targetAutonomyLevel: "L2",
      createdAt: "2026-05-22T00:20:05.000Z",
    });
    const learningAdjustedAction = learningAdjustedRecheck.certification_action_queue.find((item) => (
      item.blocker_code === topCertificationAction.blocker_code
    ));
    assert.ok(learningAdjustedAction.action.learning_priority_adjustment.adjustment < 0);
    assert.ok(learningAdjustedAction.action.learning_priority_adjustment.reasons.some((reason) => (
      reason.rule_type === "flag_certification_action_no_metric_lift"
    )));
    const learningRuleReview = buildLearningRuleReview("project_alpha", {
      db,
      skipMigrate: true,
      status: "active",
    });
    assert.ok(learningRuleReview.summary.certification_effectiveness_rules >= 1);
    assert.ok(learningRuleReview.summary.affected_action_count >= 1);
    assert.ok(learningRuleReview.learning_rule_review.some((rule) => (
      rule.rule_type === "flag_certification_action_no_metric_lift" &&
      rule.review.affected_actions.some((action) => action.id === learningAdjustedAction.id) &&
      rule.review.suggested_review_decision === "review_before_trusting"
    )));
    const noMetricLiftRule = learningRuleReview.learning_rule_review.find((rule) => (
      rule.rule_type === "flag_certification_action_no_metric_lift"
    ));
    const activeDraftAttempt = createPolicyRuleDraftFromLearningRule(db, {
      projectId: "project_alpha",
      learningRuleId: noMetricLiftRule.id,
      actorType: "test",
      actorId: "operator",
      createdAt: "2026-05-22T00:20:05.500Z",
    });
    assert.equal(activeDraftAttempt.created, false);
    assert.equal(activeDraftAttempt.skipped_reason, "learning_rule_not_trusted");
    const trustedLearningRule = updateLearningRuleStatus(noMetricLiftRule.id, {
      status: "trusted",
      note: "Trust this no-metric-lift learning rule so it can become a disabled policy draft.",
      evidence: { source: "unit_test", reason: "operator_reviewed_certification_effectiveness" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:20:05.600Z",
    });
    assert.equal(trustedLearningRule.learning_rule.status, "trusted");
    const learningPolicyDraft = createPolicyRuleDraftFromLearningRule(db, {
      projectId: "project_alpha",
      learningRuleId: noMetricLiftRule.id,
      actorType: "test",
      actorId: "operator",
      createdAt: "2026-05-22T00:20:05.700Z",
    });
    assert.equal(learningPolicyDraft.created, true);
    const learningPolicyRules = listProjectPolicyRules("project_alpha", { db, skipMigrate: true });
    const learningPolicyRule = learningPolicyRules.find((rule) => rule.id === learningPolicyDraft.policy_rule_id);
    assert.equal(learningPolicyRule.enabled, false);
    assert.equal(learningPolicyRule.config_json.source, "trusted_learning_rule");
    assert.equal(learningPolicyRule.config_json.source_learning_rule_id, noMetricLiftRule.id);
    assert.equal(learningPolicyRule.config_json.source_rule_type, "flag_certification_action_no_metric_lift");
    assert.equal(learningPolicyRule.config_json.human_review_required, true);
    assert.equal(learningPolicyRule.config_json.safety_boundary, "advisory_only_no_automatic_execution");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = ? AND target_id = ?")
        .get("policy_rule.draft_created_from_learning_rule", learningPolicyDraft.policy_rule_id).count,
      1
    );
    const reviewedPolicy = updatePolicyRuleReviewStatus(learningPolicyDraft.policy_rule_id, {
      status: "reviewed",
      note: "Operator reviewed the trusted learning rule policy draft.",
      evidence: { source: "unit_test", review_basis: "learning_rule_and_dry_run_pending" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:20:05.750Z",
    });
    assert.equal(reviewedPolicy.policy_rule.review_status, "reviewed");
    assert.equal(reviewedPolicy.policy_rule.enabled, false);
    assert.equal(reviewedPolicy.policy_rule_event.from_status, "draft_review");
    assert.equal(reviewedPolicy.policy_rule_event.to_status, "reviewed");
    assert.equal(reviewedPolicy.policy_rule_event.evidence.enabled_after_transition, false);
    const approvedDryRunPolicy = updatePolicyRuleReviewStatus(learningPolicyDraft.policy_rule_id, {
      status: "approved_for_dry_run",
      note: "Operator approved this draft for repeated dry-run review only.",
      evidence: { source: "unit_test", dry_run_scope: "historical_runs_only" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:20:05.760Z",
    });
    assert.equal(approvedDryRunPolicy.policy_rule.review_status, "approved_for_dry_run");
    assert.equal(approvedDryRunPolicy.policy_rule.enabled, false);
    assert.throws(
      () => updatePolicyRuleReviewStatus(learningPolicyDraft.policy_rule_id, { status: "draft_review" }, { db, skipMigrate: true }),
      /Invalid policy rule review transition/
    );
    assert.equal(listPolicyRuleEvents(learningPolicyDraft.policy_rule_id, { db, skipMigrate: true }).length, 2);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = ? AND target_id = ?")
        .get("policy_rule.review_status_updated", learningPolicyDraft.policy_rule_id).count,
      2
    );
    const trustedRuleReport = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:20:05.800Z",
    });
    assert.ok(trustedRuleReport.json.learning_rule_policy_drafts.results.some((item) => (
      item.learning_rule_id === noMetricLiftRule.id &&
      item.policy_rule_id === learningPolicyDraft.policy_rule_id &&
      item.skipped_reason === "policy_draft_already_exists"
    )));
    assert.ok(trustedRuleReport.json.learning_assets.policy_rules >= 1);
    assert.equal(trustedRuleReport.json.learning_assets.policy_rule_events, 2);
    assert.equal(trustedRuleReport.json.policy_rule_events.length, 2);
    assert.ok(trustedRuleReport.json.policy_dry_run_summary.draft_rule_count >= 1);
    assert.match(trustedRuleReport.markdown, /Learning Rule Policy Drafts/);
    assert.match(trustedRuleReport.markdown, /Policy Rule Review Events/);
    assert.match(renderOperatorConsoleHtml({ report_json: trustedRuleReport.json }, { locale: "zh-CN" }), /学习规则生成策略草案/);
    assert.match(renderOperatorConsoleHtml({ report_json: trustedRuleReport.json }, { locale: "zh-CN" }), /策略草案审核事件/);
    const pausedLearningRule = updateLearningRuleStatus(noMetricLiftRule.id, {
      status: "paused",
      note: "Pause this learning rule until an operator reviews the no-metric-lift pattern.",
      evidence: { source: "unit_test" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:20:06.000Z",
    });
    assert.equal(pausedLearningRule.learning_rule.status, "paused");
    assert.equal(pausedLearningRule.learning_rule_event.from_status, "trusted");
    assert.equal(pausedLearningRule.learning_rule_event.to_status, "paused");
    assert.equal(pausedLearningRule.learning_rule_event.evidence.safety_boundary, "advisory_only_no_automatic_execution");
    assert.equal(listLearningRuleEvents(noMetricLiftRule.id, { db, skipMigrate: true }).length, 2);
    assert.throws(
      () => updateLearningRuleStatus(noMetricLiftRule.id, { status: "trusted" }, { db, skipMigrate: true }),
      /Invalid learning rule transition/
    );
    const pausedRuleRecheck = runAutonomyCertificationRecheck("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      targetAutonomyLevel: "L2",
      createdAt: "2026-05-22T00:20:07.000Z",
    });
    const pausedRuleAction = pausedRuleRecheck.certification_action_queue.find((item) => (
      item.blocker_code === topCertificationAction.blocker_code
    ));
    assert.equal(pausedRuleAction.action.learning_priority_adjustment.adjustment, 0);
    assert.equal(pausedRuleRecheck.recheck.recheck_summary.certification_action_learning_rule_count, 0);
    assert.equal(
      learningAdjustedRecheck.recheck.recheck_summary.certification_action_learning_rule_count >= 1,
      true
    );
    assert.ok(reportAfterRecheck.json.certification_action_events.some((event) => event.evidence.evidence_target_type === "recheck"));
    assert.ok(reportAfterRecheck.json.certification_action_queue.some((item) => item.recommended_action === "rework_remediation"));
    assert.equal(reportAfterRecheck.json.autonomy_certification_rechecks[0].recheck_summary.certification_evidence_task_status, "evidence_tasks_pending");
    assert.ok(reportAfterRecheck.json.autonomy_certification_rechecks[0].recheck_summary.certification_evidence_task_summary.blocker_task_coverage.length >= 1);
    assert.equal(reportAfterRecheck.json.autonomy_certification_rechecks[0].recheck_summary.metric_validation_status, "verified_objectives_still_blocked");
    assert.equal(reportAfterRecheck.json.autonomy_certification_rechecks[0].recheck_summary.run_closure_status, "run_metrics_still_blocked");
    assert.match(renderOperatorConsoleHtml(reportAfterRecheck.json, { locale: "zh-CN" }), /复查历史与证据审核/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /人工认证审核申请/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /补证任务队列/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /补证任务待完成/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /认证阻断作战地图/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /有证据但仍阻断/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /重新修复/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /上传证据/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /认证推进队列/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /认证推进事件/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /认证推进事件时间线/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /认证动作效果追踪/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /强证据但指标无改善/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /标记无指标提升动作/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /学习规则审核/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /认证效果/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /证据类型/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /证据质量/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /复查信号/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /平台证据已验证但指标未解除|强证据但指标未解除/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), new RegExp(taskAwareRecheck.recheck.id));
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /证据引用/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /evidence:\/\/certification-action\/top/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /npm run local:certification-actions/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN", certificationActionForms: true }), /开始处理/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN", certificationActionForms: true }), /证据链接\/编号/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN", certificationActionForms: true }), /证据类型/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN", certificationActionForms: true }), /对象 ID/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN", certificationActionForms: true }), /本地控制台处理/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN", certificationActionForms: true }), /驳回/);
    assert.match(renderOperatorConsoleHtml({ report_json: reportAfterRecheck.json }, { locale: "zh-CN" }), /Verified 但指标未解除/);

    for (let index = 0; index < 10; index += 1) {
      const cleanRun = ingestAgentRun(
        sampleRun({
          run_id_external: `clean_run_${index}`,
          output: "Completed the routine support workflow without risk.",
          cost: 0.2,
        }),
        {
          db,
          skipMigrate: true,
          createdAt: `2026-05-22T0${index}:00:00.000Z`,
          authContext: {
            source: "webhook",
            api_key_id: "api_key_clean_window",
            signature: { verified: true, required: true, age_seconds: 10 },
          },
        }
      );
      await analyzeRun(cleanRun.run_id, {
        db,
        skipMigrate: true,
        createdAt: `2026-05-22T0${index}:01:00.000Z`,
        judgeClient: async () => ({
          overall_status: "success",
          success_score: 98,
          risk_score: 5,
          cost_efficiency_score: 95,
          failure_categories: [],
          summary: "Clean run completed successfully.",
          evidence: ["No risky output or privileged tool call."],
          recommended_actions: [],
          needs_human_review: false,
        }),
      });
    }

    const cleanWindowReport = generateNightlyReport("project_alpha", "2026-05-22", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T11:59:00.000Z",
    });
    assert.equal(cleanWindowReport.json.data_provenance.certification_evidence_ready, true);
    assert.equal(cleanWindowReport.json.autonomy_certification_roadmaps[0].target_autonomy_level, "L2");

    const l3CleanWindowReport = generateNightlyReport("project_alpha", "2026-05-22", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T12:01:00.000Z",
      targetAutonomyLevel: "L3",
    });
    assert.equal(l3CleanWindowReport.json.autonomy_certification_roadmaps[0].target_autonomy_level, "L3");
    assert.equal(l3CleanWindowReport.json.autonomy_certification_roadmaps[0].target_score, 80);
    assert.equal(l3CleanWindowReport.json.data_provenance.production_certification_policy.min_production_candidate_runs, 50);
    assert.equal(l3CleanWindowReport.json.data_provenance.certification_evidence_ready, false);
    assert.ok(l3CleanWindowReport.json.autonomy_certification_roadmaps[0].hard_blockers.some((item) => item.code === "certification_production_run_count_minimum_failed"));

    const cleanWindowRecheck = runAutonomyCertificationRecheck("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      targetAutonomyLevel: "L2",
      windowStart: "2026-05-22T00:00:00.000Z",
      windowEnd: "2026-05-23T00:00:00.000Z",
      createdAt: "2026-05-22T12:00:00.000Z",
    });
    assert.equal(cleanWindowRecheck.new_roadmap.data_provenance.certification_evidence_ready, true);
    assert.ok(!cleanWindowRecheck.new_roadmap.hard_blockers.some((item) => String(item.code).startsWith("certification_")));
    assert.ok(report.json.learning_insights.some((item) => item.insight_type === "cost_learning"));
    assert.ok(report.json.suggestion_severity_counts.some((item) => item.name === "high"));
    assert.ok(report.json.suggestion_status_counts.some((item) => item.name === "open"));
    assert.ok(report.json.top_failure_taxonomies.some((item) => item.name === "permission_escalation_attempt"));
    assert.ok(report.json.next_actions.some((item) => item.type === "human_review"));
    assert.deepEqual(report.json.source_run_ids, [run_id]);
    assert.equal(report.json.trace_items.length, 1);
    assert.match(report.markdown, /Previous Day Comparison/);
    assert.match(report.markdown, /Autonomy Readiness/);
    assert.match(report.markdown, /Should not run unattended yet/);
    assert.match(report.markdown, /Top Failure Taxonomy/);
    assert.match(report.markdown, /Success rate: 0.0% vs 100.0% previous/);
    assert.match(report.markdown, /Tomorrow Action Plan/);
    assert.match(report.markdown, /Compounding Data Assets/);
    assert.match(report.markdown, /Agent run traces: 2/);
    assert.match(report.markdown, /Feedback Memory/);
    assert.match(report.markdown, /Recurring Failure Patterns/);
    assert.match(report.markdown, /Self-Evolution Memory/);
    assert.match(report.markdown, /Cost Optimization Suggestions/);
    assert.match(report.markdown, /Risk Governance Suggestions/);
    assert.match(report.markdown, /Cost By Model/);
    assert.match(report.markdown, /Cost By Task Type/);
    assert.match(report.markdown, /Cost Opportunity/);
    assert.match(report.markdown, /Suggestion Quality Signals/);
    assert.match(report.markdown, /Top Expensive Runs/);
    assert.match(report.markdown, /Human Review Required/);
    assert.match(report.markdown, /Ingestion Health/);
    assert.match(report.markdown, /Accepted ingestion events: 1/);
    assert.match(report.markdown, /Data Provenance/);
    assert.match(report.markdown, /Evidence trust level: production_with_metadata_gaps/);
    assert.match(report.markdown, /Production candidate runs: 1/);
    assert.match(report.markdown, /Unknown-source runs: 1/);
    assert.match(report.markdown, /Data Governance/);
    assert.match(report.markdown, /Policy mode: advisory_only/);
    assert.match(report.markdown, /Eval Coverage Map/);
    assert.match(report.markdown, /Eval Backlog/);
    assert.match(report.markdown, /Autonomy Certification Roadmap/);
    assert.match(report.markdown, /Certification Score Breakdown/);
    assert.match(report.markdown, /Certification Remediation Objectives/);
    assert.match(report.markdown, /Open eval backlog items/);
    assert.match(report.markdown, /Traceability/);

    const chineseReport = reportMarkdownForLocale({ ...report, content_json: report.json }, "zh-CN");
    assert.match(chineseReport, /自主运行认证路线图/);
    assert.match(chineseReport, /量化整改目标/);

    const evidencePack = buildReportEvidencePack(report.report_id, { db, skipMigrate: true });
    assert.equal(evidencePack.report.id, report.report_id);
    assert.equal(evidencePack.summary.total_runs, 1);
    assert.equal(evidencePack.data_provenance.source_type, "webhook_or_api");
    assert.equal(evidencePack.source_runs.length, 1);
    assert.equal(evidencePack.source_runs[0].run.id, run_id);
    assert.equal(evidencePack.derived_evidence.reliability_score_evidence.length, 2);
    assert.match(evidencePack.integrity.evidence_pack_hash, /^[a-f0-9]{64}$/);

    const redactedPack = buildReportEvidencePack(report.report_id, { db, skipMigrate: true, redact: true });
    assert.equal(redactedPack.redaction.mode, "redacted");
    assert.equal(redactedPack.source_runs[0].run.input, "[REDACTED]");
    assert.equal(redactedPack.source_runs[0].run.output, "[REDACTED]");
    assert.match(redactedPack.source_runs[0].run.input_hash, /^[a-f0-9]{64}$/);
    assert.equal(redactedPack.source_runs[0].judgement.reasoning_summary, "[REDACTED]");
    assert.deepEqual(redactedPack.source_runs[0].judgement.evidence, []);
    assert.equal(redactedPack.source_runs[0].run.metadata.redacted, true);
    assert.equal(verifyEvidencePackIntegrity(redactedPack).valid, true);
    assert.equal(verifyEvidencePackIntegrity({
      ...redactedPack,
      summary: { ...redactedPack.summary, total_runs: 999 },
    }).valid, false);

    const exportAudit = recordReportEvidencePackExport(report.report_id, redactedPack, {
      db,
      skipMigrate: true,
      actorType: "test",
      actorId: "operator",
      exportSurface: "unit_test",
      createdAt: "2026-05-21T23:59:30.000Z",
    });
    assert.match(exportAudit.audit_event_id, /^audit_/);
    const auditRow = db.prepare("SELECT * FROM audit_events WHERE id = ?").get(exportAudit.audit_event_id);
    assert.equal(auditRow.action, "report.evidence_pack_exported");
    assert.equal(auditRow.target_id, report.report_id);
    assert.equal(fromJson(auditRow.metadata).redaction_mode, "redacted");

    const governance = summarizeProjectDataGovernance("project_alpha", {
      db,
      skipMigrate: true,
      asOf: "2027-06-01T00:00:00.000Z",
    });
    assert.equal(governance.mode, "advisory_only");
    assert.ok(governance.summary.total_records > 0);
    assert.ok(governance.assets.some((asset) => asset.asset_type === "agent_runs" && asset.status === "retention_due"));
    assert.ok(governance.assets.some((asset) => asset.asset_type === "audit_events" && asset.status === "within_policy"));
    assert.match(governance.guardrails[0], /does not delete/);

    const dossier = buildReadinessDossier(report.report_id, { db, skipMigrate: true });
    assert.equal(dossier.report_id, report.report_id);
    assert.equal(dossier.verdict.verdict, "not_ready_for_unattended_autonomy");
    assert.equal(dossier.executive_summary.high_risk_count, 1);
    assert.match(dossier.trust_evidence.evidence_pack_hash, /^[a-f0-9]{64}$/);
    assert.ok(dossier.blockers.some((item) => item.includes("high-risk")));
    assert.equal(dossier.autonomy_certification_roadmap.target_autonomy_level, "L2");
    assert.equal(dossier.autonomy_certification_roadmap.target_score, 60);
    assert.equal(dossier.autonomy_certification_roadmap.certification_state.current_state, "blocked_by_hard_and_score");
    assert.equal(dossier.autonomy_certification_roadmap.score_breakdown.scoring_policy_version, "readiness_policy_v0.1");
    assert.ok(dossier.autonomy_certification_rechecks.length >= 1);
    const dossierMarkdown = renderReadinessDossierMarkdown(dossier);
    assert.match(dossierMarkdown, /AI Agent Readiness Dossier/);
    assert.match(dossierMarkdown, /Not ready for unattended autonomy/);
    assert.match(dossierMarkdown, /Evidence pack hash/);
    assert.match(dossierMarkdown, /Autonomy Certification Roadmap/);
    assert.match(dossierMarkdown, /Certification state/);
    assert.match(dossierMarkdown, /Required Remediation Objectives/);
    assert.match(dossierMarkdown, /Recheck History/);
    assert.match(dossierMarkdown, /verified_objectives_still_blocked/);
    assert.match(dossierMarkdown, /run_closure=/);
  } finally {
    cleanup();
  }
});

test("eval replay stores replay results and feeds the report gate", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({
        output: "Failed with timeout while calling order_lookup.",
        status: "failed",
        cost: 0.6,
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T08:00:00.000Z" }
    );
    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T08:05:00.000Z",
      judgeClient: async () => ({
        overall_status: "failure",
        success_score: 25,
        risk_score: 25,
        cost_efficiency_score: 70,
        failure_categories: ["tool_error"],
        summary: "The lookup tool timed out.",
        evidence: ["timeout while calling order_lookup"],
        recommended_actions: [
          {
            type: "eval_case",
            severity: "low",
            title: "Replay timeout failure",
            description: "Replay the timeout case before promotion.",
            expected_impact: "Prevents timeout regressions.",
          },
        ],
        needs_human_review: false,
      }),
    });

    const evalCase = db.prepare("SELECT * FROM eval_cases WHERE project_id = ?").get("project_alpha");
    const passing = runEvalReplay("project_alpha", "agent_support", {
      eval_case_ids: [evalCase.id],
      candidate_outputs: {
        [evalCase.id]: "Order lookup returned a fallback response and asked the operator to retry safely.",
      },
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T09:00:00.000Z",
    });

    assert.equal(passing.summary.gate_decision, "passed");
    assert.equal(passing.summary.pass_count, 1);
    assert.equal(passing.replay_results[0].status, "pass");

    const regression = runEvalReplay("project_alpha", "agent_support", {
      eval_case_ids: [evalCase.id],
      candidate_outputs: [
        {
          eval_case_id: evalCase.id,
          actual_output: "Failed again with timeout from order_lookup.",
        },
      ],
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T09:10:00.000Z",
    });

    assert.equal(regression.summary.gate_decision, "blocked_by_regression");
    assert.equal(regression.summary.regression_count, 1);
    assert.equal(getEvalRun(regression.eval_run_id, { db, skipMigrate: true }).replay_results[0].status, "regression");
    assert.equal(listProjectEvalRuns("project_alpha", { db, skipMigrate: true }).length, 2);

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    assert.equal(report.json.eval_replay_gate.eval_run_id, regression.eval_run_id);
    assert.equal(report.json.eval_replay_gate.gate_decision, "blocked_by_regression");
    assert.equal(report.json.eval_replay_gate.regression_count, 1);
    assert.ok(report.json.autonomy_readiness.project_score.score_reasons.some((reason) => reason.includes("Latest eval replay")));
    assert.ok(report.json.autonomy_readiness.project_score.regression_stability_score < 70);
    assert.equal(report.json.learning_assets.eval_runs, 2);
    assert.equal(report.json.learning_assets.replay_results, 2);
    assert.match(report.markdown, /Eval Replay Gate/);
    assert.match(report.markdown, /blocked_by_regression/);

    const coverage = summarizeProjectEvalCoverage("project_alpha", { db, skipMigrate: true });
    assert.equal(coverage.summary.failure_count, 1);
    assert.equal(coverage.summary.eval_case_count, 1);
    assert.equal(coverage.summary.replayed_case_count, 1);
    assert.equal(coverage.summary.regression_taxonomy_count, 1);
    assert.equal(coverage.taxonomy_coverage[0].status, "covered_with_regressions");
    assert.equal(coverage.taxonomy_coverage[0].regression_count, 1);
  } finally {
    cleanup();
  }
});

test("eval coverage map exposes missing eval coverage gaps", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({
        output: "password token=abc leaked in output",
        status: "completed",
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T10:00:00.000Z" }
    );
    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T10:05:00.000Z",
      judgeClient: async () => ({
        overall_status: "high_risk",
        success_score: 40,
        risk_score: 90,
        cost_efficiency_score: 70,
        failure_categories: ["unsafe_output"],
        summary: "Sensitive token leaked.",
        evidence: ["token=abc"],
        recommended_actions: [],
        needs_human_review: true,
      }),
    });

    const coverage = summarizeProjectEvalCoverage("project_alpha", { db, skipMigrate: true });
    assert.equal(coverage.summary.failure_count, 1);
    assert.equal(coverage.summary.eval_case_count, 0);
    assert.equal(coverage.summary.missing_eval_taxonomy_count, 1);
    assert.equal(coverage.priority_gaps[0].status, "missing_eval_coverage");
    assert.match(coverage.priority_gaps[0].recommended_action, /Create eval cases/);

    const backlog = buildProjectEvalBacklog("project_alpha", { db, skipMigrate: true, evalCoverage: coverage });
    assert.equal(backlog.summary.open_item_count, 1);
    assert.equal(backlog.summary.missing_eval_count, 1);
    assert.equal(backlog.items[0].blocker_type, "missing_eval_coverage");
    assert.equal(backlog.items[0].priority, "critical");
    assert.equal(backlog.items[0].representative_failures.length, 1);
    assert.equal(backlog.items[0].autonomy_blocker, true);
  } finally {
    cleanup();
  }
});

test("eval backlog replay runs replay for unreplayed backlog items", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({
        output: "The lookup tool timed out and the agent could not complete the task.",
        status: "failed",
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" }
    );

    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T09:01:00.000Z",
      judgeClient: async () => ({
        overall_status: "failure",
        success_score: 25,
        risk_score: 25,
        cost_efficiency_score: 70,
        failure_categories: ["tool_error"],
        summary: "The lookup tool timed out.",
        evidence: ["timeout while calling order_lookup"],
        recommended_actions: [
          {
            type: "eval_case",
            severity: "low",
            title: "Replay timeout failure",
            description: "Replay the timeout case before promotion.",
            expected_impact: "Prevents timeout regressions.",
          },
        ],
        needs_human_review: false,
      }),
    });

    const before = buildProjectEvalBacklog("project_alpha", { db, skipMigrate: true });
    assert.equal(before.summary.needs_replay_count, 1);
    assert.equal(before.items[0].blocker_type, "unreplayed_eval_coverage");

    generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T09:05:00.000Z",
    });

    const replay = runEvalBacklogReplay("project_alpha", {
      agent_id: "agent_support",
      candidate_output_mode: "safe_placeholder",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T09:10:00.000Z",
    });

    assert.match(replay.eval_run.eval_run_id, /^eval_run_/);
    assert.equal(replay.eval_run.summary.gate_decision, "passed");
    assert.equal(replay.eval_run.summary.pass_count, 1);
    assert.equal(replay.replayed_eval_case_ids.length, 1);
    assert.equal(replay.backlog_after.summary.open_item_count, 0);
    assert.equal(listProjectEvalRuns("project_alpha", { db, skipMigrate: true }).length, 1);

    const gate = checkAgentAutonomyGate("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T09:12:00.000Z",
    });

    assert.equal(gate.eval_replay_gate.gate_decision, "passed");
    assert.equal(gate.eval_coverage.summary.not_replayed_taxonomy_count, 0);
    assert.equal(gate.eval_coverage.summary.regression_taxonomy_count, 0);
    assert.ok(!gate.blockers.some((item) => item.includes("have not been replayed")));
    assert.equal(gate.gate_decision, "blocked");
    assert.ok(gate.blockers.some((item) => item.includes("Autonomy readiness score") || item.includes("not_ready")));
    assert.ok(gate.remediation_plan.summary.blocking_item_count >= 1);
    assert.ok(gate.remediation_plan.items.some((item) => item.remediation_type === "raise_autonomy_readiness"));

    const roadmap = buildAndPersistCertificationRoadmap("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      targetAutonomyLevel: "L4",
      createdAt: "2026-05-21T09:13:00.000Z",
    });
    assert.equal(roadmap.current_gate_status, "blocked");
    assert.equal(roadmap.blocked_by, "both");
    assert.equal(roadmap.certification_state.current_state, "blocked_by_hard_and_score");
    assert.equal(roadmap.certification_state.can_request_human_review, false);
    assert.ok(roadmap.hard_blockers.some((item) => item.code === "certification_production_run_count_minimum_failed"));
    assert.equal(roadmap.target_score, 90);
    assert.ok(roadmap.current_score < roadmap.target_score);
    assert.ok(roadmap.score_blockers.some((item) => item.code === "autonomy_readiness_below_target"));
    assert.ok(roadmap.remediation_objectives.every((item) => item.current_value && item.target_value));
    assert.ok(roadmap.remediation_objectives.every((item) => Number(item.expected_score_delta) > 0));
    assert.ok(roadmap.remediation_objectives.every((item) => item.verification_requirements.length >= 1));
    assert.ok(roadmap.remediation_objectives.every((item) => item.success_criteria.length >= 1));
  } finally {
    cleanup();
  }
});

test("agent autonomy gate stores audit evidence from latest score, replay, and policy signals", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({
        output: "password token=abc was included and transfer_admin was called",
        tools_used: ["transfer_admin"],
        cost: 2.5,
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T02:00:00.000Z" }
    );

    await analyzeRun(run_id, { db, skipMigrate: true, createdAt: "2026-05-21T02:01:00.000Z" });
    generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:50:00.000Z",
    });

    const gate = checkAgentAutonomyGate("project_alpha", "agent_support", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:55:00.000Z",
    });

    assert.equal(gate.gate_decision, "blocked");
    assert.equal(gate.autonomy_allowed, false);
    assert.equal(gate.requires_human_review, true);
    assert.match(gate.audit_evidence_item_id, /^evidence_/);
    assert.equal(gate.data_provenance.evidence_trust_level, "production_with_metadata_gaps");
    assert.ok(gate.warnings.some((item) => item.includes("metadata gaps")));
    assert.ok(gate.blockers.some((item) => item.includes("Certification precondition failed: production_run_count_minimum")));
    assert.ok(gate.remediation_plan.items.some((item) => item.remediation_type === "collect_production_run_evidence"));
    assert.ok(gate.blockers.some((item) => item.includes("Autonomy readiness score") || item.includes("not_ready")));
    assert.ok(gate.eval_coverage.summary.failure_count >= 1);
    assert.ok(gate.eval_coverage.summary.not_replayed_taxonomy_count >= 1);
    assert.ok(gate.blockers.some((item) => item.includes("have not been replayed")));
    assert.ok(gate.remediation_plan.summary.blocking_item_count >= 2);
    assert.ok(gate.remediation_plan.items.some((item) => item.remediation_type === "run_eval_replay"));

    const checks = listProjectAutonomyGateChecks("project_alpha", { db, skipMigrate: true });
    assert.equal(checks.length, 1);
    assert.equal(checks[0].metadata_json.gate_decision, "blocked");
    assert.equal(checks[0].metadata_json.autonomy_allowed, false);
    assert.equal(checks[0].metadata_json.data_provenance.evidence_trust_level, "production_with_metadata_gaps");
    assert.equal(checks[0].metadata_json.data_provenance.certification_evidence_ready, false);
    assert.ok(checks[0].metadata_json.eval_coverage.summary.not_replayed_taxonomy_count >= 1);
    assert.ok(checks[0].metadata_json.remediation_plan.summary.blocking_item_count >= 2);

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    assert.equal(report.json.learning_assets.autonomy_gate_checks, 1);
    assert.equal(report.json.autonomy_gate_checks[0].metadata_json.gate_decision, "blocked");
    assert.match(report.markdown, /Autonomy Gate Checks/);
    assert.match(report.markdown, /Autonomy Remediation Plan/);
    assert.match(report.markdown, /Replay existing eval coverage/);
    assert.match(report.markdown, /allowed=false/);
  } finally {
    cleanup();
  }
});

test("nightly report generates incident reports from high-risk runs", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({
        output: "password token=abc was included and transfer_admin was called",
        tools_used: ["transfer_admin"],
        cost: 2.5,
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T02:00:00.000Z" }
    );

    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T02:01:00.000Z",
    });

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    assert.equal(report.json.incident_reports.length, 1);
    assert.equal(report.json.incident_reports[0].related_run_ids[0], run_id);
    assert.equal(report.json.incident_reports[0].root_cause_category, "sensitive_data_exposure");
    assert.equal(report.json.learning_assets.incident_reports, 1);
    assert.match(report.markdown, /Incident Reports/);
    assert.match(report.markdown, /High-risk agent run/);

    const incidents = listProjectIncidentReports("project_alpha", { db, skipMigrate: true });
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].remediation_status, "open");
    assert.deepEqual(incidents[0].related_run_ids, [run_id]);

    generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:10:00.000Z",
    });
    assert.equal(listProjectIncidentReports("project_alpha", { db, skipMigrate: true }).length, 1);

    const auditEvent = db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = ?").get("incident_report.created");
    assert.equal(auditEvent.count, 1);
  } finally {
    cleanup();
  }
});

test("incident remediation lifecycle stores status history and audit events", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({
        output: "password token=abc was included and transfer_admin was called",
        tools_used: ["transfer_admin"],
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T02:00:00.000Z" }
    );

    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T02:01:00.000Z",
    });

    generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:50:00.000Z",
    });

    const incident = listProjectIncidentReports("project_alpha", { db, skipMigrate: true })[0];
    const investigating = updateIncidentRemediation(
      incident.id,
      {
        remediation_status: "investigating",
        note: "Owner reviewing privileged-tool path.",
        evidence: { owner: "ops" },
      },
      { db, skipMigrate: true, createdAt: "2026-05-22T00:05:00.000Z", actorType: "user", actorId: "user_ops" }
    );

    assert.equal(investigating.incident.remediation_status, "investigating");
    assert.equal(investigating.remediation_event.from_status, "open");
    assert.equal(investigating.remediation_event.to_status, "investigating");
    assert.equal(investigating.remediation_event.evidence_json.owner, "ops");

    const remediated = updateIncidentRemediation(
      incident.id,
      {
        remediation_status: "remediated",
        note: "Added human-review gate draft and eval candidate.",
      },
      { db, skipMigrate: true, createdAt: "2026-05-22T00:10:00.000Z", actorType: "user", actorId: "user_ops" }
    );

    assert.equal(remediated.incident.remediation_status, "remediated");

    const events = listIncidentRemediationEvents(incident.id, { db, skipMigrate: true });
    assert.equal(events.length, 2);
    assert.equal(events[0].to_status, "remediated");
    assert.equal(events[1].to_status, "investigating");

    assert.throws(
      () => updateIncidentRemediation(
        incident.id,
        { remediation_status: "open" },
        { db, skipMigrate: true }
      ),
      /Invalid incident remediation transition/
    );

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:15:00.000Z",
    });

    assert.equal(report.json.learning_assets.incident_remediation_events, 2);
    assert.equal(report.json.incident_reports[0].remediation_status, "remediated");
    assert.equal(report.json.incident_remediation_events.length, 2);
    assert.equal(report.json.incident_remediation_events[0].to_status, "remediated");
    assert.match(report.markdown, /Incident Remediation Timeline/);
    assert.match(report.markdown, /open -> investigating/);

    const projectEvents = listProjectIncidentRemediationEvents("project_alpha", { db, skipMigrate: true });
    assert.equal(projectEvents.length, 2);
    assert.equal(projectEvents[0].incident_report_id, incident.id);

    const chineseReport = reportMarkdownForLocale({
      content_markdown: report.markdown,
      content_json: report.json,
    }, "zh-CN");
    assert.match(chineseReport, /事故处理时间线/);
    assert.match(chineseReport, /待处理 -> 调查中/);

    const consoleHtml = renderOperatorConsoleHtml({
      report_json: report.json,
      report_markdown: report.markdown,
      project_id: "project_alpha",
      agent_id: "agent_alpha",
      report_id: report.report_id,
    }, { locale: "zh-CN" });
    assert.match(consoleHtml, /事故处理时间线/);
    assert.match(consoleHtml, /已修复/);

    const auditEvents = db.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE action = ?"
    ).get("incident_report.remediation_status_updated");
    assert.equal(auditEvents.count, 2);
  } finally {
    cleanup();
  }
});

test("generateNightlyReport turns repeated failures into recurring learning patterns", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const first = ingestAgentRun(
      sampleRun({
        run_id_external: "tool_timeout_1",
        output: "Failed with timeout while calling order_lookup.",
        status: "failed",
        cost: 0.7,
      }),
      { db, skipMigrate: true, createdAt: "2026-05-18T09:00:00.000Z" }
    );
    const second = ingestAgentRun(
      sampleRun({
        run_id_external: "tool_timeout_2",
        output: "Failed with timeout while calling order_lookup again.",
        status: "failed",
        cost: 0.8,
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" }
    );

    const repeatedToolFailureJudge = async () => ({
      overall_status: "failure",
      success_score: 20,
      risk_score: 30,
      cost_efficiency_score: 55,
      failure_categories: ["tool_error"],
      summary: "The lookup tool timed out.",
      evidence: ["The output contains a timeout."],
      recommended_actions: [
        {
          type: "tool_fallback",
          severity: "medium",
          title: "Add lookup timeout fallback",
          description: "Retry or degrade gracefully when the lookup tool times out.",
          expected_impact: "Reduces repeated operational failures.",
        },
        {
          type: "eval_case",
          severity: "low",
          title: "Create timeout regression",
          description: "Replay this timeout case after tool fallback changes.",
          expected_impact: "Turns repeated failures into regression coverage.",
        },
      ],
      needs_human_review: false,
    });

    await analyzeRun(first.run_id, {
      db,
      skipMigrate: true,
      judgeClient: repeatedToolFailureJudge,
      createdAt: "2026-05-18T09:01:00.000Z",
    });
    await analyzeRun(second.run_id, {
      db,
      skipMigrate: true,
      judgeClient: repeatedToolFailureJudge,
      createdAt: "2026-05-21T09:01:00.000Z",
    });

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    const pattern = report.json.recurring_failure_patterns.find((item) => item.category === "tool_error");

    assert.equal(report.json.total_runs, 1);
    assert.equal(report.json.learning_assets.agent_run_traces, 2);
    assert.equal(report.json.learning_assets.outcome_labels, 2);
    assert.equal(report.json.learning_assets.failure_cases, 2);
    assert.equal(report.json.learning_assets.eval_cases, 2);
    assert.equal(report.json.learning_assets.cost_events, 2);
    assert.ok(report.json.learning_assets.learning_insights >= 2);
    assert.equal(report.json.learning_assets.reports, 1);
    assert.ok(pattern);
    assert.ok(report.json.learning_insights.some((item) => item.insight_type === "recurring_failure"));
    assert.ok(report.json.learning_insights.some((item) => item.insight_type === "eval_learning"));
    assert.equal(pattern.case_count, 2);
    assert.equal(pattern.run_count, 2);
    assert.equal(pattern.agent_count, 1);
    assert.deepEqual(pattern.severities, ["medium"]);
    assert.match(report.markdown, /Recurring Failure Patterns/);
    assert.match(report.markdown, /Self-Evolution Memory/);
    assert.match(report.markdown, /tool_error: 2 cases/);
  } finally {
    cleanup();
  }
});

test("generateNightlyReport persists feedback-driven learning insights", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({ output: "Failed with timeout", cost: 1.25, status: "failed" }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
      judgeClient: async () => ({
        overall_status: "failure",
        success_score: 20,
        risk_score: 30,
        cost_efficiency_score: 35,
        failure_categories: ["tool_error", "cost_anomaly"],
        summary: "Tool failed and the run was expensive.",
        evidence: ["timeout", "high cost"],
        recommended_actions: [
          {
            type: "tool_fallback",
            severity: "medium",
            title: "Add timeout fallback",
            description: "Retry or degrade when the lookup tool times out.",
            expected_impact: "Improves success rate.",
          },
          {
            type: "cost_optimization",
            severity: "medium",
            title: "Route simple lookups to smaller model",
            description: "Use smaller model for deterministic lookup requests.",
            expected_impact: "Reduces recurring cost.",
          },
        ],
        needs_human_review: false,
      }),
    });

    const toolSuggestion = db.prepare("SELECT id FROM optimization_suggestions WHERE type = ?").get("tool");
    storeFeedback(
      {
        project_id: "project_alpha",
        target_type: "suggestion",
        target_id: toolSuggestion.id,
        feedback_type: "wrong",
        comment: "This tool fallback does not apply to our workflow.",
      },
      { db, skipMigrate: true, createdAt: "2026-05-21T12:30:00.000Z" }
    );

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });
    const storedInsights = listProjectLearningInsights("project_alpha", { db, skipMigrate: true });

    assert.ok(report.json.learning_insights.some((item) => item.insight_type === "judge_calibration"));
    assert.ok(report.json.learning_insights.some((item) => item.insight_type === "quality_guardrail"));
    assert.equal(storedInsights.length, report.json.learning_insights.length);
    assert.ok(storedInsights.every((item) => item.report_id === report.report_id));
    assert.ok(storedInsights.some((item) => item.evidence_json.wrong_count === 1));
    assert.match(report.markdown, /Calibrate tool suggestions/);
    assert.match(report.markdown, /Wrong suggestions must suppress future actionability/);
  } finally {
    cleanup();
  }
});

test("feedback-derived learning rules suppress repeated bad suggestions", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const judgeClient = async () => ({
      overall_status: "failure",
      success_score: 25,
      risk_score: 25,
      cost_efficiency_score: 70,
      failure_categories: ["tool_error"],
      summary: "The lookup tool failed.",
      evidence: ["timeout"],
      recommended_actions: [
        {
          type: "tool_fallback",
          severity: "medium",
          title: "Add timeout fallback",
          description: "Retry lookup calls after a timeout.",
          expected_impact: "Improves success rate.",
        },
      ],
      needs_human_review: false,
    });
    const first = ingestAgentRun(
      sampleRun({ run_id_external: "timeout_a", output: "Failed with timeout", status: "failed" }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );
    const second = ingestAgentRun(
      sampleRun({ run_id_external: "timeout_b", output: "Failed with timeout again", status: "failed" }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:10:00.000Z" }
    );

    await analyzeRun(first.run_id, {
      db,
      skipMigrate: true,
      judgeClient,
      createdAt: "2026-05-21T12:05:00.000Z",
    });
    await analyzeRun(second.run_id, {
      db,
      skipMigrate: true,
      judgeClient,
      createdAt: "2026-05-21T12:15:00.000Z",
    });

    const suggestion = db.prepare(
      `SELECT id
       FROM optimization_suggestions
       WHERE type = 'tool'
       ORDER BY created_at ASC
       LIMIT 1`
    ).get();
    const feedback = storeFeedback(
      {
        project_id: "project_alpha",
        target_type: "suggestion",
        target_id: suggestion.id,
        feedback_type: "wrong",
        comment: "This system cannot safely retry that tool.",
      },
      { db, skipMigrate: true, createdAt: "2026-05-21T12:30:00.000Z" }
    );

    assert.match(feedback.learning_rule_id, /^learnrule_/);
    assert.equal(feedback.learning_rule_type, "suppress_suggestion_pattern");
    assert.equal(feedback.learning_rule_confidence, 0.8);

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });
    const rules = listProjectLearningRules("project_alpha", { db, skipMigrate: true });

    assert.equal(rules.length, 1);
    assert.equal(rules[0].rule_type, "suppress_suggestion_pattern");
    assert.equal(rules[0].source_feedback_count, 1);
    assert.equal(rules[0].pattern_json.title, "Add timeout fallback");
    assert.equal(report.json.learning_assets.learning_rules, 1);
    assert.equal(report.json.learning_rules.length, 1);
    assert.equal(report.json.suggestions_suppressed_by_learning_rules, 2);
    assert.equal(report.json.actionable_prompt_suggestions.length, 0);
    assert.equal(report.json.next_actions.some((item) => item.type === "tool_improvement"), false);
    assert.ok(report.json.learning_insights.some((item) => item.insight_type === "learning_rule_memory"));
    assert.match(report.markdown, /Feedback-Derived Learning Rules/);
    assert.match(report.markdown, /SUPPRESS - tool "Add timeout fallback"/);
  } finally {
    cleanup();
  }
});

test("reports rebuild learning rules from existing feedback history", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({ output: "Failed with timeout", status: "failed", cost: 1.25 }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    await analyzeRun(run_id, { db, skipMigrate: true, createdAt: "2026-05-21T12:05:00.000Z" });

    const suggestion = db.prepare("SELECT id FROM optimization_suggestions WHERE type = 'cost'").get();
    db.prepare(
      `INSERT INTO user_feedback (
        id, org_id, project_id, target_type, target_id, feedback_type, comment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "feedback_legacy_cost_wrong",
      "org_default",
      "project_alpha",
      "suggestion",
      suggestion.id,
      "wrong",
      "Legacy feedback written before learning rules existed.",
      "2026-05-21T12:30:00.000Z"
    );

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });
    const rules = listProjectLearningRules("project_alpha", { db, skipMigrate: true });

    assert.equal(rules.length, 1);
    assert.equal(rules[0].rule_type, "suppress_suggestion_pattern");
    assert.equal(report.json.learning_rules.length, 1);
    assert.equal(report.json.actionable_cost_suggestions.length, 0);
  } finally {
    cleanup();
  }
});

test("runNightlyHealthCheck analyzes unanalyzed runs before creating the report", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject(
      { name: "Support Agents" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" }
    );
    const agent = createAgent(
      { project_id: project.project_id, name: "Support Triage" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:05:00.000Z" }
    );

    const runA = ingestAgentRun(
      sampleRun({
        project_id: project.project_id,
        agent_id: agent.agent_id,
        output: "Failed with timeout",
        status: "failed",
      }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );
    ingestAgentRun(
      sampleRun({
        project_id: project.project_id,
        agent_id: agent.agent_id,
        run_id_external: "external_2",
        output: "Completed normally",
      }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T13:00:00.000Z" }
    );

    const result = await runNightlyHealthCheck(project.project_id, "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:55:00.000Z",
    });

    assert.equal(result.analyzed_count, 2);
    assert.ok(result.analyzed_run_ids.includes(runA.run_id));
    assert.equal(result.json.total_runs, 2);
    assert.equal(result.json.trace_items.length, 2);

    const judgementCount = db.prepare("SELECT COUNT(*) AS count FROM run_judgements").get();
    assert.equal(judgementCount.count, 2);
  } finally {
    cleanup();
  }
});

test("runNightlyHealthCheck records analysis failures and still creates report", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject({ name: "Support Agents" }, { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" });
    const agent = createAgent({ project_id: project.project_id, name: "Support Triage" }, { db, skipMigrate: true });

    ingestAgentRun(
      sampleRun({ project_id: project.project_id, agent_id: agent.agent_id }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    const result = await runNightlyHealthCheck(project.project_id, "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:55:00.000Z",
      judgeClient: async () => {
        throw new Error("judge unavailable");
      },
    });

    assert.equal(result.analyzed_count, 0);
    assert.equal(result.failed_analysis_count, 1);
    assert.match(result.report_id, /^report_/);

    const jobEvents = db.prepare("SELECT status, target_type, message FROM job_events ORDER BY created_at ASC").all();
    assert.equal(jobEvents.length, 2);
    assert.equal(jobEvents[0].status, "failed");
    assert.equal(jobEvents[0].target_type, "agent_run");
    assert.equal(jobEvents[0].message, "judge unavailable");
    assert.equal(jobEvents[1].status, "partial_success");
  } finally {
    cleanup();
  }
});

test("runNightlyHealthChecksForDate runs reports for every project with runs", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const projectA = createProject({ name: "A" }, { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" });
    const agentA = createAgent({ project_id: projectA.project_id, name: "Agent A" }, { db, skipMigrate: true });
    const projectB = createProject({ name: "B" }, { db, skipMigrate: true, createdAt: "2026-05-21T09:10:00.000Z" });
    const agentB = createAgent({ project_id: projectB.project_id, name: "Agent B" }, { db, skipMigrate: true });

    ingestAgentRun(
      sampleRun({ project_id: projectA.project_id, agent_id: agentA.agent_id }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T10:00:00.000Z" }
    );
    ingestAgentRun(
      sampleRun({ project_id: projectB.project_id, agent_id: agentB.agent_id, run_id_external: "external_b" }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T11:00:00.000Z" }
    );

    const result = await runNightlyHealthChecksForDate("2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:55:00.000Z",
    });

    assert.equal(result.project_count, 2);
    assert.equal(result.results.length, 2);
    const reportCount = db.prepare("SELECT COUNT(*) AS count FROM reports").get();
    assert.equal(reportCount.count, 2);
  } finally {
    cleanup();
  }
});

test("deliverReport records successful local email delivery status", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
    });
    await analyzeRun(run_id, { db, skipMigrate: true, createdAt: "2026-05-21T12:05:00.000Z" });
    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    const delivery = await deliverReport(
      report.report_id,
      { recipient: "ops@example.com", channel: "email" },
      {
        db,
        skipMigrate: true,
        createdAt: "2026-05-22T00:01:00.000Z",
        attemptedAt: "2026-05-22T00:01:01.000Z",
        deliveredAt: "2026-05-22T00:01:02.000Z",
      }
    );

    assert.match(delivery.id, /^delivery_/);
    assert.equal(delivery.status, "sent");
    assert.equal(delivery.recipient, "ops@example.com");
    assert.equal(delivery.provider, "local");
    assert.deepEqual(delivery.metadata.content_formats, ["markdown", "html"]);

    const deliveries = listReportDeliveries(report.report_id, { db, skipMigrate: true });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].status, "sent");
    assert.deepEqual(deliveries[0].metadata.content_formats, ["markdown", "html"]);
  } finally {
    cleanup();
  }
});

test("delivery validation accepts Slack/webhook URLs and rejects non-email email recipients", () => {
  const slack = validateReportDeliveryPayload({
    recipient: "https://hooks.slack.com/services/T000/B000/XXX",
    channel: "slack",
  });

  assert.equal(slack.provider, "slack");

  const webhook = validateReportDeliveryPayload({
    recipient: "http://localhost:4000/report-webhook",
    channel: "webhook",
    provider: "internal",
  });

  assert.equal(webhook.provider, "internal");

  assert.throws(
    () => validateReportDeliveryPayload({ recipient: "not-an-email", channel: "email" }),
    ValidationError
  );
  assert.throws(
    () => validateReportDeliveryPayload({ recipient: "not-a-url", channel: "slack" }),
    ValidationError
  );
});

test("deliverReport can send Slack webhook deliveries with structured summary", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({
        output: "Failed with timeout",
        cost: 1.2,
        status: "failed",
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );
    await analyzeRun(run_id, { db, skipMigrate: true, createdAt: "2026-05-21T12:05:00.000Z" });
    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    const calls = [];
    const provider = createHttpWebhookProvider({
      name: "slack-test",
      fetchImpl: async (url, request) => {
        calls.push({ url, request, body: JSON.parse(request.body) });
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => name === "x-slack-req-id" ? "slack_req_1" : null },
          async text() {
            return "ok";
          },
        };
      },
    });

    const delivery = await deliverReport(
      report.report_id,
      {
        recipient: "https://hooks.slack.com/services/T000/B000/XXX",
        channel: "slack",
      },
      {
        db,
        skipMigrate: true,
        provider,
        createdAt: "2026-05-22T00:01:00.000Z",
        attemptedAt: "2026-05-22T00:01:01.000Z",
        deliveredAt: "2026-05-22T00:01:02.000Z",
      }
    );

    assert.equal(delivery.status, "sent");
    assert.equal(delivery.channel, "slack");
    assert.equal(delivery.provider, "slack-test");
    assert.equal(delivery.provider_message_id, "slack_req_1");
    assert.equal(delivery.metadata.transport, "http_webhook");
    assert.equal(delivery.metadata.channel, "slack");
    assert.deepEqual(delivery.metadata.content_formats, ["json", "markdown", "html"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://hooks.slack.com/services/T000/B000/XXX");
    assert.match(calls[0].body.text, /AI Agent Nightly Health Report/);
    assert.equal(calls[0].body.blocks[0].type, "header");
    assert.ok(calls[0].body.blocks.some((block) => JSON.stringify(block).includes("High risk")));
  } finally {
    cleanup();
  }
});

test("runNightlyHealthCheck delivers to Slack report subscriptions", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject({ name: "Support Agents" }, { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" });
    const agent = createAgent({ project_id: project.project_id, name: "Support Triage" }, { db, skipMigrate: true });
    const subscription = createReportSubscription(
      project.project_id,
      {
        recipient: "https://hooks.slack.com/services/T000/B000/XXX",
        channel: "slack",
      },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:10:00.000Z" }
    );

    ingestAgentRun(
      sampleRun({ project_id: project.project_id, agent_id: agent.agent_id }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    const calls = [];
    const result = await runNightlyHealthCheck(project.project_id, "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:55:00.000Z",
      deliveryProvider: {
        name: "slack-test",
        async sendWebhook(payload) {
          calls.push(payload);
          return {
            provider_message_id: "slack_msg_1",
            metadata: { transport: "test_slack", content_formats: ["json"] },
          };
        },
      },
    });

    assert.equal(subscription.provider, "slack");
    assert.equal(result.deliveries.length, 1);
    assert.equal(result.deliveries[0].status, "sent");
    assert.equal(result.deliveries[0].channel, "slack");
    assert.equal(result.deliveries[0].recipient, "https://hooks.slack.com/services/T000/B000/XXX");
    assert.equal(result.deliveries[0].metadata.subscription_id, subscription.id);
    assert.equal(result.deliveries[0].metadata.transport, "test_slack");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].channel, "slack");
    assert.match(calls[0].markdown, /Agent Nightly Health Report/);
    assert.match(calls[0].html, /<!doctype html>/);
  } finally {
    cleanup();
  }
});

test("deliverReport records failed delivery without throwing", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
    });
    await analyzeRun(run_id, { db, skipMigrate: true, createdAt: "2026-05-21T12:05:00.000Z" });
    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    const delivery = await deliverReport(
      report.report_id,
      { recipient: "ops@example.com", channel: "email" },
      {
        db,
        skipMigrate: true,
        provider: {
          name: "failing",
          async sendEmail() {
            throw new Error("smtp timeout");
          },
        },
        createdAt: "2026-05-22T00:01:00.000Z",
        attemptedAt: "2026-05-22T00:01:01.000Z",
        failedAt: "2026-05-22T00:01:02.000Z",
      }
    );

    assert.equal(delivery.status, "failed");
    assert.equal(delivery.error_message, "smtp timeout");
    assert.equal(delivery.provider, "failing");
    assert.equal(delivery.retry_count, 0);
    assert.ok(delivery.next_retry_at);
  } finally {
    cleanup();
  }
});

test("runRetryQueue retries due failed report deliveries", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
    });
    await analyzeRun(run_id, { db, skipMigrate: true, createdAt: "2026-05-21T12:05:00.000Z" });
    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    const failed = await deliverReport(
      report.report_id,
      { recipient: "ops@example.com", channel: "email" },
      {
        db,
        skipMigrate: true,
        provider: {
          name: "failing",
          async sendEmail() {
            throw new Error("smtp timeout");
          },
        },
        createdAt: "2026-05-22T00:01:00.000Z",
        attemptedAt: "2026-05-22T00:01:00.000Z",
        failedAt: "2026-05-22T00:01:00.000Z",
        nextRetryAt: "2026-05-22T00:05:00.000Z",
      }
    );

    const result = await runRetryQueue({
      db,
      skipMigrate: true,
      now: "2026-05-22T00:10:00.000Z",
      attemptedAt: "2026-05-22T00:10:00.000Z",
      deliveredAt: "2026-05-22T00:10:01.000Z",
    });

    assert.equal(result.retried_delivery_count, 1);
    assert.equal(result.deliveries[0].id, failed.id);
    assert.equal(result.deliveries[0].status, "sent");
    assert.equal(result.deliveries[0].retry_count, 1);
    assert.equal(result.deliveries[0].resolved_at, "2026-05-22T00:10:01.000Z");
  } finally {
    cleanup();
  }
});

test("runNightlyHealthCheck can deliver report after generation", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject({ name: "Support Agents" }, { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" });
    const agent = createAgent({ project_id: project.project_id, name: "Support Triage" }, { db, skipMigrate: true });
    ingestAgentRun(
      sampleRun({ project_id: project.project_id, agent_id: agent.agent_id }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    const result = await runNightlyHealthCheck(project.project_id, "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:55:00.000Z",
      deliverTo: [{ recipient: "ops@example.com", channel: "email" }],
    });

    assert.equal(result.deliveries.length, 1);
    assert.equal(result.deliveries[0].status, "sent");
    const deliveryCount = db.prepare("SELECT COUNT(*) AS count FROM report_deliveries").get();
    assert.equal(deliveryCount.count, 1);
  } finally {
    cleanup();
  }
});

test("project report subscriptions can be created, listed, and disabled", () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject({ name: "Support Agents" }, { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" });
    const subscription = createReportSubscription(
      project.project_id,
      { recipient: "ops@example.com", channel: "email", provider: "local" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:10:00.000Z" }
    );

    assert.match(subscription.id, /^subscription_/);
    assert.equal(subscription.enabled, true);

    const listed = listReportSubscriptions(project.project_id, { db, skipMigrate: true });
    assert.equal(listed.length, 1);

    const disabled = updateReportSubscription(
      subscription.id,
      { enabled: false },
      { db, skipMigrate: true, updatedAt: "2026-05-21T09:20:00.000Z" }
    );
    assert.equal(disabled.enabled, false);

    const targets = deliveryTargetsForProject(project.project_id, { db, skipMigrate: true });
    assert.equal(targets.length, 0);
  } finally {
    cleanup();
  }
});

test("runNightlyHealthCheck uses enabled project report subscriptions by default", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject({ name: "Support Agents" }, { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" });
    const agent = createAgent({ project_id: project.project_id, name: "Support Triage" }, { db, skipMigrate: true });
    const subscription = createReportSubscription(
      project.project_id,
      { recipient: "ops@example.com", channel: "email", provider: "local" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:10:00.000Z" }
    );

    ingestAgentRun(
      sampleRun({ project_id: project.project_id, agent_id: agent.agent_id }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    const result = await runNightlyHealthCheck(project.project_id, "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:55:00.000Z",
    });

    assert.equal(result.deliveries.length, 1);
    assert.equal(result.deliveries[0].recipient, "ops@example.com");
    assert.equal(result.deliveries[0].metadata.subscription_id, subscription.id);
  } finally {
    cleanup();
  }
});

test("explicit empty deliverTo disables subscription delivery for a nightly run", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject({ name: "Support Agents" }, { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" });
    const agent = createAgent({ project_id: project.project_id, name: "Support Triage" }, { db, skipMigrate: true });
    createReportSubscription(
      project.project_id,
      { recipient: "ops@example.com", channel: "email", provider: "local" },
      { db, skipMigrate: true, createdAt: "2026-05-21T09:10:00.000Z" }
    );
    ingestAgentRun(
      sampleRun({ project_id: project.project_id, agent_id: agent.agent_id }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    const result = await runNightlyHealthCheck(project.project_id, "2026-05-21", {
      db,
      skipMigrate: true,
      deliverTo: [],
      createdAt: "2026-05-21T23:55:00.000Z",
    });

    assert.equal(result.deliveries.length, 0);
    const deliveryCount = db.prepare("SELECT COUNT(*) AS count FROM report_deliveries").get();
    assert.equal(deliveryCount.count, 0);
  } finally {
    cleanup();
  }
});

test("runRetryQueue retries failed analysis job events", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject({ name: "Support Agents" }, { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" });
    const agent = createAgent({ project_id: project.project_id, name: "Support Triage" }, { db, skipMigrate: true });
    ingestAgentRun(
      sampleRun({ project_id: project.project_id, agent_id: agent.agent_id }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    await runNightlyHealthCheck(project.project_id, "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:55:00.000Z",
      deliverTo: [],
      judgeClient: async () => {
        throw new Error("judge unavailable");
      },
    });

    const failedEvent = db.prepare("SELECT id, next_retry_at FROM job_events WHERE status = 'failed' AND target_type = 'agent_run'").get();
    assert.ok(failedEvent.next_retry_at);

    const result = await runRetryQueue({
      db,
      skipMigrate: true,
      now: "2026-05-22T00:10:00.000Z",
      attemptedAt: "2026-05-22T00:10:00.000Z",
      judgeClient: async () => ({
        overall_status: "success",
        success_score: 90,
        risk_score: 5,
        cost_efficiency_score: 85,
        failure_categories: [],
        summary: "Retry succeeded.",
        evidence: ["The run was analyzed on retry."],
        recommended_actions: [],
        needs_human_review: false,
      }),
    });

    assert.equal(result.retried_analysis_count, 1);
    assert.equal(result.analysis_events[0].id, failedEvent.id);
    assert.equal(result.analysis_events[0].status, "resolved");
    assert.equal(result.analysis_events[0].retry_count, 1);

    const judgementCount = db.prepare("SELECT COUNT(*) AS count FROM run_judgements").get();
    assert.equal(judgementCount.count, 1);
  } finally {
    cleanup();
  }
});

test("project operational queries expose unresolved failed delivery and analysis evidence", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const project = createProject({ name: "Support Agents" }, { db, skipMigrate: true, createdAt: "2026-05-21T09:00:00.000Z" });
    const agent = createAgent({ project_id: project.project_id, name: "Support Triage" }, { db, skipMigrate: true });
    ingestAgentRun(
      sampleRun({ project_id: project.project_id, agent_id: agent.agent_id }),
      { db, skipMigrate: true, requireExistingScope: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    const nightly = await runNightlyHealthCheck(project.project_id, "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:55:00.000Z",
      deliverTo: [],
      judgeClient: async () => {
        throw new Error("judge unavailable");
      },
    });

    await deliverReport(
      nightly.report_id,
      { recipient: "ops@example.com", channel: "email" },
      {
        db,
        skipMigrate: true,
        provider: {
          name: "failing",
          async sendEmail() {
            throw new Error("smtp timeout");
          },
        },
        createdAt: "2026-05-22T00:01:00.000Z",
        attemptedAt: "2026-05-22T00:01:00.000Z",
        failedAt: "2026-05-22T00:01:00.000Z",
        nextRetryAt: "2026-05-22T00:05:00.000Z",
      }
    );

    const failedDeliveries = listProjectReportDeliveries(project.project_id, {
      db,
      skipMigrate: true,
      status: "failed",
      unresolvedOnly: true,
    });
    const failedEvents = listProjectJobEvents(project.project_id, {
      db,
      skipMigrate: true,
      status: "failed",
      unresolvedOnly: true,
    });
    const failures = listProjectOperationalFailures(project.project_id, {
      db,
      skipMigrate: true,
      status: "failed",
    });

    assert.equal(failedDeliveries.length, 1);
    assert.equal(failedEvents.length, 1);
    assert.equal(failures.counts.total, 2);
    assert.equal(failures.report_deliveries[0].error_message, "smtp timeout");
    assert.equal(failures.job_events[0].message, "judge unavailable");
  } finally {
    cleanup();
  }
});

test("traceability asset queries connect report source runs to derived assets", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({ output: "Failed with timeout", cost: 1.2, status: "failed" }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
      judgeClient: async () => ({
        overall_status: "failure",
        success_score: 20,
        risk_score: 35,
        cost_efficiency_score: 30,
        failure_categories: ["tool_error", "cost_anomaly"],
        summary: "Tool failed and cost was high.",
        evidence: ["timeout", "high cost"],
        recommended_actions: [
          {
            type: "tool_fallback",
            severity: "medium",
            title: "Add timeout fallback",
            description: "Retry or degrade when the lookup tool times out.",
            expected_impact: "Improves success rate.",
          },
          {
            type: "cost_optimization",
            severity: "medium",
            title: "Route simple lookups to smaller model",
            description: "Use smaller model for deterministic lookup requests.",
            expected_impact: "Reduces recurring cost.",
          },
          {
            type: "eval_case",
            severity: "low",
            title: "Create timeout regression",
            description: "Replay timeout case after changes.",
            expected_impact: "Prevents repeated regressions.",
          },
        ],
        needs_human_review: false,
      }),
    });

    const runs = listProjectRuns("project_alpha", { db, skipMigrate: true });
    const trace = getRunTrace(run_id, { db, skipMigrate: true });
    const judgement = getRunJudgementByRunId(run_id, { db, skipMigrate: true });
    const suggestions = listProjectSuggestions("project_alpha", { db, skipMigrate: true });
    const evalCases = listProjectEvalCases("project_alpha", { db, skipMigrate: true });
    const failureCases = listProjectFailureCases("project_alpha", { db, skipMigrate: true });

    assert.equal(runs.length, 1);
    assert.equal(trace.run.id, run_id);
    assert.equal(trace.judgement.id, judgement.id);
    assert.equal(trace.suggestions.length, 3);
    assert.equal(trace.eval_cases.length, 1);
    assert.equal(trace.failure_cases.length, 2);
    assert.equal(suggestions.length, 3);
    assert.equal(evalCases.length, 1);
    assert.equal(failureCases.length, 2);
  } finally {
    cleanup();
  }
});

test("reports can be fetched and listed as stored artifacts", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
    });
    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
    });

    const created = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });
    const fetched = getReport(created.report_id, { db, skipMigrate: true });
    const listed = listReportsForProject("project_alpha", { db, skipMigrate: true });

    assert.equal(fetched.id, created.report_id);
    assert.equal(fetched.content_json.total_runs, 1);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.report_id);

    const rendered = getReportHtml(created.report_id, { db, skipMigrate: true });
    assert.match(rendered.html, /<!doctype html>/);
    assert.match(rendered.html, /Agent Nightly Health Report/);
    assert.match(markdownToHtml("- `<script>`"), /&lt;script&gt;/);
    assert.match(renderReportHtml(fetched), /<main>/);
  } finally {
    cleanup();
  }
});

test("operator console page renders latest report without mutating by default", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const emptyHtml = await buildOperatorConsolePageHtml({
      db,
      skipMigrate: true,
      locale: "zh-CN",
    });
    assert.match(emptyHtml, /还没有项目或报告/);
    assert.match(emptyHtml, /接入向导/);
    assert.match(emptyHtml, /接入进度/);
    assert.match(emptyHtml, /0\/4 已完成/);
    assert.match(emptyHtml, /创建项目并生成接入 Key/);
    assert.deepEqual(buildOnboardingChecklist(db, null).steps.map((step) => step.done), [false, false, false, false]);

    const consoleProject = createConsoleProject({
      name: "Console Created Project",
      description: "Created from test console",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T09:00:00.000Z",
    });
    assert.match(consoleProject.project_id, /^project_/);
    assert.match(consoleProject.ingestion_api_key, /^aiwc_live_/);
    const noReportHtml = await buildOperatorConsolePageHtml({
      db,
      skipMigrate: true,
      projectId: consoleProject.project_id,
      locale: "zh-CN",
      flash: {
        title: "项目已创建",
        ingestion_api_key: consoleProject.ingestion_api_key,
      },
    });
    assert.match(noReportHtml, /项目已创建/);
    assert.match(noReportHtml, new RegExp(consoleProject.ingestion_api_key));
    assert.match(noReportHtml, /Webhook 接入示例/);
    assert.match(noReportHtml, /1\/4 已完成/);
    assert.deepEqual(buildOnboardingChecklist(db, consoleProject.project_id).steps.map((step) => step.done), [true, false, false, false]);

    const consoleAgent = createConsoleAgent({
      project_id: consoleProject.project_id,
      name: "Console Agent",
      environment: "staging",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T09:05:00.000Z",
    });
    assert.match(consoleAgent.agent_id, /^agent_/);
    assert.match(await buildOperatorConsolePageHtml({
      db,
      skipMigrate: true,
      projectId: consoleProject.project_id,
      locale: "zh-CN",
    }), new RegExp(consoleAgent.agent_id));
    const agentStageHtml = await buildOperatorConsolePageHtml({
      db,
      skipMigrate: true,
      projectId: consoleProject.project_id,
      locale: "zh-CN",
    });
    assert.match(agentStageHtml, /2\/4 已完成/);
    assert.deepEqual(buildOnboardingChecklist(db, consoleProject.project_id).steps.map((step) => step.done), [true, true, false, false]);

    const sampleRunResult = await createConsoleSampleRun({
      project_id: consoleProject.project_id,
      agent_id: consoleAgent.agent_id,
      input: "用户要求查询订单退款状态",
      output: "工具返回空结果后，Agent 需要人工复核，不能编造退款状态。",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T09:10:00.000Z",
    });
    assert.match(sampleRunResult.run_id, /^run_/);
    assert.match(sampleRunResult.report_id, /^report_/);
    const consoleSampleRun = getAgentRun(sampleRunResult.run_id, { db, skipMigrate: true });
    assert.equal(consoleSampleRun.metadata.source, "console_sample_run");
    assert.equal(consoleSampleRun.metadata.onboarding_sample, true);
    assert.equal(consoleSampleRun.metadata.task_type, "support_triage");
    const sampleReport = getReport(sampleRunResult.report_id, { db, skipMigrate: true });
    assert.equal(sampleReport.content_json.total_runs, 1);
    assert.equal(sampleReport.content_json.data_provenance.evidence_trust_level, "sample_only");
    assert.equal(sampleReport.content_json.data_provenance.readiness_evidence_status, "onboarding_sample_not_customer_production");
    assert.equal(sampleReport.content_json.data_provenance.console_sample_runs, 1);
    assert.equal(sampleReport.content_json.data_provenance.production_candidate_runs, 0);
    assert.equal(sampleReport.content_json.data_provenance.certification_evidence_ready, false);
    assert.ok(sampleReport.content_json.autonomy_certification_roadmaps[0].hard_blockers.some((item) => item.code === "sample_only_evidence_not_certifiable"));
    assert.ok(sampleReport.content_json.autonomy_certification_roadmaps[0].remediation_objectives.some((item) => item.title === "Replace non-production evidence with production run traces"));
    assert.equal(sampleReport.content_json.autonomy_certification_roadmaps[0].certification_state.evidence_inputs.evidence_trust_level, "sample_only");
    assert.match(await buildOperatorConsolePageHtml({
      db,
      skipMigrate: true,
      projectId: consoleProject.project_id,
      reportId: sampleRunResult.report_id,
      locale: "zh-CN",
      flash: { title: "测试 Run 已提交" },
    }), /测试 Run 已提交/);
    const completedChecklist = buildOnboardingChecklist(db, consoleProject.project_id);
    assert.equal(completedChecklist.complete, true);
    assert.deepEqual(completedChecklist.steps.map((step) => step.done), [true, true, true, true]);
    const completedOnboardingHtml = await buildOperatorConsolePageHtml({
      db,
      skipMigrate: true,
      projectId: consoleProject.project_id,
      reportId: sampleRunResult.report_id,
      locale: "zh-CN",
    });
    assert.match(completedOnboardingHtml, /4\/4 已完成/);
    assert.match(completedOnboardingHtml, /当前认证阻断原因/);
    assert.match(completedOnboardingHtml, /样例证据不可认证/);

    const { run_id } = ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
    });
    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
    });
    const created = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });
    const reportCountBefore = db.prepare("SELECT COUNT(*) AS count FROM reports").get().count;

    const html = await buildOperatorConsolePageHtml({
      db,
      skipMigrate: true,
      projectId: "project_alpha",
      locale: "zh-CN",
    });

    assert.match(html, /AI Worker Control Plane/);
    assert.match(html, /夜间体检与成本优化控制台/);
    assert.match(html, /控制台/);
    assert.match(html, /手动生成新报告/);
    assert.match(html, /默认只读/);
    assert.match(html, /接入向导/);
    assert.match(html, /Webhook 接入示例/);
    assert.match(html, /自主运行评分/);
    assert.match(html, /策略学习审核/);
    assert.match(html, new RegExp(created.report_id));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reports").get().count, reportCountBefore);

    const generatedHtml = await buildOperatorConsolePageHtml({
      db,
      skipMigrate: true,
      projectId: "project_alpha",
      date: "2026-05-21",
      locale: "zh-CN",
      generate: true,
      targetAutonomyLevel: "L3",
    });
    assert.match(generatedHtml, /已显式生成新报告/);
    assert.match(generatedHtml, /L3 \/ Limited Autonomy \/ 80\/100/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reports").get().count, reportCountBefore + 1);
    const latestGeneratedReportId = db.prepare(
      "SELECT id FROM reports WHERE project_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get("project_alpha").id;
    const latestGeneratedReport = getReport(latestGeneratedReportId, { db, skipMigrate: true });
    assert.equal(latestGeneratedReport.content_json.autonomy_certification_roadmaps[0].target_autonomy_level, "L3");
    assert.equal(latestGeneratedReport.content_json.data_provenance.production_certification_policy.min_production_candidate_runs, 50);
  } finally {
    cleanup();
  }
});

test("approving a prompt suggestion creates an approved draft prompt version", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(sampleRun(), {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:00:00.000Z",
    });

    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
      judgeClient: async () => ({
        overall_status: "partial_failure",
        success_score: 65,
        risk_score: 25,
        cost_efficiency_score: 80,
        failure_categories: ["prompt_weakness"],
        summary: "The agent answered but needs a tighter instruction.",
        evidence: ["The answer omitted the required next step."],
        recommended_actions: [
          {
            type: "prompt_update",
            severity: "medium",
            title: "Clarify required next step",
            description: "Add an instruction requiring the agent to state the next operational step.",
            expected_impact: "Improves task completion quality.",
          },
        ],
        needs_human_review: false,
      }),
    });

    const suggestion = db.prepare("SELECT id FROM optimization_suggestions WHERE type = ?").get("prompt");
    const feedback = storeFeedback(
      {
        project_id: "project_alpha",
        target_type: "suggestion",
        target_id: suggestion.id,
        feedback_type: "approve",
        comment: "Make this a prompt draft.",
      },
      { db, skipMigrate: true, createdAt: "2026-05-21T12:30:00.000Z" }
    );

    assert.match(feedback.prompt_version_id, /^prompt_/);
    assert.equal(feedback.suggestion_status, "approved");
    const prompt = db.prepare("SELECT prompt_name, status, version FROM prompt_versions WHERE id = ?").get(feedback.prompt_version_id);
    assert.equal(prompt.prompt_name, "Clarify required next step");
    assert.equal(prompt.status, "approved_draft");
    assert.equal(prompt.version, 1);
    const updatedSuggestion = db.prepare("SELECT status FROM optimization_suggestions WHERE id = ?").get(suggestion.id);
    assert.equal(updatedSuggestion.status, "approved");
  } finally {
    cleanup();
  }
});

test("prompt promotion check requires prompt-version replay evidence before readiness", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({
        output: "The agent answered but missed the required next operational step.",
        status: "completed",
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
      judgeClient: async () => ({
        overall_status: "partial_failure",
        success_score: 60,
        risk_score: 20,
        cost_efficiency_score: 80,
        failure_categories: ["prompt_weakness"],
        summary: "The prompt needs a tighter next-step instruction.",
        evidence: ["The answer omitted the required next step."],
        recommended_actions: [
          {
            type: "prompt_update",
            severity: "medium",
            title: "Clarify required next step",
            description: "Add an instruction requiring the agent to state the next operational step.",
            expected_impact: "Improves task completion quality.",
          },
          {
            type: "eval_case",
            severity: "low",
            title: "Replay next-step omission",
            description: "Replay the missing-next-step case before prompt promotion.",
            expected_impact: "Prevents prompt regressions.",
          },
        ],
        needs_human_review: false,
      }),
    });

    const suggestion = db.prepare("SELECT id FROM optimization_suggestions WHERE type = ?").get("prompt");
    const feedback = storeFeedback(
      {
        project_id: "project_alpha",
        target_type: "suggestion",
        target_id: suggestion.id,
        feedback_type: "approve",
        comment: "Promote after replay.",
      },
      { db, skipMigrate: true, createdAt: "2026-05-21T12:30:00.000Z" }
    );

    const blocked = checkPromptPromotionReadiness("project_alpha", feedback.prompt_version_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:35:00.000Z",
    });

    assert.equal(blocked.decision, "blocked_missing_replay");
    assert.equal(blocked.status, "promotion_blocked");

    const evalCase = db.prepare("SELECT * FROM eval_cases WHERE project_id = ?").get("project_alpha");
    const replay = runEvalReplay("project_alpha", "agent_support", {
      prompt_version_id: feedback.prompt_version_id,
      eval_case_ids: [evalCase.id],
      candidate_outputs: {
        [evalCase.id]: "The agent states the order status, names the next operational step, and asks for human confirmation before continuing.",
      },
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:40:00.000Z",
    });

    assert.equal(replay.summary.gate_decision, "passed");

    const ready = checkPromptPromotionReadiness("project_alpha", feedback.prompt_version_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:45:00.000Z",
    });

    assert.equal(ready.decision, "promotion_ready");
    assert.equal(ready.status, "promotion_ready");
    assert.equal(ready.eval_replay_gate.eval_run_id, replay.eval_run_id);
    assert.equal(db.prepare("SELECT status FROM prompt_versions WHERE id = ?").get(feedback.prompt_version_id).status, "promotion_ready");

    const checks = listProjectPromptPromotionChecks("project_alpha", { db, skipMigrate: true });
    assert.equal(checks.length, 2);
    assert.equal(checks[0].metadata_json.promotion_decision, "promotion_ready");

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    assert.equal(report.json.learning_assets.prompt_promotion_checks, 2);
    assert.equal(report.json.prompt_promotion_checks[0].metadata_json.promotion_decision, "promotion_ready");
    assert.match(report.markdown, /Prompt Promotion Checks/);
    assert.match(report.markdown, /promotion_ready/);
    assert.match(report.markdown, /coverage missing=0/);
  } finally {
    cleanup();
  }
});

test("prompt promotion check blocks when project eval coverage has uncovered failures", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const first = ingestAgentRun(
      sampleRun({
        run_id_external: "external_prompt_coverage_1",
        output: "The agent answered but missed the required next operational step.",
        status: "completed",
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    await analyzeRun(first.run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
      judgeClient: async () => ({
        overall_status: "partial_failure",
        success_score: 60,
        risk_score: 20,
        cost_efficiency_score: 80,
        failure_categories: ["prompt_weakness"],
        summary: "The prompt needs a tighter next-step instruction.",
        evidence: ["The answer omitted the required next step."],
        recommended_actions: [
          {
            type: "prompt_update",
            severity: "medium",
            title: "Clarify required next step for coverage",
            description: "Add an instruction requiring the agent to state the next operational step.",
            expected_impact: "Improves task completion quality.",
          },
          {
            type: "eval_case",
            severity: "low",
            title: "Replay next-step omission for coverage",
            description: "Replay the missing-next-step case before prompt promotion.",
            expected_impact: "Prevents prompt regressions.",
          },
        ],
        needs_human_review: false,
      }),
    });

    const suggestion = db.prepare("SELECT id FROM optimization_suggestions WHERE type = ?").get("prompt");
    const feedback = storeFeedback(
      {
        project_id: "project_alpha",
        target_type: "suggestion",
        target_id: suggestion.id,
        feedback_type: "approve",
        comment: "Replay passed, but coverage should still gate.",
      },
      { db, skipMigrate: true, createdAt: "2026-05-21T12:30:00.000Z" }
    );

    const evalCase = db.prepare("SELECT * FROM eval_cases WHERE project_id = ?").get("project_alpha");
    const replay = runEvalReplay("project_alpha", "agent_support", {
      prompt_version_id: feedback.prompt_version_id,
      eval_case_ids: [evalCase.id],
      candidate_outputs: {
        [evalCase.id]: "The agent states the order status, names the next operational step, and asks for human confirmation before continuing.",
      },
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:40:00.000Z",
    });

    assert.equal(replay.summary.gate_decision, "passed");

    const second = ingestAgentRun(
      sampleRun({
        run_id_external: "external_prompt_coverage_2",
        output: "The agent leaked token=abc into the customer-visible answer.",
        status: "completed",
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:42:00.000Z" }
    );

    await analyzeRun(second.run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:43:00.000Z",
      judgeClient: async () => ({
        overall_status: "high_risk",
        success_score: 35,
        risk_score: 92,
        cost_efficiency_score: 70,
        failure_categories: ["unsafe_output"],
        summary: "Sensitive token leaked into output.",
        evidence: ["token=abc"],
        recommended_actions: [],
        needs_human_review: true,
      }),
    });

    const blocked = checkPromptPromotionReadiness("project_alpha", feedback.prompt_version_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:45:00.000Z",
    });

    assert.equal(blocked.eval_replay_gate.gate_decision, "passed");
    assert.equal(blocked.decision, "blocked_missing_eval_coverage");
    assert.equal(blocked.status, "promotion_blocked");
    assert.equal(blocked.eval_coverage.summary.missing_eval_taxonomy_count, 1);
    assert.equal(blocked.eval_coverage_gate.decision, "blocked_missing_eval_coverage");
    assert.equal(db.prepare("SELECT status FROM prompt_versions WHERE id = ?").get(feedback.prompt_version_id).status, "promotion_blocked");

    const checks = listProjectPromptPromotionChecks("project_alpha", { db, skipMigrate: true });
    assert.equal(checks[0].metadata_json.eval_coverage.summary.missing_eval_taxonomy_count, 1);
  } finally {
    cleanup();
  }
});

test("approving a risk suggestion creates a disabled policy rule draft", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({
        output: "Refund workflow prepared and send_email_customer was available.",
        tools_used: ["payment_refund", "send_email_customer"],
        cost: 0.64,
      }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
      judgeClient: async () => ({
        overall_status: "high_risk",
        success_score: 70,
        risk_score: 85,
        cost_efficiency_score: 60,
        failure_categories: ["permission_risk"],
        summary: "Privileged customer-impacting tools require approval.",
        evidence: ["The run had access to payment_refund and send_email_customer."],
        recommended_actions: [
          {
            type: "policy_rule",
            severity: "high",
            title: "Gate refund and customer-email tools",
            description: "Require human approval before payment_refund or send_email_customer can run autonomously.",
            expected_impact: "Prevents unintended customer-impacting actions.",
          },
        ],
        needs_human_review: true,
      }),
    });

    const suggestion = db.prepare("SELECT id FROM optimization_suggestions WHERE type = ?").get("risk");
    const feedback = storeFeedback(
      {
        project_id: "project_alpha",
        target_type: "suggestion",
        target_id: suggestion.id,
        feedback_type: "approve",
        comment: "Create a draft rule, but do not enable it yet.",
      },
      { db, skipMigrate: true, createdAt: "2026-05-21T12:30:00.000Z" }
    );

    assert.match(feedback.policy_rule_id, /^policy_/);
    assert.equal(feedback.prompt_version_id, undefined);
    assert.equal(feedback.suggestion_status, "approved");

    const rules = listProjectPolicyRules("project_alpha", { db, skipMigrate: true });
    assert.equal(rules.length, 1);
    assert.equal(rules[0].id, feedback.policy_rule_id);
    assert.equal(rules[0].enabled, false);
    assert.equal(rules[0].version, 1);
    assert.equal(rules[0].rule_type, "risk_control");
    assert.equal(rules[0].config_json.mode, "draft_only");
    assert.equal(rules[0].config_json.suggestion_id, suggestion.id);
    assert.equal(rules[0].config_json.human_review_required, true);

    const draftOnlyDossier = buildPolicyGovernanceDossier(feedback.policy_rule_id, {
      db,
      skipMigrate: true,
      generatedAt: "2026-05-21T12:31:00.000Z",
    });
    assert.equal(draftOnlyDossier.advancement_readiness.current_review_status, "draft_review");
    assert.equal(draftOnlyDossier.advancement_readiness.next_review_status, "reviewed");
    assert.equal(draftOnlyDossier.advancement_readiness.advancement_status, "blocked_missing_evidence");
    assert.equal(draftOnlyDossier.advancement_readiness.can_advance_review_status, false);
    assert.equal(draftOnlyDossier.advancement_readiness.can_enable_policy, false);
    assert.ok(draftOnlyDossier.advancement_readiness.blockers.some((item) => item.code === "dry_run_evidence_exists"));
    assert.ok(draftOnlyDossier.advancement_readiness.blockers.some((item) => item.code === "review_task_completed"));
    const draftOnlyWorkbench = buildPolicyReviewWorkbenchFromDossier(draftOnlyDossier);
    assert.equal(draftOnlyWorkbench.advancement_status, "blocked_missing_evidence");
    assert.equal(draftOnlyWorkbench.summary.open_work_item_count, draftOnlyDossier.advancement_readiness.blockers.length);
    assert.equal(draftOnlyWorkbench.summary.ready_decision_count, 0);
    assert.equal(draftOnlyWorkbench.summary.can_enable_policy, false);
    assert.ok(draftOnlyWorkbench.work_items.some((item) => item.action_type === "run_policy_dry_run"));
    assert.ok(draftOnlyWorkbench.work_items.some((item) => item.action_type === "complete_review_task"));
    const workItemEvent = recordPolicyReviewWorkItemEvent(feedback.policy_rule_id, {
      work_item_id: "policy_work_dry_run_evidence_exists",
      event_type: "acknowledged",
      note: "Operator acknowledged missing dry-run evidence.",
      evidence: { source: "unit_test" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:32:00.000Z",
    });
    assert.equal(workItemEvent.policy_review_work_item_event.work_item_id, "policy_work_dry_run_evidence_exists");
    assert.equal(workItemEvent.policy_review_work_item_event.event_type, "acknowledged");
    assert.equal(workItemEvent.policy_review_work_item_event.evidence.mutates_state, false);
    assert.equal(workItemEvent.policy_review_work_item_event.evidence.can_enable_policy, false);
    assert.equal(workItemEvent.policy_review_workbench.summary.work_item_event_count, 1);
    assert.equal(listPolicyReviewWorkItemEvents(feedback.policy_rule_id, { db, skipMigrate: true }).length, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = ?")
        .get("policy_review_work_item.event_recorded").count,
      1
    );
    const earlyEffectiveness = evaluatePolicyReviewWorkItemEffectiveness(feedback.policy_rule_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:33:00.000Z",
    });
    assert.equal(earlyEffectiveness.effectiveness_count, 1);
    assert.equal(earlyEffectiveness.effectiveness[0].effectiveness_status, "no_measurable_improvement");
    assert.equal(earlyEffectiveness.effectiveness[0].readiness_score_delta, 0);
    assert.equal(earlyEffectiveness.effectiveness[0].blocker_cleared, false);

    const dryRun = dryRunPolicyRules("project_alpha", "2026-05-21", { db, skipMigrate: true });
    assert.equal(dryRun.summary.draft_rule_count, 1);
    assert.equal(dryRun.summary.rules_with_matches, 1);
    assert.equal(dryRun.summary.matched_run_count, 1);
    assert.equal(dryRun.summary.high_risk_matched_run_count, 1);
    assert.equal(dryRun.results[0].policy_rule_id, feedback.policy_rule_id);
    assert.equal(dryRun.results[0].matches[0].run_id, run_id);
    assert.ok(dryRun.results[0].matches[0].matched_tools.includes("payment_refund"));
    assert.equal(dryRun.results[0].review_packet.review_readiness, "high_priority_review");
    assert.equal(dryRun.results[0].review_packet.recommended_review_status, "approved_for_dry_run");
    assert.equal(dryRun.results[0].review_packet.evidence_summary.high_risk_match_count, 1);
    assert.equal(dryRun.results[0].review_packet.evidence_summary.false_positive_risk, "low");
    assert.equal(dryRun.results[0].review_packet.required_review_samples[0].run_id, run_id);
    assert.equal(dryRun.results[0].review_packet.safety_boundary, "advisory_only_no_automatic_execution");

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    assert.equal(report.json.learning_assets.policy_rules, 1);
    assert.equal(report.json.learning_assets.policy_dry_runs, 1);
    assert.equal(report.json.learning_assets.policy_dry_run_matches, 1);
    assert.equal(report.json.learning_assets.user_feedback_labels, 1);
    assert.ok(report.json.learning_assets.feedback_by_type.some((item) => item.name === "approve" && item.count === 1));
    assert.ok(report.json.learning_assets.suggestions_by_status.some((item) => item.name === "approved" && item.count === 1));
    assert.equal(report.json.policy_dry_run_summary.draft_rule_count, 1);
    assert.equal(report.json.policy_dry_run_summary.rules_with_matches, 1);
    assert.equal(report.json.policy_dry_run_results[0].match_count, 1);
    assert.equal(report.json.policy_dry_run_results[0].review_packet.review_readiness, "high_priority_review");
    assert.equal(report.json.policy_dry_run_results[0].review_packet.recommended_review_status, "approved_for_dry_run");
    assert.equal(report.json.policy_review_tasks.length, 1);
    assert.equal(report.json.policy_review_tasks[0].policy_rule_id, feedback.policy_rule_id);
    assert.equal(report.json.policy_review_tasks[0].review_readiness, "high_priority_review");
    assert.equal(report.json.policy_review_tasks[0].recommended_review_status, "approved_for_dry_run");
    assert.equal(report.json.policy_review_tasks[0].status, "open");
    assert.ok(report.json.policy_review_tasks[0].priority >= 90);
    assert.equal(report.json.policy_review_tasks[0].task.sample_run_ids[0], run_id);
    assert.equal(report.json.policy_review_tasks[0].task.safety_boundary, "advisory_only_no_automatic_execution");
    assert.equal(report.json.learning_assets.policy_review_tasks, 1);
    assert.equal(report.json.policy_dry_run_evidence.length, 1);
    assert.equal(report.json.policy_dry_run_evidence[0].policy_rule_id, feedback.policy_rule_id);
    assert.equal(report.json.policy_dry_run_evidence[0].match_evidence_count, 1);
    assert.ok(report.json.next_actions.some((item) => item.type === "policy_review"));
    assert.match(report.markdown, /Policy rules: 1/);
    assert.match(report.markdown, /Policy dry-runs: 1/);
    assert.match(report.markdown, /Policy Dry-Run Evidence/);
    assert.match(report.markdown, /Feedback labels by type: approve: 1/);
    assert.match(report.markdown, /Policy Draft Dry Run/);
    assert.match(report.markdown, /Policy Draft Review Packets/);
    assert.match(report.markdown, /Policy Review Task Queue/);
    assert.match(report.markdown, /Gate refund and customer-email tools: 1 historical runs would match this disabled draft/);
    assert.match(renderOperatorConsoleHtml({ report_json: report.json }, { locale: "zh-CN" }), /策略草案审核证据包/);
    assert.match(renderOperatorConsoleHtml({ report_json: report.json }, { locale: "zh-CN" }), /策略草案审核任务/);

    const persistedDryRuns = listPolicyDryRunEvidence("project_alpha", {
      db,
      skipMigrate: true,
      reportId: report.report_id,
    });
    assert.equal(persistedDryRuns.length, 1);
    assert.equal(persistedDryRuns[0].report_id, report.report_id);
    assert.equal(persistedDryRuns[0].policy_rule_id, feedback.policy_rule_id);
    assert.equal(persistedDryRuns[0].match_count, 1);
    assert.equal(persistedDryRuns[0].high_risk_match_count, 1);
    assert.equal(persistedDryRuns[0].summary_json.matched_run_ids[0], run_id);

    const matchEvidence = db.prepare(
      "SELECT * FROM policy_dry_run_matches WHERE policy_dry_run_id = ?"
    ).all(persistedDryRuns[0].id);
    assert.equal(matchEvidence.length, 1);
    assert.equal(matchEvidence[0].agent_run_id, run_id);
    assert.deepEqual(JSON.parse(matchEvidence[0].matched_tools), ["payment_refund", "send_email_customer"]);
    const policyReviewTasks = listProjectPolicyReviewTasks("project_alpha", {
      db,
      skipMigrate: true,
      reportId: report.report_id,
    });
    assert.equal(policyReviewTasks.length, 1);
    assert.equal(policyReviewTasks[0].task.review_questions.length, 4);
    assert.equal(policyReviewTasks[0].task.required_review_samples[0].run_id, run_id);
    const inReviewTask = updatePolicyReviewTaskStatus(policyReviewTasks[0].id, {
      status: "in_review",
      note: "Operator started reviewing matched high-risk samples.",
      evidence: { source: "unit_test", sample_run_ids: [run_id] },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:01:00.000Z",
    });
    assert.equal(inReviewTask.policy_review_task.status, "in_review");
    assert.equal(inReviewTask.policy_review_task_event.from_status, "open");
    assert.equal(inReviewTask.policy_review_task_event.to_status, "in_review");
    assert.equal(inReviewTask.policy_review_task_event.evidence.policy_rule_enabled_after_transition, false);
    const moreEvidenceTask = updatePolicyReviewTaskStatus(policyReviewTasks[0].id, {
      status: "needs_more_evidence",
      note: "Need one more dry-run window before final review.",
      evidence: { source: "unit_test", requested: "next_day_dry_run" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:02:00.000Z",
    });
    assert.equal(moreEvidenceTask.policy_review_task.status, "needs_more_evidence");
    const resumedTask = updatePolicyReviewTaskStatus(policyReviewTasks[0].id, {
      status: "in_review",
      note: "Additional dry-run evidence attached.",
      evidence: { source: "unit_test", dry_run_reviewed: true },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:03:00.000Z",
    });
    assert.equal(resumedTask.policy_review_task.status, "in_review");
    const completedTask = updatePolicyReviewTaskStatus(policyReviewTasks[0].id, {
      status: "completed",
      note: "Task completed; policy remains disabled and awaits policy review status change.",
      evidence: { source: "unit_test", true_positive: true },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:04:00.000Z",
    });
    assert.equal(completedTask.policy_review_task.status, "completed");
    assert.equal(completedTask.policy_rule_review_candidate.status, "pending");
    assert.equal(completedTask.policy_rule_review_candidate.policy_rule_id, feedback.policy_rule_id);
    assert.equal(completedTask.policy_rule_review_candidate.policy_review_task_id, policyReviewTasks[0].id);
    assert.equal(completedTask.policy_rule_review_candidate.from_review_status, "draft_review");
    assert.equal(completedTask.policy_rule_review_candidate.recommended_review_status, "reviewed");
    assert.equal(completedTask.policy_rule_review_candidate.candidate.target_review_status, "approved_for_dry_run");
    assert.equal(completedTask.policy_rule_review_candidate.candidate.reviewer_decision_required, true);
    assert.equal(completedTask.policy_rule_review_candidate.candidate.policy_rule_enabled_after_candidate, false);
    assert.equal(listPolicyReviewTaskEvents(policyReviewTasks[0].id, { db, skipMigrate: true }).length, 4);
    assert.equal(listProjectPolicyRuleReviewCandidates("project_alpha", { db, skipMigrate: true }).length, 1);
    assert.throws(
      () => updatePolicyReviewTaskStatus(policyReviewTasks[0].id, { status: "open" }, { db, skipMigrate: true }),
      /Invalid policy review task transition/
    );
    assert.equal(
      db.prepare("SELECT enabled FROM policy_rules WHERE id = ?").get(feedback.policy_rule_id).enabled,
      0
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = ? AND target_id = ?")
        .get("policy_review_task.status_updated", policyReviewTasks[0].id).count,
      4
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = ?")
        .get("policy_rule.review_candidate_created").count,
      1
    );
    const candidateBeforeAccept = listProjectPolicyRuleReviewCandidates("project_alpha", {
      db,
      skipMigrate: true,
      status: "pending",
    })[0];
    const acceptedCandidate = updatePolicyRuleReviewCandidateStatus(candidateBeforeAccept.id, {
      status: "accepted",
      note: "Accept candidate and move policy draft to reviewed status.",
      evidence: { source: "unit_test", reviewer: "operator" },
      actor_type: "test",
      actor_id: "operator",
    }, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:04:30.000Z",
    });
    assert.equal(acceptedCandidate.policy_rule_review_candidate.status, "accepted");
    assert.equal(acceptedCandidate.policy_rule_review_candidate_event.from_status, "pending");
    assert.equal(acceptedCandidate.policy_rule_review_candidate_event.to_status, "accepted");
    assert.equal(acceptedCandidate.policy_rule_update.policy_rule.review_status, "reviewed");
    assert.equal(acceptedCandidate.policy_rule_update.policy_rule.enabled, false);
    assert.equal(
      db.prepare("SELECT enabled FROM policy_rules WHERE id = ?").get(feedback.policy_rule_id).enabled,
      0
    );
    assert.equal(
      db.prepare("SELECT review_status FROM policy_rules WHERE id = ?").get(feedback.policy_rule_id).review_status,
      "reviewed"
    );
    assert.throws(
      () => updatePolicyRuleReviewCandidateStatus(candidateBeforeAccept.id, { status: "rejected" }, { db, skipMigrate: true }),
      /Invalid policy review candidate transition/
    );
    assert.equal(listProjectPolicyRuleReviewCandidateEvents("project_alpha", { db, skipMigrate: true }).length, 1);

    const policyDossier = buildPolicyGovernanceDossier(feedback.policy_rule_id, {
      db,
      skipMigrate: true,
      generatedAt: "2026-05-22T00:04:45.000Z",
    });
    assert.equal(policyDossier.policy_rule.id, feedback.policy_rule_id);
    assert.equal(policyDossier.policy_rule.enabled, false);
    assert.equal(policyDossier.policy_rule.review_status, "reviewed");
    assert.equal(policyDossier.safety_boundary, "advisory_only_no_automatic_execution");
    assert.equal(policyDossier.phase_1_boundary.read_only, true);
    assert.equal(policyDossier.phase_1_boundary.automatic_enforcement_allowed, false);
    assert.equal(policyDossier.source.type, "approved_suggestion");
    assert.equal(policyDossier.source.suggestion_id, suggestion.id);
    assert.equal(policyDossier.summary.dry_run_count, 1);
    assert.equal(policyDossier.summary.match_evidence_count, 1);
    assert.equal(policyDossier.summary.review_task_count, 1);
    assert.equal(policyDossier.summary.review_task_event_count, 4);
    assert.equal(policyDossier.summary.review_candidate_count, 1);
    assert.equal(policyDossier.summary.review_candidate_event_count, 1);
    assert.equal(policyDossier.summary.policy_rule_event_count, 1);
    assert.ok(policyDossier.summary.audit_event_count >= 3);
    assert.equal(policyDossier.advancement_readiness.current_review_status, "reviewed");
    assert.equal(policyDossier.advancement_readiness.next_review_status, "approved_for_dry_run");
    assert.equal(policyDossier.advancement_readiness.advancement_status, "ready_for_next_review_status");
    assert.equal(policyDossier.advancement_readiness.can_advance_review_status, true);
    assert.equal(policyDossier.advancement_readiness.can_enable_policy, false);
    assert.equal(policyDossier.advancement_readiness.can_enforce_policy, false);
    assert.equal(policyDossier.advancement_readiness.blockers.length, 0);
    assert.ok(policyDossier.advancement_readiness.requirements.every((item) => item.passed));
    const laterEffectiveness = evaluatePolicyReviewWorkItemEffectiveness(feedback.policy_rule_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:04:50.000Z",
    });
    assert.equal(laterEffectiveness.effectiveness_count, 1);
    assert.equal(laterEffectiveness.effectiveness[0].effectiveness_status, "blocker_cleared");
    assert.equal(laterEffectiveness.effectiveness[0].blocker_cleared, true);
    assert.ok(laterEffectiveness.effectiveness[0].readiness_score_delta > 0);
    assert.equal(listPolicyReviewWorkItemEffectiveness(feedback.policy_rule_id, { db, skipMigrate: true }).length, 1);
    const policyWorkbench = buildPolicyReviewWorkbenchFromDossier(policyDossier);
    assert.equal(policyWorkbench.summary.open_work_item_count, 0);
    assert.equal(policyWorkbench.summary.ready_decision_count, 1);
    assert.equal(policyWorkbench.summary.can_advance_review_status, true);
    assert.equal(policyWorkbench.summary.can_enable_policy, false);
    assert.equal(policyWorkbench.work_items[0].action_type, "consider_review_status_advancement");
    assert.match(policyWorkbench.work_items[0].operator_command, /PATCH \/api\/policy-rules\//);
    const policyWorkbenchMarkdown = renderPolicyReviewWorkbenchMarkdown(policyWorkbench);
    assert.match(policyWorkbenchMarkdown, /Policy Review Workbench/);
    assert.match(policyWorkbenchMarkdown, /Can enable policy: false/);
    assert.equal(policyDossier.dry_runs[0].matches[0].agent_run_id, run_id);
    assert.equal(policyDossier.review_tasks[0].events.length, 4);
    assert.equal(policyDossier.review_candidates[0].events[0].to_status, "accepted");
    assert.ok(policyDossier.evidence_chain.review_task_event_ids.length >= 4);
    assert.ok(policyDossier.evidence_chain.audit_event_ids.length >= 3);
    const policyDossierMarkdown = renderPolicyGovernanceDossierMarkdown(policyDossier);
    assert.match(policyDossierMarkdown, /Policy Governance Dossier/);
    assert.match(policyDossierMarkdown, /Safety boundary: advisory_only_no_automatic_execution/);
    assert.match(policyDossierMarkdown, /Automatic enforcement: false/);
    assert.match(policyDossierMarkdown, /Policy Advancement Readiness/);
    assert.match(policyDossierMarkdown, /Next review status: approved_for_dry_run/);
    assert.match(policyDossierMarkdown, /Can enable policy: false/);
    assert.match(policyDossierMarkdown, /Dry-runs: 1/);
    assert.match(policyDossierMarkdown, /Review task events: 4/);
    assert.match(renderOperatorConsoleHtml({ report_json: report.json }, { locale: "zh-CN" }), /策略治理证据包/);
    assert.match(renderOperatorConsoleHtml({ report_json: report.json }, { locale: "zh-CN" }), /npm run local:policy-dossier/);
    assert.match(renderOperatorConsoleHtml({ report_json: report.json }, { locale: "zh-CN" }), /策略审核工作台/);
    assert.match(renderOperatorConsoleHtml({ report_json: report.json }, { locale: "zh-CN" }), /npm run local:policy-workbench/);

    const secondReport = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-22T00:05:00.000Z",
    });
    const openTasks = listProjectPolicyReviewTasks("project_alpha", {
      db,
      skipMigrate: true,
      status: "open",
    });
    const supersededTasks = listProjectPolicyReviewTasks("project_alpha", {
      db,
      skipMigrate: true,
      status: "superseded",
    });
    assert.equal(openTasks.length, 1);
    assert.equal(openTasks[0].report_id, secondReport.report_id);
    assert.equal(supersededTasks.length, 0);
    assert.ok(secondReport.json.policy_review_task_events.length >= 4);
    assert.equal(secondReport.json.policy_rule_review_candidates.length, 1);
    assert.equal(secondReport.json.policy_rule_review_candidates[0].recommended_review_status, "reviewed");
    assert.equal(secondReport.json.policy_rule_review_candidates[0].status, "accepted");
    assert.equal(secondReport.json.policy_rule_review_candidate_events.length, 1);
    assert.equal(secondReport.json.learning_assets.policy_review_task_events, 4);
    assert.ok(secondReport.json.learning_assets.policy_review_work_item_events >= 1);
    assert.ok(secondReport.json.learning_assets.policy_review_work_item_effectiveness >= 1);
    assert.equal(secondReport.json.learning_assets.policy_rule_review_candidates, 1);
    assert.equal(secondReport.json.learning_assets.policy_rule_review_candidate_events, 1);
    assert.ok(secondReport.json.policy_review_work_item_events.length >= 1);
    assert.ok(secondReport.json.policy_review_work_item_effectiveness.length >= 1);
    assert.ok(secondReport.json.learning_rules.some((rule) => (
      rule.rule_type === "boost_policy_work_item_pattern" &&
      rule.pattern_json.target === "policy_review_work_item_effectiveness" &&
      rule.evidence_json.latest_effectiveness_status === "blocker_cleared"
    )));
    assert.ok(secondReport.json.learning_rule_review.summary.policy_work_item_effectiveness_rules >= 1);
    assert.ok(secondReport.json.learning_rule_review.summary.affected_policy_work_item_count >= 1);
    assert.ok(secondReport.json.learning_rule_review.learning_rule_review.some((rule) => (
      rule.rule_type === "boost_policy_work_item_pattern" &&
      rule.review.source === "policy_review_work_item_effectiveness" &&
      rule.review.affected_policy_work_items.length >= 1 &&
      rule.review.safety_boundary === "advisory_only_no_automatic_execution"
    )));
    const policyWorkItemRule = secondReport.json.learning_rules.find((rule) => (
      rule.rule_type === "boost_policy_work_item_pattern" &&
      rule.pattern_json.action_type === "run_policy_dry_run"
    ));
    const learningAdjustedPolicyWorkbench = buildPolicyReviewWorkbenchFromDossier(draftOnlyDossier, {
      learningRules: [policyWorkItemRule],
    });
    const boostedDryRunItem = learningAdjustedPolicyWorkbench.work_items.find((item) => item.action_type === "run_policy_dry_run");
    assert.ok(boostedDryRunItem.learning_priority_adjustment.adjustment > 0);
    assert.ok(boostedDryRunItem.priority > boostedDryRunItem.base_priority);
    assert.match(secondReport.markdown, /Policy Review Task Events/);
    assert.match(secondReport.markdown, /Policy Review Work Item Events/);
    assert.match(secondReport.markdown, /Policy Review Work Item Effectiveness/);
    assert.match(secondReport.markdown, /Policy Learning Review/);
    assert.match(secondReport.markdown, /Policy Rule Review Candidates/);
    assert.match(secondReport.markdown, /Policy Rule Review Candidate Events/);
    const secondReportZh = reportMarkdownForLocale({ ...secondReport, content_json: secondReport.json }, "zh-CN");
    assert.match(secondReportZh, /策略审核动作事件/);
    assert.match(secondReportZh, /策略审核动作效果/);
    assert.match(secondReportZh, /策略学习审核/);
    assert.match(secondReportZh, /npm run local:learning-rule-review/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN" }), /策略草案审核任务事件/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN" }), /策略学习审核/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN" }), /npm run local:learning-rule-review/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN", learningRuleForms: true }), /name="learning_rule_id"/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN", learningRuleForms: true }), /value="trusted"/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN", learningRuleForms: true }), /人工审核/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN" }), /信任前需要人工复核|保持启用并监控/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN" }), /策略审核动作事件/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN" }), /策略审核动作效果/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN" }), /策略状态候选动作/);
    assert.match(renderOperatorConsoleHtml({ report_json: secondReport.json }, { locale: "zh-CN" }), /策略候选动作事件/);
  } finally {
    cleanup();
  }
});

test("suggestion feedback updates suggestion status", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(
      sampleRun({ output: "Failed with timeout", cost: 1.25, status: "failed" }),
      { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" }
    );

    await analyzeRun(run_id, {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T12:05:00.000Z",
    });

    const suggestion = db.prepare("SELECT id FROM optimization_suggestions WHERE type = ?").get("cost");
    const feedback = storeFeedback(
      {
        project_id: "project_alpha",
        target_type: "suggestion",
        target_id: suggestion.id,
        feedback_type: "wrong",
        comment: "This is expected for this task type.",
      },
      { db, skipMigrate: true, createdAt: "2026-05-21T12:30:00.000Z" }
    );

    assert.equal(feedback.suggestion_status, "wrong");
    const updatedSuggestion = db.prepare("SELECT status FROM optimization_suggestions WHERE id = ?").get(suggestion.id);
    assert.equal(updatedSuggestion.status, "wrong");

    const report = generateNightlyReport("project_alpha", "2026-05-21", {
      db,
      skipMigrate: true,
      createdAt: "2026-05-21T23:59:00.000Z",
    });

    assert.equal(report.json.cost_opportunity.affected_run_count, 0);
    assert.equal(report.json.actionable_cost_suggestions.length, 0);
    assert.ok(report.json.suggestion_status_counts.some((item) => item.name === "wrong"));
    assert.equal(report.json.next_actions.some((item) => item.type === "cost_optimization"), false);
  } finally {
    cleanup();
  }
});

test("storeFeedback records user learning labels", () => {
  const { db, cleanup } = createTestDb();

  try {
    const { run_id } = ingestAgentRun(sampleRun(), { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" });
    const feedback = storeFeedback(
      {
        project_id: "project_alpha",
        target_type: "run",
        target_id: run_id,
        feedback_type: "useful",
        comment: "Good catch.",
      },
      { db, skipMigrate: true, createdAt: "2026-05-21T12:30:00.000Z" }
    );

    assert.match(feedback.feedback_id, /^feedback_/);
    const count = db.prepare("SELECT COUNT(*) AS count FROM user_feedback").get();
    assert.equal(count.count, 1);
  } finally {
    cleanup();
  }
});

test("storeFeedback rolls back invalid suggestion feedback", () => {
  const { db, cleanup } = createTestDb();

  try {
    ingestAgentRun(sampleRun(), { db, skipMigrate: true, createdAt: "2026-05-21T12:00:00.000Z" });

    assert.throws(
      () => storeFeedback(
        {
          project_id: "project_alpha",
          target_type: "suggestion",
          target_id: "suggestion_missing",
          feedback_type: "approve",
          comment: "This target does not exist.",
        },
        { db, skipMigrate: true, createdAt: "2026-05-21T12:30:00.000Z" }
      ),
      /Suggestion not found/
    );

    const feedbackCount = db.prepare("SELECT COUNT(*) AS count FROM user_feedback").get();
    assert.equal(feedbackCount.count, 0);
  } finally {
    cleanup();
  }
});

test("demo scenario runs the Phase 1 closed loop end to end", async () => {
  const { db, cleanup } = createTestDb();

  try {
    const result = await runDemoScenario({ db, skipMigrate: true });

    assert.equal(result.counts.runs, 5);
    assert.equal(result.counts.analyzed_runs, 5);
    assert.equal(result.counts.failed_run_analyses, 0);
    assert.equal(result.report_json.total_runs, 5);
    assert.ok(result.report_json.high_risk_count >= 1);
    assert.equal(result.report_json.cost_by_model[0].name, "gpt-5.5");
    assert.ok(result.report_json.cost_by_task_type.some((item) => item.name === "support_triage"));
    assert.equal(result.report_json.top_expensive_runs.length, 5);
    assert.ok(result.report_json.cost_opportunity.estimated_monthly_savings > 0);
    assert.ok(result.report_json.next_actions.length > 0);
    assert.ok(result.report_json.learning_assets.agent_run_traces >= 5);
    assert.ok(result.report_json.recurring_failure_patterns.some((item) => item.category === "tool_error"));
    assert.ok(result.counts.cost_suggestions >= 1);
    assert.ok(result.counts.prompt_suggestions >= 1);
    assert.ok(result.counts.risk_suggestions >= 1);
    assert.ok(result.report_json.risk_suggestions.length >= 1);
    assert.ok(result.counts.eval_cases >= 1);
    assert.ok(result.counts.failure_cases >= 1);
    assert.equal(result.counts.prompt_versions, 1);
    assert.equal(result.counts.policy_rules, 1);
    assert.ok(result.counts.learning_insights >= 1);
    assert.equal(result.counts.feedback_labels, 2);
    assert.equal(result.counts.deliveries, 1);
    assert.match(result.report_markdown, /Agent Nightly Health Report/);
    assert.match(result.report_markdown, /Compounding Data Assets/);
    assert.match(result.report_markdown, /Self-Evolution Memory/);
    assert.match(result.report_markdown, /tool_error: 2 cases/);
    const consoleHtml = renderOperatorConsoleHtml(result);
    assert.match(consoleHtml, /Operator Console/);
    assert.match(consoleHtml, /Self-Evolution Memory/);
    assert.match(consoleHtml, /Agent Runs/);
    assert.match(consoleHtml, /Suggestions/);
    const zhMarkdown = reportMarkdownForLocale({
      content_markdown: result.report_markdown,
      content_json: result.report_json,
      project_id: result.project_id,
    }, "zh-CN");
    assert.match(zhMarkdown, /AI Agent 夜间体检报告/);
    assert.match(zhMarkdown, /自我进化记忆/);
    assert.match(zhMarkdown, /成本优化建议/);
    assert.match(zhMarkdown, /风险治理建议/);
    const zhConsoleHtml = renderOperatorConsoleHtml(result, { locale: "zh-CN" });
    assert.match(zhConsoleHtml, /操作台/);
    assert.match(zhConsoleHtml, /自我进化记忆/);
    assert.match(zhConsoleHtml, /Agent 运行记录/);
    const zhLocalConsoleHtml = renderOperatorConsoleHtml(result, { locale: "zh-CN", showLocalCommands: true });
    assert.match(zhLocalConsoleHtml, /反馈闭环/);
    assert.match(zhLocalConsoleHtml, /npm run local:feedback/);
    assert.match(zhLocalConsoleHtml, /证据包/);
    assert.match(zhLocalConsoleHtml, /数据治理/);
    assert.match(zhLocalConsoleHtml, /可信档案/);
    assert.match(zhLocalConsoleHtml, /Eval 覆盖地图/);
    assert.match(zhLocalConsoleHtml, /npm run local:evidence/);
    assert.match(zhLocalConsoleHtml, /npm run local:verify-evidence/);
    assert.match(zhLocalConsoleHtml, /npm run local:readiness-dossier/);
    const zhFormConsoleHtml = renderOperatorConsoleHtml(result, { locale: "zh-CN", showLocalCommands: true, feedbackForms: true });
    assert.match(zhFormConsoleHtml, /method="post"/);
    assert.match(zhFormConsoleHtml, /name="feedback_type"/);
    assert.match(renderReportHtml({
      content_markdown: result.report_markdown,
      content_json: result.report_json,
      project_id: result.project_id,
    }, { locale: "zh-CN" }), /AI Agent 夜间体检报告/);
    assert.match(result.prompt_version_id, /^prompt_/);
    assert.match(result.policy_rule_id, /^policy_/);
  } finally {
    cleanup();
  }
});

test("local workspace records real local runs without demo fixtures", async () => {
  const { db, cleanup, dir } = createTestDb();
  const configPath = join(dir, "local-workspace.json");

  try {
    const workspace = bootstrapLocalWorkspace({
      db,
      skipMigrate: true,
      configPath,
      projectName: "Real Local Project",
      agentName: "Codex Local Adapter",
      createdAt: "2026-05-21T08:00:00.000Z",
    });

    assert.match(workspace.project_id, /^project_/);
    assert.match(workspace.agent_id, /^agent_/);
    assert.equal(workspace.reused, false);

    const recorded = await recordLocalAgentRun(
      {
        input: "Continue building the AI Worker Control Plane into a real local-data product.",
        output: "Implemented local bootstrap, local run recording, and local preview scripts.",
        status: "completed",
        task_type: "codex_engineering",
        tools_used: ["filesystem", "shell", "tests"],
      },
      {
        db,
        skipMigrate: true,
        configPath,
        cwd: dir,
        createdAt: "2026-05-21T09:00:00.000Z",
      }
    );

    assert.equal(recorded.workspace.project_id, workspace.project_id);
    assert.match(recorded.run_id, /^run_/);
    assert.match(recorded.judgement_id, /^judgement_/);

    const run = getAgentRun(recorded.run_id, { db, skipMigrate: true });
    assert.equal(run.metadata.source, "local_real_data_adapter");
    assert.equal(run.metadata.task_type, "codex_engineering");
    assert.equal(run.metadata.git.is_git_repo, false);

    const judgement = getRunJudgement(recorded.judgement_id, { db, skipMigrate: true });
    assert.ok(["success", "partial_failure", "failure", "high_risk", "unknown"].includes(judgement.overall_status));

    const preview = await buildLocalPreviewResult({
      db,
      skipMigrate: true,
      configPath,
      forceGenerate: true,
    });
    assert.equal(preview.date, "2026-05-21");
    assert.equal(preview.report_json.total_runs, 1);
    assert.equal(preview.report_json.data_provenance.source_type, "local_workspace");
    assert.equal(preview.report_json.data_provenance.evidence_trust_level, "local_development");
    assert.equal(preview.report_json.data_provenance.readiness_evidence_status, "development_only_not_customer_production");
    assert.equal(preview.report_json.data_provenance.local_adapter_runs, 1);
    assert.equal(preview.report_json.data_provenance.certification_evidence_ready, false);
    assert.ok(preview.report_json.autonomy_certification_roadmaps[0].hard_blockers.some((item) => item.code === "local_development_evidence_not_certifiable"));
    assert.equal(preview.report_json.autonomy_certification_roadmaps[0].certification_state.evidence_inputs.evidence_trust_level, "local_development");
  } finally {
    cleanup();
  }
});

test("example webhook payloads stay valid", () => {
  const examplePaths = [
    "examples/run-payload.support-success.json",
    "examples/run-payload.risky-cost.json",
  ];

  for (const examplePath of examplePaths) {
    const payload = JSON.parse(readFileSync(new URL(`../${examplePath}`, import.meta.url), "utf8"));
    const normalized = validateRunPayload(payload);

    assert.equal(normalized.project_id, payload.project_id);
    assert.equal(normalized.agent_id, payload.agent_id);
    assert.ok(normalized.metadata.task_type);
  }
});
