import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyUnifiedDiffLine,
  diffFileChangeKind,
  diffReviewRisk,
  summarizeUnifiedDiff,
  unifiedDiffSections,
  unifiedDiffRows
} from "../public/diff-renderer.js";

const sampleDiff = `--- a/src/worker-signal.js
+++ b/src/worker-signal.js
@@ -1,5 +1,6 @@
 export const sandboxSignal = {
   worker: "coding-yuan",
+  status: "diff-ready",
-  status: "ready",
 };
`;

test("summarizeUnifiedDiff counts files, hunks, additions, and removals", () => {
  const summary = summarizeUnifiedDiff(sampleDiff);

  assert.equal(summary.files.length, 1);
  assert.equal(summary.files[0].after, "src/worker-signal.js");
  assert.equal(summary.files[0].added, 1);
  assert.equal(summary.files[0].removed, 1);
  assert.equal(summary.hunks, 1);
  assert.equal(summary.isEmpty, false);
});

test("classifyUnifiedDiffLine separates file headers from changed lines", () => {
  assert.equal(classifyUnifiedDiffLine("+++ b/src/file.js"), "file");
  assert.equal(classifyUnifiedDiffLine("--- a/src/file.js"), "file");
  assert.equal(classifyUnifiedDiffLine("+const next = true;"), "added");
  assert.equal(classifyUnifiedDiffLine("-const next = false;"), "removed");
  assert.equal(classifyUnifiedDiffLine("@@ -1,1 +1,1 @@"), "hunk");
});

test("unifiedDiffRows returns bounded classified rows", () => {
  const rows = unifiedDiffRows(sampleDiff, 4);

  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.type), ["file", "file", "hunk", "context"]);
  assert.equal(rows[0].lineNumber, 1);
});

test("unifiedDiffSections groups rows by file for patch review", () => {
  const sections = unifiedDiffSections(`${sampleDiff}
--- a/src/other.js
+++ b/src/other.js
@@ -1,1 +1,1 @@
-export const oldValue = 1;
+export const newValue = 2;
`, 20);

  assert.equal(sections.length, 2);
  assert.equal(sections[0].after, "src/worker-signal.js");
  assert.equal(sections[0].added, 1);
  assert.equal(sections[0].removed, 1);
  assert.equal(sections[1].after, "src/other.js");
  assert.equal(sections[1].rows.some((row) => row.type === "hunk"), true);
});

test("unifiedDiffSections marks truncated review rows", () => {
  const sections = unifiedDiffSections(sampleDiff, 2);

  assert.equal(sections.length, 1);
  assert.equal(sections[0].rows.length, 2);
  assert.equal(sections[0].truncated, true);
});

test("diff review helpers classify change type and review risk", () => {
  assert.equal(diffFileChangeKind({ before: "/dev/null", after: "src/new.js", added: 2, removed: 0 }), "added");
  assert.equal(diffFileChangeKind({ before: "src/old.js", after: "/dev/null", added: 0, removed: 2 }), "removed");
  assert.equal(diffFileChangeKind({ before: "src/a.js", after: "src/a.js", added: 8, removed: 2 }), "modified");
  assert.equal(diffReviewRisk({ added: 4, removed: 3, hunks: 1 }), "low");
  assert.equal(diffReviewRisk({ added: 20, removed: 8, hunks: 2 }), "medium");
  assert.equal(diffReviewRisk({ added: 50, removed: 40, hunks: 2 }), "high");
});
