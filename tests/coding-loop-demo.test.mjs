import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SANDBOX_DEMO_PATCH_FILE,
  codingLoopDemoProfile,
  sandboxApplyGateEnv,
  sandboxPatchRunnerEnv
} from "../src/coding-loop-demo.mjs";

test("coding loop demo profile only auto-closes the safe sandbox project", () => {
  const sandbox = codingLoopDemoProfile({ id: "coding-yuan-sandbox-demo" }, {});
  const production = codingLoopDemoProfile({ id: "production-app" }, {});

  assert.equal(sandbox.autoCloseLoop, true);
  assert.deepEqual(sandbox.patchCandidates, [SANDBOX_DEMO_PATCH_FILE]);
  assert.equal(sandbox.patchDrafts.length, 1);
  assert.equal(sandbox.patchDrafts[0].file, SANDBOX_DEMO_PATCH_FILE);
  assert.equal(production.autoCloseLoop, false);
  assert.equal(production.patchCandidates, undefined);
  assert.equal(production.patchDrafts, undefined);
});

test("coding loop demo profile preserves explicit operator patch scope", () => {
  const profile = codingLoopDemoProfile(
    { id: "coding-yuan-sandbox-demo" },
    {
      autoCloseLoop: false,
      patchCandidates: ["src/custom.js"],
      patchDrafts: [{ file: "src/custom.js", content: "export const custom = true;\n" }]
    }
  );

  assert.equal(profile.autoCloseLoop, false);
  assert.deepEqual(profile.patchCandidates, ["src/custom.js"]);
  assert.equal(profile.patchDrafts[0].file, "src/custom.js");
});

test("sandbox close-loop enables sandbox patch artifacts but keeps direct apply disabled", () => {
  const patchEnv = sandboxPatchRunnerEnv({ NODE_ENV: "test" });
  const applyEnv = sandboxApplyGateEnv({
    NODE_ENV: "test",
    CODEX_OFFICE_ENABLE_APPLY_RUNNER: "true"
  });

  assert.equal(patchEnv.CODEX_OFFICE_ENABLE_WRITE_RUNNER, "true");
  assert.equal(patchEnv.CODEX_OFFICE_PATCH_RUNNER_MODE, "sandbox");
  assert.equal(applyEnv.CODEX_OFFICE_ENABLE_APPLY_RUNNER, "false");
});
