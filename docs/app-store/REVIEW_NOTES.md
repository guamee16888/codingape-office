# Review Notes

Codingape Office is a local AI coding worker for macOS. It helps a user run a guarded coding loop on a local project: evidence pack, patch proposal, diff preview, verification, Human Gate, Apply Gate, rollback, and task report.

The app does not default-scan the user's disk. The user must explicitly choose a local project directory before evidence, diff, apply, or rollback actions are available.

The local service starts with the app and is stopped when the app exits. It is used to serve the local office workflow and project-bound task state.

Before any code modification, Codingape Office shows:

- evidence gathered from the selected project
- proposed diff
- verification result
- rollback readiness
- Human Gate approval state

The app does not apply patches automatically by default. Apply is blocked unless the patch diff exists, verification exists, rollback snapshot exists, human approval is granted, and every target file is inside the selected project root.

High-risk or unsupported file targets are blocked by the project safety policy and Project Root Guard. Path traversal and writes outside the selected project root are blocked and recorded as evidence events.

If an API key is needed for AI-backed patch synthesis, the user configures it themselves. Source upload and model-call behavior is described in the privacy material; the app must not send user source to a third party unless the user has configured a provider and started a task that requires that provider.

Support bundles are for diagnostics. They should include app state, recent errors, and redacted logs, but must not include API keys, Apple credentials, private keys, app-specific passwords, or raw secret values.

Reviewer test path:

1. Launch Codingape Office.
2. Choose a local test project folder.
3. Configure a test API key only if the reviewer wants to exercise AI-backed patch synthesis.
4. Run the safe first-order task.
5. Review evidence, diff, verification, Human Gate, Apply Gate, rollback, and support bundle generation.
