import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { markdownToHtml } from "../lib/report-rendering.mjs";
import { buildLocalPreviewResult } from "../lib/local-preview.mjs";
import { buildReadinessDossier, renderReadinessDossierMarkdown } from "../lib/readiness-dossier.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const reportIdArg = valueAfter(args, "--report");
const baseOut = valueAfter(args, "--out") || "local-output/readiness-dossier";
const reportId = reportIdArg || (await buildLocalPreviewResult({
  date: valueAfter(args, "--date") || undefined,
  forceGenerate: args.includes("--force"),
})).report_id;

const dossier = buildReadinessDossier(reportId);
if (!dossier) {
  console.error(`Report not found: ${reportId}`);
  process.exit(1);
}

const jsonPath = resolve(process.cwd(), `${baseOut}.json`);
const markdownPath = resolve(process.cwd(), `${baseOut}.md`);
const htmlPath = resolve(process.cwd(), `${baseOut}.html`);
const markdown = renderReadinessDossierMarkdown(dossier);
const html = [
  "<!doctype html>",
  "<html lang=\"en\">",
  "<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
  "<title>AI Agent Readiness Dossier</title>",
  "<style>body{font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:920px;margin:32px auto;padding:0 18px;color:#17202a}h1{font-size:28px}h2{margin-top:28px;border-top:1px solid #d8e0e8;padding-top:18px}code{background:#eef2f6;padding:2px 4px;border-radius:4px}li{margin:6px 0}</style>",
  "</head><body>",
  markdownToHtml(markdown),
  "</body></html>",
].join("\n");

mkdirSync(dirname(jsonPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(dossier, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, `${markdown}\n`, "utf8");
writeFileSync(htmlPath, html, "utf8");

console.log(JSON.stringify({
  report_id: dossier.report_id,
  project_id: dossier.project_id,
  verdict: dossier.verdict.verdict,
  severity: dossier.verdict.severity,
  json_path: jsonPath,
  markdown_path: markdownPath,
  html_path: htmlPath,
}, null, 2));
