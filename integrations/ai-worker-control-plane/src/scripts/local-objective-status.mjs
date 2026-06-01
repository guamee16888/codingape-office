import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import {
  latestCertificationRoadmap,
  listRemediationObjectiveEvents,
  updateRemediationObjectiveStatus,
} from "../lib/autonomy-certification.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const workspace = loadLocalWorkspace();

if (!workspace?.project_id || !workspace?.agent_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const objectiveId = valueAfter(args, "--objective");
const status = valueAfter(args, "--status");

if (!objectiveId || !status) {
  const latest = latestCertificationRoadmap(workspace.project_id, workspace.agent_id);
  const objectives = latest?.roadmap_json?.remediation_objectives || [];
  console.log(JSON.stringify({
    usage: "npm run local:objective-status -- --objective <objective_id> --status evidence_attached|verified|rejected|superseded|reopened --note \"...\"",
    project_id: workspace.project_id,
    agent_id: workspace.agent_id,
    objectives: objectives.map((item) => ({
      id: item.id,
      status: item.status,
      severity: item.severity,
      title: item.title,
      current_value: item.current_value,
      target_value: item.target_value,
      expected_score_delta: item.expected_score_delta,
    })),
  }, null, 2));
  process.exit(0);
}

const evidence = {
  source: "local_operator",
  evidence_ref: valueAfter(args, "--evidence-ref") || null,
  requirement_key: valueAfter(args, "--requirement-key") || null,
  requirement: valueAfter(args, "--requirement") || null,
  metric_status: valueAfter(args, "--metric-status") || null,
  expires_at: valueAfter(args, "--expires-at") || null,
  checked_at: new Date().toISOString(),
};

const result = updateRemediationObjectiveStatus(objectiveId, {
  status,
  note: valueAfter(args, "--note") || null,
  evidence,
  actor_type: "local_operator",
  actor_id: "codex_user",
});

console.log(JSON.stringify({
  objective_id: result.objective.id,
  from_status: result.objective_event.from_status,
  to_status: result.objective_event.to_status,
  status: result.objective.status,
  event_id: result.objective_event.id,
  event_count: listRemediationObjectiveEvents(objectiveId).length,
}, null, 2));
