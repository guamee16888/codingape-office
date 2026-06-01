import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import { summarizeProjectDataGovernance } from "../lib/data-governance.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/data-governance.json");
const workspace = loadLocalWorkspace();

if (!workspace?.project_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const governance = summarizeProjectDataGovernance(workspace.project_id, {
  asOf: valueAfter(args, "--as-of") || undefined,
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(governance, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  project_id: governance.project_id,
  policy_version: governance.policy_version,
  mode: governance.mode,
  total_records: governance.summary.total_records,
  archive_due_count: governance.summary.archive_due_count,
  retention_due_count: governance.summary.retention_due_count,
  output_path: outPath,
}, null, 2));
