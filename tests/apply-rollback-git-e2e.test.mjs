import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyConfirmationPhrase, applySandboxPatchPackage } from "../src/patch-apply-runner.mjs";
import { createRollbackSnapshot, createSandboxPatchPackage } from "../src/patch-runner-artifacts.mjs";
import { restoreRollbackSnapshot } from "../src/rollback-manager.mjs";

function git(projectPath, ...args) {
  return execFileSync("git", args, { cwd: projectPath, encoding: "utf8" }).trim();
}

test("a real temporary Git project can apply and fully roll back a patch", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codingape-apply-rollback-e2e-"));
  const project = join(root, "project");
  const taskId = "task_git_apply_rollback_e2e";
  const sandboxRoot = join(root, "sandbox");
  const snapshotRoot = join(root, "snapshots");
  const applyRoot = join(root, "applies");
  const rollbackRoot = join(root, "rollbacks");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  execFileSync("mkdir", ["-p", project]);
  git(project, "init", "--quiet");
  git(project, "config", "user.name", "Codingape E2E");
  git(project, "config", "user.email", "codingape-e2e@example.invalid");
  writeFileSync(join(project, "README.md"), "# Temporary project\n\nBefore apply.\n", "utf8");
  git(project, "add", "README.md");
  git(project, "commit", "--quiet", "-m", "baseline");

  const snapshot = createRollbackSnapshot({
    taskId,
    projectPath: project,
    files: ["README.md"],
    snapshotRoot
  });
  const sandbox = createSandboxPatchPackage({
    taskId,
    projectPath: project,
    allowedFiles: ["README.md"],
    patchDrafts: [{ file: "README.md", content: "# Temporary project\n\nApplied by Codingape.\n" }],
    sandboxRoot
  });
  assert.equal(snapshot.ok, true);
  assert.equal(sandbox.ok, true);

  const apply = applySandboxPatchPackage({
    taskId,
    projectPath: project,
    sandboxRoot,
    snapshotRoot,
    applyRoot,
    confirmation: applyConfirmationPhrase(taskId),
    env: { CODEX_OFFICE_ENABLE_APPLY_RUNNER: "true" }
  });
  assert.equal(apply.status, "applied");
  assert.match(readFileSync(join(project, "README.md"), "utf8"), /Applied by Codingape/);
  assert.match(git(project, "diff", "--", "README.md"), /^diff --git/m);
  assert.equal(existsSync(join(applyRoot, taskId, "manifest.json")), true);

  const rollback = restoreRollbackSnapshot({
    taskId,
    projectPath: project,
    snapshotRoot,
    rollbackRoot
  });
  assert.equal(rollback.status, "rolled_back");
  assert.equal(readFileSync(join(project, "README.md"), "utf8"), "# Temporary project\n\nBefore apply.\n");
  assert.equal(git(project, "status", "--porcelain"), "");
  assert.equal(existsSync(join(rollbackRoot, taskId, "manifest.json")), true);
});
