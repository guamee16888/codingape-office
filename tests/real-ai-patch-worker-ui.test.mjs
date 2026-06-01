import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readProjectFile(path) {
  return readFile(join(repoRoot, path), "utf8");
}

test("Model Provider Settings UI explains BYO key, local model, and snippet privacy", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const server = await readProjectFile("server.js");

  assert.match(html, /id="modelProviderMode"/);
  assert.match(html, /Demo Only/);
  assert.match(html, /BYO API Key/);
  assert.match(html, /Local Model/);
  assert.match(html, /不会默认上传整个项目/);
  assert.match(html, /确认前不会写入代码/);
  assert.match(app, /\/api\/model-provider\/settings/);
  assert.match(app, /\/api\/model-provider\/test/);
  assert.match(server, /MODEL_PROVIDER_SETTINGS_FILE/);
  assert.match(server, /redactedModelProviderSettings/);
  assert.match(server, /modelProvider: snapshot\.modelProvider/);
});

test("AI Patch Worker v1 routes model output into sandbox without bypassing Human Gate", async () => {
  const server = await readProjectFile("server.js");

  assert.match(server, /maybeGenerateAiPatchForTask/);
  assert.match(server, /generateAiPlan/);
  assert.match(server, /generateAiPatch/);
  assert.match(server, /generateAiPatchWithSandboxVerification/);
  assert.match(server, /failureLog: sandboxVerification\.output/);
  assert.match(server, /ai_patch_sandbox_verification_failed/);
  assert.match(server, /patchDrafts: patchResult\.drafts/);
  assert.match(server, /capturePatchRunEvidence/);
  assert.match(server, /captureApplyProposalEvidence/);
  assert.match(server, /Human Gate|humanGateStatus|human_gate/);
});
