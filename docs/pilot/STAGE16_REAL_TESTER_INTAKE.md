# Stage-16 Real Tester Intake

Stage-16 starts real tester intake. It does not claim pilot success until real people run the first task and report results.

## Goal

Invite 3-5 external testers, give each tester a clear first-run checklist, and record every result in the public pilot tracker without secrets, private source code, or fabricated success data.

Tracker:

```text
https://github.com/guamee16888/codingape-office/issues/5
```

## Intake Flow

1. Assign a tester ID: `T01` through `T05`.
2. Send one invite message from `TESTER_DM_TEMPLATES.md`.
3. Ask the tester to use `TESTER_INTAKE_CHECKLIST.md`.
4. Ask the tester to start with a small repo or disposable branch.
5. Ask the tester to avoid screenshots containing API keys, private paths, `.env` contents, or private source.
6. Record one public comment in issue `#5`.
7. If the tester hits a blocker, create a focused follow-up issue and link it from the tracker.

## Do Not Count As Success

Do not count a run as successful when:

- the tester did not understand Human Gate / Apply Gate
- no diff or clear failure reason was visible
- the tester had to paste secrets or full source to explain the issue
- the first task only succeeded after manual steps that are not documented
- the result is guessed from a screenshot without a tester report

## Blocker Categories

Use one primary blocker category per tester:

- `install`
- `node`
- `git`
- `port-4142`
- `project-selection`
- `model-provider`
- `context-preview`
- `diff-not-visible`
- `verification`
- `human-gate-confusing`
- `apply`
- `rollback`
- `support-bundle`
- `trust`
- `other`

## Follow-up Rules

- If two testers hit the same blocker, open a focused GitHub issue.
- If a tester does not understand the safety model, prioritize onboarding copy over new features.
- If model setup is the blocker, improve BYO Key / Local Model docs before changing model code.
- If apply or rollback fails, require a redacted support bundle before fixing.
- If testers ask for automatic apply, keep it out of scope for the pilot.

## Stage-16 Exit Criteria

- 3-5 tester slots exist in issue `#5`.
- At least 3 real tester reports are recorded.
- Pilot scorecard is updated from real reports only.
- Top blockers are categorized.
- No API keys, secrets, `.env` contents, private keys, private paths, or full private source are recorded.
- The next product fix is chosen from tester evidence, not from guesses.
