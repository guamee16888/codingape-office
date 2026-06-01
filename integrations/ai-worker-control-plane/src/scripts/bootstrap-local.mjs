import { bootstrapLocalWorkspace } from "../lib/local-workspace.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const workspace = bootstrapLocalWorkspace({
  projectName: valueAfter(args, "--project-name") || undefined,
  orgName: valueAfter(args, "--org-name") || undefined,
  agentName: valueAfter(args, "--agent-name") || undefined,
});

console.log(JSON.stringify({
  project_id: workspace.project_id,
  agent_id: workspace.agent_id,
  ingestion_api_key_prefix: workspace.ingestion_api_key_prefix,
  reused: workspace.reused,
  db_path: workspace.db_path,
  config_path: workspace.config_path,
}, null, 2));
