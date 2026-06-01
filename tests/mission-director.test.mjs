import assert from "node:assert/strict";
import { test } from "node:test";
import { missionDirectorForTask } from "../public/mission-director.js";

test("missionDirectorForTask routes apply blocked work to Ops and Gate", () => {
  const task = {
    id: "task_demo_apply",
    title: "Generate sandbox patch and hold apply gate",
    evidence: [
      "data/evidence/task_demo_apply.json",
      "data/proposals/task_demo_apply.json",
      "data/verifications/task_demo_apply.json",
      "data/patch-runs/task_demo_apply.json",
      "data/patch-applies/task_demo_apply/manifest.json"
    ],
    result: {
      applyStatus: "requires_confirmation",
      humanGateStatus: "approved",
      patchRunStatus: "sandbox_written",
      verificationStatus: "passed"
    }
  };

  const director = missionDirectorForTask(task);

  assert.equal(director.phase, "apply_blocked");
  assert.equal(director.focusNode, "apply");
  assert.equal(director.focusWorkerId, "ops-yuan");
  assert.equal(director.inspectorTab, "gate");
  assert.equal(director.evidenceCompleteness.label, "6/6");
  assert.equal(director.humanGateStatus, "Approved");
  assert.equal(director.applyGateStatus, "Requires confirmation");
  assert.match(director.safetyLine, /no write before the confirmation phrase/i);
});

test("missionDirectorForTask keeps sandbox diff in Evidence before apply gate", () => {
  const task = {
    id: "task_demo_diff",
    title: "Review sandbox diff",
    evidence: [
      "data/evidence/task_demo_diff.json",
      "data/proposals/task_demo_diff.json",
      "data/verifications/task_demo_diff.json",
      "data/patch-runs/task_demo_diff.json"
    ],
    result: {
      humanGateStatus: "approved",
      patchRunStatus: "sandbox_written",
      verificationStatus: "passed"
    }
  };

  const director = missionDirectorForTask(task);

  assert.equal(director.phase, "diff_ready");
  assert.equal(director.focusNode, "diff");
  assert.equal(director.focusWorkerId, "coding-yuan");
  assert.equal(director.inspectorTab, "evidence");
  assert.equal(director.evidenceCompleteness.label, "5/6");
  assert.equal(director.applyGateStatus, "Blocked by default");
  assert.match(director.nextAction, /diff preview/i);
});

test("missionDirectorForTask does not imply automatic apply when runner is armed", () => {
  const task = {
    id: "task_demo_armed",
    evidence: ["data/patch-applies/task_demo_armed/manifest.json"],
    result: {
      applyStatus: "requires_confirmation"
    }
  };

  const director = missionDirectorForTask(task, { applyRunnerEnabled: true });

  assert.equal(director.commandMode, "Apply runner ready · Exact confirmation still required");
  assert.equal(director.gateStatus, "Requires confirmation");
});

test("missionDirectorForTask describes review-only missions as evidence complete", () => {
  const task = {
    id: "task_review_only",
    source: "mission_review_only",
    status: "completed",
    evidence: ["data/evidence/task_review_only.json"]
  };

  const director = missionDirectorForTask(task);

  assert.equal(director.focusNode, "evidence");
  assert.equal(director.phaseLabel, "Evidence captured");
  assert.equal(director.progress, 35);
  assert.match(director.commandMode, /Read-only evidence complete/);
  assert.match(director.safetyLine, /generated no patch/);
  assert.match(director.safetyLine, /modified no project files/);
});
