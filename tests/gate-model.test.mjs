import assert from "node:assert/strict";
import { test } from "node:test";
import {
  affectedFilesFromTask,
  gateApprovalChecklistFromTask,
  gateModelFromTask,
  gateProofSummaryFromTask,
  gateRiskExplanation,
  gateVerdictFromTask
} from "../public/gate-model.js";

test("affectedFilesFromTask deduplicates patch candidates and drafts", () => {
  const task = {
    patchCandidates: ["src/worker-signal.js"],
    patchDrafts: [{ file: "src/worker-signal.js" }, { file: "src/new-file.js" }]
  };

  assert.deepEqual(affectedFilesFromTask(task), ["src/worker-signal.js", "src/new-file.js"]);
});

test("gateModelFromTask keeps sandbox patch blocked from direct project writes", () => {
  const task = {
    patchRun: "data/patch-runs/task_1.json",
    result: {
      humanGateStatus: "approved",
      patchRunStatus: "sandbox_written",
      applyStatus: "requires_confirmation"
    }
  };

  const model = gateModelFromTask(task);

  assert.equal(model.canReviewPatch, true);
  assert.equal(model.canRunApplyGate, true);
  assert.equal(model.directWritesBlocked, true);
  assert.equal(model.requiresExactConfirmation, true);
  assert.equal(model.requiresHumanApproval, true);
});

test("gateRiskExplanation explains apply confirmation blockers", () => {
  const task = {
    result: {
      patchRunStatus: "sandbox_written",
      applyStatus: "requires_confirmation"
    }
  };

  assert.match(gateRiskExplanation(task), /exact human confirmation/);
});

test("gateApprovalChecklistFromTask exposes approval facts without allowing writes", () => {
  const task = {
    id: "task_approval",
    patchCandidates: ["src/worker-signal.js"],
    patchRun: "data/patch-runs/task_approval.json",
    result: {
      verificationStatus: "passed",
      humanGateStatus: "approved",
      patchRunStatus: "sandbox_written",
      applyStatus: "requires_confirmation"
    }
  };

  const checklist = gateApprovalChecklistFromTask(task);

  assert.deepEqual(checklist.affectedFiles, ["src/worker-signal.js"]);
  assert.equal(checklist.requiredConfirmation, "APPLY task_approval");
  assert.ok(checklist.willHappen.some((line) => /preflight/.test(line)));
  assert.ok(checklist.willNotHappen.some((line) => /Human Gate/.test(line)));
  assert.ok(checklist.blockers.some((line) => /confirmation/.test(line)));
  assert.ok(checklist.blockers.some((line) => /Project file writes remain blocked/.test(line)));
});

test("gate proof summary counts the full auditable close loop", () => {
  const task = {
    evidence: [
      "data/evidence/task_1.json",
      "data/proposals/task_1.json",
      "data/verifications/task_1.json",
      "data/patch-runs/task_1.json",
      "data/patch-applies/task_1/manifest.json"
    ],
    result: {
      humanGateStatus: "approved"
    }
  };

  assert.deepEqual(gateProofSummaryFromTask(task), {
    completed: 6,
    label: "6/6",
    ready: true,
    total: 6
  });
});

test("gate verdict makes blocked apply the first-class safety message", () => {
  const task = {
    patchRun: "data/patch-runs/task_1.json",
    applyRun: "data/patch-applies/task_1/manifest.json",
    evidence: [
      "data/evidence/task_1.json",
      "data/proposals/task_1.json",
      "data/verifications/task_1.json",
      "data/patch-runs/task_1.json",
      "data/patch-applies/task_1/manifest.json"
    ],
    result: {
      humanGateStatus: "approved",
      patchRunStatus: "sandbox_written",
      applyStatus: "requires_confirmation"
    }
  };

  const verdict = gateVerdictFromTask(task);

  assert.equal(verdict.tone, "blocked");
  assert.equal(verdict.headline, "Write Is Blocked");
  assert.equal(verdict.proofLabel, "6/6");
  assert.equal(verdict.applyLabel, "Requires confirmation");
});
