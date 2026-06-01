import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  extractPatchSynthesisFileRefs,
  synthesizePatchDraftsV1
} from "../src/patch-synthesis-v1.mjs";

test("patch synthesis appends a reviewable README draft", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-synthesis-"));
  writeFileSync(join(project, "README.md"), "# Existing App\n", "utf8");

  const result = synthesizePatchDraftsV1({
    task: {
      id: "task_readme",
      title: "更新 README 增加 Mac Beta 说明",
      projectName: "Existing App"
    },
    projectPath: project,
    now: "2026-05-28T00:00:00.000Z"
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.targetFile, "README.md");
  assert.match(result.drafts[0].content, /# Existing App/);
  assert.match(result.drafts[0].content, /Coding猿 Patch Draft/);
  assert.match(result.drafts[0].content, /Human Gate and Apply Gate/);
  assert.equal(readFileSync(join(project, "README.md"), "utf8"), "# Existing App\n");
});

test("patch synthesis creates a docs task note when no target is explicit", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-synthesis-"));
  mkdirSync(join(project, "src"));

  const result = synthesizePatchDraftsV1({
    task: {
      id: "task_note",
      title: "让任务输入能生成更实质的 patch draft",
      projectName: "Patch App"
    },
    projectPath: project,
    now: "2026-05-28T00:00:00.000Z"
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.targetFile, "docs/coding-yuan-task-notes.md");
  assert.match(result.drafts[0].content, /让任务输入能生成更实质的 patch draft/);
});

test("patch synthesis blocks unsafe explicit target paths", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-synthesis-"));
  const result = synthesizePatchDraftsV1({
    task: {
      id: "task_bad",
      title: "把内容写入 `../secret.md`"
    },
    projectPath: project
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.drafts, []);
  assert.ok(result.blockers.some((blocker) => blocker.id === "patch_synthesis_target_unsafe"));
});

test("patch synthesis file reference extraction avoids ordinary Node.js text", () => {
  assert.deepEqual(extractPatchSynthesisFileRefs("Node.js 项目里更新 README.md 和 `src/app.ts`"), [
    "src/app.ts",
    "README.md"
  ]);
});
