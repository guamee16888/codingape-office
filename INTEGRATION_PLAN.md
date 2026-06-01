# AI Worker Control Plane Integration Plan

Boundary: this repository is the client system. The AI Worker Control Plane integration remains a separate module boundary. This plan does not rewrite business logic or add dashboards beyond the existing local UI.

## Current Repository Assessment

`codex-office` is a local Node/Three.js worker desktop:

- `server.js` serves the UI, scans sibling projects, records local worker tasks, captures read-only evidence, drafts patch-plan artifacts, and writes JSONL logs under `data/`.
- `public/app.js`, `public/index.html`, and `public/styles.css` render the Coding Yuan office and call local APIs.
- `data/tasks.jsonl`, `data/worker-events.jsonl`, `data/evidence/*.json`, and `data/proposals/*.json` are local operational traces.

No direct LLM provider calls were found in this repo. There are no OpenAI, Anthropic, Gemini, LangChain, CrewAI, AutoGen, LangGraph, cron, webhook receiver, or background queue integrations in the current codebase. The first integration should therefore be a generic ingestion adapter plus narrow instrumentation around the existing local workflows.

## Discovered Run Candidates

| Surface | Current behavior | Instrument? | Reason |
| --- | --- | --- | --- |
| `POST /api/tasks` | Creates a queued or blocked worker task | Later | This is an intent event, not an agent run. |
| `POST /api/tasks/:id/run` | Captures read-only evidence: git status, diff stat, changed files | Yes | It is a bounded automated run with input, output, tools, latency, and status. |
| `POST /api/tasks/:id/proposal` | Builds a patch-plan artifact from evidence | Yes | It is an advisory automated run with input, output, and traceable evidence. |
| `POST /api/worker-events` | Records manual operator events | Later | Manual event stream is useful context, but not a run log yet. |
| `POST /api/approvals/:id` | Records human approval decisions | Later | This should become gate/evidence context, not first-phase run ingestion. |
| `GET /events` SSE | Streams snapshots every 7 seconds | No | This is presentation state, not workflow execution. |
| Workspace scanner | Reads sibling project status on demand | No | It is part of status rendering and would produce noisy logs. |

## Field Mapping

### Evidence Runner

- `project_id`: `AIWC_PROJECT_ID`
- `agent_id`: `AIWC_AGENT_ID`
- `run_id_external`: `codex-office:evidence:{task.id}`
- `input`: task title, external project id/name, worker id/name, risk
- `output`: evidence path, changed files, command results, recommended verification
- `model`: `codex-office-evidence-runner`
- `provider`: `local`
- `tools_used`: read-only git commands
- `cost`: `0`
- `latency`: measured from run start to completion
- `status`: `completed`
- `metadata`: `source`, `source_system`, `workflow_name`, `environment`, `task_id`, external project id, worker info, risk, `read_only`, `token_cost_known=false`

### Patch Proposal Runner

- `project_id`: `AIWC_PROJECT_ID`
- `agent_id`: `AIWC_AGENT_ID`
- `run_id_external`: `codex-office:proposal:{task.id}`
- `input`: task id/title, evidence path, changed files
- `output`: proposal artifact
- `model`: `codex-office-patch-planner`
- `provider`: `local`
- `tools_used`: `buildPatchProposal`
- `cost`: `0`
- `latency`: `0` for now because the operation is synchronous and local
- `status`: `completed`
- `metadata`: `source`, `source_system`, `workflow_name`, `environment`, `task_id`, external project id, worker info, risk, `read_only`, `advisory_only`, `token_cost_known=false`

## Adapter Design

The adapter lives at `src/aiwc/run-log-adapter.mjs` and exposes:

- `recordAiWorkerRunLog(payload, options)`
- `buildAiWorkerRunLogPayload(payload, options)`
- `resolveAiWorkerConfig(options)`
- `redactRunLogValue(value)`

Configuration:

- `AIWC_BASE_URL`: base URL of the independent control plane
- `AIWC_INGESTION_API_KEY`: project ingestion key
- `AIWC_PROJECT_ID`: control-plane project id
- `AIWC_AGENT_ID`: control-plane agent id
- `AIWC_RUN_LOG_TIMEOUT_MS` or `AIWC_TIMEOUT_MS`: optional timeout, default `2500`
- `AIWC_SOURCE_SYSTEM`: optional, default `codex-office`
- `AIWC_SOURCE`: optional, default `codex_office_adapter`
- `AIWC_ENVIRONMENT` or `CODEX_OFFICE_ENV` or `NODE_ENV`: optional environment label

Safety behavior:

- If configuration is missing, ingestion is skipped and the business flow continues.
- If the network request fails or times out, the function returns `{ ok: false }` and does not throw by default.
- Requests include Bearer auth and HMAC signature headers using the exact redacted JSON body.
- `run_id_external` is stable and idempotent. Callers should provide it; the adapter can derive a deterministic fallback from workflow metadata.
- Inputs, outputs, and metadata are recursively redacted for password, secret, API key, auth header, cookie, private key, access token, refresh token, session token, bearer token, JWT, and common provider key patterns.
- Payload sizes are bounded by string, array, object-key, and depth limits.

## Rollout

1. Land the adapter and tests.
2. Wire only the existing evidence and proposal runners through a fire-and-forget call.
3. Configure a local or staging control-plane project and agent:
   - `AIWC_BASE_URL=http://localhost:3000`
   - `AIWC_INGESTION_API_KEY=aiwc_live_...`
   - `AIWC_PROJECT_ID=project_...`
   - `AIWC_AGENT_ID=agent_...`
4. Run a task evidence capture and proposal draft from the UI.
5. Confirm ingestion in the control plane through project runs or ingestion events.
6. Later phases can add manual event context, approval gate evidence, nightly report triggers, replay uploads, and autonomy gate checks.

## Non-Goals For Phase 1

- Do not copy AI Worker Control Plane files into this repo.
- Do not create a complex dashboard here.
- Do not automatically repair, deploy, restart, trade, or write production systems.
- Do not block the user-facing workflow when ingestion fails.
- Do not send raw secrets or unrestricted file contents.
- Do not guess hidden AI workflows that are not present in this repository.
