# Review Notes

Codingape Office is a local-first AI coding worker for macOS. In plain terms, it is a local AI coding worker that keeps project writes behind evidence, diff review, verification, and approval gates.

The app helps developers safely test AI-assisted code changes on a local project folder selected by the user. The workflow is safety-gated:

1. The user chooses a local project folder.
2. The app collects local evidence such as git status, package scripts, and task-relevant files.
3. If the user configures a model provider, the app may send task-relevant code snippets to the selected provider.
4. The app generates an AI plan and a unified diff.
5. The diff is applied only in a sandbox first.
6. Verification runs before apply.
7. The user must approve through Human Gate and Apply Gate before any project write.
8. A rollback snapshot is created before apply.

Important safety behavior:

- The app does not default-scan the full disk.
- The app only works inside the project folder selected by the user.
- The app does not automatically modify code.
- The app does not automatically deploy code.
- Sensitive files such as `.env` files, private keys, wallets, certificates, and credentials are skipped.
- API keys are redacted from logs, support bundles, screenshots, and reports.
- Support bundles are for diagnostics and do not include secrets in plaintext.

Model provider behavior:

- Demo Only mode runs without an AI model.
- BYO API Key mode uses the user's configured provider.
- Local Model mode uses a local endpoint such as Ollama or LM Studio.
- Users can test the model connection before running a task.

The local service starts with the app and is stopped when the app exits. It is used to serve the local office workflow and project-bound task state.

Reviewer test path:

1. Launch Codingape Office.
2. Choose a local test project folder.
3. Configure a test API key only if the reviewer wants to exercise AI-backed patch synthesis.
4. Run the safe first-order task.
5. Review evidence, diff, verification, Human Gate, Apply Gate, rollback, and support bundle generation.

This is not a fully autonomous developer. It is a safety-gated AI coding worker that requires user review and approval before writing code.
