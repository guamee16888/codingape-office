import {
  missionModeFromTask,
  missionProgress,
  runPhaseFromTask,
  taskHasEvidencePath
} from "./ui-state-map.js";
import { taskIdFromTimelineEvent } from "./timeline-router.js";
import {
  fallbackWorkerAvatar,
  workerAnimationForState,
  workerLightForState,
  workerStateForRunPhase
} from "./worker-avatar-runtime.js";

function statusFromBoolean(value) {
  return value ? "ok" : "pending";
}

export function coreWorkerState(worker, task) {
  const phase = runPhaseFromTask(task);
  const mode = missionModeFromTask(task);
  if (!worker) return "idle";
  if (worker.id === "coding-yuan") {
    if (["queued", "assigned"].includes(phase)) return "assigned";
    if (["evidence_collecting", "proposal_generating", "verification_running", "patch_running"].includes(phase)) return "working";
    if (phase === "diff_ready") return "completed";
    if (phase === "apply_blocked") return "waiting_approval";
    if (phase === "failed") return "failed";
  }
  if (worker.id === "judge-yuan") {
    if (mode === "review_only") return "idle";
    if (mode === "proposal" && (task?.proposal || taskHasEvidencePath(task, "data/proposals/"))) return "reviewing";
    if (["judge_review", "verification_running"].includes(phase)) return "reviewing";
    if (["human_gate", "apply_blocked"].includes(phase)) return "waiting_approval";
    if (phase === "failed") return "blocked";
  }
  if (worker.id === "ops-yuan") {
    if (["review_only", "proposal", "verify"].includes(mode)) return "idle";
    if (["patch_running", "diff_ready"].includes(phase)) return "monitoring";
    if (phase === "apply_blocked") return "blocked";
    if (phase === "completed") return "completed";
  }
  return worker.status === "working" || worker.status === "running" ? "working" : "idle";
}

export function coreWorkerAction(worker, task) {
  const phase = runPhaseFromTask(task);
  const mode = missionModeFromTask(task);
  if (!worker) return "Idle";
  if (worker.id === "coding-yuan") {
    if (phase === "evidence_collecting") return mode === "review_only" ? "Read-only evidence captured" : "Collecting command evidence";
    if (phase === "proposal_generating") return "Drafting patch blueprint";
    if (phase === "verification_running") return "Running allowlisted verification";
    if (phase === "patch_running") return "Packaging sandbox patch";
    if (phase === "diff_ready") return "Sandbox diff is ready";
    if (phase === "apply_blocked") return "Waiting for human write decision";
  }
  if (worker.id === "judge-yuan") {
    if (mode === "review_only") return "Standing by until a plan needs review";
    if (mode === "proposal") return "Reviewing plan sidecar; no write triggered";
    if (mode === "verify") return "Reviewing plan and verifying evidence";
    if (phase === "human_gate") return "Waiting for human approval";
    if (phase === "apply_blocked") return "Explaining Apply Gate blocker";
    if (phase === "judge_review") return "Reviewing Evidence Pack";
    if (phase === "verification_running") return "Checking test evidence";
  }
  if (worker.id === "ops-yuan") {
    if (mode === "review_only") return "Apply Gate not used in this run";
    if (mode === "proposal") return "Standing by during proposal; writes blocked by default";
    if (mode === "verify") return "Standing by during verification; no write execution";
    if (phase === "apply_blocked") return "Policy blocked direct write";
    if (phase === "diff_ready") return "Rollback snapshot ready";
    if (phase === "patch_running") return "Monitoring patch preflight";
  }
  return worker.currentTask || "Idle";
}

export function workerStationTelemetry(worker, task) {
  const mode = missionModeFromTask(task);
  const evidenceReady = taskHasEvidencePath(task, "data/evidence/");
  const proposalReady = Boolean(task?.proposal || taskHasEvidencePath(task, "data/proposals/"));
  const verificationStatus = task?.result?.verificationStatus || (task?.verification ? "passed" : "not_run");
  const patchStatus = task?.result?.patchRunStatus || "not_run";
  const applyStatus = task?.result?.applyStatus || "not_run";
  const humanStatus = task?.result?.humanGateStatus || "pending";

  if (worker?.id === "coding-yuan") {
    return [
      { label: "Evidence", status: statusFromBoolean(evidenceReady), value: evidenceReady ? "Captured" : "Waiting" },
      { label: "Plan", status: statusFromBoolean(proposalReady), value: proposalReady ? "Ready" : "Waiting" },
      { label: "Patch", status: patchStatus === "sandbox_written" ? "ok" : patchStatus === "blocked" ? "danger" : "pending", value: patchStatus }
    ];
  }

  if (worker?.id === "judge-yuan") {
    if (mode === "review_only") {
      return [
        { label: "Mode", status: "info", value: "Standing by this run" },
        { label: "Verification", status: "pending", value: "Not run this time" },
        { label: "Write", status: "pending", value: "No write this time" }
      ];
    }
    return [
      { label: "Verification", status: verificationStatus === "passed" ? "ok" : verificationStatus === "failed" ? "danger" : "pending", value: verificationStatus },
      { label: "Human", status: humanStatus === "approved" ? "ok" : humanStatus === "changes_requested" ? "danger" : "warn", value: humanStatus },
      { label: "Write", status: applyStatus === "applied" ? "ok" : applyStatus === "requires_confirmation" || applyStatus === "blocked" ? "warn" : "pending", value: applyStatus }
    ];
  }

  if (worker?.id === "ops-yuan") {
    if (["review_only", "proposal", "verify"].includes(mode)) {
      return [
        { label: "Mode", status: "info", value: "Standing by this run" },
        { label: "Write", status: "pending", value: "No write this time" },
        { label: "Gate", status: "ok", value: "Blocked by default" }
      ];
    }
    return [
      { label: "Rollback", status: patchStatus === "sandbox_written" ? "ok" : "pending", value: patchStatus === "sandbox_written" ? "Ready" : "Waiting" },
      { label: "Write", status: applyStatus === "applied" ? "ok" : applyStatus === "requires_confirmation" || applyStatus === "blocked" ? "danger" : "pending", value: applyStatus },
      { label: "Progress", status: "info", value: `${missionProgress(task)}%` }
    ];
  }

  return [
    { label: "Queue", status: "info", value: String(worker?.queue || 0) },
    { label: "Risk", status: worker?.risk === "high" ? "warn" : "ok", value: worker?.risk || "low" },
    { label: "Run", status: task ? "ok" : "pending", value: task ? "active" : "idle" }
  ];
}

function stationGateStatus(task) {
  if (task?.result?.applyStatus === "applied") return "applied";
  if (task?.result?.applyStatus === "requires_confirmation") return "requires_confirmation";
  if (task?.result?.applyStatus === "blocked") return "blocked";
  if (task?.result?.humanGateStatus === "approved") return "human_approved";
  if (task?.result?.humanGateStatus === "changes_requested") return "changes_requested";
  if (task?.result?.verificationStatus === "passed") return "waiting_human";
  return "pending";
}

function stationEventAffinity(worker, event) {
  if (!worker || !event) return 0;
  const type = event.type || "";

  let roleScore = 0;
  if (worker.id === "coding-yuan") {
    if (type === "patch_run_ready") roleScore = 95;
    else if (type === "human_gate_approved") roleScore = 90;
    else if (type === "verification_passed") roleScore = 80;
    else if (type === "patch_plan") roleScore = 70;
    else if (type === "task_evidence") roleScore = 60;
    else if (type === "task_completed") roleScore = 45;
    else if (type.startsWith("task_")) roleScore = 40;
  }

  if (worker.id === "judge-yuan") {
    if (type === "apply_gate_pending") roleScore = 95;
    else if (type === "patch_run_blocked") roleScore = 90;
    else if (type.includes("human_gate")) roleScore = 85;
    else if (type === "judge_review") roleScore = 80;
    else if (type === "verification_blocked") roleScore = 75;
    else if (type.includes("judge")) roleScore = 70;
  }

  if (worker.id === "ops-yuan") {
    if (type === "apply_gate_pending") roleScore = 100;
    else if (type === "patch_run_blocked") roleScore = 95;
    else if (type === "patch_run_ready") roleScore = 85;
    else if (/rollback|blocked|failed/.test(type)) roleScore = 80;
    else if (type === "task_completed") roleScore = 45;
  }

  if (!roleScore) return 0;
  return roleScore + (event.workerId === worker.id ? 30 : 0);
}

function eventBelongsToTask(event, task) {
  if (!task?.id || !event) return true;
  if (taskIdFromTimelineEvent(event) === task.id) return true;
  if (event.title?.includes(task.title || task.id)) return true;
  return (event.evidence || []).some((path) => String(path).includes(task.id));
}

function eventTimestamp(event) {
  const timestamp = Date.parse(event?.timestamp || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function selectStationEvent(events = [], worker, selectedProject, task) {
  return events
    .filter((event) => {
      if (selectedProject?.id && event.projectId !== selectedProject.id) return false;
      if (!eventBelongsToTask(event, task)) return false;
      return stationEventAffinity(worker, event) > 0;
    })
    .map((event) => ({
      event,
      score: stationEventAffinity(worker, event),
      timestamp: eventTimestamp(event)
    }))
    .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)[0]?.event || null;
}

export function workerStationModel(worker, task, event = null) {
  const state = coreWorkerState(worker, task);
  const phase = runPhaseFromTask(task);
  const runtimeState = workerStateForRunPhase(phase, worker?.id, { hasActiveTask: Boolean(task) });
  const light = workerLightForState(runtimeState);
  return {
    action: coreWorkerAction(worker, task),
    animation: workerAnimationForState(runtimeState),
    eventId: event?.id || "",
    eventTitle: event?.title || "",
    eventType: event?.type || "",
    fallbackAvatar: fallbackWorkerAvatar(worker),
    gateStatus: stationGateStatus(task),
    id: worker?.id || "worker",
    light,
    mark: worker?.mark || "A",
    name: worker?.name || "Worker",
    phase,
    progress: missionProgress(task),
    riskLevel: task?.risk || worker?.risk || "low",
    runId: task?.id || "no active run",
    runtimeState,
    state,
    telemetry: workerStationTelemetry(worker, task)
  };
}
