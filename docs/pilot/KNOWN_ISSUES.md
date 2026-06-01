# Known Issues

This file is for external pilot testers. Keep blockers visible instead of pretending the product is ready.

## AI Patch Evaluation

- Some providers may return invalid unified diff headers. The evaluator should classify this as `invalid_diff`, not as a safety failure.
- AI-README-003 previously exposed this diff-contract risk. The latest Stage-13 verification passed 15/15, but treat future isolated `AI-README-003 invalid_diff` results as a known model-format issue unless the latest evaluation shows a broader regression.
- Provider fetch failures and timeouts should be separated from model output quality.

## First Run

- If port `4142` is already used, close the older Codingape Office service or change the local port.
- If Node/npm is missing, install Node.js LTS before running the open-source dev server.
- If Git is missing, install Xcode Command Line Tools with `xcode-select --install`.
- If no project root is selected, `/office` should show onboarding instead of scanning the full disk.

## Model Setup

- Demo Only does not call AI and can still run the safety loop.
- BYO Key and Local Model quality depends on the provider and model.
- API keys must not be pasted into feedback, issues, screenshots, support bundles, or docs.

## Apple Distribution

Apple Developer certificates, App Store Connect records, provisioning profiles, notarization, and TestFlight upload credentials are outside Stage-13. Record them as external blockers instead of blocking the pilot UX work.
