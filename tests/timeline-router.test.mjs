import assert from "node:assert/strict";
import { test } from "node:test";
import {
  focusNodeForTimelineEvent,
  focusWorkerForTimelineEvent,
  inspectorTabForTimelineEvent,
  missionModeFromTimelineEvent,
  significantTimelineEvents,
  taskIdFromTimelineEvent,
  timelineEventKey,
  timelineEventImportance,
  timelineEventSeverity,
  timelineReplaySummary
} from "../public/timeline-router.js";

test("taskIdFromTimelineEvent infers task ids from evidence paths", () => {
  const event = {
    evidence: [
      "data/evidence/task_mphtx0nh_7td6lh.json",
      "data/proposals/task_mphtx0nh_7td6lh.json"
    ]
  };

  assert.equal(taskIdFromTimelineEvent(event), "task_mphtx0nh_7td6lh");
});

test("timelineEventKey uses ids and falls back to stable event fields", () => {
  assert.equal(timelineEventKey({ id: "event_123", type: "apply_gate_pending" }), "event_123");

  const key = timelineEventKey({
    type: "apply_gate_pending",
    projectId: "coding-yuan-sandbox-demo",
    workerId: "ops-yuan",
    timestamp: "2026-05-24T08:00:00.000Z",
    title: "Apply gate checked",
    evidence: ["data/apply-runs/task_mphtx0nh_7td6lh.json"]
  });

  assert.equal(
    key,
    "apply_gate_pending|coding-yuan-sandbox-demo|ops-yuan|2026-05-24T08:00:00.000Z|task_mphtx0nh_7td6lh|Apply gate checked"
  );
});

test("missionModeFromTimelineEvent reads explicit mode and mission source", () => {
  assert.equal(missionModeFromTimelineEvent({ mode: "review_only" }), "review_only");
  assert.equal(missionModeFromTimelineEvent({ source: "mission_verify" }), "verify");
  assert.equal(missionModeFromTimelineEvent({ source: "operator" }), "");
});

test("inspectorTabForTimelineEvent routes gate and evidence events", () => {
  assert.equal(inspectorTabForTimelineEvent({ type: "apply_gate_pending" }), "gate");
  assert.equal(inspectorTabForTimelineEvent({ type: "human_gate_approved" }), "gate");
  assert.equal(inspectorTabForTimelineEvent({ type: "verification_passed" }), "evidence");
  assert.equal(inspectorTabForTimelineEvent({ type: "git_signal" }), "mission");
});

test("timelineReplaySummary preserves route, evidence count, and severity", () => {
  const summary = timelineReplaySummary({
    id: "event_task_mphtx0nh_7td6lh",
    type: "patch_run_ready",
    risk: "low",
    title: "Patch runner ready",
    evidence: ["data/patch-runs/task_mphtx0nh_7td6lh.json"]
  });

  assert.equal(summary.inspectorTab, "evidence");
  assert.equal(summary.evidenceCount, 1);
  assert.equal(summary.focusNode, "diff");
  assert.equal(summary.focusWorkerId, "coding-yuan");
  assert.equal(summary.severity, "success");
  assert.equal(summary.taskId, "task_mphtx0nh_7td6lh");
});

test("timeline focus maps audit events to worker stations and flow nodes", () => {
  assert.equal(focusNodeForTimelineEvent({ type: "apply_gate_pending" }), "apply");
  assert.equal(focusWorkerForTimelineEvent({ type: "apply_gate_pending" }), "ops-yuan");
  assert.equal(focusNodeForTimelineEvent({ type: "human_gate_approved" }), "human");
  assert.equal(focusWorkerForTimelineEvent({ type: "verification_passed" }), "judge-yuan");
  assert.equal(focusNodeForTimelineEvent({ type: "task_evidence" }), "evidence");
  assert.equal(focusWorkerForTimelineEvent({ type: "task_evidence" }), "coding-yuan");
});

test("timelineEventSeverity treats high risk pending gates as danger", () => {
  assert.equal(timelineEventSeverity({ type: "apply_gate_pending", risk: "high" }), "danger");
});

test("timelineEventImportance prioritizes gates and failures over plain queue noise", () => {
  assert.ok(
    timelineEventImportance({ type: "apply_gate_pending", risk: "high" }) >
    timelineEventImportance({ type: "task_queued", risk: "medium" })
  );
});

test("significantTimelineEvents keeps the recent critical audit trail compact", () => {
  const events = [
    { id: "queue-new", type: "task_queued", timestamp: "2026-05-24T08:00:00.000Z" },
    { id: "apply", type: "apply_gate_pending", risk: "high", timestamp: "2026-05-24T07:00:00.000Z" },
    { id: "verify", type: "verification_passed", risk: "low", timestamp: "2026-05-24T06:00:00.000Z" },
    { id: "evidence", type: "task_evidence", risk: "medium", timestamp: "2026-05-24T05:00:00.000Z" },
    { id: "queue-old", type: "task_queued", timestamp: "2026-05-24T04:00:00.000Z" }
  ];

  const compact = significantTimelineEvents(events, { limit: 3 });

  assert.deepEqual(compact.map((event) => event.id), ["apply", "verify", "evidence"]);
});

test("significantTimelineEvents keeps review-only feeds honest", () => {
  const events = [
    { id: "queued", taskId: "task_live_123", mode: "review_only", type: "task_queued", timestamp: "2026-05-24T08:00:00.000Z" },
    { id: "evidence", taskId: "task_live_123", mode: "review_only", type: "task_evidence", timestamp: "2026-05-24T08:01:00.000Z" },
    { id: "patch", taskId: "task_live_123", mode: "review_only", type: "patch_run_ready", timestamp: "2026-05-24T08:02:00.000Z" },
    { id: "apply", taskId: "task_live_123", mode: "review_only", type: "apply_gate_pending", timestamp: "2026-05-24T08:03:00.000Z" },
    { id: "other-apply", taskId: "task_other_123", mode: "sandbox_patch", type: "apply_gate_pending", timestamp: "2026-05-24T08:04:00.000Z" }
  ];

  const compact = significantTimelineEvents(events, {
    limit: 8,
    mode: "review_only",
    taskId: "task_live_123"
  });

  assert.deepEqual(compact.map((event) => event.id), ["evidence", "queued"]);
});

test("significantTimelineEvents excludes patch and apply events from verify feeds", () => {
  const events = [
    { id: "evidence", taskId: "task_live_456", mode: "verify", type: "task_evidence", timestamp: "2026-05-24T08:00:00.000Z" },
    { id: "judge", taskId: "task_live_456", mode: "verify", type: "judge_review", timestamp: "2026-05-24T08:01:00.000Z" },
    { id: "verify", taskId: "task_live_456", mode: "verify", type: "verification_passed", timestamp: "2026-05-24T08:02:00.000Z" },
    { id: "patch", taskId: "task_live_456", mode: "verify", type: "patch_run_ready", timestamp: "2026-05-24T08:03:00.000Z" },
    { id: "apply", taskId: "task_live_456", mode: "verify", type: "apply_gate_pending", timestamp: "2026-05-24T08:04:00.000Z" }
  ];

  const compact = significantTimelineEvents(events, {
    limit: 8,
    mode: "verify",
    taskId: "task_live_456"
  });

  assert.deepEqual(compact.map((event) => event.id), ["verify", "judge", "evidence"]);
});
