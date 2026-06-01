import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import { requestCertificationReview } from "../lib/autonomy-certification.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/certification-review-request.json");
const workspace = loadLocalWorkspace();

if (!workspace?.project_id || !workspace?.agent_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const request = requestCertificationReview(workspace.project_id, workspace.agent_id, {
  actorType: "local_operator",
  actorId: "codex_user",
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  project_id: workspace.project_id,
  agent_id: workspace.agent_id,
  request_id: request.id,
  request_status: request.request_status,
  certification_state: request.certification_state,
  current_score: request.current_score,
  target_score: request.target_score,
  audit_evidence_item_id: request.audit_evidence_item_id,
  output_path: outPath,
}, null, 2));
