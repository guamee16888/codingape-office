import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("First Run onboarding appears when no project root is authorized", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const server = await readProjectFile("server.js");

  assert.match(html, /id="firstRunOnboarding"/);
  assert.match(html, /onboardingChooseProjectButton/);
  assert.match(html, /onboardingRunSelfCheckButton/);
  assert.match(html, /onboardingFirstOrderButton/);
  assert.match(html, /onboardingByoKey/);
  assert.match(app, /function renderFirstRunOnboarding\(snapshot\)/);
  assert.match(app, /Boolean\(onboarding\.required\)/);
  assert.match(server, /function buildFirstRunOnboarding/);
  assert.match(server, /欢迎/);
  assert.match(server, /配置 API Key 或确认 BYO key/);
  assert.match(server, /创建一个安全示例任务/);
});

test("Safe Demo Task prepares README patch through guarded first-order loop", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const server = await readProjectFile("server.js");

  assert.match(html, /id="runFirstOrderButton"[\s\S]*?>跑第一单<\/button>/);
  assert.match(app, /const FIRST_ORDER_TITLE = "给 README 增加一个 Coding猿 Beta 测试段落"/);
  assert.match(app, /async function runFirstOrder\(\)/);
  assert.match(app, /safeFirstOrder:\s*true/);
  assert.match(server, /const FIRST_ORDER_TITLE = "给 README 增加一个 Coding猿 Beta 测试段落"/);
  assert.match(server, /function safeFirstOrderPatchDraft\(project\)/);
  assert.match(server, /function captureFirstOrderVerificationEvidence\(task, project, firstOrder\)/);
  assert.match(server, /coding-yuan-first-order-self-check/);
  assert.match(server, /README\.codingape-beta\.md/);
  assert.match(server, /assertPathInsideProjectRoot\(project\.path, targetFile\)/);
  assert.match(server, /\(demoProfile\.autoCloseLoop \|\| body\.safeFirstOrder\) && verification\.ok/);
  assert.match(server, /project apply still requires exact local confirmation/);
});

test("Error Recovery UX includes every external tester failure class", async () => {
  const app = await readProjectFile("public/app.js");
  const server = await readProjectFile("server.js");

  for (const id of [
    "local_service_start_failed",
    "port_4142_busy",
    "node_missing",
    "git_missing",
    "api_key_missing",
    "project_root_missing",
    "project_not_git_repo",
    "apply_failed",
    "rollback_failed"
  ]) {
    assert.match(server, new RegExp(id));
  }
  assert.match(server, /recoveryGuide: buildErrorRecoveryGuide/);
  assert.match(app, /function recoveryItemTemplate\(item = \{\}\)/);
  assert.match(app, /support\.recoveryGuide/);
});
