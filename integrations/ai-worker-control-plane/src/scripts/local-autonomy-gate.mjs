import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import { checkAgentAutonomyGate } from "../lib/autonomy-gates.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/autonomy-gate.json");
const workspace = loadLocalWorkspace();

if (!workspace?.project_id || !workspace?.agent_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const result = checkAgentAutonomyGate(workspace.project_id, workspace.agent_id);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  project_id: result.project_id,
  agent_id: result.agent_id,
  gate_decision: result.gate_decision,
  autonomy_allowed: result.autonomy_allowed,
  requires_human_review: result.requires_human_review,
  blocker_count: result.blockers.length,
  warning_count: result.warnings.length,
  eval_gate_decision: result.eval_replay_gate.gate_decision,
  eval_replay_pass_rate: result.eval_replay_gate.pass_rate,
  missing_eval_taxonomy_count: result.eval_coverage.summary.missing_eval_taxonomy_count,
  not_replayed_taxonomy_count: result.eval_coverage.summary.not_replayed_taxonomy_count,
  regression_taxonomy_count: result.eval_coverage.summary.regression_taxonomy_count,
  audit_evidence_item_id: result.audit_evidence_item_id,
  output_path: outPath,
}, null, 2));
