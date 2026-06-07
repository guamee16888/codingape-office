# Pilot Scorecard

Stage-13 started the first-run pilot workflow. Stage-15 activates public GitHub tracking for 3-5 real external testers. Stage-19 prepares explicit invite tracking so reserved slots are not confused with real tester results.

This scorecard measures whether real external testers can complete the first useful loop, not whether the internal framework has more features.

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

GitHub tracker:

```text
https://github.com/guamee16888/codingape-office/issues/5
```

| Metric | Current |
| --- | --- |
| Tester count | 0 |
| First task completed | Not evaluated |
| Human Gate understood | Not evaluated |
| Support bundle generated | Not evaluated |
| Feedback score average | Not evaluated |
| Key leakage | 0 known |
| Auto apply | 0 allowed |

## Stage-15 Activation Checklist

- [x] Pilot labels exist on GitHub.
- [x] Public pilot tracker issue exists.
- [x] Existing external tester roadmap issue is labeled.
- [x] Existing benchmark issue is labeled.
- [ ] 3-5 external testers have been invited.
- [ ] Each tester result is recorded without secrets or source code.
- [ ] Main blockers are categorized.
- [x] OpenAI OSS application draft is ready to submit.

## Stage-16 Intake Checklist

- [x] Tester intake checklist exists.
- [x] Tester DM templates exist.
- [x] Stage-16 intake plan exists.
- [x] Tester slots `T01` through `T05` are reserved in the GitHub tracker.
- [x] Local tester result recorder exists.
- [ ] At least 3 external testers have been invited.
- [ ] At least 3 real tester results are recorded.
- [ ] Scorecard metrics are updated from real tester results only.
- [ ] Top blocker category is selected from evidence.

## Stage-19 Submission And Invite Checklist

- [x] OSS application packet can be generated locally.
- [x] OSS submission tracker document exists.
- [x] Tester invite tracker document exists.
- [x] Public OSS submission tracker issue exists: https://github.com/guamee16888/codingape-office/issues/6
- [x] Public tester invite tracker issue exists: https://github.com/guamee16888/codingape-office/issues/7
- [x] Stage-20 OpenAI OSS form worksheet exists.
- [x] Stage-20 first three invite plan exists.
- [ ] At least 3 real tester invites have been sent.
- [ ] OpenAI OSS application has been submitted by the maintainer.
- [ ] No application or invite tracker contains secrets, private local paths, or private source code.
- [ ] Real tester results are recorded only after an actual run.

## Reporting Rule

If a run fails because of model transport, invalid diff, missing Node/npm, port conflict, project selection, or user confusion, record the blocker. Do not turn failure into success just to improve the number.
