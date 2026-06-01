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
  if (!worker) return "待命";
  if (worker.id === "coding-yuan") {
    if (phase === "evidence_collecting") return mode === "review_only" ? "只读证据已采集" : "采集命令证据";
    if (phase === "proposal_generating") return "起草补丁蓝图";
    if (phase === "verification_running") return "运行白名单验证";
    if (phase === "patch_running") return "打包沙盒补丁";
    if (phase === "diff_ready") return "沙盒差异已就绪";
    if (phase === "apply_blocked") return "等待人工写入决定";
  }
  if (worker.id === "judge-yuan") {
    if (mode === "review_only") return "本次不参与，等待需要审查的方案";
    if (mode === "proposal") return "旁路审查方案，不触发写入";
    if (mode === "verify") return "审查方案并验证证据";
    if (phase === "human_gate") return "等待人工审批";
    if (phase === "apply_blocked") return "解释写入闸门阻断原因";
    if (phase === "judge_review") return "审核证据包";
    if (phase === "verification_running") return "检查测试证据";
  }
  if (worker.id === "ops-yuan") {
    if (mode === "review_only") return "本次不进入写入闸门";
    if (mode === "proposal") return "方案阶段待命，写入仍默认阻断";
    if (mode === "verify") return "验证阶段待命，不执行写入";
    if (phase === "apply_blocked") return "策略已阻断直接写入";
    if (phase === "diff_ready") return "回滚快照就绪";
    if (phase === "patch_running") return "监控补丁预检";
  }
  return worker.currentTask || "待命";
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
      { label: "证据", status: statusFromBoolean(evidenceReady), value: evidenceReady ? "已采集" : "等待中" },
      { label: "方案", status: statusFromBoolean(proposalReady), value: proposalReady ? "就绪" : "等待中" },
      { label: "补丁", status: patchStatus === "sandbox_written" ? "ok" : patchStatus === "blocked" ? "danger" : "pending", value: patchStatus }
    ];
  }

  if (worker?.id === "judge-yuan") {
    if (mode === "review_only") {
      return [
        { label: "模式", status: "info", value: "本次待命" },
        { label: "验证", status: "pending", value: "本次不跑" },
        { label: "写入", status: "pending", value: "本次不写" }
      ];
    }
    return [
      { label: "验证", status: verificationStatus === "passed" ? "ok" : verificationStatus === "failed" ? "danger" : "pending", value: verificationStatus },
      { label: "人工", status: humanStatus === "approved" ? "ok" : humanStatus === "changes_requested" ? "danger" : "warn", value: humanStatus },
      { label: "写入", status: applyStatus === "applied" ? "ok" : applyStatus === "requires_confirmation" || applyStatus === "blocked" ? "warn" : "pending", value: applyStatus }
    ];
  }

  if (worker?.id === "ops-yuan") {
    if (["review_only", "proposal", "verify"].includes(mode)) {
      return [
        { label: "模式", status: "info", value: "本次待命" },
        { label: "写入", status: "pending", value: "本次不写" },
        { label: "闸门", status: "ok", value: "默认阻断" }
      ];
    }
    return [
      { label: "回滚", status: patchStatus === "sandbox_written" ? "ok" : "pending", value: patchStatus === "sandbox_written" ? "就绪" : "等待中" },
      { label: "写入", status: applyStatus === "applied" ? "ok" : applyStatus === "requires_confirmation" || applyStatus === "blocked" ? "danger" : "pending", value: applyStatus },
      { label: "进度", status: "info", value: `${missionProgress(task)}%` }
    ];
  }

  return [
    { label: "队列", status: "info", value: String(worker?.queue || 0) },
    { label: "风险", status: worker?.risk === "high" ? "warn" : "ok", value: worker?.risk || "low" },
    { label: "运行", status: task ? "ok" : "pending", value: task ? "active" : "idle" }
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
    mark: worker?.mark || "猿",
    name: worker?.name || "员工",
    phase,
    progress: missionProgress(task),
    riskLevel: task?.risk || worker?.risk || "low",
    runId: task?.id || "no active run",
    runtimeState,
    state,
    telemetry: workerStationTelemetry(worker, task)
  };
}
