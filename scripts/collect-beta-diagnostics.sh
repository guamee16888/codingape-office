#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
OUT_DIR="${1:-$ROOT_DIR/dist/beta-diagnostics/$STAMP}"
ZIP_PATH="$OUT_DIR.zip"
SERVICE_URL="${CODEX_OFFICE_SERVICE_URL:-http://127.0.0.1:4142}"

mkdir -p "$OUT_DIR"

run_capture() {
  local name="$1"
  shift
  {
    echo "$ $*"
    "$@"
  } >"$OUT_DIR/$name.txt" 2>&1 || true
}

run_capture sw_vers /usr/bin/sw_vers
run_capture uname /usr/bin/uname -a
run_capture git_version /usr/bin/env git --version
run_capture node_version /usr/bin/env node --version
run_capture npm_version /usr/bin/env npm --version
run_capture port_4142 /usr/sbin/lsof -nP -iTCP:4142 -sTCP:LISTEN

curl -sS "$SERVICE_URL/api/status" >"$OUT_DIR/api-status.json" 2>"$OUT_DIR/api-status.err" || true
curl -sS -X POST "$SERVICE_URL/api/support-bundle" \
  -H "content-type: application/json" \
  -H "x-codex-office-local: support-bundle" \
  -d '{}' >"$OUT_DIR/support-bundle-response.json" 2>"$OUT_DIR/support-bundle.err" || true

LOG_DIR="$HOME/Library/Logs/CodingYuanOffice"
LEGACY_OUT="$HOME/Library/Logs/com.geoaifactory.codex-office.out.log"
LEGACY_ERR="$HOME/Library/Logs/com.geoaifactory.codex-office.err.log"
CRASH_DIR="$HOME/Library/Logs/DiagnosticReports"

mkdir -p "$OUT_DIR/logs" "$OUT_DIR/crash-reports"
cp "$LOG_DIR"/service.*.log "$OUT_DIR/logs/" 2>/dev/null || true
cp "$LEGACY_OUT" "$LEGACY_ERR" "$OUT_DIR/logs/" 2>/dev/null || true
find "$CRASH_DIR" -maxdepth 1 \( -name "CodingYuanOffice*.crash" -o -name "Coding猿 Office*.crash" \) -print -exec cp {} "$OUT_DIR/crash-reports/" \; 2>/dev/null || true

cat >"$OUT_DIR/README.txt" <<EOF
Coding猿 Office Beta diagnostics

Attach this zip when reporting startup, apply, rollback, or first-run failures.

Key paths:
- Service logs: ~/Library/Logs/CodingYuanOffice/service.out.log and service.err.log
- Legacy launchd logs: ~/Library/Logs/com.geoaifactory.codex-office.*.log
- Crash reports: ~/Library/Logs/DiagnosticReports/CodingYuanOffice*.crash
- Support bundles: ~/Library/Application Support/CodingYuan Office/data/support-bundles
EOF

rm -f "$ZIP_PATH"
/usr/bin/ditto -c -k --sequesterRsrc "$OUT_DIR" "$ZIP_PATH"
echo "$ZIP_PATH"
