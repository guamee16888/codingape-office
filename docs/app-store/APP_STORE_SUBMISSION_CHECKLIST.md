# App Store Submission Checklist

## Product

- App name: Codingape Office
- Default MAS Bundle ID: `com.geoaifactory.codingyuan-office`
- Default version: `1.0.0`
- Default build number: `1`
- Category: Developer Tools or Productivity
- Support URL: prepare a public support page before submission.
- Privacy policy URL: prepare a public privacy page before submission.

## Apple Account

- Create/confirm Bundle ID in Apple Developer.
- Create App Store Connect app record for macOS.
- Install Apple Distribution or Mac App Distribution certificate with private key.
- Install Mac Installer Distribution certificate for `.pkg` upload.
- Create Mac App Store provisioning profile for the Bundle ID.
- Accept current Apple Developer agreements, tax, banking, and paid app terms if needed.

## Local Build

```bash
export CODEX_OFFICE_MAS_BUNDLE_ID="com.geoaifactory.codingyuan-office"
export CODEX_OFFICE_MAS_VERSION="1.0.0"
export CODEX_OFFICE_MAS_BUILD="1"
export CODEX_OFFICE_MAS_PROVISIONING_PROFILE="/path/to/profile.provisionprofile"
npm run prepare:mas-runtime
npm run build:mac-app-store
```

Expected output:

- `dist/mac/Codingape Office.app`
- `dist/mac-app-store/CodingYuanOffice-1.0.0-1-mas.pkg`
- `dist/mac-app-store/mac-app-store-report.json`
- `dist/mas-runtime/node-runtime/mas-runtime-manifest.json`

## Verification

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac/Codingape Office.app"
pkgutil --check-signature "dist/mac-app-store/CodingYuanOffice-1.0.0-1-mas.pkg"
```

Upload the signed `.pkg` through Transporter or App Store Connect.

## Submission Materials

- App screenshots from the real `/office` flow.
- Review notes from `docs/app-store/REVIEW_NOTES.md`.
- Privacy narrative from `docs/app-store/PRIVACY_DATA_FLOW.md`.
- Support and diagnostics policy from `docs/app-store/SUPPORT_AND_DIAGNOSTICS.md`.
- TestFlight runbook and tester result format.
