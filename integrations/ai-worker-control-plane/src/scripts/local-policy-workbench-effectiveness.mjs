import { migrate, openDatabase } from "../lib/db.mjs";
import { evaluatePolicyReviewWorkItemEffectiveness } from "../lib/policy-governance-dossier.mjs";

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
const policyRuleIdArg = valueAfter(args, "--policy") || valueAfter(args, "--policy-rule");
const db = openDatabase();
migrate(db);

try {
  const policyRuleId = policyRuleIdArg || latestPolicyRuleId(db, projectId);
  if (!policyRuleId) {
    console.error("No policy rule found. Pass --policy policy_... after creating a policy draft.");
    process.exit(1);
  }

  const result = evaluatePolicyReviewWorkItemEffectiveness(policyRuleId, {
    db,
    skipMigrate: true,
  });

  console.log(JSON.stringify({
    policy_rule_id: result.policy_rule_id,
    project_id: result.project_id,
    current_readiness_score: result.current_readiness_score,
    current_advancement_status: result.current_advancement_status,
    effectiveness_count: result.effectiveness_count,
    statuses: result.effectiveness.reduce((acc, item) => {
      acc[item.effectiveness_status] = (acc[item.effectiveness_status] || 0) + 1;
      return acc;
    }, {}),
    safety_boundary: result.safety_boundary,
  }, null, 2));
} finally {
  db.close();
}
