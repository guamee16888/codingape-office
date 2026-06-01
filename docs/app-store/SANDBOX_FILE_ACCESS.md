# Sandbox File Access

## Required Entitlements

The MAS candidate uses:

- `com.apple.security.app-sandbox`
- `com.apple.security.files.user-selected.read-write`
- `com.apple.security.files.bookmarks.app-scope`
- `com.apple.security.network.client`
- `com.apple.security.network.server`

Entitlement files:

- `entitlements/CodingYuanOffice.mas.entitlements`
- `entitlements/CodingYuanOffice.mas.inherit.entitlements`

## Project Root Authorization

The App Store version must use explicit user selection for project roots. Persistent access should be restored through an app-scoped security-scoped bookmark or an equivalent App Sandbox-compatible authorization mechanism.

The saved local project record should remain metadata only. Actual read/write access must be based on the active sandbox authorization plus Project Root Guard.

## Current Implementation

The MAS shell uses a WebKit native bridge to open `NSOpenPanel`, return the selected project path, create an app-scoped security-scoped bookmark, and store the bookmark with the local project record. On app launch, the shell restores non-stale bookmarks before starting the local service.

The local service is launched by the app shell and stopped when the app exits. It must inherit the signed sandbox context and operate only against the active user-authorized project root.

The remaining requirement is a signed sandbox/TestFlight validation pass with the real provisioning profile and App Store entitlements.

## Runtime

The App Store build must not require user-installed Node/npm. Use `npm run prepare:mas-runtime` before `npm run build:mac-app-store`; the build script requires `dist/mas-runtime/node-runtime/mas-runtime-manifest.json` and copies/signs that runtime into the app.

## Write Guard

All write candidates must remain relative to the selected project root. The apply path must continue to require:

- diff ready
- verification result
- rollback snapshot
- human approval
- target files inside project root
