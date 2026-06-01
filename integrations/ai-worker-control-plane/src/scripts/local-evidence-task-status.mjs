import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import {
  listCertificationEvidenceTaskEvents,
  listCertificationEvidenceTasks,
  updateCertificationEvidenceTaskStatus,
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

const taskId = valueAfter(args, "--task");
const status = valueAfter(args, "--status");

if (!taskId || !status) {
  const tasks = listCertificationEvidenceTasks(workspace.project_id, workspace.agent_id, { limit: 50 });
  console.log(JSON.stringify({
    usage: "npm run local:evidence-task-status -- --task <task_id> --status evidence_attached|verified|rejected|closed|superseded|reopened --note \"...\"",
    project_id: workspace.project_id,
    agent_id: workspace.agent_id,
    tasks: tasks.map((item) => ({
      id: item.id,
      status: item.status,
      severity: item.severity,
      task_type: item.task_type,
      title: item.title,
      required_evidence: item.required_evidence,
    })),
  }, null, 2));
  process.exit(0);
}

const evidence = {
  source: "local_operator",
  evidence_ref: valueAfter(args, "--evidence-ref") || null,
  recheck_id: valueAfter(args, "--recheck") || valueAfter(args, "--recheck-id") || null,
  requirement: valueAfter(args, "--requirement") || null,
  metric_status: valueAfter(args, "--metric-status") || null,
  checked_at: new Date().toISOString(),
};

const result = updateCertificationEvidenceTaskStatus(taskId, {
  status,
  note: valueAfter(args, "--note") || null,
  evidence,
  require_closure_recommendation: status === "closed",
  actor_type: "local_operator",
  actor_id: "codex_user",
});

console.log(JSON.stringify({
  task_id: result.task.id,
  from_status: result.task_event.from_status,
  to_status: result.task_event.to_status,
  status: result.task.status,
  event_id: result.task_event.id,
  closure_basis_recheck_id: result.task_event.evidence?.closure_basis_recheck_id || null,
  closure_recommended: Boolean(result.task_event.evidence?.closure_recommended),
  event_count: listCertificationEvidenceTaskEvents(taskId).length,
}, null, 2));
