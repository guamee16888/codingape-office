import { migrate, openDatabase } from "../lib/db.mjs";
import { recordPolicyReviewWorkItemEvent } from "../lib/policy-governance-dossier.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function latestPolicyRuleId(db, projectId) {
  const clauses = [];
  const params = [];
  if (projectId) {
    clauses.push("project_id = ?");
    params.push(projectId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = db.prepare(
    `SELECT id
     FROM policy_rules
     ${where}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`
  ).get(...params);
  return row?.id || null;
}

const args = process.argv.slice(2);
const projectId = valueAfter(args, "--project");
const workItemId = valueAfter(args, "--work-item") || valueAfter(args, "--work_item");
const eventType = valueAfter(args, "--event") || valueAfter(args, "--event-type") || "acknowledged";
const note = valueAfter(args, "--note") || null;
const evidenceRef = valueAfter(args, "--evidence-ref") || null;
const policyRuleIdArg = valueAfter(args, "--policy") || valueAfter(args, "--policy-rule");
const db = openDatabase();
migrate(db);

try {
  const policyRuleId = policyRuleIdArg || latestPolicyRuleId(db, projectId);
  if (!policyRuleId) {
    console.error("No policy rule found. Pass --policy policy_... after creating a policy draft.");
    process.exit(1);
  }
  if (!workItemId) {
    console.error("Missing --work-item policy_work_...");
    process.exit(1);
  }

  const result = recordPolicyReviewWorkItemEvent(policyRuleId, {
    work_item_id: workItemId,
    event_type: eventType,
    note,
    evidence: {
      evidence_ref: evidenceRef,
      source: "local_cli",
    },
    actor_type: "local_operator",
    actor_id: "local",
  }, {
    db,
    skipMigrate: true,
  });

  console.log(JSON.stringify({
    policy_rule_id: policyRuleId,
    work_item_id: result.policy_review_work_item_event.work_item_id,
    event_type: result.policy_review_work_item_event.event_type,
    action_type: result.policy_review_work_item_event.action_type,
    event_id: result.policy_review_work_item_event.id,
    work_item_event_count: result.policy_review_workbench.summary.work_item_event_count,
    can_enable_policy: result.policy_review_workbench.summary.can_enable_policy,
    safety_boundary: result.policy_review_work_item_event.evidence.safety_boundary,
  }, null, 2));
} finally {
  db.close();
}
