import { rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, migrate } from "./db.mjs";
import { createAgent, createProject } from "./projects.mjs";
import { ingestAgentRun } from "./runs.mjs";
import { heuristicJudgeClient } from "./judge.mjs";
import { runNightlyHealthCheck } from "./nightly.mjs";
import { createReportSubscription } from "./report-subscriptions.mjs";
import { storeFeedback } from "./feedback.mjs";
import {
  getRunTrace,
  listProjectEvalCases,
  listProjectFailureCases,
  listProjectRuns,
  listProjectSuggestions,
} from "./assets.mjs";

const DEMO_DATE = "2026-05-21";

function demoRuns(projectId, agentId) {
  return [
    {
      project_id: projectId,
      agent_id: agentId,
      run_id_external: "demo_success_001",
      input: "Customer asks for order status on order A-100.",
      output: "Order A-100 is in transit and expected tomorrow.",
      model: "gpt-5.5",
      provider: "openai",
      tools_used: ["order_lookup"],
      cost: 0.08,
      latency: 3.2,
      status: "completed",
      metadata: { prompt_tokens: 220, completion_tokens: 90, total_tokens: 310, task_type: "support_triage" },
    },
    {
      project_id: projectId,
      agent_id: agentId,
      run_id_external: "demo_tool_timeout_002",
      input: "Customer asks to check refund status for R-404.",
      output: "Failed with timeout while calling refund_lookup.",
      model: "gpt-5.5",
      provider: "openai",
      tools_used: ["refund_lookup"],
      cost: 0.72,
      latency: 42.5,
      status: "failed",
      metadata: { prompt_tokens: 1800, completion_tokens: 120, total_tokens: 1920, task_type: "support_triage" },
    },
    {
      project_id: projectId,
      agent_id: agentId,
      run_id_external: "demo_sensitive_003",
      input: "User pasted a password token=abc123 and asked for account help.",
      output: "I can help, but the message included token=abc123 and should be redacted before processing.",
      model: "gpt-5.5",
      provider: "openai",
      tools_used: ["account_lookup"],
      cost: 0.19,
      latency: 7.4,
      status: "completed",
      metadata: { prompt_tokens: 760, completion_tokens: 160, total_tokens: 920, task_type: "account_support" },
    },
    {
      project_id: projectId,
      agent_id: agentId,
      run_id_external: "demo_missing_context_004",
      input: "Ambiguous request: please process the thing for the customer.",
      output: "I do not have enough information; missing context includes customer ID and requested action.",
      model: "gpt-5.5",
      provider: "openai",
      tools_used: [],
      cost: 0.11,
      latency: 5.1,
      status: "completed",
      metadata: { prompt_tokens: 500, completion_tokens: 140, total_tokens: 640, task_type: "support_triage" },
    },
    {
      project_id: projectId,
      agent_id: agentId,
      run_id_external: "demo_privileged_005",
      input: "Agent tried to issue a refund and send confirmation email without approval.",
      output: "Refund workflow prepared, but the payment tool returned timeout; human approval required before execution.",
      model: "gpt-5.5",
      provider: "openai",
      tools_used: ["payment_refund", "send_email_customer"],
      cost: 0.64,
      latency: 18.8,
      status: "completed",
      metadata: { prompt_tokens: 1400, completion_tokens: 260, total_tokens: 1660, task_type: "refund_ops" },
    },
  ];
}

export async function runDemoScenario(options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const date = options.date || DEMO_DATE;
    const project = createProject(
      {
        name: "Demo AI Worker Control Plane",
        org_name: "Demo Operations",
        description: "Demo project for Agent Nightly Health Report + Cost Optimization.",
      },
      { db, skipMigrate: true, createdAt: `${date}T08:00:00.000Z` }
    );
    const agent = createAgent(
      {
        project_id: project.project_id,
        name: "Support Triage Agent",
        description: "Handles support triage, lookup, and refund-prep workflows.",
        environment: "production",
      },
      { db, skipMigrate: true, createdAt: `${date}T08:05:00.000Z` }
    );
    const subscription = createReportSubscription(
      project.project_id,
      { recipient: "ops@example.com", channel: "email", provider: "local" },
      { db, skipMigrate: true, createdAt: `${date}T08:10:00.000Z` }
    );

    const runIds = [];
    const runs = demoRuns(project.project_id, agent.agent_id);
    for (const [index, run] of runs.entries()) {
      const createdAt = `${date}T${String(10 + index).padStart(2, "0")}:00:00.000Z`;
      const result = ingestAgentRun(run, {
        db,
        skipMigrate: true,
        requireExistingScope: true,
        createdAt,
      });
      runIds.push(result.run_id);
    }

    const nightly = await runNightlyHealthCheck(project.project_id, date, {
      db,
      skipMigrate: true,
      judgeClient: heuristicJudgeClient,
      createdAt: `${date}T23:55:00.000Z`,
    });

    const promptSuggestion = listProjectSuggestions(project.project_id, {
      db,
      skipMigrate: true,
      type: "prompt",
      limit: 1,
    })[0];
    const feedback = promptSuggestion
      ? storeFeedback(
        {
          project_id: project.project_id,
          target_type: "suggestion",
          target_id: promptSuggestion.id,
          feedback_type: "approve",
          comment: "Demo: turn the prompt recommendation into an approved draft.",
        },
        { db, skipMigrate: true, createdAt: `${date}T23:58:00.000Z` }
      )
      : null;
    const riskSuggestion = listProjectSuggestions(project.project_id, {
      db,
      skipMigrate: true,
      type: "risk",
      limit: 1,
    })[0];
    const riskFeedback = riskSuggestion
      ? storeFeedback(
        {
          project_id: project.project_id,
          target_type: "suggestion",
          target_id: riskSuggestion.id,
          feedback_type: "approve",
          comment: "Demo: turn the risk recommendation into a disabled policy draft.",
        },
        { db, skipMigrate: true, createdAt: `${date}T23:59:00.000Z` }
      )
      : null;

    const suggestions = listProjectSuggestions(project.project_id, { db, skipMigrate: true, limit: 50 });
    const evalCases = listProjectEvalCases(project.project_id, { db, skipMigrate: true, limit: 50 });
    const failureCases = listProjectFailureCases(project.project_id, { db, skipMigrate: true, limit: 50 });
    const storedRuns = listProjectRuns(project.project_id, { db, skipMigrate: true, limit: 50 });
    const promptVersionCount = db.prepare("SELECT COUNT(*) AS count FROM prompt_versions WHERE project_id = ?").get(project.project_id).count;
    const policyRuleCount = db.prepare("SELECT COUNT(*) AS count FROM policy_rules WHERE project_id = ?").get(project.project_id).count;
    const feedbackCount = db.prepare("SELECT COUNT(*) AS count FROM user_feedback WHERE project_id = ?").get(project.project_id).count;
    const learningInsightCount = db.prepare("SELECT COUNT(*) AS count FROM learning_insights WHERE project_id = ?").get(project.project_id).count;
    const trace = getRunTrace(runIds[1], { db, skipMigrate: true });

    return {
      date,
      project_id: project.project_id,
      agent_id: agent.agent_id,
      ingestion_api_key_prefix: project.ingestion_api_key_prefix,
      subscription_id: subscription.id,
      run_ids: runIds,
      sample_trace_run_id: trace.run.id,
      report_id: nightly.report_id,
      report_markdown: nightly.markdown,
      report_json: nightly.json,
      deliveries: nightly.deliveries,
      approved_prompt_suggestion_id: promptSuggestion?.id ?? null,
      approved_risk_suggestion_id: riskSuggestion?.id ?? null,
      prompt_version_id: feedback?.prompt_version_id ?? null,
      policy_rule_id: riskFeedback?.policy_rule_id ?? null,
      counts: {
        runs: storedRuns.length,
        analyzed_runs: nightly.analyzed_count,
        failed_run_analyses: nightly.failed_analysis_count,
        suggestions: suggestions.length,
        cost_suggestions: suggestions.filter((item) => item.type === "cost").length,
        prompt_suggestions: suggestions.filter((item) => item.type === "prompt").length,
        risk_suggestions: suggestions.filter((item) => item.type === "risk").length,
        eval_cases: evalCases.length,
        failure_cases: failureCases.length,
        prompt_versions: Number(promptVersionCount),
        policy_rules: Number(policyRuleCount),
        learning_insights: Number(learningInsightCount),
        feedback_labels: Number(feedbackCount),
        deliveries: nightly.deliveries.length,
      },
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export async function runTemporaryDemoScenario(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aiwc-demo-"));
  const dbPath = join(dir, "demo.sqlite");

  try {
    const result = await runDemoScenario({ ...options, dbPath });
    return { ...result, db_path: dbPath, db_persisted: Boolean(options.keepDatabase) };
  } finally {
    if (!options.keepDatabase) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
