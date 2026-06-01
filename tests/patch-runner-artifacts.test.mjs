import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createSandboxPatchPackage,
  createUnifiedDiff,
  createRollbackSnapshot,
  safeProjectFilePath
} from "../src/patch-runner-artifacts.mjs";

test("safeProjectFilePath keeps targets inside the selected project", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-office-project-"));
  assert.equal(safeProjectFilePath(root, "src/app.js").relativePath, "src/app.js");
  assert.equal(safeProjectFilePath(root, "../secret.js"), null);
  assert.equal(safeProjectFilePath(root, "/tmp/secret.js"), null);
});

test("createRollbackSnapshot copies allowlisted file contents into a manifest", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-project-"));
  const snapshots = mkdtempSync(join(tmpdir(), "codex-office-snapshots-"));
  writeFileSync(join(project, "app.js"), "console.log('ok');\n", "utf8");

  const manifest = createRollbackSnapshot({
    taskId: "task_snapshot",
    projectPath: project,
    files: ["app.js", "new-file.js"],
    snapshotRoot: snapshots,
    relativeRoot: "data/patch-snapshots"
  });

  assert.equal(manifest.ok, true);
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.files[0].existed, true);
  assert.equal(manifest.files[1].existed, false);
  assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    readFileSync(join(snapshots, "task_snapshot", "files", "app.js"), "utf8"),
    "console.log('ok');\n"
  );
  assert.equal(manifest.manifestPath, "data/patch-snapshots/task_snapshot/manifest.json");
});

test("createRollbackSnapshot blocks files above the snapshot size limit", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-project-"));
  const snapshots = mkdtempSync(join(tmpdir(), "codex-office-snapshots-"));
  writeFileSync(join(project, "big.js"), "x".repeat(8), "utf8");

  const manifest = createRollbackSnapshot({
    taskId: "task_big",
    projectPath: project,
    files: ["big.js"],
    snapshotRoot: snapshots,
    maxBytes: 4
  });

  assert.equal(manifest.ok, false);
  assert.ok(manifest.blockers.some((blocker) => blocker.id === "snapshot_file_too_large"));
});

test("createUnifiedDiff creates a reviewable line diff", () => {
  const diff = createUnifiedDiff("src/app.js", "const value = 1;\n", "const value = 2;\n");

  assert.match(diff, /--- a\/src\/app\.js/);
  assert.match(diff, /\+const value = 2;/);
  assert.match(diff, /-const value = 1;/);
});

test("createSandboxPatchPackage writes proposed files and diff without changing project files", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-project-"));
  const sandbox = mkdtempSync(join(tmpdir(), "codex-office-sandbox-"));
  writeFileSync(join(project, "app.js"), "export const value = 1;\n", "utf8");

  const manifest = createSandboxPatchPackage({
    taskId: "task_sandbox",
    projectPath: project,
    allowedFiles: ["app.js"],
    patchDrafts: [
      {
        file: "app.js",
        content: "export const value = 2;\n"
      }
    ],
    sandboxRoot: sandbox,
    relativeRoot: "data/patch-sandbox",
    summaryMarkdown: "# Summary\n"
  });

  assert.equal(manifest.ok, true);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].changed, true);
  assert.equal(manifest.manifestPath, "data/patch-sandbox/task_sandbox/manifest.json");
  assert.equal(manifest.diffPath, "data/patch-sandbox/task_sandbox/diff.patch");
  assert.equal(manifest.summaryPath, "data/patch-sandbox/task_sandbox/summary.md");
  assert.equal(
    readFileSync(join(sandbox, "task_sandbox", "files", "app.js"), "utf8"),
    "export const value = 2;\n"
  );
  assert.match(readFileSync(join(sandbox, "task_sandbox", "diff.patch"), "utf8"), /\+export const value = 2;/);
  assert.equal(readFileSync(join(project, "app.js"), "utf8"), "export const value = 1;\n");
});

test("createSandboxPatchPackage blocks drafts outside approved files", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-project-"));
  const sandbox = mkdtempSync(join(tmpdir(), "codex-office-sandbox-"));
  writeFileSync(join(project, "app.js"), "export const value = 1;\n", "utf8");

  const manifest = createSandboxPatchPackage({
    taskId: "task_blocked",
    projectPath: project,
    allowedFiles: ["app.js"],
    patchDrafts: [
      {
        file: "other.js",
        content: "export const value = 2;\n"
      }
    ],
    sandboxRoot: sandbox
  });

  assert.equal(manifest.ok, false);
  assert.ok(manifest.blockers.some((blocker) => blocker.id === "draft_outside_allowed_files"));
  assert.equal(existsSync(join(sandbox, "task_blocked", "files", "other.js")), false);
});
