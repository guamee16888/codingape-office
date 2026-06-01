import { listProjectSuggestions } from "../lib/assets.mjs";
import { migrate, openDatabase } from "../lib/db.mjs";
import { storeFeedback } from "../lib/feedback.mjs";
import { ensureLocalWorkspace } from "../lib/local-workspace.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function has(args, flag) {
  return args.includes(flag);
}

const args = process.argv.slice(2);
const db = openDatabase();
migrate(db);

try {
  const workspace = ensureLocalWorkspace({ db, skipMigrate: true });

  if (has(args, "--list")) {
    const suggestions = listProjectSuggestions(workspace.project_id, {
      db,
      skipMigrate: true,
      limit: Number(valueAfter(args, "--limit") || 20),
      status: valueAfter(args, "--status") || undefined,
      type: valueAfter(args, "--suggestion-type") || undefined,
    }).map((suggestion) => ({
      id: suggestion.id,
      type: suggestion.type,
      severity: suggestion.severity,
      status: suggestion.status,
      title: suggestion.title,
      expected_impact: suggestion.expected_impact,
      agent_id: suggestion.agent_id,
      created_at: suggestion.created_at,
    }));

    console.log(JSON.stringify({
      project_id: workspace.project_id,
      suggestions,
    }, null, 2));
    process.exit(0);
  }

  const targetId = valueAfter(args, "--target");
  const feedbackType = valueAfter(args, "--type");
  const comment = valueAfter(args, "--comment") || null;

  if (!targetId || !feedbackType) {
    console.error("Usage: npm run local:feedback -- --target <suggestion_id> --type <approve|reject|useful|not_useful|wrong> [--comment text]");
    console.error("List pending suggestions: npm run local:feedback -- --list --status open");
    process.exit(1);
  }

  const result = storeFeedback(
    {
      project_id: workspace.project_id,
      target_type: "suggestion",
      target_id: targetId,
      feedback_type: feedbackType,
      comment,
    },
    { db, skipMigrate: true }
  );

  console.log(JSON.stringify({
    project_id: workspace.project_id,
    target_id: targetId,
    feedback_type: feedbackType,
    ...result,
  }, null, 2));
} finally {
  db.close();
}
