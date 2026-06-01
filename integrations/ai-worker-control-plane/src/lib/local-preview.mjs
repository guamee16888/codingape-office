import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fromJson, migrate, openDatabase } from "./db.mjs";
import { heuristicJudgeClient } from "./judge.mjs";
import { ensureLocalWorkspace } from "./local-workspace.mjs";
import { dayRange, getReport } from "./reports.mjs";
import { runNightlyHealthCheck } from "./nightly.mjs";
import { renderOperatorConsoleHtml } from "./operator-console-rendering.mjs";
import { renderReportHtml } from "./report-rendering.mjs";

function countOne(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.count || 0);
}

export function projectCounts(db, projectId, reportJson = {}, deliveries = []) {
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

function latestReportForDate(db, projectId, date) {
  const { start, end } = dayRange(date);
  const row = db.prepare(
    `SELECT id
     FROM reports
     WHERE project_id = ? AND period_start = ? AND period_end = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(projectId, start, end);

  return row ? getReport(row.id, { db, skipMigrate: true }) : null;
}

function latestRunDate(db, projectId) {
  const row = db.prepare(
    `SELECT created_at
     FROM agent_runs
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(projectId);

  return row?.created_at ? String(row.created_at).slice(0, 10) : null;
}

export async function buildLocalPreviewResult(options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const workspace = ensureLocalWorkspace({
      db,
      skipMigrate: true,
      configPath: options.configPath,
      writeConfig: options.writeConfig,
    });
    const date = options.date || latestRunDate(db, workspace.project_id) || new Date().toISOString().slice(0, 10);
    const existing = options.forceGenerate ? null : latestReportForDate(db, workspace.project_id, date);
    let report;
    let deliveries = [];

    if (existing) {
      report = {
        report_id: existing.id,
        markdown: existing.content_markdown,
        json: existing.content_json,
      };
      deliveries = db.prepare(
        `SELECT *
         FROM report_deliveries
         WHERE report_id = ?
         ORDER BY created_at DESC`
      ).all(existing.id).map((row) => ({
        ...row,
        metadata: fromJson(row.metadata, {}),
      }));
    } else {
      report = await runNightlyHealthCheck(workspace.project_id, date, {
        db,
        skipMigrate: true,
        judgeClient: heuristicJudgeClient,
        deliverTo: [],
      });
      deliveries = report.deliveries;
    }

    return {
      date,
      project_id: workspace.project_id,
      agent_id: workspace.agent_id,
      report_id: report.report_id,
      report_markdown: report.markdown,
      report_json: report.json,
      deliveries,
      counts: projectCounts(db, workspace.project_id, report.json, deliveries),
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function writeLocalPreviewFiles(result, options = {}) {
  const locale = options.locale || "zh-CN";
  const consolePath = resolve(process.cwd(), options.consoleOut || "local-output/operator-console.html");
  const htmlPath = resolve(process.cwd(), options.htmlOut || "local-output/nightly-report.html");
  mkdirSync(dirname(consolePath), { recursive: true });
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(consolePath, renderOperatorConsoleHtml(result, {
    locale,
    showLocalCommands: true,
    feedbackForms: Boolean(options.feedbackForms),
  }), "utf8");
  writeFileSync(htmlPath, renderReportHtml({
    content_markdown: result.report_markdown,
    content_json: result.report_json,
    project_id: result.project_id,
  }, { locale }), "utf8");

  return { consolePath, htmlPath };
}
