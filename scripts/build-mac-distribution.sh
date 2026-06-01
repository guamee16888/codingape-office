#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Coding猿 Office"
VERSION="${CODEX_OFFICE_APP_VERSION:-0.5.0-beta}"
BUNDLE_VERSION="${CODEX_OFFICE_BUNDLE_VERSION:-0.5.0}"
DIST_ROOT="$ROOT_DIR/dist/mac-distribution"
APP_PATH="$ROOT_DIR/dist/mac/$APP_NAME.app"
ZIP_PATH="$DIST_ROOT/CodingYuanOffice-$VERSION-mac.zip"
DMG_PATH="$DIST_ROOT/CodingYuanOffice-$VERSION-mac.dmg"
DMG_STAGE="$DIST_ROOT/dmg-staging"
REPORT_PATH="$DIST_ROOT/distribution-report.json"
NOTARY_LOG_PATH="$DIST_ROOT/notarytool.log"
SIGN_IDENTITY="${CODEX_OFFICE_DEVELOPER_ID_APPLICATION:-${DEVELOPER_ID_APPLICATION:-}}"
NOTARY_PROFILE="${CODEX_OFFICE_NOTARY_PROFILE:-}"
APPLE_ID="${CODEX_OFFICE_APPLE_ID:-${APPLE_ID:-}}"
APPLE_TEAM_ID="${CODEX_OFFICE_TEAM_ID:-${APPLE_TEAM_ID:-}}"
APPLE_PASSWORD="${CODEX_OFFICE_APP_PASSWORD:-${APPLE_APP_SPECIFIC_PASSWORD:-}}"
SIGNING_STATUS="skipped"
NOTARIZATION_STATUS="skipped"
SPCTL_STATUS="not_run"

mkdir -p "$DIST_ROOT"

CODEX_OFFICE_APP_VERSION="$VERSION" \
CODEX_OFFICE_BUNDLE_VERSION="$BUNDLE_VERSION" \
CODEX_OFFICE_NODE_PATH_IN_APP="${CODEX_OFFICE_NODE_PATH_IN_APP:-node}" \
bash "$ROOT_DIR/scripts/build-mac-app.sh" >/dev/null

if [[ -n "$SIGN_IDENTITY" ]]; then
  /usr/bin/codesign --force --deep --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP_PATH"
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_PATH"
  SIGNING_STATUS="signed"
elif [[ "${CODEX_OFFICE_REQUIRE_SIGNING:-false}" == "true" ]]; then
  echo "CODEX_OFFICE_REQUIRE_SIGNING=true but CODEX_OFFICE_DEVELOPER_ID_APPLICATION is not set." >&2
  exit 1
fi

rm -f "$ZIP_PATH" "$DMG_PATH"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

rm -rf "$DMG_STAGE"
mkdir -p "$DMG_STAGE"
/bin/cp -R "$APP_PATH" "$DMG_STAGE/"
/bin/ln -s /Applications "$DMG_STAGE/Applications"
/bin/cp "$ROOT_DIR/docs/BETA_EXTERNAL_TESTER_RUNBOOK.md" "$DMG_STAGE/README-BETA.md" 2>/dev/null || true
/usr/bin/hdiutil create -volname "$APP_NAME Beta" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG_PATH" >/dev/null

NOTARY_ARGS=()
if [[ -n "$NOTARY_PROFILE" ]]; then
  NOTARY_ARGS=(--keychain-profile "$NOTARY_PROFILE")
elif [[ -n "$APPLE_ID" && -n "$APPLE_TEAM_ID" && -n "$APPLE_PASSWORD" ]]; then
  NOTARY_ARGS=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD")
fi

if [[ "$SIGNING_STATUS" == "signed" && ${#NOTARY_ARGS[@]} -gt 0 ]]; then
  /usr/bin/xcrun notarytool submit "$DMG_PATH" --wait "${NOTARY_ARGS[@]}" | tee "$NOTARY_LOG_PATH"
  /usr/bin/xcrun stapler staple "$DMG_PATH"
  NOTARIZATION_STATUS="notarized"
elif [[ "${CODEX_OFFICE_REQUIRE_NOTARIZATION:-false}" == "true" ]]; then
  echo "CODEX_OFFICE_REQUIRE_NOTARIZATION=true but signing/notary credentials are incomplete." >&2
  exit 1
fi

if /usr/sbin/spctl --assess --type execute --verbose "$APP_PATH" >/tmp/coding-yuan-spctl.log 2>&1; then
  SPCTL_STATUS="accepted"
else
  SPCTL_STATUS="$(tr '\n' ' ' </tmp/coding-yuan-spctl.log | sed 's/[[:space:]]\+/ /g')"
fi

REPORT_PATH="$REPORT_PATH" \
VERSION="$VERSION" \
BUNDLE_VERSION="$BUNDLE_VERSION" \
APP_PATH="$APP_PATH" \
ZIP_PATH="$ZIP_PATH" \
DMG_PATH="$DMG_PATH" \
SIGNING_STATUS="$SIGNING_STATUS" \
SIGN_IDENTITY="$SIGN_IDENTITY" \
NOTARIZATION_STATUS="$NOTARIZATION_STATUS" \
NOTARY_LOG_PATH="$NOTARY_LOG_PATH" \
SPCTL_STATUS="$SPCTL_STATUS" \
node --input-type=module <<'NODE'
import { writeFileSync } from "node:fs";

const report = {
  product: "Coding猿 Office",
  channel: "Mac Beta",
  version: process.env.VERSION,
  bundleVersion: process.env.BUNDLE_VERSION,
  generatedAt: new Date().toISOString(),
  artifacts: {
    app: process.env.APP_PATH,
    zip: process.env.ZIP_PATH,
    dmg: process.env.DMG_PATH
  },
  signing: {
    status: process.env.SIGNING_STATUS,
    identityConfigured: Boolean(process.env.SIGN_IDENTITY)
  },
  notarization: {
    status: process.env.NOTARIZATION_STATUS,
    logPath: process.env.NOTARY_LOG_PATH
  },
  gatekeeper: {
    spctl: process.env.SPCTL_STATUS
  },
  requiredEnvironment: [
    "CODEX_OFFICE_DEVELOPER_ID_APPLICATION",
    "CODEX_OFFICE_NOTARY_PROFILE or CODEX_OFFICE_APPLE_ID + CODEX_OFFICE_TEAM_ID + CODEX_OFFICE_APP_PASSWORD"
  ],
  testerSupport: {
    runbook: "docs/BETA_EXTERNAL_TESTER_RUNBOOK.md",
    tenMinuteScript: "scripts/ten-minute-first-order-trial.sh",
    diagnosticsScript: "scripts/collect-beta-diagnostics.sh",
    serviceLogs: "~/Library/Logs/CodingYuanOffice/service.out.log and service.err.log",
    crashReports: "~/Library/Logs/DiagnosticReports/CodingYuanOffice_*.crash",
    supportBundles: "~/Library/Application Support/CodingYuan Office/data/support-bundles"
  }
};

writeFileSync(process.env.REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
NODE

cat <<EOF
$APP_PATH
$ZIP_PATH
$DMG_PATH
$REPORT_PATH
signing=$SIGNING_STATUS notarization=$NOTARIZATION_STATUS spctl=$SPCTL_STATUS
EOF
