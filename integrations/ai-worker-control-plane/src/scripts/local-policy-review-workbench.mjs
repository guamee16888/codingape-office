import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { migrate, openDatabase } from "../lib/db.mjs";
import { markdownToHtml } from "../lib/report-rendering.mjs";
import { buildPolicyReviewWorkbench, renderPolicyReviewWorkbenchMarkdown } from "../lib/policy-governance-dossier.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function latestPolicyRuleId(db, projectId) {
  const clauses = [];
  const params = [];
  if (projectId) {
    clauses.push("project_id = ?");
    params.push(projectId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = db.prepare(
    `SELECT id
     FROM policy_rules
     ${where}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`
  ).get(...params);
  return row?.id || null;
}

const args = process.argv.slice(2);
const policyRuleIdArg = valueAfter(args, "--policy") || valueAfter(args, "--policy-rule");
const projectId = valueAfter(args, "--project");
const baseOut = valueAfter(args, "--out") || "local-output/policy-review-workbench";
const db = openDatabase();
migrate(db);

try {
  const policyRuleId = policyRuleIdArg || latestPolicyRuleId(db, projectId);
  if (!policyRuleId) {
    console.error("No policy rule found. Pass --policy policy_... after creating a policy draft.");
    process.exit(1);
  }

  const workbench = buildPolicyReviewWorkbench(policyRuleId, { db, skipMigrate: true });
  if (!workbench) {
    console.error(`Policy rule not found: ${policyRuleId}`);
    process.exit(1);
  }

  const jsonPath = resolve(process.cwd(), `${baseOut}.json`);
  const markdownPath = resolve(process.cwd(), `${baseOut}.md`);
  const htmlPath = resolve(process.cwd(), `${baseOut}.html`);
  const markdown = renderPolicyReviewWorkbenchMarkdown(workbench);
  const html = [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>Policy Review Workbench</title>",
    "<style>body{font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:920px;margin:32px auto;padding:0 18px;color:#17202a}h1{font-size:28px}h2{margin-top:28px;border-top:1px solid #d8e0e8;padding-top:18px}code{background:#eef2f6;padding:2px 4px;border-radius:4px}li{margin:6px 0}</style>",
    "</head><body>",
    markdownToHtml(markdown),
    "</body></html>",
  ].join("\n");

  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(workbench, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, `${markdown}\n`, "utf8");
  writeFileSync(htmlPath, html, "utf8");

  console.log(JSON.stringify({
    policy_rule_id: workbench.policy_rule_id,
    project_id: workbench.project_id,
    advancement_status: workbench.advancement_status,
    readiness_score: workbench.readiness_score,
    open_work_item_count: workbench.summary.open_work_item_count,
    ready_decision_count: workbench.summary.ready_decision_count,
    work_item_event_count: workbench.summary.work_item_event_count,
    can_enable_policy: workbench.summary.can_enable_policy,
    safety_boundary: workbench.safety_boundary,
    json_path: jsonPath,
    markdown_path: markdownPath,
    html_path: htmlPath,
  }, null, 2));
} finally {
  db.close();
}
