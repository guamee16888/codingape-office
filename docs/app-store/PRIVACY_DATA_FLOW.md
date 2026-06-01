# Privacy Data Flow

## Local Data

Coding猿 Office stores operational state locally under the app support data directory. Local state can include selected project metadata, task records, evidence summaries, patch proposals, verification results, rollback metadata, apply reports, and support bundle metadata.

## User Project Files

The user chooses a project root. Coding猿 Office should only read/write files under that selected root, and writes must pass Project Root Guard plus Human Gate.

The app must not scan the full disk by default.

## Network

Network access is used only for configured model/API calls, AIWC ingestion when configured, local service health, and user-triggered diagnostics. If no remote provider is configured, the local coding loop should remain local-only where possible.

User source code must not be uploaded to third parties unless the user explicitly configures the provider and starts a task that requires the provider. UI and privacy copy must make that boundary clear.

When a remote model provider is configured, request payloads may include task text, selected project evidence summaries, and proposed patch context needed for that user-started task. The default safety posture is project-root scoped and human gated; the app must not perform background full-disk source collection.

## Secrets

API keys, Apple credentials, app-specific passwords, private key passwords, and signing materials must not be logged, stored in support bundles, or included in reports.

## Support Bundles

Support bundles may include:

- app version/build metadata
- local service health
- recent redacted errors
- operational readiness status
- apply/rollback report metadata

Support bundles must exclude:

- raw API keys
- Apple ID credentials
- app-specific passwords
- private keys or `.p12` files
- unredacted environment variables
- user source files unless explicitly selected and disclosed
