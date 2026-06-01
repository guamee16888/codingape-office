import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import { buildProjectEvalBacklog } from "../lib/eval-backlog.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/eval-backlog.json");
const workspace = loadLocalWorkspace();

if (!workspace?.project_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const backlog = buildProjectEvalBacklog(workspace.project_id);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(backlog, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  project_id: backlog.project_id,
  backlog_version: backlog.backlog_version,
  open_item_count: backlog.summary.open_item_count,
  critical_item_count: backlog.summary.critical_item_count,
  missing_eval_count: backlog.summary.missing_eval_count,
  needs_replay_count: backlog.summary.needs_replay_count,
  regression_count: backlog.summary.regression_count,
  output_path: outPath,
}, null, 2));
