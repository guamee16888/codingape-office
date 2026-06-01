import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreWorkerAction,
  coreWorkerState,
  selectStationEvent,
  workerStationModel,
  workerStationTelemetry
} from "../public/worker-station-model.js";

const applyBlockedTask = {
  id: "task_demo_123",
  evidence: [
    "data/evidence/task_demo_123.json",
    "data/proposals/task_demo_123.json",
    "data/verifications/task_demo_123.json",
    "data/patch-runs/task_demo_123.json",
    "data/patch-applies/task_demo_123/manifest.json"
  ],
  proposal: "data/proposals/task_demo_123.json",
  verification: "data/verifications/task_demo_123.json",
  patchRun: "data/patch-runs/task_demo_123.json",
  applyRun: "data/patch-applies/task_demo_123/manifest.json",
  result: {
    applyStatus: "requires_confirmation",
    humanGateStatus: "approved",
    patchRunStatus: "sandbox_written",
    verificationStatus: "passed"
  }
};

test("coreWorkerState maps apply blocked work into role-specific station states", () => {
  assert.equal(coreWorkerState({ id: "coding-yuan" }, applyBlockedTask), "waiting_approval");
  assert.equal(coreWorkerState({ id: "judge-yuan" }, applyBlockedTask), "waiting_approval");
  assert.equal(coreWorkerState({ id: "ops-yuan" }, applyBlockedTask), "blocked");
});

test("coreWorkerAction explains the true backend phase", () => {
  assert.equal(coreWorkerAction({ id: "coding-yuan" }, applyBlockedTask), "等待人工写入决定");
  assert.equal(coreWorkerAction({ id: "judge-yuan" }, applyBlockedTask), "解释写入闸门阻断原因");
  assert.equal(coreWorkerAction({ id: "ops-yuan" }, applyBlockedTask), "策略已阻断直接写入");
});

test("workerStationTelemetry exposes evidence, rollback, and apply state", () => {
  const codingTelemetry = workerStationTelemetry({ id: "coding-yuan" }, applyBlockedTask);
  const opsTelemetry = workerStationTelemetry({ id: "ops-yuan" }, applyBlockedTask);

  assert.deepEqual(codingTelemetry.map((item) => item.status), ["ok", "ok", "ok"]);
  assert.deepEqual(codingTelemetry.map((item) => item.label), ["证据", "方案", "补丁"]);
  assert.equal(opsTelemetry.find((item) => item.label === "回滚").value, "就绪");
  assert.equal(opsTelemetry.find((item) => item.label === "写入").status, "danger");
});

test("review-only mission keeps Judge and Ops visibly on standby", () => {
  const task = {
    id: "task_review_only",
    source: "mission_review_only",
    status: "completed",
    evidence: ["data/evidence/task_review_only.json"],
    result: {
      commandCount: 3
    }
  };

  assert.equal(coreWorkerState({ id: "coding-yuan" }, task), "working");
  assert.equal(coreWorkerAction({ id: "coding-yuan" }, task), "只读证据已采集");
  assert.equal(coreWorkerState({ id: "judge-yuan" }, task), "idle");
  assert.equal(coreWorkerAction({ id: "judge-yuan" }, task), "本次不参与，等待需要审查的方案");
  assert.equal(coreWorkerState({ id: "ops-yuan" }, task), "idle");
  assert.equal(coreWorkerAction({ id: "ops-yuan" }, task), "本次不进入写入闸门");
  assert.deepEqual(workerStationTelemetry({ id: "ops-yuan" }, task).map((item) => item.value), [
    "本次待命",
    "本次不写",
    "默认阻断"
  ]);
});

test("proposal mission brings Judge online while Ops remains gated standby", () => {
  const task = {
    id: "task_proposal",
    source: "mission_proposal",
    status: "completed",
    proposal: "data/proposals/task_proposal.json",
    evidence: ["data/evidence/task_proposal.json", "data/proposals/task_proposal.json"]
  };

  assert.equal(coreWorkerState({ id: "judge-yuan" }, task), "reviewing");
  assert.equal(coreWorkerAction({ id: "judge-yuan" }, task), "旁路审查方案，不触发写入");
  assert.equal(coreWorkerState({ id: "ops-yuan" }, task), "idle");
  assert.equal(coreWorkerAction({ id: "ops-yuan" }, task), "方案阶段待命，写入仍默认阻断");
});

test("workerStationModel carries latest event context without changing run state", () => {
  const model = workerStationModel(
    { id: "judge-yuan", name: "Judge猿", mark: "审" },
    applyBlockedTask,
    { id: "event_apply_gate", type: "apply_gate_pending", title: "Apply gate checked" }
  );

  assert.equal(model.runId, "task_demo_123");
  assert.equal(model.eventId, "event_apply_gate");
  assert.equal(model.eventType, "apply_gate_pending");
  assert.equal(model.eventTitle, "Apply gate checked");
  assert.equal(model.phase, "apply_blocked");
  assert.equal(model.runtimeState, "waiting_approval");
  assert.equal(model.animation, "waiting_approval");
  assert.equal(model.light.key, "amber");
  assert.equal(model.gateStatus, "requires_confirmation");
});

test("workerStationModel exposes blocked Ops runtime state for the 3D room", () => {
  const model = workerStationModel(
    { id: "ops-yuan", name: "Ops猿", mark: "运", risk: "medium" },
    applyBlockedTask
  );

  assert.equal(model.runtimeState, "blocked");
  assert.equal(model.animation, "blocked");
  assert.equal(model.light.key, "red");
  assert.equal(model.riskLevel, "medium");
});

test("selectStationEvent assigns task events by worker role before generic task recency", () => {
  const events = [
    {
      id: "judge_latest",
      workerId: "judge-yuan",
      projectId: "coding-yuan-sandbox-demo",
      type: "apply_gate_pending",
      title: "Apply gate checked",
      evidence: ["data/patch-applies/task_demo_123/manifest.json"],
      timestamp: "2026-05-23T09:50:00.000Z"
    },
    {
      id: "coding_patch",
      workerId: "coding-yuan",
      projectId: "coding-yuan-sandbox-demo",
      type: "patch_run_ready",
      title: "Patch runner ready",
      evidence: ["data/patch-runs/task_demo_123.json"],
      timestamp: "2026-05-23T04:10:00.000Z"
    },
    {
      id: "coding_completed",
      workerId: "coding-yuan",
      projectId: "coding-yuan-sandbox-demo",
      type: "task_completed",
      title: "Completed after patch runner",
      evidence: ["data/evidence/task_demo_123.json"],
      timestamp: "2026-05-23T09:59:00.000Z"
    },
    {
      id: "other_project",
      workerId: "coding-yuan",
      projectId: "other",
      type: "task_completed",
      title: "Completed somewhere else",
      evidence: ["data/evidence/task_demo_123.json"],
      timestamp: "2026-05-23T10:00:00.000Z"
    }
  ];
  const project = { id: "coding-yuan-sandbox-demo" };

  assert.equal(selectStationEvent(events, { id: "coding-yuan" }, project, applyBlockedTask).id, "coding_patch");
  assert.equal(selectStationEvent(events, { id: "judge-yuan" }, project, applyBlockedTask).id, "judge_latest");
  assert.equal(selectStationEvent(events, { id: "ops-yuan" }, project, applyBlockedTask).id, "judge_latest");
});
