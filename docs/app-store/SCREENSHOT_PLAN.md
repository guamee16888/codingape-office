# Screenshot Plan

Capture screenshots from a clean signed sandbox build.

Stage-9 capture command:

```bash
npm run stage9:capture-app-store-screenshots
```

The command writes review-safe Demo Data screenshots under `data/app-store-screenshots/`.

## Required Frames

- `01-demo-overview.png`: live worker room, selected project, and current task state.
- `02-evidence-pack.png`: Evidence Pack and first-order proof trail.
- `03-human-gate.png`: Human Gate approval state and safety copy.
- `04-apply-gate-blocked.png`: Apply Gate blocked until exact confirmation.
- `05-company-report.png`: Company Report with evidence, diff, verification, and rollback status.

Additional manual frames for App Review, captured from a clean sandbox build:

- First Run Onboarding: welcome and project selection.
- Support Center: support bundle controls and redacted diagnostic summary.

## Rules

- Use demo-safe or disposable test project content.
- Do not show private source code, API keys, Apple credentials, email addresses, private repos, or customer data.
- Use the same app name, icon, and version as the submitted build.
- Every App Store screenshot should answer one question in the first glance: what is happening, why it is safe, and what the user controls.
