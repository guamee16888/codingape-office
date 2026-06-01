#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_URL="${CODEX_OFFICE_SERVICE_URL:-http://127.0.0.1:4142}"
PROJECT_ROOT="${1:-${PROJECT_ROOT:-}}"
STARTED_SERVER_PID=""

if [[ -z "$PROJECT_ROOT" ]]; then
  PROJECT_ROOT="$HOME/CodingYuanOfficeBetaFirstOrder"
  mkdir -p "$PROJECT_ROOT"
  if [[ ! -f "$PROJECT_ROOT/README.md" ]]; then
    printf '# CodingYuan Office Beta First Order\n\nSafe beta trial project.\n' >"$PROJECT_ROOT/README.md"
  fi
  if [[ ! -d "$PROJECT_ROOT/.git" ]]; then
    git -C "$PROJECT_ROOT" init >/dev/null
    git -C "$PROJECT_ROOT" add README.md >/dev/null
    git -C "$PROJECT_ROOT" commit -m "Initial beta trial project" >/dev/null 2>&1 || true
  fi
fi

for tool in git node npm curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
done

if ! curl -fsS "$SERVICE_URL/api/status" >/dev/null 2>&1; then
  echo "Starting local Codingape Office service for the 10-minute trial..."
  mkdir -p "$ROOT_DIR/dist/external-trial"
  (cd "$ROOT_DIR" && PORT=4142 npm run dev >"$ROOT_DIR/dist/external-trial/server.out.log" 2>"$ROOT_DIR/dist/external-trial/server.err.log") &
  STARTED_SERVER_PID="$!"
  for _ in {1..40}; do
    if curl -fsS "$SERVICE_URL/api/status" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi

if ! curl -fsS "$SERVICE_URL/api/status" >/dev/null 2>&1; then
  echo "Local service did not become healthy. Run npm run beta:diagnostics and send the zip." >&2
  exit 1
fi

PROJECT_JSON="$(PROJECT_ROOT="$PROJECT_ROOT" node --input-type=module <<'NODE'
const body = {
  path: process.env.PROJECT_ROOT,
  name: "Codingape Beta First Order",
  selected: true
};
process.stdout.write(JSON.stringify(body));
NODE
)"

SAVE_RESPONSE="$(curl -sS -X POST "$SERVICE_URL/api/local-projects" -H "content-type: application/json" -d "$PROJECT_JSON")"
PROJECT_ID="$(SAVE_RESPONSE="$SAVE_RESPONSE" node --input-type=module <<'NODE'
const response = JSON.parse(process.env.SAVE_RESPONSE || "{}");
if (!response.ok || !response.project?.id) {
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
process.stdout.write(response.project.id);
NODE
)"

RUN_RESPONSE="$(curl -sS -X POST "$SERVICE_URL/api/projects/$PROJECT_ID/coding-loop" \
  -H "content-type: application/json" \
  -d '{"mode":"sandbox_patch","title":"Add a Codingape beta testing paragraph to README","safeFirstOrder":true}')"

RUN_SUMMARY="$(RUN_RESPONSE="$RUN_RESPONSE" node --input-type=module <<'NODE'
const response = JSON.parse(process.env.RUN_RESPONSE || "{}");
if (!response.ok) {
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
const summary = {
  taskId: response.task?.id,
  targetFile: response.safeFirstOrder?.targetFile,
  evidence: response.evidence?.evidencePath,
  proposal: response.proposal?.proposalPath,
  verification: response.verification?.verificationPath,
  patchRunStatus: response.patchRun?.status,
  applyGateStatus: response.applyRun?.status,
  report: response.taskReport?.reportPath
};
process.stdout.write(JSON.stringify(summary, null, 2));
NODE
)"

cat <<EOF
Codingape Office 10-minute first-order trial completed.

Project root:
$PROJECT_ROOT

Result:
$RUN_SUMMARY

Next human step:
Open $SERVICE_URL/office, review Diff Preview and Human Gate.
Project files are still protected until you explicitly confirm Apply Approved Patch.
EOF

if [[ -n "$STARTED_SERVER_PID" ]]; then
  echo "Trial service is still running as pid $STARTED_SERVER_PID. Stop it when done: kill $STARTED_SERVER_PID"
fi
