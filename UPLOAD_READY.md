# Upload Ready

Status: blocked before upload candidate generation.

Last checked: 2026-05-31 Stage-6 Mac App Store upload preflight.

## Build Identity

- Product: Coding猿 Office
- Bundle ID: `com.geoaifactory.codingyuan-office`
- Version: `1.0.0`
- Build number: `1`
- App path: `<repo>/dist/mac/Coding猿 Office.app`
- Package path: `<repo>/dist/mac-app-store/CodingYuanOffice-1.0.0-1-mas.pkg`

## Current Result

`npm run prepare:mas-runtime` completed successfully and produced:

- `<repo>/dist/mas-runtime/node-runtime/mas-runtime-manifest.json`

`npm run build:mac-app-store` stopped during preflight. No App Store upload candidate should be treated as ready from this run.

Blocking checks:

- Apple Distribution or Mac App Distribution signing identity: not detected
- Mac Installer Distribution signing identity: not detected
- Mac App Store provisioning profile for `com.geoaifactory.codingyuan-office`: not detected
- Team ID: not configured in the build environment

The MAS build preflight now validates visible profiles against the target bundle id, team id, and selected app signing certificate before packaging.

## Upload Tooling

- Transporter app: not detected on this machine during this check
- `xcrun altool`: not detected on this machine during this check

No Apple credentials were requested or entered.

## Next Upload Method

After Apple signing identities and the MAS provisioning profile are visible locally:

1. Re-run `security find-identity -p codesigning -v` and confirm Apple Distribution/Mac App Distribution plus Mac Installer Distribution identities are visible.
2. Set `CODEX_OFFICE_TEAM_ID` and, if needed, `CODEX_OFFICE_MAS_PROVISIONING_PROFILE=/path/to/profile.provisionprofile`.
3. Run `npm run prepare:mas-runtime`.
4. Run `npm run build:mac-app-store`.
5. Verify the generated `.app` with `codesign --verify --deep --strict --verbose=2`.
6. Verify the generated `.pkg` with `pkgutil --check-signature`.
7. Upload the `.pkg` through Transporter or an Apple-supported upload tool while signed in with the user's own Apple account.
