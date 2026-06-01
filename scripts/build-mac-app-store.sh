#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Codingape Office"
VERSION="${CODEX_OFFICE_MAS_VERSION:-1.0.0}"
BUILD_NUMBER="${CODEX_OFFICE_MAS_BUILD:-1}"
BUNDLE_ID="${CODEX_OFFICE_MAS_BUNDLE_ID:-com.geoaifactory.codingyuan-office}"
TEAM_ID="${CODEX_OFFICE_TEAM_ID:-${APPLE_TEAM_ID:-}}"
DIST_ROOT="$ROOT_DIR/dist/mac-app-store"
APP_PATH="$ROOT_DIR/dist/mac/$APP_NAME.app"
PKG_PATH="$DIST_ROOT/CodingYuanOffice-$VERSION-$BUILD_NUMBER-mas.pkg"
REPORT_PATH="$DIST_ROOT/mac-app-store-report.json"
ENTITLEMENTS="$ROOT_DIR/entitlements/CodingYuanOffice.mas.entitlements"
INHERIT_ENTITLEMENTS="$ROOT_DIR/entitlements/CodingYuanOffice.mas.inherit.entitlements"
RUNTIME_DIR="${CODEX_OFFICE_MAS_RUNTIME_DIR:-$ROOT_DIR/dist/mas-runtime/node-runtime}"
RUNTIME_MANIFEST="$RUNTIME_DIR/mas-runtime-manifest.json"
PROVISIONING_PROFILE="${CODEX_OFFICE_MAS_PROVISIONING_PROFILE:-}"
APP_SIGN_IDENTITY="${CODEX_OFFICE_APPLE_DISTRIBUTION:-${APPLE_DISTRIBUTION_IDENTITY:-}}"
INSTALLER_SIGN_IDENTITY="${CODEX_OFFICE_MAC_INSTALLER_DISTRIBUTION:-${MAC_INSTALLER_DISTRIBUTION_IDENTITY:-}}"
SIGNING_IDENTITIES=""
DETECTED_PROFILE=""
PROFILE_BUNDLE_ID=""
PROFILE_TEAM_ID=""
PROFILE_CERT_HASHES=""
APP_SIGN_HASH=""
INSTALLER_SIGN_HASH=""
STATUS="blocked"
FAILURES=()

mkdir -p "$DIST_ROOT"

detect_identities() {
  SIGNING_IDENTITIES="$(/usr/bin/security find-identity -p codesigning -v 2>&1 || true)"
  if [[ -z "$APP_SIGN_IDENTITY" ]]; then
    APP_SIGN_IDENTITY="$(printf '%s\n' "$SIGNING_IDENTITIES" | sed -nE 's/.*"(Apple Distribution:[^"]+)".*/\1/p; s/.*"(Mac App Distribution:[^"]+)".*/\1/p; s/.*"(3rd Party Mac Developer Application:[^"]+)".*/\1/p' | head -1)"
  fi
  if [[ -z "$INSTALLER_SIGN_IDENTITY" ]]; then
    INSTALLER_SIGN_IDENTITY="$(printf '%s\n' "$SIGNING_IDENTITIES" | sed -nE 's/.*"(Mac Installer Distribution:[^"]+)".*/\1/p; s/.*"(3rd Party Mac Developer Installer:[^"]+)".*/\1/p' | head -1)"
  fi
}

profile_bundle_id() {
  local profile_path="$1"
  /usr/bin/security cms -D -i "$profile_path" 2>/dev/null \
    | /usr/bin/plutil -extract Entitlements.application-identifier raw -o - - 2>/dev/null \
    | sed -E 's/^[A-Z0-9]+\.(.*)$/\1/'
}

profile_team_id() {
  local profile_path="$1"
  /usr/bin/security cms -D -i "$profile_path" 2>/dev/null \
    | /usr/bin/plutil -extract TeamIdentifier.0 raw -o - - 2>/dev/null
}

profile_certificate_hashes() {
  local profile_path="$1"
  local profile_xml
  profile_xml="$(/usr/bin/security cms -D -i "$profile_path" 2>/dev/null || true)"
  PROFILE_XML="$profile_xml" node --input-type=module <<'NODE'
import { createHash } from "node:crypto";

const xml = process.env.PROFILE_XML || "";
const certs = xml.match(/<key>DeveloperCertificates<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] || "";
for (const match of certs.matchAll(/<data>\s*([\s\S]*?)\s*<\/data>/g)) {
  const b64 = match[1].replace(/\s+/g, "");
  const der = Buffer.from(b64, "base64");
  if (der.length > 0) {
    process.stdout.write(`${createHash("sha1").update(der).digest("hex").toUpperCase()}\n`);
  }
}
NODE
}

identity_hash_for_name() {
  local identity_name="$1"
  local line
  [[ -n "$identity_name" ]] || return 0
  while IFS= read -r line; do
    if [[ "$line" == *"\"$identity_name\""* ]]; then
      printf '%s\n' "$line" | sed -nE 's/^[[:space:]]*[0-9]+\) ([A-F0-9]{40}) ".*"$/\1/p'
      return
    fi
  done <<<"$SIGNING_IDENTITIES"
}

identity_team_id() {
  local identity_name="$1"
  printf '%s\n' "$identity_name" | sed -nE 's/.*\(([A-Z0-9]{10})\).*/\1/p'
}

detect_profile() {
  if [[ -n "$PROVISIONING_PROFILE" && -f "$PROVISIONING_PROFILE" ]]; then
    DETECTED_PROFILE="$PROVISIONING_PROFILE"
    return
  fi

  local search_dirs=(
    "$HOME/Library/MobileDevice/Provisioning Profiles"
    "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
  )
  local profile
  for dir in "${search_dirs[@]}"; do
    [[ -d "$dir" ]] || continue
    while IFS= read -r profile; do
      if [[ "$(profile_bundle_id "$profile")" == "$BUNDLE_ID" ]]; then
        DETECTED_PROFILE="$profile"
        return
      fi
    done < <(/usr/bin/find "$dir" -type f \( -iname "*.provisionprofile" -o -iname "*.mobileprovision" \) 2>/dev/null)
  done
}

collect_profile_metadata() {
  [[ -n "$DETECTED_PROFILE" ]] || return 0
  PROFILE_BUNDLE_ID="$(profile_bundle_id "$DETECTED_PROFILE" || true)"
  PROFILE_TEAM_ID="$(profile_team_id "$DETECTED_PROFILE" || true)"
  PROFILE_CERT_HASHES="$(profile_certificate_hashes "$DETECTED_PROFILE" || true)"
}

add_failure() {
  FAILURES+=("$1")
}

json_array() {
  local first=1
  printf '['
  for item in "$@"; do
    if [[ "$first" -eq 0 ]]; then printf ','; fi
    first=0
    ITEM="$item" node --input-type=module -e 'process.stdout.write(JSON.stringify(process.env.ITEM))'
  done
  printf ']'
}

write_report() {
  local app_identity_configured="false"
  local installer_identity_configured="false"
  local profile_configured="false"
  local runtime_configured="false"
  [[ -n "$APP_SIGN_HASH" ]] && app_identity_configured="true"
  [[ -n "$INSTALLER_SIGN_HASH" ]] && installer_identity_configured="true"
  [[ -n "$DETECTED_PROFILE" ]] && profile_configured="true"
  [[ -f "$RUNTIME_MANIFEST" && -x "$RUNTIME_DIR/bin/node" ]] && runtime_configured="true"

  local failures_json
  failures_json="$(json_array "${FAILURES[@]}")"

  REPORT_PATH="$REPORT_PATH" \
  PRODUCT="$APP_NAME" \
  VERSION="$VERSION" \
  BUILD_NUMBER="$BUILD_NUMBER" \
  BUNDLE_ID="$BUNDLE_ID" \
  TEAM_ID="$TEAM_ID" \
  APP_PATH="$APP_PATH" \
  PKG_PATH="$PKG_PATH" \
  STATUS="$STATUS" \
  APP_IDENTITY_CONFIGURED="$app_identity_configured" \
  INSTALLER_IDENTITY_CONFIGURED="$installer_identity_configured" \
  PROFILE_CONFIGURED="$profile_configured" \
  RUNTIME_CONFIGURED="$runtime_configured" \
  ENTITLEMENTS="$ENTITLEMENTS" \
  INHERIT_ENTITLEMENTS="$INHERIT_ENTITLEMENTS" \
  RUNTIME_DIR="$RUNTIME_DIR" \
  RUNTIME_MANIFEST="$RUNTIME_MANIFEST" \
  APP_SIGN_IDENTITY="$APP_SIGN_IDENTITY" \
  INSTALLER_SIGN_IDENTITY="$INSTALLER_SIGN_IDENTITY" \
  PROFILE_PATH="$DETECTED_PROFILE" \
  PROFILE_BUNDLE_ID="$PROFILE_BUNDLE_ID" \
  PROFILE_TEAM_ID="$PROFILE_TEAM_ID" \
  PROFILE_CERT_MATCH="$([[ -n "$APP_SIGN_HASH" && "$PROFILE_CERT_HASHES" == *"$APP_SIGN_HASH"* ]] && printf true || printf false)" \
  FAILURES_JSON="$failures_json" \
  node --input-type=module <<'NODE'
import { writeFileSync } from "node:fs";

const report = {
  product: process.env.PRODUCT,
  channel: "Mac App Store",
  status: process.env.STATUS,
  version: process.env.VERSION,
  buildNumber: process.env.BUILD_NUMBER,
  bundleId: process.env.BUNDLE_ID,
  teamIdConfigured: Boolean(process.env.TEAM_ID),
  generatedAt: new Date().toISOString(),
  artifacts: {
    app: process.env.APP_PATH,
    pkg: process.env.PKG_PATH
  },
  signing: {
    appleDistributionConfigured: process.env.APP_IDENTITY_CONFIGURED === "true",
    macInstallerDistributionConfigured: process.env.INSTALLER_IDENTITY_CONFIGURED === "true",
    provisioningProfileConfigured: process.env.PROFILE_CONFIGURED === "true",
    appSigningIdentity: process.env.APP_SIGN_IDENTITY || null,
    installerSigningIdentity: process.env.INSTALLER_SIGN_IDENTITY || null
  },
  provisioningProfile: {
    path: process.env.PROFILE_PATH || null,
    bundleId: process.env.PROFILE_BUNDLE_ID || null,
    teamId: process.env.PROFILE_TEAM_ID || null,
    includesAppSigningIdentity: process.env.PROFILE_CERT_MATCH === "true"
  },
  sandbox: {
    entitlements: process.env.ENTITLEMENTS,
    inheritedEntitlements: process.env.INHERIT_ENTITLEMENTS
  },
  runtime: {
    bundledNodeRuntimeConfigured: process.env.RUNTIME_CONFIGURED === "true",
    runtimeDir: process.env.RUNTIME_DIR,
    manifest: process.env.RUNTIME_MANIFEST
  },
  failures: JSON.parse(process.env.FAILURES_JSON || "[]")
};

writeFileSync(process.env.REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
NODE
}

detect_identities
detect_profile
collect_profile_metadata

APP_SIGN_HASH="$(identity_hash_for_name "$APP_SIGN_IDENTITY" || true)"
INSTALLER_SIGN_HASH="$(identity_hash_for_name "$INSTALLER_SIGN_IDENTITY" || true)"
if [[ -z "$TEAM_ID" ]]; then
  TEAM_ID="${PROFILE_TEAM_ID:-$(identity_team_id "$APP_SIGN_IDENTITY")}"
fi

printf 'Mac App Store preflight: app=%s bundle_id=%s version=%s build=%s team_id=%s\n' \
  "$APP_NAME" "$BUNDLE_ID" "$VERSION" "$BUILD_NUMBER" "${TEAM_ID:-<missing>}"

if [[ ! -f "$ENTITLEMENTS" || ! -f "$INHERIT_ENTITLEMENTS" ]]; then
  add_failure "MAS entitlements are missing. Expected entitlements/CodingYuanOffice.mas.entitlements and entitlements/CodingYuanOffice.mas.inherit.entitlements."
fi
if [[ -z "$APP_SIGN_IDENTITY" ]]; then
  add_failure "Apple Distribution / Mac App Distribution signing identity is missing. Create and install an Apple Distribution certificate for Mac App Store signing."
elif [[ -z "$APP_SIGN_HASH" ]]; then
  add_failure "Selected Apple Distribution / Mac App Distribution identity is not available in the current keychain: $APP_SIGN_IDENTITY."
fi
if [[ -z "$INSTALLER_SIGN_IDENTITY" ]]; then
  add_failure "Mac Installer Distribution signing identity is missing. Create and install a Mac Installer Distribution certificate for the App Store upload package."
elif [[ -z "$INSTALLER_SIGN_HASH" ]]; then
  add_failure "Selected Mac Installer Distribution identity is not available in the current keychain: $INSTALLER_SIGN_IDENTITY."
fi
if [[ -z "$DETECTED_PROFILE" ]]; then
  add_failure "Mac App Store provisioning profile is missing. Create a profile for $BUNDLE_ID and set CODEX_OFFICE_MAS_PROVISIONING_PROFILE=/path/to/profile.provisionprofile."
else
  if [[ "$PROFILE_BUNDLE_ID" != "$BUNDLE_ID" ]]; then
    add_failure "Mac App Store provisioning profile bundle id mismatch. Expected $BUNDLE_ID but found ${PROFILE_BUNDLE_ID:-<unreadable>}."
  fi
  if [[ -z "$PROFILE_TEAM_ID" ]]; then
    add_failure "Mac App Store provisioning profile team id is unreadable."
  elif [[ -n "$TEAM_ID" && "$PROFILE_TEAM_ID" != "$TEAM_ID" ]]; then
    add_failure "Mac App Store provisioning profile team id mismatch. Expected $TEAM_ID but found $PROFILE_TEAM_ID."
  fi
  if [[ -z "$PROFILE_CERT_HASHES" ]]; then
    add_failure "Mac App Store provisioning profile developer certificates are unreadable."
  elif [[ -n "$APP_SIGN_HASH" && "$PROFILE_CERT_HASHES" != *"$APP_SIGN_HASH"* ]]; then
    add_failure "Mac App Store provisioning profile does not include the selected app signing certificate."
  fi
fi
if [[ ! -f "$RUNTIME_MANIFEST" || ! -x "$RUNTIME_DIR/bin/node" ]]; then
  add_failure "Verified MAS runtime bundle is missing. Run npm run prepare:mas-runtime or replace the Node service with a MAS-safe embedded runner, then set CODEX_OFFICE_MAS_RUNTIME_DIR if using a custom path."
fi

if [[ "${#FAILURES[@]}" -gt 0 ]]; then
  write_report
  printf 'Mac App Store build blocked for %s (%s build %s).\n' "$BUNDLE_ID" "$VERSION" "$BUILD_NUMBER" >&2
  printf 'Preflight blockers:\n' >&2
  for failure in "${FAILURES[@]}"; do
    printf -- '- %s\n' "$failure" >&2
  done
  printf 'See MAS_BLOCKERS.md and %s.\n' "$REPORT_PATH" >&2
  exit 1
fi

CODEX_OFFICE_APP_VERSION="$VERSION" \
CODEX_OFFICE_BUNDLE_VERSION="$BUILD_NUMBER" \
CODEX_OFFICE_BUNDLE_ID="$BUNDLE_ID" \
CODEX_OFFICE_NODE_PATH_IN_APP="$APP_PATH/Contents/MacOS/node" \
bash "$ROOT_DIR/scripts/build-mac-app.sh" >/dev/null

mkdir -p "$APP_PATH/Contents/Frameworks"
/bin/cp "$RUNTIME_DIR/bin/node" "$APP_PATH/Contents/MacOS/node"
/bin/chmod 755 "$APP_PATH/Contents/MacOS/node"
/usr/bin/rsync -a "$RUNTIME_DIR/Frameworks/" "$APP_PATH/Contents/Frameworks/"
/bin/cp "$DETECTED_PROFILE" "$APP_PATH/Contents/embedded.provisionprofile"

/usr/bin/codesign --force --sign "$APP_SIGN_IDENTITY" --entitlements "$INHERIT_ENTITLEMENTS" "$APP_PATH/Contents/MacOS/node"
while IFS= read -r runtime_item; do
  /usr/bin/codesign --force --sign "$APP_SIGN_IDENTITY" --entitlements "$INHERIT_ENTITLEMENTS" "$runtime_item"
done < <(/usr/bin/find "$APP_PATH/Contents/Frameworks" -type f \( -perm -0100 -o -perm -0010 -o -perm -0001 \))
/usr/bin/codesign --force --sign "$APP_SIGN_IDENTITY" --entitlements "$ENTITLEMENTS" "$APP_PATH"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_PATH"

/usr/bin/productbuild --component "$APP_PATH" /Applications --sign "$INSTALLER_SIGN_IDENTITY" "$PKG_PATH"

STATUS="packaged"
write_report

cat <<EOF
$APP_PATH
$PKG_PATH
$REPORT_PATH
status=$STATUS bundle_id=$BUNDLE_ID version=$VERSION build=$BUILD_NUMBER
EOF
