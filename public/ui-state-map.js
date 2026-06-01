export function taskHasEvidencePath(task, prefix) {
  return Boolean(task?.evidence?.some((item) => String(item).startsWith(prefix)));
}

export function taskEventTime(task) {
  const timestamp = Date.parse(
    task?.updatedAt ||
      task?.completedAt ||
      task?.startedAt ||
      task?.createdAt ||
      ""
  );
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function latestTaskForProject(tasks = [], projectId = "") {
  const candidates = tasks.filter((task) => !projectId || task.projectId === projectId);
  return [...candidates]
    .sort((a, b) => taskEventTime(b) - taskEventTime(a) || String(b.id || "").localeCompare(String(a.id || "")))[0] || null;
}

export function missionModeFromTask(task) {
  const source = String(task?.source || "");
  if (!source.startsWith("mission_")) return "sandbox_patch";
  return source.replace("mission_", "") || "sandbox_patch";
}

export function runPhaseFromTask(task) {
  if (!task) return "queued";
  const mode = missionModeFromTask(task);
  if (task.result?.applyStatus === "applied") return "completed";
  if (task.result?.applyStatus === "requires_confirmation") return "apply_blocked";
  if (task.result?.applyStatus === "blocked") return "apply_blocked";
  if (task.result?.patchRunStatus === "sandbox_written") return "diff_ready";
  if (task.result?.patchRunStatus === "blocked") return "failed";
  if (task.result?.humanGateStatus === "approved") return "patch_running";
  if (task.result?.humanGateStatus === "changes_requested") return "failed";
  if (task.result?.verificationStatus === "passed") return "human_gate";
  if (task.result?.verificationStatus === "failed") return "verification_failed";
  if (taskHasEvidencePath(task, "data/verifications/") || task.verification) return "verification_running";
  if (task.proposal || taskHasEvidencePath(task, "data/proposals/")) return "judge_review";
  if (taskHasEvidencePath(task, "data/evidence/")) return mode === "review_only" ? "evidence_collecting" : "proposal_generating";
  if (task.status === "running") return "evidence_collecting";
  if (task.status === "queued") return "queued";
  if (task.status === "blocked") return "failed";
  return "assigned";
}

export function missionProgress(task) {
  const phase = runPhaseFromTask(task);
  const order = [
    "queued",
    "assigned",
    "evidence_collecting",
    "proposal_generating",
    "verification_running",
    "judge_review",
    "human_gate",
    "patch_running",
    "diff_ready",
    "apply_blocked",
    "completed"
  ];
  const index = Math.max(0, order.indexOf(phase));
  return Math.min(100, Math.round((index / (order.length - 1)) * 100));
}

export function flowStatusForNode(task, node) {
  const phase = runPhaseFromTask(task);
  const hasEvidence = taskHasEvidencePath(task, "data/evidence/");
  const hasProposal = Boolean(task?.proposal || taskHasEvidencePath(task, "data/proposals/"));
  const hasVerification = Boolean(task?.verification || taskHasEvidencePath(task, "data/verifications/"));
  const hasPatchRun = Boolean(task?.patchRun || taskHasEvidencePath(task, "data/patch-runs/"));
  const hasApplyGate = Boolean(task?.applyRun || taskHasEvidencePath(task, "data/patch-applies/"));

  if (!task) return "pending";
  if (node.id === "task") return task.status === "running" ? "running" : "passed";
  if (node.id === "evidence") return hasEvidence ? "passed" : phase === "evidence_collecting" ? "running" : "pending";
  if (node.id === "proposal") return hasProposal ? "passed" : phase === "proposal_generating" ? "running" : "pending";
  if (node.id === "verification") {
    if (task.result?.verificationStatus === "passed") return "passed";
    if (task.result?.verificationStatus === "failed") return "failed";
    return hasVerification || phase === "verification_running" ? "running" : "pending";
  }
  if (node.id === "judge") {
    if (task.result?.humanGateStatus === "changes_requested") return "failed";
    if (task.result?.humanGateStatus === "approved") return "passed";
    return hasProposal ? "running" : "pending";
  }
  if (node.id === "human") {
    if (task.result?.humanGateStatus === "approved") return "passed";
    if (task.result?.humanGateStatus === "changes_requested") return "failed";
    return task.result?.verificationStatus === "passed" || hasProposal ? "waiting_human" : "pending";
  }
  if (node.id === "patch") {
    if (task.result?.patchRunStatus === "sandbox_written" || task.result?.patchRunStatus === "dry_run") return "passed";
    if (task.result?.patchRunStatus === "blocked") return "blocked";
    return task.result?.humanGateStatus === "approved" ? "running" : "pending";
  }
  if (node.id === "diff") return hasPatchRun && task.result?.patchRunStatus === "sandbox_written" ? "passed" : "pending";
  if (node.id === "apply") {
    if (task.result?.applyStatus === "applied") return "passed";
    if (task.result?.applyStatus === "blocked" || task.result?.applyStatus === "requires_confirmation") return "blocked";
    return hasApplyGate ? "waiting_human" : "pending";
  }
  if (node.id === "report") return task.result?.applyStatus || task.result?.patchRunStatus ? "passed" : "pending";
  return "pending";
}

export const COMPACT_MISSION_FLOW_NODES = [
  { id: "task", label: "Task" },
  { id: "evidence", label: "Evidence" },
  { id: "verification", label: "Verification" },
  { id: "judge", label: "Judge Review" },
  { id: "apply", label: "Apply Gate" }
];

export const PREMIUM_MISSION_FLOW_NODES = [
  { id: "task", label: "Task" },
  { id: "evidence", label: "Evidence" },
  { id: "proposal", label: "Proposal" },
  { id: "verification", label: "Verification" },
  { id: "judge", label: "Judge Review" },
  { id: "human", label: "Human Gate" },
  { id: "patch", label: "Sandbox Patch" },
  { id: "diff", label: "Diff Preview" },
  { id: "apply", label: "Apply Gate" },
  { id: "report", label: "Report" }
];

const COMPACT_FOCUS_ALIASES = {
  assigned: "task",
  queued: "task",
  proposal: "evidence",
  patch: "evidence",
  diff: "evidence",
  human: "judge",
  report: "apply"
};

export function visibleMissionFlowNodeId(focusNode) {
  const normalized = String(focusNode || "");
  return COMPACT_FOCUS_ALIASES[normalized] || normalized;
}

export function premiumMissionFlowNodeId(focusNode) {
  const normalized = String(focusNode || "");
  if (normalized === "queued" || normalized === "assigned") return "task";
  return PREMIUM_MISSION_FLOW_NODES.some((node) => node.id === normalized) ? normalized : "task";
}

function strongestStatus(statuses) {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("waiting_human")) return "waiting_human";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("passed")) return "passed";
  return "pending";
}

export function compactFlowStatusForNode(task, node) {
  const nodeId = typeof node === "string" ? node : node?.id;
  const mode = missionModeFromTask(task);

  if (!task) return "pending";
  if (nodeId === "task") return flowStatusForNode(task, { id: "task" });
  if (nodeId === "verification") return flowStatusForNode(task, { id: "verification" });
  if (nodeId === "apply") return flowStatusForNode(task, { id: "apply" });
  if (nodeId === "evidence") {
    const evidenceNodes = mode === "review_only"
      ? ["evidence"]
      : mode === "proposal" || mode === "verify"
        ? ["evidence", "proposal"]
        : ["evidence", "proposal", "patch", "diff"];
    return strongestStatus(evidenceNodes.map((id) => flowStatusForNode(task, { id })));
  }
  if (nodeId === "judge") {
    return strongestStatus(["judge", "human"].map((id) => flowStatusForNode(task, { id })));
  }

  return flowStatusForNode(task, { id: nodeId });
}
