import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildOperationalReadiness } from "../src/operational-readiness.mjs";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

function completeCriticalInput(overrides = {}) {
  return {
    serviceHealth: {
      local: { status: "online", detail: "Local server is responding." },
      daemon: { status: "managed", detail: "launchd is installed." },
      publicEntry: { status: "configured", detail: "Public entry is configured." }
    },
    localProjects: {
      selectedProjectId: "proj_1",
      selectedName: "Coding猿",
      selectedPath: "/Users/example/Code/codingape-office"
    },
    tasks: [{ id: "task_1", status: "completed" }],
    evidencePacks: [{ taskId: "task_1", capturedAt: "2026-05-28T01:00:00.000Z" }],
    proposalPacks: [{ taskId: "task_1", proposalPath: "data/proposals/task_1.json", createdAt: "2026-05-28T01:01:00.000Z" }],
    verificationPacks: [{ taskId: "task_1", verificationPath: "data/verifications/task_1.json", completedAt: "2026-05-28T01:02:00.000Z", result: { ok: true } }],
    patchRunPacks: [{ taskId: "task_1", completedAt: "2026-05-28T01:03:00.000Z", rollbackSnapshotPath: "data/patch-snapshots/task_1/manifest.json" }],
    patchApplyPacks: [{ taskId: "task_1", completedAt: "2026-05-28T01:04:00.000Z", status: "requires_confirmation" }],
    taskReports: [{ taskId: "task_1", reportPath: "data/task-reports/task_1.md", generatedAt: "2026-05-28T01:05:00.000Z" }],
    aiwcConfigured: true,
    aiwcHealth: { ok: true, status: "connected", detail: "AIWC health-check passed.", missing: [] },
    hasSupportBundle: true,
    stableTag: "stable/20260528-operational-readiness-v1",
    ...overrides
  };
}

test("operational readiness reports hard blockers before beta operation", () => {
  const readiness = buildOperationalReadiness({
    serviceHealth: {
      local: { status: "online", detail: "Local server is responding." }
    },
    localProjects: {}
  });

  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.statusLabel, "未可运营");
  assert.ok(readiness.blockers.some((check) => check.id === "local_project"));
  assert.ok(readiness.blockers.some((check) => check.id === "evidence_pack"));
  assert.ok(readiness.nextActions.length > 0);
});

test("operational readiness is beta-ready when critical loop exists but advisories remain", () => {
  const readiness = buildOperationalReadiness(completeCriticalInput({
    serviceHealth: {
      local: { status: "online", detail: "Local server is responding." }
    },
    aiwcConfigured: false,
    aiwcHealth: { ok: false, status: "missing_configuration", missing: ["AIWC_INGESTION_API_KEY"] },
    stableTag: ""
  }));

  assert.equal(readiness.status, "beta_ready");
  assert.equal(readiness.statusLabel, "Beta 可运营");
  assert.equal(readiness.blockers.length, 0);
  assert.ok(readiness.advisories.some((check) => check.id === "daemon"));
  assert.ok(readiness.advisories.some((check) => check.id === "git_checkpoint"));
  assert.ok(readiness.advisories.some((check) => check.id === "aiwc_ingestion"));
});

test("operational readiness reaches operational when AIWC health-check passes", () => {
  const readiness = buildOperationalReadiness(completeCriticalInput({
    aiwcConfigured: false,
    aiwcHealth: { ok: true, status: "connected", detail: "AIWC health-check passed.", missing: [] }
  }));

  assert.equal(readiness.status, "operational");
  assert.equal(readiness.statusLabel, "可运营");
  assert.equal(readiness.score, 100);
  assert.equal(readiness.blockers.length, 0);
  assert.equal(readiness.advisories.length, 0);
});

test("operational readiness keeps failed AIWC health-check advisory-only", () => {
  const readiness = buildOperationalReadiness(completeCriticalInput({
    aiwcConfigured: true,
    aiwcHealth: { ok: false, status: "failed", detail: "AIWC health-check failed.", missing: [] }
  }));

  assert.equal(readiness.status, "beta_ready");
  assert.equal(readiness.blockers.length, 0);
  assert.ok(readiness.advisories.some((check) => check.id === "aiwc_ingestion"));
});

test("local office exposes operational readiness and support bundle controls", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");
  const server = await readProjectFile("server.js");

  assert.match(html, /id="operationalStatus"/);
  assert.match(html, /id="aiwcConfigList"/);
  assert.match(html, /id="testAiwcHealthButton"[\s\S]*?>测试 AIWC 连接<\/button>/);
  assert.match(html, /id="generateSupportBundleButton"[\s\S]*?>生成支持包<\/button>/);
  assert.match(app, /function renderOperationalReadinessPanel\(snapshot\)/);
  assert.match(app, /function testAiwcHealth\(\)/);
  assert.match(app, /function generateSupportBundle\(\)/);
  assert.match(app, /\/api\/aiwc\/health-check/);
  assert.match(app, /\/api\/support-bundle/);
  assert.match(app, /X-Codex-Office-Local": "support-bundle"/);
  assert.match(css, /\.operational-readiness-panel\s*{/);
  assert.match(css, /\.aiwc-config-box/);
  assert.match(css, /\.ops-check-row/);
  assert.match(server, /function latestStableTag\(\)/);
  assert.match(server, /function buildAiwcHealthSnapshot\(\)/);
  assert.match(server, /function buildSupportBundle\(snapshot = buildSnapshot\(\)\)/);
  assert.match(server, /url\.pathname === "\/api\/aiwc\/health-check"/);
  assert.match(server, /url\.pathname === "\/api\/operational-readiness"/);
  assert.match(server, /url\.pathname === "\/api\/support-bundle"/);
});
