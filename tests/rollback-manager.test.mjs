import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRollbackSnapshot } from "../src/patch-runner-artifacts.mjs";
import { restoreRollbackSnapshot } from "../src/rollback-manager.mjs";

test("restoreRollbackSnapshot restores existing files and removes new files", () => {
  const taskId = "task_rollback_ok";
  const project = mkdtempSync(join(tmpdir(), "codex-office-project-"));
  const snapshots = mkdtempSync(join(tmpdir(), "codex-office-snapshots-"));
  const rollbacks = mkdtempSync(join(tmpdir(), "codex-office-rollbacks-"));
  writeFileSync(join(project, "app.js"), "before\n", "utf8");

  const snapshot = createRollbackSnapshot({
    taskId,
    projectPath: project,
    files: ["app.js", "new.js"],
    snapshotRoot: snapshots
  });
  assert.equal(snapshot.ok, true);
  writeFileSync(join(project, "app.js"), "after\n", "utf8");
  writeFileSync(join(project, "new.js"), "created\n", "utf8");

  const result = restoreRollbackSnapshot({
    taskId,
    projectPath: project,
    snapshotRoot: snapshots,
    rollbackRoot: rollbacks
  });

  assert.equal(result.status, "rolled_back");
  assert.equal(readFileSync(join(project, "app.js"), "utf8"), "before\n");
  assert.equal(existsSync(join(project, "new.js")), false);
  assert.equal(result.summary.restoredFiles.length, 1);
  assert.equal(result.summary.removedFiles.length, 1);
  assert.equal(existsSync(join(rollbacks, taskId, "manifest.json")), true);
});

test("restoreRollbackSnapshot blocks project root mismatch", () => {
  const taskId = "task_rollback_mismatch";
  const project = mkdtempSync(join(tmpdir(), "codex-office-project-"));
  const otherProject = mkdtempSync(join(tmpdir(), "codex-office-other-"));
  const snapshots = mkdtempSync(join(tmpdir(), "codex-office-snapshots-"));
  const rollbacks = mkdtempSync(join(tmpdir(), "codex-office-rollbacks-"));
  writeFileSync(join(project, "app.js"), "before\n", "utf8");
  createRollbackSnapshot({
    taskId,
    projectPath: project,
    files: ["app.js"],
    snapshotRoot: snapshots
  });

  const result = restoreRollbackSnapshot({
    taskId,
    projectPath: otherProject,
    snapshotRoot: snapshots,
    rollbackRoot: rollbacks
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.summary.blockers.some((blocker) => blocker.id === "rollback_project_mismatch"));
});
