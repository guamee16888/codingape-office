# Stage-15 External Pilot Activation

Stage-15 turns the public repository into a real external pilot workflow. The goal is to help 3-5 external testers run one safe first task and report what happened without exposing secrets or private source code.

## Goal

Validate whether a new tester can:

1. Install or run Codingape Office locally.
2. Open `/office`.
3. Select a small local project folder.
4. Choose Demo Only, BYO API Key, or Local Model.
5. Run `Run First Task: Update README`.
6. See context preview, plan, diff, verification, Human Gate, Apply Gate, rollback, and report surfaces.
7. Export feedback JSON or generate a support bundle if blocked.

## Success Bar

The pilot is useful if each tester produces one of these outcomes within about 10 minutes:

- a visible diff with Human Gate understood
- a clear failure reason with support material
- a concrete onboarding confusion report

Do not count a run as successful if the tester never understood that writes are human-gated.

## Tester Cohort

Target: 3-5 external testers.

Use small repos, disposable branches, or toy projects first. Do not ask testers to start with a production-only repository.

## GitHub Tracking

Use one public tracker issue for the pilot cohort:

```text
[Pilot] External tester first-run tracker
```

Current tracker:

```text
https://github.com/guamee16888/codingape-office/issues/5
```

Use one comment per tester run. Keep comments redacted and short.

Recommended comment format:

```text
Tester: T01
Run mode: Demo Only / BYO API Key / Local Model
Install/local run: pass/fail
Project selected: pass/fail
Model configured: pass/fail/skipped
First task: pass/fail/blocked
Diff visible: yes/no
Human Gate understood: yes/no
Apply attempted: yes/no
Rollback visible: yes/no
Support bundle generated: yes/no
Main blocker:
Feedback score:
Next fix:
```

## Labels

Use these labels to keep pilot work organized:

- `pilot-feedback`
- `first-run`
- `model-provider`
- `safety`
- `security`
- `docs`
- `good first issue`
- `benchmark`

## What Not To Record

Never record:

- API keys
- `.env` contents
- private keys
- wallet files
- certificates
- Apple signing material
- raw private source files
- full prompts or full model context
- private local machine paths

## First Follow-up Rules

- If the tester is confused before selecting a project, improve onboarding copy.
- If the tester cannot configure a model, improve Model Provider Settings docs and health checks.
- If the tester cannot see the diff, improve first-task flow visibility.
- If the tester does not understand Human Gate, improve the main status and gate copy.
- If apply or rollback fails, collect a redacted support bundle and file a bug.

## Exit Criteria

Stage-15 is complete when:

- GitHub labels exist for pilot triage.
- A public pilot tracker issue exists.
- Existing roadmap and benchmark issues have useful labels.
- The pilot scorecard points to the tracker.
- The OpenAI OSS application draft is ready to copy into a form.
- No pilot data is fabricated.
