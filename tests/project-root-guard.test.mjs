import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertPathInsideProjectRoot,
  guardProjectWriteTargets,
  normalizeProjectRelativePath,
  summarizeProjectRootGuard
} from "../src/project-root-guard.mjs";

test("Project Root Guard normalizes safe relative paths", () => {
  const normalized = normalizeProjectRelativePath("./src//app.js");

  assert.equal(normalized.ok, true);
  assert.equal(normalized.path, "src/app.js");
});

test("Project Root Guard blocks traversal, absolute paths, and null bytes", () => {
  assert.equal(normalizeProjectRelativePath("../secret.js").blocker.id, "project_path_traversal");
  assert.equal(normalizeProjectRelativePath("/tmp/secret.js").blocker.id, "project_path_absolute");
  assert.equal(normalizeProjectRelativePath("src/app.js\0").blocker.id, "project_path_null_byte");
});

test("Project Root Guard asserts write targets stay inside selected root", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-office-root-"));
  const safe = assertPathInsideProjectRoot(root, "src/app.js");
  const blocked = assertPathInsideProjectRoot(root, "../outside.js");

  assert.equal(safe.ok, true);
  assert.equal(safe.relativePath, "src/app.js");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockers[0].source, "project_root_guard");
});

test("Project Root Guard summarizes blocked write targets for timeline evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-office-root-"));
  const guarded = guardProjectWriteTargets(root, ["src/app.js", "../outside.js"]);
  const summary = summarizeProjectRootGuard(guarded.blockers);

  assert.equal(guarded.ok, false);
  assert.deepEqual(guarded.files.map((file) => file.file), ["src/app.js"]);
  assert.deepEqual(guarded.blockedFiles, ["../outside.js"]);
  assert.equal(summary.blocked, true);
  assert.equal(summary.blockers.length, 1);
});
