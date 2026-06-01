import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildAndPersistCertificationRoadmap } from "../lib/autonomy-certification.mjs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/certification-roadmap.json");
const targetAutonomyLevel = valueAfter(args, "--target-level") || "L2";
const workspace = loadLocalWorkspace();

if (!workspace?.project_id || !workspace?.agent_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const roadmap = buildAndPersistCertificationRoadmap(workspace.project_id, workspace.agent_id, {
  targetAutonomyLevel,
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(roadmap, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  project_id: roadmap.project_id,
  agent_id: roadmap.agent_id,
  current_score: roadmap.current_score,
  target_score: roadmap.target_score,
  target_autonomy_level: roadmap.target_autonomy_level,
  gate_status: roadmap.current_gate_status,
  blocked_by: roadmap.blocked_by,
  hard_blocker_count: roadmap.hard_blockers.length,
  score_blocker_count: roadmap.score_blockers.length,
  remediation_objective_count: roadmap.remediation_objectives.length,
  estimated_score_after_plan: roadmap.estimated_score_after_plan,
  scoring_policy_version: roadmap.score_breakdown.scoring_policy_version,
  output_path: outPath,
}, null, 2));
