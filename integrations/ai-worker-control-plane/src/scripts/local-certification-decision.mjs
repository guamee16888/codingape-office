import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import { listCertificationReviewRequests, submitCertificationReviewDecision } from "../lib/autonomy-certification.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const decisionValue = valueAfter(args, "--decision") || "request_more_evidence";
const requestId = valueAfter(args, "--request");
const rationale = valueAfter(args, "--rationale") || "Local reviewer decision recorded without granting autonomy.";
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/certification-review-decision.json");
const workspace = loadLocalWorkspace();

if (!workspace?.project_id || !workspace?.agent_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const latestRequestId = requestId || listCertificationReviewRequests(workspace.project_id, workspace.agent_id, { limit: 1 })[0]?.id;
if (!latestRequestId) {
  console.error("No certification review request found. Run npm run local:certification-review first.");
  process.exit(1);
}

const result = submitCertificationReviewDecision(latestRequestId, {
  decision: decisionValue,
  reviewerActorType: "local_reviewer",
  reviewerActorId: "codex_user",
  rationale,
  evidence: { source: "local_cli" },
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  project_id: workspace.project_id,
  agent_id: workspace.agent_id,
  request_id: result.request.id,
  decision_id: result.decision.id,
  decision: result.decision.decision,
  from_status: result.decision.from_status,
  to_status: result.decision.to_status,
  can_grant_autonomy: result.request.reviewer_decision.can_grant_autonomy,
  output_path: outPath,
}, null, 2));
