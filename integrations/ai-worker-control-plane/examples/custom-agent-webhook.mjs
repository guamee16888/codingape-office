import { createHmac } from "node:crypto";

const baseUrl = process.env.AIWC_BASE_URL || "http://localhost:3000";
const apiKey = process.env.AIWC_INGESTION_API_KEY;
const projectId = process.env.AIWC_PROJECT_ID;
const agentId = process.env.AIWC_AGENT_ID;

if (!apiKey || !projectId || !agentId) {
  console.error("Set AIWC_INGESTION_API_KEY, AIWC_PROJECT_ID, and AIWC_AGENT_ID before running this example.");
  process.exit(1);
}

const startedAt = Date.now();

async function runAgentTask(input) {
  const output = `Demo agent processed: ${input}`;
  return {
    output,
    tools_used: ["demo_tool"],
    model: "gpt-5.5",
    provider: "openai",
    cost: 0.03,
    latency: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    status: "completed",
    metadata: {
      task_type: "custom_agent_demo",
      prompt_tokens: 120,
      completion_tokens: 60,
      total_tokens: 180
    }
  };
}

const input = process.argv.slice(2).join(" ") || "Check customer order status.";
const result = await runAgentTask(input);
const body = JSON.stringify({
  project_id: projectId,
  agent_id: agentId,
  run_id_external: `custom-agent-${Date.now()}`,
  input,
  output: result.output,
  model: result.model,
  provider: result.provider,
  tools_used: result.tools_used,
  cost: result.cost,
  latency: result.latency,
  status: result.status,
  metadata: result.metadata
});
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = `sha256=${createHmac("sha256", apiKey)
  .update(`${timestamp}.${body}`, "utf8")
  .digest("hex")}`;

const response = await fetch(`${baseUrl}/api/runs`, {
  method: "POST",
  headers: {
    "authorization": `Bearer ${apiKey}`,
    "content-type": "application/json",
    "x-aiwc-timestamp": timestamp,
    "x-aiwc-signature": signature
  },
  body
});

const responseBody = await response.text();
console.log(response.status, responseBody);

if (!response.ok) {
  process.exit(1);
}
