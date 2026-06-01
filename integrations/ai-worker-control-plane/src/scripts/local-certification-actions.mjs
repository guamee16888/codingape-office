import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import {
  listCertificationActionEvents,
  listCertificationActionQueue,
  updateCertificationActionStatus,
} from "../lib/autonomy-certification.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/certification-action-queue.json");
const workspace = loadLocalWorkspace();
const actionId = valueAfter(args, "--action");
const requestedStatus = valueAfter(args, "--status");

if (!workspace?.project_id || !workspace?.agent_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

let updateResult = null;
let actionEvents = [];
if (actionId && requestedStatus) {
  updateResult = updateCertificationActionStatus(actionId, {
    status: requestedStatus,
    note: valueAfter(args, "--note"),
    evidence: {
      evidence_ref: valueAfter(args, "--evidence-ref"),
      recheck_ref: args.includes("--recheck") ? "run_after_status_update" : null,
      operator_command: "npm run local:certification-actions",
    },
    actor_type: "local_operator",
    actor_id: process.env.USER || "local",
  });
  actionEvents = listCertificationActionEvents(actionId, {
    limit: Number(valueAfter(args, "--event-limit") || 20),
  });
} else if (actionId || requestedStatus) {
  console.error("Use --action <id> together with --status <status> to update a certification action.");
  process.exit(1);
}

const actions = listCertificationActionQueue(workspace.project_id, workspace.agent_id, {
  status: actionId ? null : (requestedStatus || "open"),
  limit: Number(valueAfter(args, "--limit") || 50),
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({
  updated_action: updateResult,
  action_events: actionEvents,
  actions,
}, null, 2)}\n`, "utf8");

const byAction = actions.reduce((acc, item) => {
  acc[item.recommended_action] = (acc[item.recommended_action] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  project_id: workspace.project_id,
  agent_id: workspace.agent_id,
  updated_action_id: updateResult?.action?.id || null,
  updated_action_status: updateResult?.action?.status || null,
  action_event_id: updateResult?.action_event?.id || null,
  action_event_count: actionEvents.length,
  action_count: actions.length,
  by_action: byAction,
  top_actions: actions.slice(0, 8).map((item) => ({
    id: item.id,
    priority: item.priority,
    recommended_action: item.recommended_action,
    blocker_code: item.blocker_code,
    task_id: item.certification_evidence_task_id,
    reason: item.reason,
  })),
  output_path: outPath,
}, null, 2));
