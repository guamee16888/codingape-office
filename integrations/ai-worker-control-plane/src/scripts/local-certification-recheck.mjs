import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import { runAutonomyCertificationRecheck } from "../lib/autonomy-certification.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/certification-recheck.json");
const targetAutonomyLevel = valueAfter(args, "--target-level") || "L2";
const workspace = loadLocalWorkspace();

if (!workspace?.project_id || !workspace?.agent_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const result = runAutonomyCertificationRecheck(workspace.project_id, workspace.agent_id, {
  targetAutonomyLevel,
  actorType: "local_operator",
  actorId: "codex_user",
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  project_id: workspace.project_id,
  agent_id: workspace.agent_id,
  recheck_id: result.recheck.id,
  previous_score: result.recheck.previous_score,
  new_score: result.recheck.new_score,
  score_delta: result.recheck.score_delta,
  target_score: result.recheck.target_score,
  previous_gate_status: result.recheck.previous_gate_status,
  new_gate_status: result.recheck.new_gate_status,
  certification_state: result.recheck.recheck_summary.certification_state?.current_state,
  can_request_human_review: result.recheck.recheck_summary.certification_state?.can_request_human_review,
  new_blocked_by: result.recheck.new_blocked_by,
  metric_validation_status: result.recheck.recheck_summary.metric_validation_status,
  verified_but_unresolved_count: result.recheck.recheck_summary.verified_but_unresolved_count,
  evidence_requirement_status: result.recheck.recheck_summary.evidence_requirement_status,
  incomplete_evidence_review_count: result.recheck.recheck_summary.incomplete_evidence_review_count,
  run_closure_status: result.recheck.recheck_summary.run_closure_status,
  run_closure_ready_count: result.recheck.recheck_summary.run_closure_ready_count,
  run_closure_still_blocked_count: result.recheck.recheck_summary.run_closure_still_blocked_count,
  certification_evidence_task_status: result.recheck.recheck_summary.certification_evidence_task_status,
  evidence_task_ready_count: result.recheck.recheck_summary.certification_evidence_task_summary?.ready_task_count || 0,
  evidence_task_pending_count: result.recheck.recheck_summary.certification_evidence_task_summary?.pending_task_count || 0,
  evidence_task_closure_recommended_count: result.recheck.recheck_summary.certification_evidence_task_summary?.closure_recommended_count || 0,
  output_path: outPath,
}, null, 2));
