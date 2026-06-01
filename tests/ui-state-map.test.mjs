import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPACT_MISSION_FLOW_NODES,
  PREMIUM_MISSION_FLOW_NODES,
  compactFlowStatusForNode,
  flowStatusForNode,
  latestTaskForProject,
  missionModeFromTask,
  missionProgress,
  premiumMissionFlowNodeId,
  runPhaseFromTask,
  taskEventTime,
  visibleMissionFlowNodeId
} from "../public/ui-state-map.js";

test("runPhaseFromTask maps verified human-gated work to the human gate phase", () => {
  const task = {
    status: "completed",
    proposal: "data/proposals/task_1.json",
    verification: "data/verifications/task_1.json",
    evidence: ["data/evidence/task_1.json"],
    result: {
      verificationStatus: "passed"
    }
  };

  assert.equal(runPhaseFromTask(task), "human_gate");
  assert.equal(flowStatusForNode(task, { id: "verification" }), "passed");
  assert.equal(flowStatusForNode(task, { id: "human" }), "waiting_human");
});

test("runPhaseFromTask maps sandbox diff and apply gate evidence without implying auto-apply", () => {
  const task = {
    status: "completed",
    patchRun: "data/patch-runs/task_2.json",
    applyRun: "data/patch-applies/task_2/manifest.json",
    evidence: [
      "data/evidence/task_2.json",
      "data/patch-runs/task_2.json",
      "data/patch-applies/task_2/manifest.json"
    ],
    result: {
      patchRunStatus: "sandbox_written",
      applyStatus: "requires_confirmation"
    }
  };

  assert.equal(runPhaseFromTask(task), "apply_blocked");
  assert.equal(flowStatusForNode(task, { id: "diff" }), "passed");
  assert.equal(flowStatusForNode(task, { id: "apply" }), "blocked");
  assert.ok(missionProgress(task) > 80);
});

test("runPhaseFromTask maps an applied proposal to completed", () => {
  const task = {
    status: "completed",
    result: {
      applyStatus: "applied"
    }
  };

  assert.equal(runPhaseFromTask(task), "completed");
  assert.equal(flowStatusForNode(task, { id: "report" }), "passed");
  assert.equal(missionProgress(task), 100);
});

test("runPhaseFromTask maps approved human gate into patch preflight without skipping apply gate", () => {
  const task = {
    status: "completed",
    proposal: "data/proposals/task_4.json",
    verification: "data/verifications/task_4.json",
    evidence: [
      "data/evidence/task_4.json",
      "data/proposals/task_4.json",
      "data/verifications/task_4.json"
    ],
    result: {
      verificationStatus: "passed",
      humanGateStatus: "approved"
    }
  };

  assert.equal(runPhaseFromTask(task), "patch_running");
  assert.equal(flowStatusForNode(task, { id: "human" }), "passed");
  assert.equal(flowStatusForNode(task, { id: "patch" }), "running");
  assert.equal(flowStatusForNode(task, { id: "apply" }), "pending");
});

test("runPhaseFromTask keeps a sandbox patch at diff preview until apply gate is checked", () => {
  const task = {
    status: "completed",
    patchRun: "data/patch-runs/task_5.json",
    evidence: [
      "data/evidence/task_5.json",
      "data/proposals/task_5.json",
      "data/verifications/task_5.json",
      "data/patch-runs/task_5.json"
    ],
    result: {
      verificationStatus: "passed",
      humanGateStatus: "approved",
      patchRunStatus: "sandbox_written"
    }
  };

  assert.equal(runPhaseFromTask(task), "diff_ready");
  assert.equal(flowStatusForNode(task, { id: "diff" }), "passed");
  assert.equal(flowStatusForNode(task, { id: "apply" }), "pending");
  assert.ok(missionProgress(task) < 90);
});

test("compact mission flow keeps the first screen focused on five durable phases", () => {
  assert.deepEqual(
    COMPACT_MISSION_FLOW_NODES.map((node) => node.id),
    ["task", "evidence", "verification", "judge", "apply"]
  );
  assert.deepEqual(
    COMPACT_MISSION_FLOW_NODES.map((node) => node.label),
    ["任务", "证据", "验证", "审核", "写入闸门"]
  );
  assert.equal(visibleMissionFlowNodeId("proposal"), "evidence");
  assert.equal(visibleMissionFlowNodeId("diff"), "evidence");
  assert.equal(visibleMissionFlowNodeId("human"), "judge");
  assert.equal(visibleMissionFlowNodeId("report"), "apply");
});

test("premium mission flow exposes the full paid loop without compact aliases", () => {
  assert.deepEqual(
    PREMIUM_MISSION_FLOW_NODES.map((node) => node.id),
    ["task", "evidence", "proposal", "verification", "judge", "human", "patch", "diff", "apply", "report"]
  );
  assert.deepEqual(
    PREMIUM_MISSION_FLOW_NODES.map((node) => node.label),
    ["任务", "证据", "方案", "验证", "审核", "人工确认", "沙盒补丁", "Diff 预览", "写入闸门", "报告"]
  );
  assert.equal(premiumMissionFlowNodeId("proposal"), "proposal");
  assert.equal(premiumMissionFlowNodeId("diff"), "diff");
  assert.equal(premiumMissionFlowNodeId("human"), "human");
  assert.equal(premiumMissionFlowNodeId("queued"), "task");
});

test("compact mission flow aggregates granular audit states without hiding safety gates", () => {
  const task = {
    status: "completed",
    proposal: "data/proposals/task_6.json",
    verification: "data/verifications/task_6.json",
    patchRun: "data/patch-runs/task_6.json",
    applyRun: "data/patch-applies/task_6/manifest.json",
    evidence: [
      "data/evidence/task_6.json",
      "data/proposals/task_6.json",
      "data/verifications/task_6.json",
      "data/patch-runs/task_6.json",
      "data/patch-applies/task_6/manifest.json"
    ],
    result: {
      verificationStatus: "passed",
      humanGateStatus: "approved",
      patchRunStatus: "sandbox_written",
      applyStatus: "requires_confirmation"
    }
  };

  assert.equal(compactFlowStatusForNode(task, { id: "evidence" }), "passed");
  assert.equal(compactFlowStatusForNode(task, { id: "verification" }), "passed");
  assert.equal(compactFlowStatusForNode(task, { id: "judge" }), "passed");
  assert.equal(compactFlowStatusForNode(task, { id: "apply" }), "blocked");
});

test("review-only mission stops the compact flow at captured evidence", () => {
  const task = {
    id: "task_review_only",
    source: "mission_review_only",
    status: "completed",
    evidence: ["data/evidence/task_review_only.json"],
    result: {
      commandCount: 3
    }
  };

  assert.equal(missionModeFromTask(task), "review_only");
  assert.equal(runPhaseFromTask(task), "evidence_collecting");
  assert.equal(compactFlowStatusForNode(task, { id: "evidence" }), "passed");
  assert.equal(compactFlowStatusForNode(task, { id: "verification" }), "pending");
  assert.equal(compactFlowStatusForNode(task, { id: "judge" }), "pending");
  assert.equal(compactFlowStatusForNode(task, { id: "apply" }), "pending");
});

test("latestTaskForProject follows the newest run instead of the first matching task", () => {
  const tasks = [
    {
      id: "task_old",
      projectId: "coding-yuan-sandbox-demo",
      updatedAt: "2026-05-24T01:00:00.000Z"
    },
    {
      id: "task_other",
      projectId: "other",
      updatedAt: "2026-05-24T01:10:00.000Z"
    },
    {
      id: "task_new",
      projectId: "coding-yuan-sandbox-demo",
      updatedAt: "2026-05-24T01:20:00.000Z"
    }
  ];

  assert.equal(latestTaskForProject(tasks, "coding-yuan-sandbox-demo").id, "task_new");
  assert.equal(latestTaskForProject(tasks).id, "task_new");
  assert.ok(taskEventTime(tasks[2]) > taskEventTime(tasks[0]));
});
