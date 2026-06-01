#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Coding猿 Office"
APP_DIR="$ROOT_DIR/dist/mac/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
APP_PAYLOAD_DIR="$RESOURCES_DIR/app"
EXECUTABLE_NAME="CodingYuanOffice"
APP_VERSION="${CODEX_OFFICE_APP_VERSION:-0.5.0-beta}"
BUNDLE_VERSION="${CODEX_OFFICE_BUNDLE_VERSION:-0.5.0}"
BUNDLE_ID="${CODEX_OFFICE_BUNDLE_ID:-com.geoaifactory.codingyuan-office.beta}"
NODE_BIN="${CODEX_OFFICE_NODE:-node}"
NODE_PATH_IN_APP="${CODEX_OFFICE_NODE_PATH_IN_APP:-}"
SWIFTC_BIN="${SWIFTC:-/usr/bin/swiftc}"
RSYNC_BIN="${RSYNC:-/usr/bin/rsync}"

if [[ "$NODE_BIN" == */* ]]; then
  NODE_CHECK="$NODE_BIN"
else
  NODE_CHECK="$(command -v "$NODE_BIN" || true)"
fi

if [[ -z "$NODE_CHECK" ]]; then
  echo "Node.js was not found. Install Node or set CODEX_OFFICE_NODE=/path/to/node." >&2
  exit 1
fi

if [[ -z "$NODE_PATH_IN_APP" ]]; then
  NODE_PATH_IN_APP="$NODE_CHECK"
fi

if [[ ! -x "$SWIFTC_BIN" ]]; then
  echo "swiftc was not found at $SWIFTC_BIN. Install Xcode Command Line Tools or set SWIFTC=/path/to/swiftc." >&2
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

"$SWIFTC_BIN" \
  -parse-as-library \
  "$ROOT_DIR/mac-app/CodingYuanOffice.swift" \
  -framework Cocoa \
  -framework WebKit \
  -o "$MACOS_DIR/$EXECUTABLE_NAME"

"$RSYNC_BIN" -a --delete \
  --exclude ".git" \
  --exclude ".DS_Store" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "dist" \
  --exclude "data" \
  --exclude "tests" \
  --exclude "node_modules" \
  --exclude "**/node_modules" \
  --exclude ".next" \
  --exclude "**/.next" \
  --exclude "**/.data" \
  --exclude "**/local-output" \
  --exclude "**/demo-output" \
  --exclude "codex-session-import" \
  --exclude "*.sqlite" \
  --exclude "*.sqlite3" \
  --exclude "*.db" \
  --exclude "*.pem" \
  --exclude "*.key" \
  --exclude "*.p12" \
  --exclude "credentials" \
  --exclude "secrets" \
  --exclude "private" \
  "$ROOT_DIR/" "$APP_PAYLOAD_DIR/"

printf '%s\n' "$APP_PAYLOAD_DIR" > "$RESOURCES_DIR/repo-root.txt"
printf '%s\n' "$NODE_PATH_IN_APP" > "$RESOURCES_DIR/node-path.txt"

cat > "$CONTENTS_DIR/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleExecutable</key>
  <string>$EXECUTABLE_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$APP_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$BUNDLE_VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

echo "$APP_DIR"
