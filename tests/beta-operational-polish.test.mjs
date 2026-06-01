import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("AIWC health check exposes redacted configuration status", async () => {
  const server = await readProjectFile("server.js");
  const app = await readProjectFile("public/app.js");
  const html = await readProjectFile("public/index.html");

  assert.match(server, /function buildAiwcConfigStatus\(env = process\.env\)/);
  assert.match(server, /AIWC_INGESTION_API_KEY/);
  assert.match(server, /displayValue: config\.ingestionApiKey \? "已配置，已隐藏" : ""/);
  assert.match(server, /async function handleAiwcHealthCheck/);
  assert.match(server, /recordAiWorkerRunLog\(\{/);
  assert.match(server, /run_id_external: `codex-office:aiwc-health:/);
  assert.match(server, /AIWC_HEALTH_FILE/);
  assert.match(html, /id="aiwcConfigList"/);
  assert.match(html, /id="aiwcHealthDetail"/);
  assert.match(app, /function aiwcConfigTemplate\(item = \{\}\)/);
  assert.match(app, /item\.secret[\s\S]*?"已配置，已隐藏"/);
  assert.match(app, /fetchJson\("\/api\/aiwc\/health-check"\)/);
});

test("First Run Checklist is part of the office snapshot and UI", async () => {
  const server = await readProjectFile("server.js");
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(server, /function buildFirstRunChecklist/);
  assert.match(server, /"project_root"/);
  assert.match(server, /"git"/);
  assert.match(server, /"node"/);
  assert.match(server, /"npm"/);
  assert.match(server, /"api_key"/);
  assert.match(server, /"evidence_runner"/);
  assert.match(server, /"patch_runner"/);
  assert.match(server, /"support_bundle"/);
  assert.match(server, /"local_service"/);
  assert.match(server, /firstRunChecklist,/);
  assert.match(html, /class="first-run-panel"/);
  assert.match(html, /id="firstRunList"/);
  assert.match(app, /function renderFirstRunChecklist\(snapshot\)/);
  assert.match(app, /firstRunCheckTemplate/);
  assert.match(css, /\.first-run-panel/);
  assert.match(css, /\.first-run-item/);
});

test("Beta Support Center can generate, open, copy, and inspect diagnostics", async () => {
  const server = await readProjectFile("server.js");
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(server, /function buildSupportCenterSnapshot/);
  assert.match(server, /function buildRecentErrors/);
  assert.match(server, /function buildDiagnosticSummary/);
  assert.match(server, /async function handleOpenSupportBundleDirectory/);
  assert.match(server, /url\.pathname === "\/api\/support-bundle\/open-directory"/);
  assert.match(server, /recentErrors/);
  assert.match(html, /class="beta-support-panel"/);
  assert.match(html, /id="openSupportBundleDirectoryButton"[\s\S]*?>打开支持包目录<\/button>/);
  assert.match(html, /id="copyDiagnosticSummaryButton"[\s\S]*?>复制诊断摘要<\/button>/);
  assert.match(html, /id="recentErrorList"/);
  assert.match(html, /id="restartHintText"/);
  assert.match(app, /function renderSupportCenter\(snapshot\)/);
  assert.match(app, /function openSupportBundleDirectory\(\)/);
  assert.match(app, /function copyDiagnosticSummary\(\)/);
  assert.match(app, /function copyRestartHint\(\)/);
  assert.match(app, /X-Codex-Office-Local": "support-bundle-open"/);
  assert.match(css, /\.beta-support-panel/);
  assert.match(css, /\.recent-error-item/);
  assert.match(css, /\.restart-hint-text/);
});
