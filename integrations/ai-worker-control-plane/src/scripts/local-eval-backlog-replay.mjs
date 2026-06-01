import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import { runEvalBacklogReplay } from "../lib/eval-backlog-replay.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/eval-backlog-replay.json");
const mode = valueAfter(args, "--mode") || "safe_placeholder";
const workspace = loadLocalWorkspace();

if (!workspace?.project_id || !workspace?.agent_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const result = runEvalBacklogReplay(workspace.project_id, {
  agent_id: workspace.agent_id,
  candidate_output_mode: mode,
});
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  project_id: result.project_id,
  agent_id: result.agent_id,
  eval_run_id: result.eval_run.eval_run_id,
  gate_decision: result.eval_run.summary.gate_decision,
  pass_count: result.eval_run.summary.pass_count,
  fail_count: result.eval_run.summary.fail_count,
  regression_count: result.eval_run.summary.regression_count,
  replayed_eval_case_count: result.replayed_eval_case_ids.length,
  backlog_after_open_items: result.backlog_after.summary.open_item_count,
  output_path: outPath,
}, null, 2));
