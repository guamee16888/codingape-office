# Mac App Store Blockers

Last audited: 2026-05-31 Stage-6 upload preflight

This file tracks blockers for the Mac App Store route only. Developer ID notarization is a separate outside-the-store beta path and does not count as App Store submission readiness.

## External Apple Account Blockers

- **Apple Distribution signing identity missing**
  - Current Stage-6 preflight: `security find-identity -p codesigning -v` returns `0 valid identities found` on this machine.
  - Follow-up checks found no `Apple Distribution` certificate in the current user keychain.
  - Needed: Apple Distribution, Mac App Distribution, or legacy 3rd Party Mac Developer Application identity installed with private key.
  - User action: Apple Developer Account Holder/Admin creates the certificate, installs it into login keychain, then reruns `security find-identity -p codesigning -v`.

- **Mac Installer Distribution signing identity missing**
  - Current Stage-6 preflight: no `Mac Installer Distribution` certificate is visible in the current user keychain.
  - Needed to sign the `.pkg` generated for App Store Connect upload.
  - User action: create/install Mac Installer Distribution or legacy 3rd Party Mac Developer Installer certificate.

- **App Store Connect bundle/app record not locally verifiable**
  - Target default Bundle ID: `com.geoaifactory.codingyuan-office`.
  - User reported the Bundle ID and App Store Connect app record are created.
  - Local status: this cannot be verified without a user-authenticated Apple session. Do not enter Apple credentials into Codex; verify manually in App Store Connect if needed.

- **Mac App Store provisioning profile missing**
  - Current Stage-6 preflight: no provisioning profile is installed in the standard local profile directories, and no profile was found in `~/Downloads` during the bounded check.
  - User action: install or locate the Mac App Store provisioning profile for `com.geoaifactory.codingyuan-office`, then set `CODEX_OFFICE_MAS_PROVISIONING_PROFILE=/path/to/profile.provisionprofile` if it is not in a standard Xcode profile directory.
  - Build guardrail: once a profile is visible, `npm run build:mac-app-store` validates the profile bundle id, team id, and embedded DeveloperCertificates against the selected app signing identity before packaging.

## Runtime Architecture Status

- **MAS runtime bundle prepared**
  - Current beta shell starts `server.js` through Node.
  - The MAS path no longer relies on user-installed Node/npm at runtime.
  - `npm run prepare:mas-runtime` stages `dist/mas-runtime/node-runtime`, copies non-system dylib dependencies, rewrites load paths, ad-hoc signs the prepared runtime for local validation, and writes `mas-runtime-manifest.json`.
  - `npm run build:mac-app-store` requires that manifest and will copy/sign the runtime into the `.app`.
  - Remaining user/action item: validate this bundled runtime in a signed sandbox/TestFlight build after Apple signing and provisioning are installed.

- **Persistent project access needs signed-sandbox validation**
  - Current MAS shell path: user selects the project root through native `NSOpenPanel`; the app creates an app-scoped security-scoped bookmark; the local project registry stores that bookmark; app launch restores non-stale bookmarks before starting the local service.
  - Remaining user/action item: validate this behavior in a signed sandbox/TestFlight build with the real provisioning profile and App Store entitlements.

## Current Code Guardrails Already Present

- Project selection is explicit; no default full-disk scan.
- Project Root Guard blocks traversal and writes outside the selected root.
- Apply remains Human Gate protected and requires diff, verification, rollback, approval, and in-root targets.
- Support bundles are designed to redact secrets.

## Automatic Build Behavior

`npm run build:mac-app-store` must fail when any required signing, provisioning, runtime, or sandbox material is missing. A passing build means it generated a sandboxed, signed `.app` and a signed `.pkg` candidate for App Store Connect upload.
