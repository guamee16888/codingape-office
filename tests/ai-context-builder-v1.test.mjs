import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildAiPatchContext,
  isSensitiveContextPath
} from "../src/ai-context-builder-v1.mjs";

test("AI context skips .env and records only the sent file list", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-ai-context-"));
  writeFileSync(join(project, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  writeFileSync(join(project, "README.md"), "# App\n", "utf8");
  writeFileSync(join(project, ".env"), "OPENAI_API_KEY=secret\n", "utf8");
  mkdirSync(join(project, "src"));
  writeFileSync(join(project, "src/app.js"), "export const value = 1;\n", "utf8");

  const context = buildAiPatchContext({
    projectPath: project,
    task: { id: "task_1", title: "Update README.md and .env and src/app.js" },
    userFiles: [".env", "src/app.js"]
  });

  assert.equal(context.ok, true);
  assert.ok(context.sentFiles.includes("README.md"));
  assert.ok(context.sentFiles.includes("src/app.js"));
  assert.equal(context.sentFiles.includes(".env"), false);
  assert.ok(context.skippedFiles.some((file) => file.file === ".env" && file.reason === "sensitive_path_skipped"));
  assert.equal(JSON.stringify(context).includes("OPENAI_API_KEY=secret"), false);
});

test("AI context treats secret, wallet, and certificate paths as sensitive", () => {
  assert.equal(isSensitiveContextPath(".env"), true);
  assert.equal(isSensitiveContextPath("wallets/key.json"), true);
  assert.equal(isSensitiveContextPath("certificates/app.p12"), true);
  assert.equal(isSensitiveContextPath("src/app.ts"), false);
});

test("AI context expands user-specified safe directories into bounded files", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-ai-context-dir-"));
  writeFileSync(join(project, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  mkdirSync(join(project, "src"));
  writeFileSync(join(project, "src/app.js"), "export const value = 1;\n", "utf8");
  writeFileSync(join(project, "src/secret.key"), "SECRET\n", "utf8");

  const context = buildAiPatchContext({
    projectPath: project,
    task: { id: "task_2", title: "Add validation in src" },
    userFiles: ["src"]
  });

  assert.ok(context.sentFiles.includes("src/app.js"));
  assert.equal(context.sentFiles.includes("src/secret.key"), false);
});
