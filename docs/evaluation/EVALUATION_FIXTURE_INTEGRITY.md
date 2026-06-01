# Evaluation Fixture Integrity

Stage-12.3 separates benchmark quality from model quality. A task can only judge the AI patch worker fairly when the fixture has one primary failure aligned with that task.

## Fixture Rules

- Keep one intended failure per fixture.
- Keep unrelated behavior either healthy or outside the verification command.
- Make the recommended verification command small and local.
- Do not include `.env`, private keys, wallet files, certificates, credentials, or secret folders.
- Do not count a fixture with unrelated pre-existing failures as an AI patch failure.

## Baseline Verification

The evaluator runs the task verification command before calling the model.

- Baseline pass: continue to context building and model evaluation.
- Baseline fail in the task target: continue to model evaluation and record `expectedBaselineFailure: true`.
- Baseline fail outside the task target: stop before model calls and classify the task as `pre_existing_unrelated_failure`.
- Ambiguous baseline failure: stop before model calls and classify the task as `baseline_verification_failed`.

This avoids wasting tokens and avoids reporting an unrelated fixture problem as `verification_failed`.

## AI-TEST-002 Correction

The old divide-by-zero task used a mixed math fixture where `add(2, 3)` already failed because `add()` returned string concatenation. A correct divide patch could still fail verification because of that unrelated `add()` failure.

Stage-12.3 moves the divide-by-zero task to `divide-zero-demo`, where:

- `add(a, b)` is already correct.
- normal division works.
- the only intended baseline failure is missing `RangeError` handling for zero divisors.

The add bug is covered separately by `add-number-sum-demo`.

## Benchmark vs Real Projects

Benchmark fixtures should be narrow and clean. Real user projects are messier: they may already have failing tests before Coding猿 starts.

In the product flow, a pre-existing unrelated failure should be shown as: "The project already has failing checks. Expand the task scope or fix the baseline first?" That is a user decision, not a benchmark pass or model failure.
