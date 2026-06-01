# Integration Notes

Phase 1 integrations should be simple webhook senders. Do not wait for a full SDK. The required pattern is: capture one agent run, normalize it into the `POST /api/runs` contract, send it with the project ingestion API key, and let the nightly job analyze it.

For production senders, also sign the exact request body:

- `x-aiwc-timestamp`: Unix timestamp in seconds.
- `x-aiwc-signature`: `sha256=<hex hmac of "{timestamp}.{raw_body}">`, using the project ingestion API key as the HMAC secret.

`AIWC_REQUIRE_WEBHOOK_SIGNATURE=true` makes signatures mandatory on `POST /api/runs`. This gives the ingestion endpoint replay and tamper protection while preserving the simple Bearer-key path for early local testing.

## Required Fields

```json
{
  "project_id": "project_...",
  "agent_id": "agent_...",
  "run_id_external": "your-system-run-id",
  "input": "Original task or compact input summary",
  "output": "Agent output or error message",
  "model": "gpt-5.5",
  "provider": "openai",
  "tools_used": ["tool_name"],
  "cost": 0.12,
  "latency": 8.4,
  "status": "completed",
  "metadata": {
    "task_type": "support_triage",
    "prompt_tokens": 100,
    "completion_tokens": 40,
    "total_tokens": 140
  }
}
```

Use `metadata.task_type` consistently. The nightly report groups cost by model, agent, and task type.

Set `run_id_external` to a stable ID from the source system, not a random value. For example, use an n8n execution ID, Make scenario execution ID, Zapier task ID, LangChain trace ID, or your own job ID. The ingestion endpoint deduplicates on `project_id + agent_id + run_id_external`, so sender retries do not inflate run counts, cost, or risk scores.

## n8n

1. Add an HTTP Request node after the agent/workflow step.
2. Set method to `POST`.
3. Set URL to `https://your-domain.com/api/runs`.
4. Add headers:
   - `authorization`: `Bearer aiwc_live_...`
   - `content-type`: `application/json`
   - `x-aiwc-timestamp`: current Unix timestamp
   - `x-aiwc-signature`: HMAC signature of the raw JSON body
5. Map workflow fields into the run payload.
6. Map execution ID into `run_id_external`.
7. Put workflow name or intent into `metadata.task_type`.

Good `task_type` examples: `support_triage`, `refund_ops`, `sales_research`, `data_analysis`, `code_assist`.

## Make

1. Add an HTTP module at the end of the scenario.
2. Choose `Make a request`.
3. Use `POST https://your-domain.com/api/runs`.
4. Add the same authorization, content-type, timestamp, and signature headers.
5. Build JSON from scenario variables.
6. Map scenario execution ID into `run_id_external`.
7. Send failed scenarios too, using `status: "failed"` and the error text as `output`.

## Zapier

1. Add `Webhooks by Zapier`.
2. Choose `POST`.
3. Send JSON to `/api/runs`.
4. Add `Authorization: Bearer aiwc_live_...`. If signature enforcement is enabled, add the timestamp and signature headers from a code step or custom webhook sender.
5. Map Zapier task/run ID into `run_id_external`.
6. Use the Zap name or action category as `metadata.task_type`.

## Custom Agents

Use `examples/custom-agent-webhook.mjs` as the minimum pattern:

```bash
AIWC_BASE_URL=http://localhost:3000 \
AIWC_INGESTION_API_KEY=aiwc_live_... \
AIWC_PROJECT_ID=project_... \
AIWC_AGENT_ID=agent_... \
node examples/custom-agent-webhook.mjs "Check customer order status"
```

This file is intentionally an example sender, not a committed SDK. Keep the production SDK decision for later, after the webhook contract proves useful.

## What To Send On Failure

For failed runs, still send the run:

```json
{
  "status": "failed",
  "output": "Tool refund_lookup timed out after 30s",
  "metadata": {
    "task_type": "refund_ops",
    "error_code": "tool_timeout"
  }
}
```

Failures are valuable assets. The system can turn them into failure cases, suggestions, and future eval cases. Repeated failure categories also appear in the nightly report as rolling 7-day recurring patterns, which helps teams decide what should become eval coverage or prompt/tool fallback work.

## Debug Ingestion

After wiring a sender, confirm the control plane received the payload:

```bash
curl -sS "https://your-domain.com/api/projects/project_.../ingestion-events?limit=20" \
  -H "authorization: Bearer aiwc_live_..."
```

Use `?deduplicated=true` to confirm retry deduplication and `?signature_verified=true` to inspect signed intake evidence. These records are audit metadata only; they do not expose cleartext API keys or raw signatures.

For a compact health summary:

```bash
curl -sS "https://your-domain.com/api/projects/project_.../ingestion-health" \
  -H "authorization: Bearer aiwc_live_..."
```

This returns accepted ingestion events, duplicate retry rate, signature coverage, last ingestion time, and observed key IDs.

Feedback is also a learning asset. Marking a suggestion `wrong`, `not_useful`, `useful`, `approve`, or `reject` feeds future learning insights, so the system can remember what advice should be trusted or calibrated down.

## Report Delivery Webhooks

Reports can be delivered to email, generic webhooks, Slack incoming webhooks, and Discord webhooks.

Slack subscription example:

```json
{
  "recipient": "https://hooks.slack.com/services/...",
  "channel": "slack",
  "enabled": true
}
```

Generic webhook delivery posts JSON with `subject`, `summary`, `markdown`, `html`, and a compact report object. Slack and Discord channels send chat-native summary payloads.
