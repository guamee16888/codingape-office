#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${CODEX_OFFICE_DATA_DIR:-$ROOT_DIR/data}"
BETA_OPS_DIR="$DATA_DIR/beta-ops"
RUNS_FILE="$BETA_OPS_DIR/tester-runs.jsonl"
SUPPORT_DIR="$BETA_OPS_DIR/support-bundles"
SUPPORT_BUNDLE_PATH="${SUPPORT_BUNDLE_PATH:-}"

mkdir -p "$BETA_OPS_DIR" "$SUPPORT_DIR"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --support-bundle)
      SUPPORT_BUNDLE_PATH="${2:-}"
      shift 2
      ;;
    --tester-id)
      TESTER_ID="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

COPIED_SUPPORT_BUNDLE=""
if [[ -n "$SUPPORT_BUNDLE_PATH" && -f "$SUPPORT_BUNDLE_PATH" ]]; then
  COPIED_SUPPORT_BUNDLE="$SUPPORT_DIR/$(date -u +"%Y%m%dT%H%M%SZ")-$(basename "$SUPPORT_BUNDLE_PATH")"
  cp "$SUPPORT_BUNDLE_PATH" "$COPIED_SUPPORT_BUNDLE"
fi

RUNS_FILE="$RUNS_FILE" \
TESTER_ID="${TESTER_ID:-tester-$(date -u +"%Y%m%dT%H%M%SZ")}" \
TESTER_NAME="${TESTER_NAME:-}" \
CHANNEL="${CHANNEL:-external_beta}" \
RUNBOOK_STATUS="${RUNBOOK_STATUS:-completed}" \
INSTALL_STATUS="${INSTALL_STATUS:-installed}" \
NODE_STATUS="${NODE_STATUS:-available}" \
PORT_STATUS="${PORT_STATUS:-clear}" \
FIRST_ORDER_STATUS="${FIRST_ORDER_STATUS:-not_run}" \
FIRST_APPLY_STATUS="${FIRST_APPLY_STATUS:-not_attempted}" \
SUPPORT_BUNDLE_PATH="${COPIED_SUPPORT_BUNDLE:-$SUPPORT_BUNDLE_PATH}" \
FAILURE_TAGS="${FAILURE_TAGS:-}" \
NOTES="${NOTES:-}" \
node --input-type=module <<'NODE'
import { appendFileSync } from "node:fs";

const record = {
  id: `${process.env.TESTER_ID}-${Date.now().toString(36)}`,
  testerId: process.env.TESTER_ID,
  testerName: process.env.TESTER_NAME,
  channel: process.env.CHANNEL,
  recordedAt: new Date().toISOString(),
  runbookStatus: process.env.RUNBOOK_STATUS,
  installStatus: process.env.INSTALL_STATUS,
  nodeStatus: process.env.NODE_STATUS,
  portStatus: process.env.PORT_STATUS,
  firstOrderStatus: process.env.FIRST_ORDER_STATUS,
  firstApplyStatus: process.env.FIRST_APPLY_STATUS,
  supportBundlePath: process.env.SUPPORT_BUNDLE_PATH,
  failureTags: (process.env.FAILURE_TAGS || "").split(",").map((tag) => tag.trim()).filter(Boolean),
  notes: process.env.NOTES
};

appendFileSync(process.env.RUNS_FILE, `${JSON.stringify(record)}\n`, "utf8");
console.log(JSON.stringify(record, null, 2));
NODE
