# AI Worker Control Plane

Phase 1 MVP for Agent Nightly Health Report + Cost Optimization.

## What Exists

- `POST /api/projects` creates a project and returns a one-time ingestion API key.
- `GET /api/projects/:projectId/api-keys` lists ingestion API keys without secrets.
- `POST /api/projects/:projectId/api-keys` creates another one-time ingestion API key.
- `POST /api/api-keys/:apiKeyId/revoke` revokes an ingestion API key.
- `POST /api/agents` creates an agent inside a project.
- `POST /api/runs` webhook route for agent run ingestion.
- `POST /api/runs` supports optional HMAC signatures with timestamp replay protection; set `AIWC_REQUIRE_WEBHOOK_SIGNATURE=true` to require signed ingestion.
- `POST /api/runs` is idempotent by `project_id + agent_id + run_id_external` so sender retries do not duplicate run counts.
- `GET /api/projects/:projectId/runs` lists project runs.
- `GET /api/projects/:projectId/ingestion-events` lists recent accepted and duplicate ingestion audit events for webhook debugging.
- `GET /api/projects/:projectId/ingestion-health` summarizes accepted runs, duplicate retries, signature coverage, and active key usage.
- `GET /api/runs/:runId` fetches a run trace with derived assets.
- `GET /api/runs/:runId/judgement` fetches the run judgement.
- `analyzeRun(runId)` for structured run judgement.
- `GET /api/projects/:projectId/suggestions` lists optimization suggestions.
- `GET /api/projects/:projectId/eval-cases` lists generated eval cases.
- `GET /api/projects/:projectId/eval-runs` lists eval replay gate runs.
- `POST /api/projects/:projectId/eval-runs` stores pass/fail/regression replay evidence for candidate outputs.
- `GET /api/projects/:projectId/failure-cases` lists failure cases and can filter by `taxonomy_code`.
- `GET /api/projects/:projectId/learning-insights` lists self-evolution insights.
- `GET /api/projects/:projectId/learning-rules` lists feedback-derived learning rules.
- `GET /api/projects/:projectId/incident-reports` lists incident reports generated from high-risk runs and recurring root causes.
- `GET /api/incidents/:incidentId` fetches one incident report.
- `PATCH /api/incidents/:incidentId` updates incident remediation status and stores history.
- `GET /api/incidents/:incidentId/remediation-events` lists remediation history.
- `GET /api/projects/:projectId/policy-rules` lists policy rules and disabled drafts.
- `GET /api/projects/:projectId/policy-dry-run` shows which historical runs disabled policy drafts would have matched, with optional persisted evidence via `include_evidence=true`.
- `POST /api/projects/:projectId/prompt-versions/:promptVersionId/promotion-check` stores replay-backed prompt promotion readiness evidence.
- `GET /api/projects/:projectId/agents/:agentId/autonomy-gate` lists stored autonomy gate checks for an agent.
- `POST /api/projects/:projectId/agents/:agentId/autonomy-gate` stores a review-only autonomy gate decision for an agent.
- `generateNightlyReport(projectId, date)` for markdown reports.
- Nightly reports include autonomy-readiness scores, ingestion health, fine-grained failure taxonomy, learning-asset counts, feedback memory, rolling 7-day recurring failure patterns, and self-evolution insights.
- `POST /api/reports/nightly` runs analysis for unanalyzed project runs and creates a report.
- `POST /api/cron/nightly` runs nightly reports for every project with runs on a date.
- `POST /api/cron/retry` retries due failed analyses and report deliveries.
- `GET /api/reports/:reportId` fetches a generated report.
- `GET /api/reports/:reportId/html` renders a generated report as HTML.
- `GET /api/projects/:projectId/reports` lists project reports.
- `POST /api/reports/:reportId/deliver` sends a report through email, webhook, Slack, or Discord delivery providers.
- `GET /api/reports/:reportId/deliveries` lists report delivery attempts.
- `GET /api/projects/:projectId/job-events` lists project operational job events.
- `GET /api/projects/:projectId/report-deliveries` lists report delivery attempts for a project.
- `GET /api/projects/:projectId/operational-failures` lists unresolved failed or exhausted operational evidence.
- `GET /api/projects/:projectId/report-subscriptions` lists project report recipients.
- `POST /api/projects/:projectId/report-subscriptions` creates a project report recipient.
- `PATCH /api/report-subscriptions/:subscriptionId` updates or disables a report recipient.
- `GET /life-console` renders a standalone LifeOps prototype that maps the Agent Reliability control-plane model onto human behavior traces, relapse taxonomy, replay, autonomy gates, policy dry-runs, action queues, and audit evidence.
- `POST /life-console` records a local LifeOps trace, appends it to `.data/lifeops-events.json`, reclassifies taxonomy, recalculates 7-day risk, and redirects back to the focused console.
- `POST /api/feedback` for learning labels.
- Suggestion feedback updates suggestion status, creates feedback-derived learning rules, and can create approved draft prompt versions or disabled policy-rule drafts.
- Project-scoped API key protection on run ingestion, manual analysis, reports, traceability reads, delivery, key rotation, subscriptions, operational evidence, and feedback.
- Example webhook payloads and custom-agent sender under `examples/`.
- Local SQLite schema for development.
- Prisma/Postgres schema for production direction.

## Local Commands

```bash
npm test
npm run migrate
npm run analyze -- run_...
npm run report -- project_id 2026-05-21
npm run nightly -- 2026-05-21
npm run retry -- 2026-05-22T00:10:00.000Z
npm run demo
npm run demo:preview
npm run demo:preview:en
npm run local:bootstrap
npm run local:record -- --input "What the agent tried to do" --output "What happened"
npm run local:preview
npm run local:feedback -- --list --status open
npm run local:evidence
npm run local:console
npm run dev # then open /life-console
```

Set `AIWC_DB_PATH` to choose a SQLite database path. Without it, the app uses `.data/aiwc.sqlite`.

Set `OPENAI_API_KEY` to enable the LLM judge. Without it, the judge uses a deterministic local fallback so tests and local development still work.

`/life-console` is intentionally separate from the AI worker SQLite schema for now. It writes local behavior traces to `.data/lifeops-events.json` so the LifeOps loop can iterate quickly before choosing a production schema. Set `LIFEOPS_EVENT_PATH` to point it at another local event log.

The current LifeOps loop is:

1. Record a behavior trace from `/life-console`.
2. Classify it into a relapse or impulse taxonomy.
3. Recalculate 7-day risk, clean streak, readiness, and gate status.
4. Generate a trace-driven replay with root cause, confidence, source event, and next gate.
5. Dry-run LifeOps policies against recent traces and push matched controls into the action queue.
6. Advance action queue items through `pending -> in_progress -> evidence_attached -> resolved / dismissed`.
7. Compare post-action traces against pre-action traces to estimate whether an intervention improved, failed, or still lacks evidence.
8. Surface the trace and action events in audit tables so replay, policy decisions, intervention history, and effectiveness remain explainable.

## Ingestion Auth

Create a project first, then send runs with either:

```http
Authorization: Bearer aiwc_live_...
```

or:

```http
x-api-key: aiwc_live_...
```

Only the key hash is stored. The cleartext key is returned once from project creation.

Keys can be rotated by creating a new project API key, updating the sender, then revoking the old key. Revoked keys no longer authenticate.

## Report Flow

Use `POST /api/reports/nightly` with a project API key to manually run the Phase 1 nightly loop for one project:

```json
{
  "project_id": "project_...",
  "date": "2026-05-21"
}
```

Use `POST /api/cron/nightly` for scheduled runs across projects. In production, set `CRON_SECRET` and send `Authorization: Bearer <secret>`.

## Report Delivery

Phase 1 uses a local email provider stub by default and supports HTTP webhook delivery for `webhook`, `slack`, and `discord` channels. It records delivery attempts in `report_deliveries` with `sent` or `failed` status. Delivery providers receive markdown and rendered HTML; webhook providers receive structured summary payloads.

Projects can store report recipients in `report_subscriptions`. Nightly jobs use enabled subscriptions by default, while an explicit empty `deliver_to` list skips delivery for that run. For Slack or Discord, use the incoming webhook URL as `recipient` and set `channel` to `slack` or `discord`.

## Retry Queue

Failed report deliveries and failed nightly analysis events store retry metadata. `npm run retry` or `POST /api/cron/retry` retries due items and marks them `sent`, `resolved`, still `failed`, or `exhausted`.

Operational evidence can be queried without a dashboard through the project job-events, report-deliveries, and operational-failures endpoints.

## Traceability

Reports store source run and judgement IDs. Use the run and asset query endpoints to trace report claims back to raw run logs, judgements, failure cases, suggestions, cost events, and eval cases.

Use `GET /api/reports/:reportId/evidence-pack` to export a structured audit pack for a stored report. Add `?redact=true` to mask sensitive run text while preserving hashes. The evidence pack includes report metadata, data provenance, ingestion health, autonomy readiness, source run traces, derived evidence, audit events, and SHA-256 integrity hashes. Each export writes a `report.evidence_pack_exported` audit event. This is the Phase 1 foundation for enterprise evidence, incident review, and future compliance exports.

Use `GET /api/reports/:reportId/readiness-dossier` to generate a trust dossier from a stored report. The dossier answers whether the AI worker is ready for unattended autonomy and cites evidence-pack hash, data provenance, ingestion health, incidents, eval replay, and data governance.

Nightly reports also include previous-day comparison when prior-day runs exist, so users can see whether volume, success rate, risk rate, and cost are improving or worsening.

Reports also include `autonomy_readiness`, `learning_assets`, `top_failure_taxonomies`, `eval_replay_gate`, `prompt_promotion_checks`, `autonomy_gate_checks`, `incident_reports`, `incident_remediation_events`, `ingestion_health`, `data_provenance`, `recurring_failure_patterns`, `learning_insights`, and `learning_rules`. These make the control plane's compounding memory visible: accumulated traces, labels, cost events, failure cases, fine-grained taxonomy codes, eval cases, eval runs, replay results, suggestions, feedback labels, reliability scores, score snapshots, learning insights, feedback-derived rules, prompt drafts, prompt promotion evidence, autonomy gate evidence, incident reports, incident remediation timelines, ingestion reliability, source-of-data evidence, policy foundations, policy dry-run evidence, reports, audit events, and repeated failure categories over the last 7 days.

`data_provenance` explains whether the report is based on local workspace runs, authenticated webhook/API runs, demo-like data, or mixed/unknown source metadata. This is how the local console answers "is this my data or simulated data?" without relying on memory or UI guesswork.

Failure cases now carry `taxonomy_code`, `taxonomy_confidence`, and `taxonomy_evidence_json`. Query `/api/projects/:projectId/failure-cases?taxonomy_code=permission_escalation_attempt` to inspect one precise failure mode.

Eval replay is the first safe version of the future上线门禁. Send candidate outputs to `/api/projects/:projectId/eval-runs`; the system stores `eval_runs` and `replay_results`, marks each case `pass`, `fail`, or `regression`, and feeds the latest gate into Regression Stability scoring. It does not execute or modify production agents.

Prompt promotion checks use that replay evidence. A prompt draft can become `promotion_ready` only after a prompt-version-specific replay gate passes. Missing replay or regression evidence produces `promotion_blocked` or `promotion_needs_review`; none of these statuses deploy a prompt automatically.

Autonomy gate checks are the first explicit answer to "can this agent run unattended?" Call `/api/projects/:projectId/agents/:agentId/autonomy-gate` after reports, replay, and policy dry-run evidence exist. The check stores `audit_evidence_items` with `blocked`, `limited_autonomy`, or `approved_with_monitoring`, plus blockers and warnings. It does not grant permissions or enable production autonomy.

Incident reports are the black-box memory layer. High-risk runs and recurring root-cause patterns become `incident_reports` with severity, related run IDs, root cause category, and remediation status. Remediation status changes create `incident_remediation_events` with notes and evidence, and nightly reports surface the remediation timeline. They are evidence only and do not change production behavior.

Autonomy readiness is the first scoring spine. It asks whether the agent can run unattended and stores:

- Autonomy Readiness Score
- Reliability Score
- Cost Efficiency Score
- Risk Exposure Control Score
- Regression Stability Score
- Human Review Independence Score

Learning insights and learning rules are the Phase 1 self-evolution layer. Insights explain what the system has learned. Rules turn operator feedback into `trust_suggestion_pattern` or `suppress_suggestion_pattern` memory that affects future report actionability. They do not automatically change production prompts, workflows, or policies.

Policy dry-run is the Phase 1 governance bridge. Approved risk suggestions create disabled policy drafts, and dry-run evaluates those drafts against historical runs to estimate impact before any enforcement exists. Each nightly report persists a dry-run batch and per-run match evidence. It is review evidence only.

## Demo Smoke Flow

`npm run demo` runs a deterministic local smoke scenario for the whole Phase 1 loop: project, agent, sample runs, AI Judge, derived assets, nightly report delivery, prompt-suggestion approval into an `approved_draft` prompt version, and risk-suggestion approval into a disabled policy-rule draft.

Use `npm run demo -- --locale zh-CN --markdown` to print the generated report in Chinese. See `docs/DEMO.md` and `docs/API.md` for operator-facing examples.

Use `npm run demo -- --html-out demo-output/nightly-report.html` to export a browser-openable HTML report snapshot.

Use `npm run demo -- --console-out demo-output/operator-console.html` to export a browser-openable operator console preview.

Use `npm run demo:preview` to regenerate both browser-openable files at once in Chinese:

- `demo-output/operator-console.html`
- `demo-output/nightly-report.html`

Use `npm run demo:preview:en` when you need the English preview.

## Local Real Data

Use the local flow when you want real data instead of simulated demo data:

```bash
npm run local:bootstrap
npm run local:record -- --input "What the agent tried to do" --output "What happened" --status completed
npm run local:preview -- --force
npm run local:feedback -- --list --status open
npm run local:evidence -- --redact
npm run local:verify-evidence -- --file local-output/report-evidence-pack.redacted.json
npm run local:evidence-manifest
npm run local:data-governance
npm run local:readiness-dossier
npm run local:eval-coverage
npm run local:console
npm run dev # then open /life-console
```

The Agent Control Plane flow writes to `.data/aiwc.sqlite` and renders:

- `local-output/operator-console.html`
- `local-output/nightly-report.html`
- `local-output/report-evidence-pack.json` or a redacted evidence pack when `npm run local:evidence -- --redact` is used
- `local-output/data-governance.json` when `npm run local:data-governance` is used
- `local-output/readiness-dossier.html` when `npm run local:readiness-dossier` is used
- `local-output/eval-coverage.json` when `npm run local:eval-coverage` is used

The LifeOps console writes to `.data/lifeops-events.json`. Each trace captures focus, outcome, trigger, intensity, note, taxonomy, and audit-ready timestamps, then updates the visible risk score and recent trace log. Action queue transitions are stored in the same file under `action_events` so intervention work remains append-only and reviewable.

See `docs/LOCAL_REAL_DATA.md`.

The local preview shows a `数据来源` section. Local Codex/client captures appear as `本地工作区数据`; simulated demo runs are marked as demo-like and should not be treated as production evidence.

## Integration Examples

See `docs/INTEGRATIONS.md` for n8n, Make, Zapier, and custom-agent webhook guidance. The important convention is to send `metadata.task_type`; reports use it for task-level cost attribution.
