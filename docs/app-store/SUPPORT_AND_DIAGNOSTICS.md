# Support And Diagnostics

## Support Center

The app should expose a support center that can:

- generate a support bundle
- open the support bundle directory
- copy a diagnostic summary
- show recent redacted errors
- explain how to restart the local service

## Log Paths

Current local shell logs:

- `~/Library/Logs/CodingYuanOffice/service.out.log`
- `~/Library/Logs/CodingYuanOffice/service.err.log`

Crash reports:

- `~/Library/Logs/DiagnosticReports/CodingYuanOffice_*.crash`

Support bundles:

- `~/Library/Application Support/CodingYuan Office/data/support-bundles`

## Redaction Rules

Never include:

- Apple ID password
- 2FA codes
- app-specific passwords
- App Store Connect API keys
- `.p12` files or private keys
- API keys
- raw environment variables containing secrets

## Reviewer Support

Review notes should tell App Review how to generate a support bundle after running the safe first-order task.

If the reviewer closes the app, the app-managed local service should stop with it. A support bundle generated before exit can include service health and redacted recent errors, but not credentials or raw secret environment variables.
