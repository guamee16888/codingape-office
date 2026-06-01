import { migrate, openDatabase } from "../lib/db.mjs";
import { updateLearningRuleStatus } from "../lib/learning-rules.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function latestLearningRuleId(db, projectId) {
  const clauses = [];
  const params = [];
  if (projectId) {
    clauses.push("project_id = ?");
    params.push(projectId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = db.prepare(
    `SELECT id
     FROM learning_rules
     ${where}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`
  ).get(...params);
  return row?.id || null;
}

const args = process.argv.slice(2);
const projectId = valueAfter(args, "--project");
const learningRuleIdArg = valueAfter(args, "--rule") || valueAfter(args, "--learning-rule");
const status = valueAfter(args, "--status") || "paused";
const note = valueAfter(args, "--note") || "Local operator reviewed this learning rule.";
const db = openDatabase();
migrate(db);

try {
  const learningRuleId = learningRuleIdArg || latestLearningRuleId(db, projectId);
  if (!learningRuleId) {
    console.error("No learning rule found. Pass --rule learnrule_... after generating learning rules.");
    process.exit(1);
  }

  const result = updateLearningRuleStatus(learningRuleId, {
    status,
    note,
    evidence: {
      source: "local_cli",
      mutates_policy: false,
      mutates_prompt: false,
      grants_autonomy: false,
      enables_policy_enforcement: false,
    },
    actor_type: "local_operator",
    actor_id: "local",
  }, {
    db,
    skipMigrate: true,
  });

  console.log(JSON.stringify({
    learning_rule_id: result.learning_rule.id,
    rule_type: result.learning_rule.rule_type,
    from_status: result.learning_rule_event.from_status,
    to_status: result.learning_rule_event.to_status,
    event_id: result.learning_rule_event.id,
    safety_boundary: result.learning_rule_event.evidence.safety_boundary,
    mutates_policy: result.learning_rule_event.evidence.mutates_policy,
    enables_policy_enforcement: result.learning_rule_event.evidence.enables_policy_enforcement,
  }, null, 2));
} finally {
  db.close();
}
