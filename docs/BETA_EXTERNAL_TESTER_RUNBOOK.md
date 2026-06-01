# Codingape Office Beta External Tester Distribution Runbook

This runbook is for Beta v0.4 external testing. The goal is to help a first-time tester install the app, launch it, complete the first task, and generate diagnostics when something fails.

## 1. Build The Distribution Package

Without Apple credentials, generate an unsigned test package:

```sh
npm run build:mac-distribution
```

With Developer ID and notarization credentials:

```sh
export CODEX_OFFICE_DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)"
export CODEX_OFFICE_NOTARY_PROFILE="codingyuan-notary"
npm run build:mac-distribution
```

You can also use the Apple ID credential set:

```sh
export CODEX_OFFICE_DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)"
export CODEX_OFFICE_APPLE_ID="apple-id@example.com"
export CODEX_OFFICE_TEAM_ID="TEAMID"
export CODEX_OFFICE_APP_PASSWORD="app-specific-password"
npm run build:mac-distribution
```

Output paths:

```text
dist/mac/Codingape Office.app
dist/mac-distribution/CodingYuanOffice-0.5.0-beta-mac.zip
dist/mac-distribution/CodingYuanOffice-0.5.0-beta-mac.dmg
dist/mac-distribution/distribution-report.json
```

## 2. External Tester Install Steps

1. Install Git, Node.js LTS, and npm.
2. Open `CodingYuanOffice-0.5.0-beta-mac.dmg`.
3. Drag `Codingape Office.app` into Applications.
4. Open the app and go to `/office`.
5. In First Run Onboarding, choose a local code project directory.
6. Click `Run First Task`.
7. Review Evidence Pack, Diff Preview, Verification, Human Gate, and Apply Gate.
8. Apply the patch only after confirming that the diff is correct and entering the exact confirmation phrase.

Safety promise:

- No default full-disk scanning.
- All reads and writes are bound to the user-authorized project root.
- Project Root Guard blocks path traversal and writes outside the selected root.
- Apply requires a diff, verification, rollback snapshot, and human approval.
- The default flow is human-gated and does not write project files automatically.

## 3. Limits

- Beta v0.4 still requires Node.js LTS on the tester machine.
- Missing AIWC centralized logging is shown as a warning and does not block local beta use.
- Use a small Git repo for the first task; non-Git repos show a warning.
- Cross-repo tasks, large binaries, dependency folders, and sensitive config files are not good first-task targets.

## 4. Logs, Crashes, And Support Bundles

App service logs:

```text
~/Library/Logs/CodingYuanOffice/service.out.log
~/Library/Logs/CodingYuanOffice/service.err.log
```

Legacy launchd preview logs:

```text
~/Library/Logs/com.geoaifactory.codex-office.out.log
~/Library/Logs/com.geoaifactory.codex-office.err.log
```

Crash reports:

```text
~/Library/Logs/DiagnosticReports/CodingYuanOffice*.crash
~/Library/Logs/DiagnosticReports/Codingape Office*.crash
```

Support bundles:

```text
~/Library/Application Support/CodingYuan Office/data/support-bundles
```

One-command diagnostics:

```sh
npm run beta:diagnostics
```

## 5. Ten-Minute First Task For A New Tester

For local rehearsal or guided external testing, run the end-to-end script:

```sh
npm run beta:first-order
```

Or specify a test repository:

```sh
PROJECT_ROOT=/path/to/safe/test/repo npm run beta:first-order
```

The script will:

1. Check Git, Node, npm, and curl.
2. Start or reuse `http://127.0.0.1:4142`.
3. Create or select a safe test project.
4. Run `Add a Codingape beta testing paragraph to README`.
5. Generate evidence, patch proposal, diff, verification, human gate, apply gate, and report.
6. Stop before human confirmation and never apply automatically.

Pass criteria:

- `/office` opens.
- Evidence Pack has a path.
- Diff Preview only edits README or creates `README.codingape-beta.md`.
- Verification passes or returns a readable failure suggestion.
- Apply Gate is human-gated by default.
- Support bundle can be generated.
