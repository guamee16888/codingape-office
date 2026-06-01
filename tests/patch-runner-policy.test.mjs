import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyPatchFile,
  classifyPatchRunPreflight,
  normalizePatchDrafts,
  normalizeRelativeProjectPath,
  patchRunnerEnabled,
  patchRunnerMode,
  validatePatchDraftsForRun
} from "../src/patch-runner-policy.mjs";

const APPROVED_CONTEXT = {
  task: {
    id: "task_1",
    risk: "medium"
  },
  proposal: {
    risk: "medium"
  },
  verification: {
    result: {
      ok: true
    }
  },
  humanGate: {
    status: "approved"
  },
  changedFiles: ["src/app.js"]
};

test("patch runner is disabled by default", () => {
  assert.equal(patchRunnerEnabled({}), false);
  assert.equal(patchRunnerMode({}), "dry_run");
});

test("normalizes only relative project paths", () => {
  assert.equal(normalizeRelativeProjectPath("./src/app.js"), "src/app.js");
  assert.equal(normalizeRelativeProjectPath("src/../secret.js"), "");
  assert.equal(normalizeRelativeProjectPath("/tmp/app.js"), "");
});

test("blocks sensitive and dependency-control files", () => {
  assert.equal(classifyPatchFile("src/app.js").ok, true);
  assert.equal(classifyPatchFile(".env").ok, false);
  assert.equal(classifyPatchFile("package.json").ok, false);
  assert.equal(classifyPatchFile("wallets/keys.json").ok, false);
});

test("requires verification and human gate before a patch run can proceed", () => {
  const result = classifyPatchRunPreflight({
    ...APPROVED_CONTEXT,
    verification: {
      result: {
        ok: false
      }
    },
    humanGate: {
      status: "pending"
    },
    env: {
      CODEX_OFFICE_ENABLE_WRITE_RUNNER: "true"
    }
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.id === "verification_not_passing"));
  assert.ok(result.blockers.some((blocker) => blocker.id === "human_gate_not_approved"));
});

test("allows dry-run when all safety gates pass", () => {
  const result = classifyPatchRunPreflight({
    ...APPROVED_CONTEXT,
    env: {
      CODEX_OFFICE_ENABLE_WRITE_RUNNER: "true"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "dry_run_ready");
  assert.deepEqual(result.allowedFiles, ["src/app.js"]);
});

test("supports sandbox mode without broadening file safety", () => {
  const result = classifyPatchRunPreflight({
    ...APPROVED_CONTEXT,
    changedFiles: ["src/app.js", "package.json"],
    env: {
      CODEX_OFFICE_ENABLE_WRITE_RUNNER: "true",
      CODEX_OFFICE_PATCH_RUNNER_MODE: "sandbox"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.mode, "sandbox");
  assert.ok(result.blockers.some((blocker) => blocker.id === "unsafe_file"));
});

test("normalizes safe patch drafts and rejects unsafe draft content", () => {
  const result = normalizePatchDrafts([
    {
      file: "src/app.js",
      content: "export const ok = true;\n"
    },
    {
      file: ".env",
      content: "SECRET=value\n"
    },
    {
      file: "src/binary.js",
      content: "ok\0no"
    }
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.drafts.map((draft) => draft.file), ["src/app.js"]);
  assert.ok(result.blockers.some((blocker) => blocker.id === "draft_file_unsafe"));
  assert.ok(result.blockers.some((blocker) => blocker.id === "draft_content_binary"));
});

test("requires patch drafts to stay inside the approved patch surface", () => {
  const result = validatePatchDraftsForRun({
    allowedFiles: ["src/app.js"],
    patchDrafts: [
      {
        file: "src/other.js",
        content: "export const outside = true;\n"
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.drafts, []);
  assert.ok(result.blockers.some((blocker) => blocker.id === "draft_outside_allowed_files"));
});
