import { fromJson, migrate, nowIso, openDatabase } from "./db.mjs";
import { heuristicJudgeClient } from "./judge.mjs";
import { createId } from "./ids.mjs";
import { runNightlyHealthCheck } from "./nightly.mjs";
import { renderOperatorConsoleHtml } from "./operator-console-rendering.mjs";
import { getReport } from "./reports.mjs";
import { createAgent, createProject } from "./projects.mjs";
import { ingestAgentRun } from "./runs.mjs";
import { AUTONOMY_LEVELS, normalizeAutonomyLevel } from "./certification-policies.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function latestProjectId(db) {
  const reportProject = db.prepare(
    `SELECT project_id
     FROM reports
     ORDER BY created_at DESC
     LIMIT 1`
  ).get();
  if (reportProject?.project_id) return reportProject.project_id;

  const project = db.prepare(
    `SELECT id
     FROM projects
     ORDER BY created_at DESC
     LIMIT 1`
  ).get();
  return project?.id || null;
}

function countOne(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.count || 0);
}

function consoleProjectCounts(db, projectId, reportJson = {}, deliveries = []) {
  return {
    runs: countOne(db, "SELECT COUNT(*) AS count FROM agent_runs WHERE project_id = ?", projectId),
    analyzed_runs: countOne(
      db,
      `SELECT COUNT(*) AS count
       FROM run_judgements j
       JOIN agent_runs r ON r.id = j.agent_run_id
       WHERE r.project_id = ?`,
      projectId
    ),
    failed_run_analyses: countOne(db, "SELECT COUNT(*) AS count FROM job_events WHERE project_id = ? AND status = 'failed'", projectId),
    suggestions: countOne(db, "SELECT COUNT(*) AS count FROM optimization_suggestions WHERE project_id = ?", projectId),
    cost_suggestions: countOne(db, "SELECT COUNT(*) AS count FROM optimization_suggestions WHERE project_id = ? AND type = 'cost'", projectId),
    prompt_suggestions: countOne(db, "SELECT COUNT(*) AS count FROM optimization_suggestions WHERE project_id = ? AND type = 'prompt'", projectId),
    risk_suggestions: countOne(db, "SELECT COUNT(*) AS count FROM optimization_suggestions WHERE project_id = ? AND type = 'risk'", projectId),
    eval_cases: countOne(db, "SELECT COUNT(*) AS count FROM eval_cases WHERE project_id = ?", projectId),
    failure_cases: countOne(
      db,
      `SELECT COUNT(*) AS count
       FROM failure_cases f
       JOIN agent_runs r ON r.id = f.agent_run_id
       WHERE r.project_id = ?`,
      projectId
    ),
    prompt_versions: countOne(db, "SELECT COUNT(*) AS count FROM prompt_versions WHERE project_id = ?", projectId),
    policy_rules: countOne(db, "SELECT COUNT(*) AS count FROM policy_rules WHERE project_id = ?", projectId),
    learning_rules: countOne(db, "SELECT COUNT(*) AS count FROM learning_rules WHERE project_id = ?", projectId),
    learning_rule_events: countOne(db, "SELECT COUNT(*) AS count FROM learning_rule_events WHERE project_id = ?", projectId),
    learning_insights: reportJson.learning_insights?.length || countOne(db, "SELECT COUNT(*) AS count FROM learning_insights WHERE project_id = ?", projectId),
    feedback_labels: countOne(db, "SELECT COUNT(*) AS count FROM user_feedback WHERE project_id = ?", projectId),
    deliveries: deliveries.length,
  };
}

function latestAgentId(db, projectId, reportJson = {}) {
  const scoredAgent = reportJson.autonomy_readiness?.agent_scores?.[0]?.target_id;
  if (scoredAgent) return scoredAgent;

  const runAgent = db.prepare(
    `SELECT agent_id
     FROM agent_runs
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(projectId);
  if (runAgent?.agent_id) return runAgent.agent_id;

  const agent = db.prepare(
    `SELECT id
     FROM agents
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(projectId);
  return agent?.id || "";
}

function latestReport(db, projectId) {
  const row = db.prepare(
    `SELECT id
     FROM reports
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(projectId);
  return row ? getReport(row.id, { db, skipMigrate: true }) : null;
}

function listConsoleProjects(db) {
  return db.prepare(
    `SELECT
       p.id,
       p.name,
       COUNT(DISTINCT r.id) AS report_count,
       COUNT(DISTINCT ar.id) AS run_count
     FROM projects p
     LEFT JOIN reports r ON r.project_id = p.id
     LEFT JOIN agent_runs ar ON ar.project_id = p.id
     GROUP BY p.id
     ORDER BY MAX(COALESCE(r.created_at, p.created_at)) DESC, p.created_at DESC
     LIMIT 100`
  ).all().map((row) => ({
    ...row,
    report_count: Number(row.report_count || 0),
    run_count: Number(row.run_count || 0),
  }));
}

function listConsoleReports(db, projectId) {
  return db.prepare(
    `SELECT id, report_type, period_start, period_end, created_at
     FROM reports
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 20`
  ).all(projectId);
}

function consoleControlsHtml({ locale, projectId, reportId, projects, reports, generated, targetAutonomyLevel }) {
  const zh = String(locale || "").toLowerCase().startsWith("zh");
  const selectedTarget = normalizeAutonomyLevel(targetAutonomyLevel || "L2");
  const projectOptions = projects.map((project) => [
    `<option value="${escapeHtml(project.id)}" ${project.id === projectId ? "selected" : ""}>`,
    `${escapeHtml(project.name || project.id)} (${project.run_count} runs / ${project.report_count} reports)`,
    `</option>`,
  ].join(""));
  const reportOptions = reports.map((report) => [
    `<option value="${escapeHtml(report.id)}" ${report.id === reportId ? "selected" : ""}>`,
    `${escapeHtml(String(report.period_start || "").slice(0, 10) || report.report_type)} / ${escapeHtml(report.id)}`,
    `</option>`,
  ].join(""));
  const targetOptions = Object.entries(AUTONOMY_LEVELS).map(([level, config]) => [
    `<option value="${escapeHtml(level)}" ${level === selectedTarget ? "selected" : ""}>`,
    `${escapeHtml(level)} / ${escapeHtml(config.label)} / ${config.target_score}/100`,
    `</option>`,
  ].join(""));

  return [
    `<section class="panel" id="console-controls" style="margin-bottom:14px">`,
    `<h2>${zh ? "控制台" : "Console Controls"}</h2>`,
    generated ? `<p><span class="pill good">${zh ? "已显式生成新报告" : "Generated a new report explicitly"}</span></p>` : "",
    `<div class="row">`,
    `<form method="get" action="/console" class="button-row">`,
    `<label>${zh ? "项目" : "Project"} <select class="compact-input" name="project">${projectOptions.join("")}</select></label>`,
    `<button type="submit">${zh ? "切换" : "Switch"}</button>`,
    `</form>`,
    `<form method="get" action="/console" class="button-row">`,
    `<input type="hidden" name="project" value="${escapeHtml(projectId)}">`,
    `<input type="hidden" name="target" value="${escapeHtml(selectedTarget)}">`,
    `<label>${zh ? "报告" : "Report"} <select class="compact-input" name="report">${reportOptions.join("")}</select></label>`,
    `<button type="submit">${zh ? "查看报告" : "View Report"}</button>`,
    `</form>`,
    `<form method="get" action="/console" class="button-row">`,
    `<input type="hidden" name="project" value="${escapeHtml(projectId)}">`,
    `<input type="hidden" name="generate" value="1">`,
    `<label>${zh ? "认证目标" : "Target"} <select class="compact-input" name="target">${targetOptions.join("")}</select></label>`,
    `<button type="submit">${zh ? "手动生成新报告" : "Generate Report"}</button>`,
    `</form>`,
    `</div>`,
    `<p class="muted">${zh ? "默认只读。只有点击“手动生成新报告”或提交审核表单才会写入数据库。" : "Read-only by default. Only explicit generation or review form submission writes to the database."}</p>`,
    `</section>`,
  ].join("");
}

function injectConsoleControls(html, controlsHtml, onboardingHtml = "") {
  return html.replace("</header>", `</header>\n${controlsHtml}\n${onboardingHtml}`);
}

function deliveriesForReport(db, reportId) {
  if (!reportId) return [];
  return db.prepare(
    `SELECT *
     FROM report_deliveries
     WHERE report_id = ?
     ORDER BY created_at DESC`
  ).all(reportId).map((row) => ({
    ...row,
    metadata: fromJson(row.metadata, {}),
  }));
}

function latestProjectAgents(db, projectId) {
  if (!projectId) return [];
  return db.prepare(
    `SELECT id, name, environment, created_at
     FROM agents
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 20`
  ).all(projectId);
}

export function buildOnboardingChecklist(db, projectId = null) {
  const projectCount = countOne(db, "SELECT COUNT(*) AS count FROM projects");
  const projectExists = projectId
    ? countOne(db, "SELECT COUNT(*) AS count FROM projects WHERE id = ?", projectId) > 0
    : projectCount > 0;
  const agentCount = projectId
    ? countOne(db, "SELECT COUNT(*) AS count FROM agents WHERE project_id = ?", projectId)
    : 0;
  const runCount = projectId
    ? countOne(db, "SELECT COUNT(*) AS count FROM agent_runs WHERE project_id = ?", projectId)
    : 0;
  const reportCount = projectId
    ? countOne(db, "SELECT COUNT(*) AS count FROM reports WHERE project_id = ?", projectId)
    : 0;

  return {
    project_id: projectId,
    complete: Boolean(projectExists && agentCount > 0 && runCount > 0 && reportCount > 0),
    counts: {
      projects: projectCount,
      agents: agentCount,
      runs: runCount,
      reports: reportCount,
    },
    steps: [
      {
        key: "project",
        done: Boolean(projectExists),
        label_zh: "创建项目",
        label_en: "Create project",
        detail_zh: projectExists ? `已选择项目 ${projectId || "latest"}` : "还没有项目",
        detail_en: projectExists ? `Selected project ${projectId || "latest"}` : "No project yet",
      },
      {
        key: "agent",
        done: agentCount > 0,
        label_zh: "创建 Agent",
        label_en: "Create Agent",
        detail_zh: `${agentCount} 个 Agent`,
        detail_en: `${agentCount} agents`,
      },
      {
        key: "run",
        done: runCount > 0,
        label_zh: "接入 Run",
        label_en: "Ingest Run",
        detail_zh: `${runCount} 条运行记录`,
        detail_en: `${runCount} run records`,
      },
      {
        key: "report",
        done: reportCount > 0,
        label_zh: "生成报告",
        label_en: "Generate Report",
        detail_zh: `${reportCount} 份报告`,
        detail_en: `${reportCount} reports`,
      },
    ],
  };
}

function onboardingChecklistHtml(checklist, locale) {
  const zh = String(locale || "").toLowerCase().startsWith("zh");
  const completed = checklist.steps.filter((step) => step.done).length;
  return [
    `<section class="panel" id="onboarding-progress" style="margin-bottom:14px">`,
    `<div class="row">`,
    `<h2 style="margin-right:auto">${zh ? "接入进度" : "Onboarding Progress"}</h2>`,
    `<span class="pill ${checklist.complete ? "good" : "warn"}">${completed}/4 ${zh ? "已完成" : "complete"}</span>`,
    `</div>`,
    `<div class="grid four onboarding-steps">`,
    ...checklist.steps.map((step, index) => [
      `<article class="onboarding-step ${step.done ? "done" : "pending"}">`,
      `<span class="pill ${step.done ? "good" : "warn"}">${step.done ? (zh ? "完成" : "Done") : (zh ? "待完成" : "Pending")}</span>`,
      `<h3>${index + 1}. ${escapeHtml(zh ? step.label_zh : step.label_en)}</h3>`,
      `<p class="muted">${escapeHtml(zh ? step.detail_zh : step.detail_en)}</p>`,
      `</article>`,
    ].join("")),
    `</div>`,
    `<p class="muted">${zh ? "目标是先跑通最小闭环：项目 → Agent → Run 黑匣子 → 夜间体检报告。" : "Goal: complete the minimum loop: project -> agent -> run black box -> nightly report."}</p>`,
    `</section>`,
  ].join("");
}

function onboardingFormsHtml({ locale, selectedProjectId, projects = [], agents = [], flash = null, checklist = null }) {
  const zh = String(locale || "").toLowerCase().startsWith("zh");
  const projectOptions = projects.map((project) => (
    `<option value="${escapeHtml(project.id)}" ${project.id === selectedProjectId ? "selected" : ""}>${escapeHtml(project.name || project.id)}</option>`
  )).join("");
  const agentOptions = agents.map((agent) => (
    `<option value="${escapeHtml(agent.id)}">${escapeHtml(agent.name || agent.id)} (${escapeHtml(agent.environment || "production")})</option>`
  )).join("");
  const latestAgent = agents[0];

  return [
    checklist ? onboardingChecklistHtml(checklist, locale) : "",
    flash ? [
      `<section class="panel" style="margin-bottom:14px;border-left:4px solid #1f7a4d">`,
      `<h2>${escapeHtml(flash.title || (zh ? "操作已完成" : "Action completed"))}</h2>`,
      flash.message ? `<p>${escapeHtml(flash.message)}</p>` : "",
      flash.ingestion_api_key ? [
        `<p><strong>${zh ? "一次性 Ingestion API Key" : "One-time ingestion API key"}</strong></p>`,
        `<p><code>${escapeHtml(flash.ingestion_api_key)}</code></p>`,
        `<p class="muted">${zh ? "这个明文 key 只在创建时展示。请保存到你的 Agent 环境变量，不要提交到代码仓库。" : "This cleartext key is shown only once. Store it in your agent environment and never commit it."}</p>`,
      ].join("") : "",
      `</section>`,
    ].join("") : "",
    `<section class="panel" id="onboarding" style="margin-bottom:14px">`,
    `<h2>${zh ? "接入向导" : "Onboarding"}</h2>`,
    `<div class="grid two">`,
    `<form method="post" action="/console" class="stack">`,
    `<input type="hidden" name="intent" value="create_project">`,
    `<h3>${zh ? "创建项目" : "Create Project"}</h3>`,
    `<label>${zh ? "项目名称" : "Project name"}<br><input class="compact-input" name="name" value="${zh ? "AI Worker Project" : "AI Worker Project"}"></label>`,
    `<label>${zh ? "项目描述" : "Description"}<br><input class="compact-input" name="description" value="${zh ? "Agent 运行黑匣子与自主运行评分" : "Agent black box and autonomy readiness"}"></label>`,
    `<button type="submit">${zh ? "创建项目并生成接入 Key" : "Create project and key"}</button>`,
    `</form>`,
    `<form method="post" action="/console" class="stack">`,
    `<input type="hidden" name="intent" value="create_agent">`,
    `<h3>${zh ? "创建 Agent" : "Create Agent"}</h3>`,
    `<label>${zh ? "项目" : "Project"}<br><select class="compact-input" name="project_id">${projectOptions}</select></label>`,
    `<label>Agent<br><input class="compact-input" name="name" value="${zh ? "客服 Agent" : "Support Agent"}"></label>`,
    `<label>${zh ? "环境" : "Environment"}<br><input class="compact-input" name="environment" value="production"></label>`,
    `<button type="submit" ${selectedProjectId ? "" : "disabled"}>${zh ? "创建 Agent" : "Create Agent"}</button>`,
    `</form>`,
    `</div>`,
    `<h3>${zh ? "提交测试 Run 并生成报告" : "Submit Test Run and Generate Report"}</h3>`,
    `<form method="post" action="/console" class="stack">`,
    `<input type="hidden" name="intent" value="create_sample_run">`,
    `<label>${zh ? "项目" : "Project"}<br><select class="compact-input" name="project_id">${projectOptions}</select></label>`,
    `<label>Agent<br><select class="compact-input" name="agent_id">${agentOptions}</select></label>`,
    `<label>${zh ? "输入" : "Input"}<br><input class="compact-input" name="input" value="${zh ? "用户要求查询订单退款状态" : "User asks for refund status"}"></label>`,
    `<label>${zh ? "输出" : "Output"}<br><input class="compact-input" name="output" value="${zh ? "工具返回空结果后，Agent 需要人工复核，不能编造退款状态。" : "Tool returned empty result; agent should ask for human review instead of inventing status."}"></label>`,
    `<button type="submit" ${selectedProjectId && latestAgent ? "" : "disabled"}>${zh ? "提交测试 Run 并生成报告" : "Submit test run and report"}</button>`,
    `</form>`,
    `<h3>${zh ? "Webhook 接入示例" : "Webhook Example"}</h3>`,
    `<pre style="overflow:auto;background:#eef2f6;border:1px solid #d9e2ec;border-radius:8px;padding:12px"><code>curl -X POST http://localhost:3000/api/runs \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer ${flash?.ingestion_api_key ? escapeHtml(flash.ingestion_api_key) : "aiwc_live_..."}" \\
  -d '{"project_id":"${escapeHtml(selectedProjectId || "project_...")}","agent_id":"${escapeHtml(latestAgent?.id || "agent_...")}","run_id_external":"run-001","input":"user request","output":"agent response","model":"gpt-5.5","provider":"openai","tools_used":[],"cost":0.12,"latency":8.4,"status":"completed","metadata":{"task_type":"support_triage"}}'</code></pre>`,
    `<p class="muted">${zh ? "接入 run 后，点击控制台里的“手动生成新报告”，即可看到体检报告、评分、门禁和学习记忆。" : "After ingesting a run, click Generate Report in the console to see health, scores, gates, and learning memory."}</p>`,
    `</section>`,
  ].join("");
}

function emptyConsoleHtml(message, options = {}) {
  const locale = options.locale || "zh-CN";
  const zh = String(locale).toLowerCase().startsWith("zh");
  const onboarding = onboardingFormsHtml({
    locale,
    selectedProjectId: options.selectedProjectId,
    projects: options.projects || [],
    agents: options.agents || [],
    flash: options.flash,
    checklist: options.checklist,
  });
  return [
    "<!doctype html>",
    `<html lang="${zh ? "zh-CN" : "en"}">`,
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>${zh ? "AI Worker 控制台" : "AI Worker Console"}</title>`,
    "<style>",
    "body{margin:0;background:#f6f8fa;color:#102a43;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}main{max-width:920px;margin:48px auto;padding:24px}.panel{background:#fff;border:1px solid #d9e2ec;border-radius:8px;padding:22px}h1{margin:0 0 10px;font-size:24px}h2{margin:0 0 12px;font-size:18px}h3{margin:8px 0 6px;font-size:14px}p{line-height:1.7;color:#52606d}.muted{color:#61707f}.grid{display:grid;gap:14px}.two{grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr)}.four{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.stack{display:grid;gap:14px}.onboarding-step{border:1px solid #d9e2ec;border-radius:8px;padding:12px;background:#f8fafb}.onboarding-step.done{border-color:#abd6be;background:#edf8f1}.pill{display:inline-flex;align-items:center;border-radius:999px;padding:2px 8px;font-size:12px;border:1px solid #d9e2ec;background:#f8fafb;color:#102a43}.pill.good{color:#1f7a4d;border-color:#abd6be;background:#edf8f1}.pill.warn{color:#9a6400;border-color:#e4c47b;background:#fff7e5}.compact-input{border:1px solid #d9e2ec;border-radius:6px;padding:5px 7px;font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-width:118px;max-width:220px}button{appearance:none;border:1px solid #d9e2ec;background:#fff;color:#102a43;border-radius:6px;padding:6px 9px;font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}code{background:#eef2f6;border:1px solid #d9e2ec;border-radius:4px;padding:2px 5px}",
    "</style>",
    "</head>",
    "<body>",
    "<main><section class=\"panel\">",
    `<h1>${zh ? "AI Worker Control Plane" : "AI Worker Control Plane"}</h1>`,
    `<p>${message}</p>`,
    `<p>${zh ? "先创建项目、接入 Agent run，然后生成夜间体检报告。" : "Create a project, ingest agent runs, then generate a nightly report."}</p>`,
    "</section>",
    onboarding,
    "</main>",
    "</body></html>",
  ].join("\n");
}

export async function buildOperatorConsolePageHtml(options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);

  try {
    const locale = options.locale || "zh-CN";
    const targetAutonomyLevel = normalizeAutonomyLevel(options.targetAutonomyLevel || "L2");
    const projectId = options.projectId || latestProjectId(db);
    const projects = listConsoleProjects(db);
    if (!projectId) {
      const checklist = buildOnboardingChecklist(db, null);
      return emptyConsoleHtml(
        locale.toLowerCase().startsWith("zh")
          ? "还没有项目或报告。"
          : "No project or report exists yet.",
        { locale, projects, flash: options.flash, checklist }
      );
    }

    let report = options.reportId
      ? getReport(options.reportId, { db, skipMigrate: true })
      : latestReport(db, projectId);

    if (options.generate) {
      const date = options.date || new Date().toISOString().slice(0, 10);
      const generated = await runNightlyHealthCheck(projectId, date, {
        db,
        skipMigrate: true,
        judgeClient: heuristicJudgeClient,
        deliverTo: [],
        targetAutonomyLevel,
      });
      report = {
        id: generated.report_id,
        content_markdown: generated.markdown,
        content_json: generated.json,
      };
    }

    if (!report) {
      const agents = latestProjectAgents(db, projectId);
      const checklist = buildOnboardingChecklist(db, projectId);
      return emptyConsoleHtml(
        locale.toLowerCase().startsWith("zh")
          ? `项目 ${projectId} 还没有报告。`
          : `Project ${projectId} has no report yet.`,
        { locale, selectedProjectId: projectId, projects, agents, flash: options.flash, checklist }
      );
    }

    const reportJson = report.content_json || {};
    const deliveries = deliveriesForReport(db, report.id);
    const reports = listConsoleReports(db, projectId);
    const agents = latestProjectAgents(db, projectId);
    const result = {
      date: String(report.period_start || options.date || "").slice(0, 10),
      project_id: projectId,
      agent_id: latestAgentId(db, projectId, reportJson),
      report_id: report.id,
      report_markdown: report.content_markdown || "",
      report_json: reportJson,
      deliveries,
      counts: consoleProjectCounts(db, projectId, reportJson, deliveries),
    };

    const html = renderOperatorConsoleHtml(result, {
      locale,
      showLocalCommands: true,
      feedbackForms: false,
      certificationActionForms: false,
      learningRuleForms: true,
    });
    return injectConsoleControls(html, consoleControlsHtml({
      locale,
      projectId,
      reportId: report.id,
      projects,
      reports,
      generated: Boolean(options.generate),
      targetAutonomyLevel,
    }), onboardingFormsHtml({
      locale,
      selectedProjectId: projectId,
      projects,
      agents,
      flash: options.flash,
      checklist: buildOnboardingChecklist(db, projectId),
    }));
  } finally {
    if (!options.db) db.close();
  }
}

export function createConsoleProject(payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    return createProject({
      name: payload.name || "AI Worker Project",
      description: payload.description || "Agent black box and autonomy readiness",
    }, { db, skipMigrate: true, createdAt: options.createdAt });
  } finally {
    if (!options.db) db.close();
  }
}

export function createConsoleAgent(payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    return createAgent({
      project_id: payload.project_id,
      name: payload.name || "Support Agent",
      environment: payload.environment || "production",
      description: payload.description || "Created from console onboarding",
    }, { db, skipMigrate: true, createdAt: options.createdAt });
  } finally {
    if (!options.db) db.close();
  }
}

export async function createConsoleSampleRun(payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) migrate(db);
  try {
    const createdAt = options.createdAt || nowIso();
    const projectId = payload.project_id;
    const agentId = payload.agent_id;
    const run = ingestAgentRun({
      project_id: projectId,
      agent_id: agentId,
      run_id_external: payload.run_id_external || `console-sample-${createId("external")}`,
      input: payload.input || "User asks for refund status.",
      output: payload.output || "Tool returned empty result; agent should ask for human review instead of inventing status.",
      model: payload.model || "gpt-5.5",
      provider: payload.provider || "openai",
      tools_used: payload.tools_used || ["orders.lookup"],
      cost: Number(payload.cost ?? 0.12),
      latency: Number(payload.latency ?? 8.4),
      status: payload.status || "completed",
      metadata: {
        ...(payload.metadata || {}),
        source: "console_sample_run",
        onboarding_sample: true,
        task_type: payload.task_type || "support_triage",
        prompt_tokens: Number(payload.prompt_tokens ?? 420),
        completion_tokens: Number(payload.completion_tokens ?? 180),
      },
    }, {
      db,
      skipMigrate: true,
      requireExistingScope: true,
      createdAt,
      authContext: {
        source: "console_sample_run",
      },
    });

    const date = String(createdAt).slice(0, 10);
    const report = await runNightlyHealthCheck(projectId, date, {
      db,
      skipMigrate: true,
      judgeClient: heuristicJudgeClient,
      deliverTo: [],
    });

    return {
      project_id: projectId,
      agent_id: agentId,
      run_id: run.run_id,
      report_id: report.report_id,
      date,
      deduplicated: Boolean(run.deduplicated),
    };
  } finally {
    if (!options.db) db.close();
  }
}
