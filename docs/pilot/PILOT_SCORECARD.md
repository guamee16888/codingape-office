# Pilot Scorecard

Stage-13 measures whether real external testers can complete the first useful loop, not whether the internal framework has more features.

## Success Criteria

Target cohort: 3-5 external testers.

Minimum success bar:

- Install or local run succeeds.
- First launch reaches `/office`.
- Tester selects a project root.
- Tester understands Demo Only / BYO Key / Local Model.
- Tester runs `Run First Task: Update README`.
- Diff is visible before write.
- Human Gate is understood.
- Apply remains manually gated.
- Rollback/report path is visible.
- Feedback JSON or support bundle can be generated.

## Metrics Schema

Latest local pilot metrics are written to:

```text
data/pilot/latest.json
```

Fields:

- `testerId`
- `installStatus`
- `modelConfigStatus`
- `firstTaskStatus`
- `diffVisible`
- `humanGateUnderstood`
- `applyClicked`
- `rollbackAvailable`
- `supportBundleGenerated`
- `feedbackScore`
- `blockerCategory`

## Current Scorecard

No external tester results are recorded in this repository. Do not fill this section with simulated data.

| Metric | Current |
| --- | --- |
| Tester count | 0 |
| First task completed | Not evaluated |
| Human Gate understood | Not evaluated |
| Support bundle generated | Not evaluated |
| Feedback score average | Not evaluated |
| Key leakage | 0 known |
| Auto apply | 0 allowed |

## Reporting Rule

If a run fails because of model transport, invalid diff, missing Node/npm, port conflict, project selection, or user confusion, record the blocker. Do not turn failure into success just to improve the number.
