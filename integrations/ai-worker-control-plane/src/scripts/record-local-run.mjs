import { readFileSync } from "node:fs";
import { recordLocalAgentRun } from "../lib/local-workspace.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function has(args, flag) {
  return args.includes(flag);
}

function splitList(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

const args = process.argv.slice(2);
const jsonPath = valueAfter(args, "--json");
const jsonPayload = jsonPath ? JSON.parse(readFileSync(jsonPath, "utf8")) : {};
const status = valueAfter(args, "--status") || jsonPayload.status || (has(args, "--failed") ? "failed" : "completed");

const result = await recordLocalAgentRun({
  ...jsonPayload,
  input: valueAfter(args, "--input") || jsonPayload.input,
  output: valueAfter(args, "--output") || jsonPayload.output,
  status,
  model: valueAfter(args, "--model") || jsonPayload.model,
  provider: valueAfter(args, "--provider") || jsonPayload.provider,
  cost: valueAfter(args, "--cost") ?? jsonPayload.cost,
  latency: valueAfter(args, "--latency") ?? jsonPayload.latency,
  task_type: valueAfter(args, "--task-type") || jsonPayload.task_type,
  tools_used: splitList(valueAfter(args, "--tools"), jsonPayload.tools_used || ["filesystem", "shell", "tests"]),
  metadata: {
    ...(jsonPayload.metadata || {}),
    operator_note: valueAfter(args, "--note") || jsonPayload.metadata?.operator_note || null,
  },
}, {
  cwd: valueAfter(args, "--cwd") || process.cwd(),
});

console.log(JSON.stringify({
  project_id: result.workspace.project_id,
  agent_id: result.workspace.agent_id,
  run_id: result.run_id,
  judgement_id: result.judgement_id,
  status: result.run_payload.status,
  model: result.run_payload.model,
  provider: result.run_payload.provider,
  changed_file_count: result.run_payload.metadata.git.changed_file_count,
  token_cost_known: result.run_payload.metadata.token_cost_known,
}, null, 2));
