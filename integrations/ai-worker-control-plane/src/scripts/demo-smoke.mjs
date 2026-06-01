import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { runDemoScenario, runTemporaryDemoScenario } from "../lib/demo-scenario.mjs";
import { renderOperatorConsoleHtml } from "../lib/operator-console-rendering.mjs";
import { renderReportHtml } from "../lib/report-rendering.mjs";
import { reportMarkdownForLocale } from "../lib/i18n.mjs";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const showMarkdown = args.has("--markdown");
const keepDatabase = args.has("--keep");
const dbPath = process.env.AIWC_DEMO_DB_PATH || null;

function valueAfter(flag) {
  const index = rawArgs.indexOf(flag);
  return index >= 0 ? rawArgs[index + 1] : null;
}

const htmlOutPath = valueAfter("--html-out");
const consoleOutPath = valueAfter("--console-out");
const locale = valueAfter("--locale") || (args.has("--zh") ? "zh-CN" : "en");

const result = dbPath
  ? await runDemoScenario({ dbPath })
  : await runTemporaryDemoScenario({ keepDatabase });

const summary = {
  date: result.date,
  project_id: result.project_id,
  agent_id: result.agent_id,
  ingestion_api_key_prefix: result.ingestion_api_key_prefix,
  report_id: result.report_id,
  sample_trace_run_id: result.sample_trace_run_id,
  approved_prompt_suggestion_id: result.approved_prompt_suggestion_id,
  approved_risk_suggestion_id: result.approved_risk_suggestion_id,
  prompt_version_id: result.prompt_version_id,
  policy_rule_id: result.policy_rule_id,
  counts: result.counts,
  deliveries: result.deliveries.map((delivery) => ({
    id: delivery.id,
    status: delivery.status,
    recipient: delivery.recipient,
    provider: delivery.provider,
  })),
  db_path: dbPath || result.db_path,
  db_persisted: Boolean(dbPath || keepDatabase),
};

console.log(JSON.stringify(summary, null, 2));

if (htmlOutPath) {
  const outputPath = resolve(process.cwd(), htmlOutPath);
  const html = renderReportHtml({
    content_markdown: result.report_markdown,
    content_json: result.report_json,
    project_id: result.project_id,
  }, { locale });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf8");
  console.log(`\nHTML report written to ${outputPath}`);
}

if (consoleOutPath) {
  const outputPath = resolve(process.cwd(), consoleOutPath);
  const html = renderOperatorConsoleHtml(result, { locale });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf8");
  console.log(`\nOperator console written to ${outputPath}`);
}

if (showMarkdown) {
  console.log("\n--- Nightly Report Markdown ---\n");
  console.log(reportMarkdownForLocale({
    content_markdown: result.report_markdown,
    content_json: result.report_json,
    project_id: result.project_id,
  }, locale));
}
