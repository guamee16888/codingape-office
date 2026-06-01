import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { evaluateApplyGateV1 } from "../src/apply-gate-v1.mjs";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("project discovery only uses explicitly saved local project records", async () => {
  const server = await readProjectFile("server.js");
  const app = await readProjectFile("public/app.js");
  const discoverBody = functionBody(server, "discoverProjects");

  assert.match(discoverBody, /readLocalProjectRegistry\(LOCAL_PROJECTS_FILE\)/);
  assert.doesNotMatch(discoverBody, /readdirSync\(WORKSPACE_ROOT/);
  assert.match(server, /function authorizedProjectSelection\(projects = \[\], projectId = ""\)/);
  assert.match(server, /hasSecurityScopedBookmark: Boolean\(record\.securityScopedBookmark\)/);
  assert.match(server, /selectedHasSecurityScopedBookmark: Boolean\(selected\?\.securityScopedBookmark\)/);
  assert.match(server, /project_root_required/);
  assert.match(server, /project_root_not_authorized/);
  assert.match(app, /当前授权项目/);
  assert.match(app, /Codingape Office will not scan the full disk by default/);
});

test("task and apply endpoints require the current authorized project root", async () => {
  const server = await readProjectFile("server.js");

  assert.match(server, /async function handleCreateTask[\s\S]*?authorizedProjectSelection\(projects, body\.projectId\)/);
  assert.match(server, /async function handleRunCodingLoop[\s\S]*?authorizedProjectSelection\(projects, projectId\)/);
  assert.match(server, /async function handleRunTask[\s\S]*?authorizedProjectSelection\(projects, task\.projectId\)/);
  assert.match(server, /async function handleRunVerification[\s\S]*?authorizedProjectSelection\(projects, task\.projectId\)/);
  assert.match(server, /async function handleRunPatch[\s\S]*?authorizedProjectSelection\(projects, task\.projectId\)/);
  assert.match(server, /async function handleApplyGate[\s\S]*?captureApplyProposalEvidence\(task, selection\.project, body\)/);
  assert.match(server, /async function handleRollbackTask[\s\S]*?restoreRollbackSnapshot\(\{[\s\S]*?projectPath: selection\.project\.path/);
});

test("Apply Approved Patch remains human-gated and root guarded", () => {
  const gate = evaluateApplyGateV1({
    patchRun: {
      status: "sandbox_written",
      diffPath: "data/patch-runs/task/diff.patch",
      rollbackSnapshotPath: "data/patch-snapshots/task/manifest.json",
      sandboxFiles: [{ file: "../outside.js", changed: true }]
    },
    verification: { result: { ok: true } },
    humanGate: { status: "approved" },
    projectPath: "/tmp/project",
    rollbackManifest: { ok: true }
  });

  assert.equal(gate.canApply, false);
  assert.equal(gate.requiredFacts.diffReady, true);
  assert.equal(gate.requiredFacts.verificationResultExists, true);
  assert.equal(gate.requiredFacts.rollbackSnapshotReady, true);
  assert.equal(gate.requiredFacts.humanApprovalGranted, true);
  assert.equal(gate.requiredFacts.allTargetFilesInsideProjectRoot, false);
  assert.ok(gate.blockers.some((blocker) => blocker.source === "project_root_guard"));
});
