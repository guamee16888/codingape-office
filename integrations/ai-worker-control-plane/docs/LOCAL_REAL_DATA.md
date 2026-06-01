# Local Real Data Flow

The demo preview is simulated. The local flow is for real operator data from this workspace.

The generated report and local console include `数据来源`. This section states whether the report is based on local workspace captures, authenticated webhook/API ingestion, demo-like data, or mixed/unknown source metadata. Use it as the first check before treating a report as evidence.

## 1. Bootstrap A Real Local Project

```bash
npm run local:bootstrap
```

This creates:

- a persistent SQLite database at `.data/aiwc.sqlite`
- a local project
- a local Codex/work-session agent
- a local-only `.data/local-workspace.json` file containing the project, agent, and ingestion key

`.data/` is gitignored because it may contain local credentials and private run traces.

## 2. Record A Real Work Session

```bash
npm run local:record -- \
  --input "Build the Chinese real-data path for AI Worker Control Plane" \
  --output "Added local bootstrap, run recording, and local preview." \
  --status completed \
  --tools filesystem,shell,tests
```

This stores one real `agent_runs` row and immediately creates a structured judgement plus derived assets.

The adapter captures git metadata such as branch, changed-file count, and short status lines. It does not capture Codex's internal token usage yet because the Codex client does not expose that telemetry here. Reports therefore mark those runs as token/cost unknown unless you provide cost metadata manually.

## 3. Generate The Chinese Real-Data Preview

```bash
npm run local:preview
```

Outputs:

- `local-output/operator-console.html`
- `local-output/nightly-report.html`

The preview includes `这个 Agent 可以无人值守吗？`, which is the first version of the Autonomy Readiness scoring layer. It also includes `数据来源`; for this flow it should show local workspace data from the Codex/local adapter. The score is evidence-based and advisory only; it does not grant permissions or enable policy enforcement.

If a local static server is running at the project root, open:

- `http://127.0.0.1:4897/local-output/operator-console.html`
- `http://127.0.0.1:4897/local-output/nightly-report.html`

## 4. Feed Operator Review Back Into Learning

List suggestions:

```bash
npm run local:feedback -- --list --status open
```

Mark a suggestion as useful, wrong, rejected, or approved:

```bash
npm run local:feedback -- \
  --target suggestion_... \
  --type useful \
  --comment "This recommendation matches what I would do."
```

Supported feedback types:

- `approve`
- `reject`
- `useful`
- `not_useful`
- `wrong`

Approving a prompt suggestion creates an approved draft prompt version. Approving a risk suggestion creates a disabled policy-rule draft. Neither is deployed or enforced automatically.

Regenerate the preview after feedback. Use `--force` when you want to rebuild the report even if a report for that date already exists:

```bash
npm run local:preview -- --force
```

Feedback now becomes learning memory. `useful` and `approve` produce trust-pattern rules; `reject`, `not_useful`, and `wrong` produce suppression-pattern rules. The next report shows those rules under `反馈沉淀的学习规则`, and suppressed patterns are kept out of future actionability.

## 5. Export The Evidence Pack

```bash
npm run local:evidence -- --redact
```

This writes `local-output/report-evidence-pack.json` by default, or a path of your choice with `--out`. Use `--redact` for a shareable pack that masks sensitive text while preserving hashes. The pack includes source run traces, judgements, derived evidence, audit chain, data provenance, ingestion health, and integrity hashes for the latest local report. Each export records an audit event.

Verify and index local evidence packs:

```bash
npm run local:verify-evidence -- --file local-output/report-evidence-pack.redacted.json
npm run local:evidence-manifest
```

The manifest writes `local-output/evidence-manifest.json` with report IDs, redaction modes, evidence hashes, and verification status for local evidence-pack files.

## 6. Export Data Governance Summary

```bash
npm run local:data-governance
```

This writes `local-output/data-governance.json`, an advisory retention and governance summary for local project assets. It does not delete or mutate data.

## 7. Export Readiness Dossier

```bash
npm run local:readiness-dossier
```

This writes `local-output/readiness-dossier.json`, `.md`, and `.html`. It summarizes whether the project is ready for unattended autonomy using readiness scores, evidence-pack hash, data provenance, ingestion health, incidents, eval replay, and data governance.

## 8. Export Eval Coverage Map

```bash
npm run local:eval-coverage
```

This writes `local-output/eval-coverage.json`, showing which failure taxonomies have eval cases, replay coverage, regressions, and priority gaps.

## 9. Use The Local Button Console

Start the local console:

```bash
npm run local:console
```

Open:

```text
http://127.0.0.1:4898/
```

The local console renders feedback buttons for each open suggestion, plus a `重新生成报告` button. Button clicks write feedback into the same database, update learning rules, and regenerate the report. This is still local-only and does not deploy any production prompt or policy.

If you approve a risk suggestion, the system creates a disabled policy draft and shows `策略草案 Dry-run`. This estimates which historical local runs would have matched that draft, persists the dry-run batch plus per-run match evidence, but it still does not enable enforcement.

## Product Boundary

This is not auto-remediation. The local adapter only records evidence, analyzes it, and generates report assets. It does not modify production prompts, workflows, external systems, or customer-facing behavior.
