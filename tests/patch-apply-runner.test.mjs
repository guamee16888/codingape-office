import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyConfirmationPhrase,
  applySandboxPatchPackage,
  patchApplyRunnerEnabled
} from "../src/patch-apply-runner.mjs";
import {
  createRollbackSnapshot,
  createSandboxPatchPackage
} from "../src/patch-runner-artifacts.mjs";

function preparePatchPackage(taskId, original = "export const value = 1;\n", proposed = "export const value = 2;\n") {
  const project = mkdtempSync(join(tmpdir(), "codex-office-project-"));
  const sandbox = mkdtempSync(join(tmpdir(), "codex-office-sandbox-"));
  const snapshots = mkdtempSync(join(tmpdir(), "codex-office-snapshots-"));
  const applies = mkdtempSync(join(tmpdir(), "codex-office-applies-"));
  writeFileSync(join(project, "app.js"), original, "utf8");

  const rollback = createRollbackSnapshot({
    taskId,
    projectPath: project,
    files: ["app.js"],
    snapshotRoot: snapshots
  });
  const sandboxPackage = createSandboxPatchPackage({
    taskId,
    projectPath: project,
    allowedFiles: ["app.js"],
    patchDrafts: [
      {
        file: "app.js",
        content: proposed
      }
    ],
    sandboxRoot: sandbox
  });

  assert.equal(rollback.ok, true);
  assert.equal(sandboxPackage.ok, true);
  return {
    applies,
    project,
    sandbox,
    snapshots
  };
}

test("patch apply runner is disabled by default and exposes exact confirmation", () => {
  assert.equal(patchApplyRunnerEnabled({}), false);
  assert.equal(applyConfirmationPhrase("task_1"), "APPLY task_1");
});

test("applySandboxPatchPackage requires env enablement and exact confirmation before writes", () => {
  const taskId = "task_apply_gate";
  const prepared = preparePatchPackage(taskId);

  const result = applySandboxPatchPackage({
    taskId,
    projectPath: prepared.project,
    sandboxRoot: prepared.sandbox,
    snapshotRoot: prepared.snapshots,
    applyRoot: prepared.applies,
    env: {}
  });

  assert.equal(result.status, "requires_confirmation");
  assert.ok(result.summary.blockers.some((blocker) => blocker.id === "apply_runner_disabled"));
  assert.ok(result.summary.blockers.some((blocker) => blocker.id === "apply_confirmation_required"));
  assert.equal(readFileSync(join(prepared.project, "app.js"), "utf8"), "export const value = 1;\n");
  assert.equal(existsSync(join(prepared.applies, taskId, "manifest.json")), true);
});

test("applySandboxPatchPackage applies sandbox files after rollback hash and confirmation checks", () => {
  const taskId = "task_apply_ok";
  const prepared = preparePatchPackage(taskId);

  const result = applySandboxPatchPackage({
    taskId,
    projectPath: prepared.project,
    sandboxRoot: prepared.sandbox,
    snapshotRoot: prepared.snapshots,
    applyRoot: prepared.applies,
    confirmation: applyConfirmationPhrase(taskId),
    env: {
      CODEX_OFFICE_ENABLE_APPLY_RUNNER: "true"
    }
  });

  assert.equal(result.status, "applied");
  assert.equal(result.summary.appliedFiles.length, 1);
  assert.equal(readFileSync(join(prepared.project, "app.js"), "utf8"), "export const value = 2;\n");
});

test("applySandboxPatchPackage blocks when project file drifted after rollback snapshot", () => {
  const taskId = "task_apply_drift";
  const prepared = preparePatchPackage(taskId);
  writeFileSync(join(prepared.project, "app.js"), "export const value = 3;\n", "utf8");

  const result = applySandboxPatchPackage({
    taskId,
    projectPath: prepared.project,
    sandboxRoot: prepared.sandbox,
    snapshotRoot: prepared.snapshots,
    applyRoot: prepared.applies,
    confirmation: applyConfirmationPhrase(taskId),
    env: {
      CODEX_OFFICE_ENABLE_APPLY_RUNNER: "true"
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.summary.blockers.some((blocker) => blocker.id === "project_hash_drift"));
  assert.equal(readFileSync(join(prepared.project, "app.js"), "utf8"), "export const value = 3;\n");
});
