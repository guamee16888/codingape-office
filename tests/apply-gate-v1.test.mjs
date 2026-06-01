import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { evaluateApplyGateV1 } from "../src/apply-gate-v1.mjs";

function readyInputs(projectPath) {
  return {
    projectPath,
    patchRun: {
      status: "sandbox_written",
      diffPath: "data/patch-sandbox/task_1/diff.patch",
      rollbackSnapshotPath: "data/patch-snapshots/task_1/manifest.json",
      sandboxFiles: [
        { file: "src/app.js", changed: true }
      ]
    },
    verification: {
      result: { ok: true, output: "ok" }
    },
    humanGate: {
      status: "approved"
    },
    rollbackManifest: {
      ok: true
    }
  };
}

test("Apply Gate v1 is blocked by default", () => {
  const result = evaluateApplyGateV1();

  assert.equal(result.status, "blocked");
  assert.equal(result.canApply, false);
  assert.equal(result.requiredFacts.diffReady, false);
  assert.equal(result.requiredFacts.verificationResultExists, false);
  assert.equal(result.requiredFacts.rollbackSnapshotReady, false);
  assert.equal(result.requiredFacts.humanApprovalGranted, false);
  assert.equal(result.requiredFacts.allTargetFilesInsideProjectRoot, false);
});

test("Apply Gate v1 becomes ready only when all required facts exist", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-office-root-"));
  const result = evaluateApplyGateV1(readyInputs(root));

  assert.equal(result.status, "ready");
  assert.equal(result.canApply, true);
  assert.deepEqual(result.targetFiles, ["src/app.js"]);
  assert.equal(result.blockers.length, 0);
});

test("Apply Gate v1 blocks target files outside the selected project root", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-office-root-"));
  const input = readyInputs(root);
  input.patchRun.sandboxFiles = [{ file: "../outside.js", changed: true }];

  const result = evaluateApplyGateV1(input);

  assert.equal(result.status, "blocked");
  assert.equal(result.canApply, false);
  assert.equal(result.requiredFacts.allTargetFilesInsideProjectRoot, false);
  assert.ok(result.blockers.some((blocker) => blocker.source === "project_root_guard"));
});

test("Apply Gate v1 blocks until human approval is granted", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-office-root-"));
  const input = readyInputs(root);
  input.humanGate = { status: "pending" };

  const result = evaluateApplyGateV1(input);

  assert.equal(result.status, "blocked");
  assert.equal(result.canApply, false);
  assert.ok(result.blockers.some((blocker) => blocker.id === "apply_gate_human_approval_missing"));
});
