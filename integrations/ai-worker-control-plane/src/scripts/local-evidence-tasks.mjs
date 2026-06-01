import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadLocalWorkspace } from "../lib/local-workspace.mjs";
import { listCertificationEvidenceTasks } from "../lib/autonomy-certification.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/certification-evidence-tasks.json");
const status = valueAfter(args, "--status");
const workspace = loadLocalWorkspace();

if (!workspace?.project_id || !workspace?.agent_id) {
  console.error("Local workspace not found. Run npm run local:bootstrap first.");
  process.exit(1);
}

const tasks = listCertificationEvidenceTasks(workspace.project_id, workspace.agent_id, {
  limit: 100,
  status,
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({ project_id: workspace.project_id, agent_id: workspace.agent_id, tasks }, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  project_id: workspace.project_id,
  agent_id: workspace.agent_id,
  task_count: tasks.length,
  open_count: tasks.filter((item) => item.status === "open").length,
  output_path: outPath,
}, null, 2));
