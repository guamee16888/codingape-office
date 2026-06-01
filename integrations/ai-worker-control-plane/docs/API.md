# API Notes

Phase 1 exposes a small API for proving the closed loop: create a project, create an agent, ingest runs, generate a nightly report, inspect traceability, and capture feedback.

## Create Project

```bash
curl -sS -X POST http://localhost:3000/api/projects \
  -H "content-type: application/json" \
  -d '{
    "name": "Support Agents",
    "org_name": "Acme AI",
    "description": "Nightly health reports for support workflows"
  }'
```

The response includes `project_id` and a one-time `ingestion_api_key`. Store the key in the sender. The database keeps only a hash.

## Create Agent

```bash
curl -sS -X POST http://localhost:3000/api/agents \
  -H "content-type: application/json" \
  -d '{
    "project_id": "project_...",
    "name": "Support Triage Agent",
    "environment": "production"
  }'
```

## Ingest Run

```bash
curl -sS -X POST http://localhost:3000/api/runs \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "project_id": "project_...",
    "agent_id": "agent_...",
    "run_id_external": "support-2026-05-21-001",
    "input": "Help the user check an order.",
    "output": "Order status returned successfully.",
    "model": "gpt-5.5",
    "provider": "openai",
    "tools_used": ["order_lookup"],
    "cost": 0.12,
    "latency": 8.4,
    "status": "completed",
    "metadata": {
      "task_type": "support_triage",
      "prompt_tokens": 100,
      "completion_tokens": 40,
      "total_tokens": 140
    }
  }'
```

`POST /api/runs` requires an existing project/agent pair and a valid project ingestion key.

Ingestion is idempotent when `run_id_external` is present. A retry with the same `project_id`, `agent_id`, and `run_id_external` returns the original `run_id`, does not create a second run, and records an audit event. Senders should set `run_id_external` to their own stable run, trace, job, or workflow execution ID.

Accepted and deduplicated run ingestion events write audit metadata with the API key ID, signature verification state, signature requirement state, signature age, ingestion source, and dedupe status. The audit metadata does not store cleartext API keys or raw signatures.

For production senders, sign the exact JSON body with HMAC-SHA256 using the ingestion API key:

- `x-aiwc-timestamp`: Unix timestamp in seconds.
- `x-aiwc-signature`: `sha256=<hex hmac of "{timestamp}.{raw_body}">`.

The server accepts unsigned requests by default for early MVP compatibility. Set `AIWC_REQUIRE_WEBHOOK_SIGNATURE=true` to require signatures on `POST /api/runs`. Signed requests are rejected when the timestamp is outside the 5-minute tolerance window or the body has been changed.

Node example:

```js
import { createHmac } from "node:crypto";

const body = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = `sha256=${createHmac("sha256", ingestionApiKey)
  .update(`${timestamp}.${body}`, "utf8")
  .digest("hex")}`;

await fetch("https://your-domain.com/api/runs", {
  method: "POST",
  headers: {
    "authorization": `Bearer ${ingestionApiKey}`,
    "content-type": "application/json",
    "x-aiwc-timestamp": timestamp,
    "x-aiwc-signature": signature
  },
  body
});
```

## Run Nightly Report

```bash
curl -sS -X POST http://localhost:3000/api/reports/nightly \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "project_id": "project_...",
    "date": "2026-05-21"
  }'
```

The nightly job analyzes unanalyzed runs, stores structured judgements and derived assets, generates a markdown/JSON report, and delivers it to enabled project subscriptions unless `deliver_to: []` is passed.

The report JSON includes a `previous_day_comparison` object when prior-day runs exist. It compares run volume, success rate, failure rate, high-risk rate, total cost, and average cost.

The report JSON also includes:

- `autonomy_readiness`: project and agent scores for autonomy readiness, reliability, cost efficiency, risk exposure control, regression stability, and human-review independence.
- `learning_assets`: cumulative counts for run traces, outcome labels, cost events, failure cases, failure taxonomy, eval cases, suggestions, feedback labels, learning insights, reliability scores, score snapshots, incident reports, incident remediation events, policy rules, policy dry-runs, policy dry-run match evidence, prompt versions, reports, and audit events.
- `top_failure_taxonomies`: fine-grained failure patterns such as `permission_escalation_attempt`, `sensitive_data_exposure`, `workflow_state_drift`, or `cost_overrun_loop`, with counts and average classification confidence.
- `eval_replay_gate`: latest eval replay gate summary, including pass/fail/regression counts and the gate decision.
- `prompt_promotion_checks`: recent prompt promotion readiness evidence backed by prompt-version-specific replay gates.
- `autonomy_gate_checks`: recent agent autonomy gate evidence with `blocked`, `limited_autonomy`, or `approved_with_monitoring` decisions.
- `incident_reports`: generated black-box records for high-risk runs and recurring root-cause patterns.
- `incident_remediation_events`: immutable incident lifecycle transitions for the incidents surfaced in the report.
- `ingestion_health`: accepted ingestion events, duplicate retries, signature coverage, duplicate rate, last ingestion time, and observed API key IDs for the report period.
- `data_provenance`: source-of-data summary that distinguishes local workspace captures, authenticated webhook/API ingestion, demo-like data, mixed/unknown metadata, and runs with unknown token/cost telemetry.
- `recurring_failure_patterns`: repeated failure categories seen over the rolling 7-day window ending at the report period.
- `learning_insights`: self-evolution memory generated from feedback, recurring failures, cost opportunities, eval backlog, prompt drafts, and policy drafts.
- `learning_rules`: feedback-derived `trust_suggestion_pattern` and `suppress_suggestion_pattern` rules that make accepted or rejected advice affect later report actionability.
- `policy_dry_run_summary` and `policy_dry_run_results`: disabled policy drafts evaluated against historical runs for the report period.
- `policy_dry_run_evidence`: persisted report-scoped dry-run batches and match evidence counts.
- `reliability_score_evidence`: persisted score IDs and score snapshot IDs for the report.

## Report Evidence Pack

Export the structured evidence behind a stored report:

```bash
curl -sS http://localhost:3000/api/reports/report_.../evidence-pack \
  -H "authorization: Bearer aiwc_live_..."
```

Use `?redact=true` to export a shareable evidence pack that masks sensitive run inputs, outputs, judgement prose, failure descriptions, suggestions, eval inputs, and raw audit metadata while preserving hashes and non-sensitive operational fields.

The evidence pack includes report metadata, summary metrics, `data_provenance`, `ingestion_health`, autonomy readiness, source run traces, run judgements, failure cases, cost events, suggestions, eval cases, policy dry-run evidence, reliability score evidence, incident evidence, remediation timeline, audit chain, and SHA-256 integrity hashes. Each export writes a `report.evidence_pack_exported` audit event. It is read-only audit evidence; it does not regenerate reports or change production behavior.

## Readiness Dossier

Generate a customer-readable trust dossier from a stored report:

```bash
curl -sS http://localhost:3000/api/reports/report_.../readiness-dossier \
  -H "authorization: Bearer aiwc_live_..."
```

Use `?format=markdown` for a markdown version. The dossier summarizes verdict, autonomy readiness, reliability, cost efficiency, risk exposure, regression stability, evidence-pack hash, data provenance, ingestion health, data governance, incidents, blockers, strengths, and recommended next steps. It is a read-only trust summary and does not change agent permissions.

Fetch policy dry-run evidence directly:

```bash
curl -sS "http://localhost:3000/api/projects/project_.../policy-dry-run?date=2026-05-21&include_evidence=true&report_id=report_..." \
  -H "authorization: Bearer aiwc_live_..."
```

## Deliver A Report

Email delivery:

```bash
curl -sS -X POST http://localhost:3000/api/reports/report_.../deliver \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "recipient": "ops@example.com",
    "channel": "email"
  }'
```

Slack webhook delivery:

```bash
curl -sS -X POST http://localhost:3000/api/reports/report_.../deliver \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "recipient": "https://hooks.slack.com/services/...",
    "channel": "slack"
  }'
```

Generic webhook and Discord delivery use `channel: "webhook"` or `channel: "discord"` with an http(s) webhook URL.

## Report Subscriptions

```bash
curl -sS -X POST http://localhost:3000/api/projects/project_.../report-subscriptions \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "recipient": "https://hooks.slack.com/services/...",
    "channel": "slack",
    "enabled": true
  }'
```

Enabled subscriptions are used by nightly jobs by default.

## Trace Report Claims

```bash
curl -sS http://localhost:3000/api/projects/project_.../runs \
  -H "authorization: Bearer aiwc_live_..."

curl -sS "http://localhost:3000/api/projects/project_.../ingestion-events?limit=20" \
  -H "authorization: Bearer aiwc_live_..."

curl -sS "http://localhost:3000/api/projects/project_.../ingestion-events?deduplicated=true" \
  -H "authorization: Bearer aiwc_live_..."

curl -sS "http://localhost:3000/api/projects/project_.../ingestion-health?from=2026-05-21T00:00:00.000Z&to=2026-05-22T00:00:00.000Z" \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/runs/run_... \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/runs/run_.../judgement \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/projects/project_.../suggestions \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/projects/project_.../eval-cases \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/projects/project_.../eval-runs \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/projects/project_.../eval-coverage \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/projects/project_.../failure-cases \
  -H "authorization: Bearer aiwc_live_..."

curl -sS "http://localhost:3000/api/projects/project_.../failure-cases?taxonomy_code=permission_escalation_attempt" \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/projects/project_.../learning-insights \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/projects/project_.../learning-rules \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/projects/project_.../incident-reports \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/projects/project_.../policy-rules \
  -H "authorization: Bearer aiwc_live_..."

curl -sS "http://localhost:3000/api/projects/project_.../policy-review-tasks?status=open" \
  -H "authorization: Bearer aiwc_live_..."

curl -sS "http://localhost:3000/api/projects/project_.../policy-review-candidates?status=pending" \
  -H "authorization: Bearer aiwc_live_..."

curl -sS -X PATCH http://localhost:3000/api/policy-review-candidates/policy_candidate_... \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "status": "accepted",
    "note": "Accept candidate and move the policy draft to the next review status.",
    "evidence": {
      "source": "operator_review"
    }
  }'

curl -sS http://localhost:3000/api/policy-review-candidates/policy_candidate_.../events \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/policy-review-tasks/policy_task_... \
  -H "authorization: Bearer aiwc_live_..."

curl -sS -X PATCH http://localhost:3000/api/policy-review-tasks/policy_task_... \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "status": "in_review",
    "note": "Started reviewing sample runs.",
    "evidence": {
      "source": "operator_review"
    }
  }'

curl -sS http://localhost:3000/api/policy-review-tasks/policy_task_.../events \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/policy-rules/policy_... \
  -H "authorization: Bearer aiwc_live_..."

curl -sS -X PATCH http://localhost:3000/api/policy-rules/policy_... \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "status": "reviewed",
    "note": "Reviewed source learning rule and dry-run scope.",
    "evidence": {
      "source": "operator_review",
      "dry_run_scope": "historical_runs_only"
    }
  }'

curl -sS http://localhost:3000/api/policy-rules/policy_.../events \
  -H "authorization: Bearer aiwc_live_..."

curl -sS "http://localhost:3000/api/projects/project_.../policy-dry-run?date=2026-05-21" \
  -H "authorization: Bearer aiwc_live_..."

curl -sS http://localhost:3000/api/projects/project_.../agents/agent_.../autonomy-gate \
  -H "authorization: Bearer aiwc_live_..."
```

These read-only endpoints are the no-dashboard way to inspect evidence behind the report. `ingestion-events` is useful during onboarding: it shows whether run payloads are arriving, whether signatures were verified, and whether retries were deduplicated. `ingestion-health` summarizes accepted events, duplicate retries, signature coverage, duplicate rate, last ingestion time, and observed ingestion key IDs. `eval-coverage` shows failure taxonomy coverage, failure-to-eval ratio, replay coverage, missing eval coverage, unreplayed evals, and regression taxonomies.

## Inspect Incident Reports

Incident reports are generated during nightly report creation from high-risk runs and recurring root-cause patterns.

```bash
curl -sS "http://localhost:3000/api/projects/project_.../incident-reports?severity=high&remediation_status=open" \
  -H "authorization: Bearer aiwc_live_..."
```

Each incident includes `related_run_ids`, `root_cause_category`, `severity`, `summary`, and `remediation_status`. Phase 1 does not automatically mark remediation complete or change production systems.

Update remediation status:

```bash
curl -sS -X PATCH http://localhost:3000/api/incidents/incident_... \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "remediation_status": "investigating",
    "note": "Owner is reviewing the privileged tool path.",
    "evidence": {
      "owner": "ops"
    }
  }'
```

Allowed lifecycle states are `open`, `investigating`, `remediated`, `verified`, `dismissed`, and `reopened`. Each update creates an `incident_remediation_events` record and an audit event. Nightly report JSON also includes the latest `incident_remediation_events` for surfaced incidents so operators can see the review timeline next to the incident.

List remediation history:

```bash
curl -sS http://localhost:3000/api/incidents/incident_.../remediation-events \
  -H "authorization: Bearer aiwc_live_..."
```

## Run Eval Replay Gate

Use eval replay before promoting a prompt, model route, or workflow candidate. The endpoint evaluates candidate outputs against stored eval cases and persists pass/fail/regression evidence. It does not execute customer agents or modify production systems.

```bash
curl -sS -X POST http://localhost:3000/api/projects/project_.../eval-runs \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "agent_id": "agent_...",
    "eval_case_ids": ["eval_..."],
    "candidate_outputs": [
      {
        "eval_case_id": "eval_...",
        "actual_output": "The agent handled the missing tool result with a fallback and asked for human review."
      }
    ]
  }'
```

The response includes `summary.gate_decision`:

- `passed`: all replayed cases passed.
- `needs_review`: at least one case failed.
- `blocked_by_regression`: at least one case repeated a known failure pattern.
- `insufficient_eval_coverage`: no usable replay coverage.

## Check Prompt Promotion Readiness

After approving a prompt suggestion into a prompt draft and running replay with `prompt_version_id`, check whether the draft can enter human release approval:

```bash
curl -sS -X POST http://localhost:3000/api/projects/project_.../prompt-versions/prompt_.../promotion-check \
  -H "authorization: Bearer aiwc_live_..."
```

The check stores `audit_evidence_items` and updates the prompt draft status:

- `promotion_ready`: prompt-version-specific replay passed; still requires human production approval.
- `promotion_needs_review`: replay exists but did not fully pass.
- `promotion_blocked`: replay is missing or regressed.

This endpoint does not deploy the prompt.

## Check Agent Autonomy Gate

After a nightly report has created readiness scores, and after replay/policy dry-run evidence exists, run an explicit autonomy gate check:

```bash
curl -sS -X POST http://localhost:3000/api/projects/project_.../agents/agent_.../autonomy-gate \
  -H "authorization: Bearer aiwc_live_..."
```

The response includes:

- `gate_decision`: `blocked`, `limited_autonomy`, or `approved_with_monitoring`.
- `autonomy_allowed`: true only for `approved_with_monitoring`.
- `blockers`: evidence that stops unattended autonomy.
- `warnings`: evidence that still requires operator attention.
- `audit_evidence_item_id`: the stored evidence item for later audit.

List stored checks:

```bash
curl -sS http://localhost:3000/api/projects/project_.../agents/agent_.../autonomy-gate \
  -H "authorization: Bearer aiwc_live_..."
```

This gate is review-only in Phase 1. It does not grant permissions, enable policies, modify prompts, change workflows, call tools, or send messages.

## Certification Roadmap and Objective Evidence

Nightly reports now include `autonomy_certification_roadmaps`: the current score, target autonomy level, hard blockers, score blockers, quantified remediation objectives, expected score deltas, and verification requirements.

Update a remediation objective as evidence arrives:

```bash
curl -sS -X PATCH http://localhost:3000/api/remediation-objectives/objective_... \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "status": "evidence_attached",
    "note": "Attached incident review and replay evidence.",
    "evidence": {
      "evidence_ref": "internal://risk-review/123"
    }
  }'
```

Allowed statuses are `open`, `evidence_attached`, `verified`, `rejected`, `reopened`, and `superseded`. Each transition stores a `remediation_objective_events` row and an audit event.

List objective events:

```bash
curl -sS http://localhost:3000/api/remediation-objectives/objective_.../events \
  -H "authorization: Bearer aiwc_live_..."
```

Recheck the certification roadmap after evidence or fixes:

```bash
curl -sS -X POST http://localhost:3000/api/projects/project_.../agents/agent_.../certification-recheck \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{ "target_autonomy_level": "L2" }'
```

The recheck stores previous score, new score, score delta, previous/new gate status, blocker type, and objective status summary. It is still evidence-only and does not grant autonomy.

Rechecks also validate verified objectives against current metrics. If an operator marks an objective as `verified` but the latest roadmap still contains the matching blocker, the recheck summary reports:

- `metric_validation_status`: `verified_objectives_still_blocked`
- `verified_but_unresolved_count`: number of verified objectives whose underlying metric/blocker is still unresolved
- `objective_metric_validations`: stored rows explaining which blockers still match

Rechecks also review objective evidence requirements. Each objective requirement can be:

- `satisfied`
- `missing`
- `expired`
- `mismatched_objective`
- `attached_but_unverified`

Evidence metadata can include `requirement`, `requirement_key`, `metric_status`, and `expires_at`. The recheck summary reports `evidence_requirement_status` and `incomplete_evidence_review_count`.

Rechecks also assess active objectives against the current scoring-window run metrics. The response reports:

- `run_closure_status`: `run_metrics_support_closure`, `run_metrics_still_blocked`, or `run_metrics_not_enough_evidence`
- `run_closure_ready_count`: objectives whose latest run metrics support closure
- `run_closure_still_blocked_count`: objectives still contradicted by latest run metrics
- `objective_run_closure_assessments`: persisted per-objective evidence rows

This is evidence only. Closure-ready does not automatically close the objective or approve autonomy.

## Certification Action Queue

List the current operator actions generated by the latest certification rechecks:

```bash
curl -sS "http://localhost:3000/api/projects/project_.../agents/agent_.../certification-actions?status=open" \
  -H "authorization: Bearer aiwc_live_..."
```

Each action links a blocker to a recommended next step, such as attaching evidence or reworking remediation. Repeated rechecks supersede older active actions for the same blocker/task so the current queue stays focused.

Fetch or update one action:

```bash
curl -sS -X PATCH http://localhost:3000/api/certification-actions/cert_action_... \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "status": "in_progress",
    "note": "Operator is preparing evidence for this blocker.",
    "evidence": {
      "evidence_ref": "internal://certification/action/123"
    }
  }'
```

Allowed statuses are `open`, `in_progress`, `evidence_attached`, `resolved`, `dismissed`, `reopened`, and `superseded`. Each transition stores a `certification_action_events` row and an audit event. Updating an action is advisory-only: it does not close blockers, grant autonomy, modify prompts, modify workflows, call tools, or affect customers.

List action events:

```bash
curl -sS http://localhost:3000/api/certification-actions/cert_action_.../events \
  -H "authorization: Bearer aiwc_live_..."
```

## HTML Report

```bash
curl -sS http://localhost:3000/api/reports/report_.../html \
  -H "authorization: Bearer aiwc_live_..."
```

The HTML endpoint renders the stored markdown report. It does not create new analysis.

## Feedback

```bash
curl -sS -X POST http://localhost:3000/api/feedback \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "project_id": "project_...",
    "target_type": "suggestion",
    "target_id": "suggestion_...",
    "feedback_type": "approve",
    "comment": "Turn this into a prompt draft."
  }'
```

Approving a prompt suggestion creates an `approved_draft` prompt version. It does not modify production prompts.

Approving a risk suggestion creates a disabled `policy_rules` draft. It does not enable or enforce the policy.

Policy dry-run then shows which historical runs that disabled draft would match, including matched tools, risk score, source run, and recommendation. It is review evidence only.

Policy drafts also have an advisory review lifecycle: `draft_review -> reviewed -> approved_for_dry_run -> ready_to_enable_later`, or `rejected`. Every transition writes `policy_rule_events` and audit events. Even `ready_to_enable_later` leaves `enabled=false`; Phase 1 never enforces policies automatically.

Policy dry-run also generates `policy_review_tasks`. Each task contains priority, sample runs, review questions, evidence requirements, false-positive risk, and a recommended review status. New report tasks supersede older open tasks for the same policy draft.

Policy review tasks have an advisory lifecycle: `open -> in_review -> needs_more_evidence -> in_review -> completed`, or `rejected`. Every transition writes `policy_review_task_events` and audit events. Task completion does not change the policy rule status and never enables enforcement.

When a policy review task is completed, the system may create a pending `policy_rule_review_candidates` row recommending a policy review-status change. This is only a candidate action for a human operator; it does not call `PATCH /api/policy-rules/[policyRuleId]` and does not enable the policy.

Candidates have their own lifecycle: `pending -> accepted` or `pending -> rejected`. Accepting a candidate applies the next valid policy review-status transition through the same guarded policy API and still keeps `enabled=false`. Rejecting a candidate only records the rejection event.

Fetch the read-only governance dossier for a policy draft:

```bash
curl -sS http://localhost:3000/api/policy-rules/policy_.../governance-dossier \
  -H "authorization: Bearer aiwc_live_..."
```

Markdown output:

```bash
curl -sS "http://localhost:3000/api/policy-rules/policy_.../governance-dossier?format=markdown" \
  -H "authorization: Bearer aiwc_live_..."
```

The dossier links the policy rule, source approved suggestion or trusted learning rule, policy dry-runs, dry-run match evidence, review tasks, task events, review candidates, candidate events, policy rule events, and related audit events. It is read-only and keeps the Phase 1 safety boundary: advisory-only, no automatic execution, no automatic enforcement, and `enabled=false`.

The response also includes `advancement_readiness`, a deterministic readiness object for the next review step:

- `current_review_status`
- `next_review_status`
- `advancement_status`
- `readiness_score`
- `requirements`
- `blockers`
- `can_advance_review_status`
- `can_enable_policy`
- `can_enforce_policy`
- `next_action`

`can_enable_policy` and `can_enforce_policy` are always `false` in Phase 1. Advancement readiness only explains whether the evidence is strong enough for a human to consider the next review-status transition.

Local export:

```bash
npm run local:policy-dossier
```

Use `--policy policy_...` to export a specific policy draft, or `--out local-output/custom-policy-dossier` to change the output basename. The command writes `.json`, `.md`, and `.html` files.

Fetch the read-only review workbench for a policy draft:

```bash
curl -sS http://localhost:3000/api/policy-rules/policy_.../review-workbench \
  -H "authorization: Bearer aiwc_live_..."
```

Markdown output:

```bash
curl -sS "http://localhost:3000/api/policy-rules/policy_.../review-workbench?format=markdown" \
  -H "authorization: Bearer aiwc_live_..."
```

The workbench turns advancement blockers into operator work items. It can recommend collecting dry-run evidence, completing a review task, inspecting candidates, or considering a guarded review-status transition. It is read-only: it does not create tasks, update review status, enable policies, or enforce policies.

Local export:

```bash
npm run local:policy-workbench
```

Record an operator response to a workbench item:

```bash
curl -sS -X POST http://localhost:3000/api/policy-rules/policy_.../review-workbench/events \
  -H "content-type: application/json" \
  -H "authorization: Bearer aiwc_live_..." \
  -d '{
    "work_item_id": "policy_work_review_task_completed",
    "event_type": "acknowledged",
    "note": "Operator will review the sample runs.",
    "evidence": {
      "evidence_ref": "internal://policy-review/123"
    }
  }'
```

Allowed event types are `acknowledged`, `evidence_attached`, `completed`, `dismissed`, `reopened`, and `note_added`. Work item events write audit history and a workbench snapshot, but do not mutate policy state, complete review tasks, enable policies, or enforce policies.

List work item events:

```bash
curl -sS http://localhost:3000/api/policy-rules/policy_.../review-workbench/events \
  -H "authorization: Bearer aiwc_live_..."
```

Local event recording:

```bash
npm run local:policy-workbench-event -- --work-item policy_work_review_task_completed --event acknowledged --note "reviewed"
```

Evaluate work item effectiveness:

```bash
curl -sS -X POST http://localhost:3000/api/policy-rules/policy_.../review-workbench/effectiveness \
  -H "authorization: Bearer aiwc_live_..."
```

List persisted effectiveness records:

```bash
curl -sS http://localhost:3000/api/policy-rules/policy_.../review-workbench/effectiveness \
  -H "authorization: Bearer aiwc_live_..."
```

Effectiveness compares each work item event's stored workbench snapshot with the current policy workbench. It records readiness score delta, blocker-cleared status, and an effectiveness status such as `blocker_cleared`, `readiness_improved_blocker_persisted`, `readiness_regressed_after_action`, `dismissed_without_action`, or `no_measurable_improvement`.

Nightly reports rebuild policy work-item learning rules from these effectiveness records. The Workbench applies active/trusted rules as priority adjustments only. It does not close blockers, mutate policies, or enable enforcement.

Local effectiveness evaluation:

```bash
npm run local:policy-workbench-effectiveness
```

Suggestion feedback also updates the suggestion status to `approved`, `rejected`, `useful`, `not_useful`, or `wrong`, so later reports and operator queries can separate accepted advice from rejected or incorrect advice.

Suggestion feedback also upserts a learning rule. `useful` and `approve` create trust-pattern memory; `reject`, `not_useful`, and `wrong` create suppression-pattern memory. Nightly reports rebuild missing learning rules from existing feedback history before calculating next actions, so older feedback is not stranded.
