import { buildLocalPreviewResult, writeLocalPreviewFiles } from "../lib/local-preview.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function firstPositional(args) {
  return args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
}

const args = process.argv.slice(2);
const explicitDate = valueAfter(args, "--date") || firstPositional(args);
const date = explicitDate || new Date().toISOString().slice(0, 10);
const locale = valueAfter(args, "--locale") || "zh-CN";
const consoleOut = valueAfter(args, "--console-out") || "local-output/operator-console.html";
const htmlOut = valueAfter(args, "--html-out") || "local-output/nightly-report.html";
const forceGenerate = args.includes("--force");

const result = await buildLocalPreviewResult({ date: explicitDate, forceGenerate });
const { consolePath, htmlPath } = writeLocalPreviewFiles(result, { locale, consoleOut, htmlOut });

console.log(JSON.stringify({
  project_id: result.project_id,
  agent_id: result.agent_id,
  report_id: result.report_id,
  date: result.date || date,
  run_count: result.counts.runs,
  analyzed_runs: result.counts.analyzed_runs,
  console_path: consolePath,
  report_path: htmlPath,
}, null, 2));
