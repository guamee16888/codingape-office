import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import { summarizeProjectEvalCoverage } from "../lib/eval-coverage.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/eval-coverage.json");
const workspace = loadLocalWorkspace();

if (!workspace?.project_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const coverage = summarizeProjectEvalCoverage(workspace.project_id);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  project_id: coverage.project_id,
  coverage_version: coverage.coverage_version,
  failure_count: coverage.summary.failure_count,
  eval_case_count: coverage.summary.eval_case_count,
  replayed_case_count: coverage.summary.replayed_case_count,
  missing_eval_taxonomy_count: coverage.summary.missing_eval_taxonomy_count,
  regression_taxonomy_count: coverage.summary.regression_taxonomy_count,
  output_path: outPath,
}, null, 2));
