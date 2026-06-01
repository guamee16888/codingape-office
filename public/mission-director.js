import { missionModeFromTask, missionProgress, runPhaseFromTask, taskHasEvidencePath } from "./ui-state-map.js";

export const MISSION_PHASE_DIRECTIVES = {
  queued: {
    commandMode: "Sandbox queue · Human Gate required",
    focusNode: "task",
    focusWorkerId: "coding-yuan",
    inspectorTab: "mission",
    nextAction: "Assign the task to Codingape and start read-only evidence collection first.",
    phaseLabel: "Queued",
    roomTitle: "Task is queued",
    safetyLine: "No command has run yet.",
    sceneState: "queued",
    workerSignal: "Codingape is waiting for assignment"
  },
  assigned: {
    commandMode: "Sandbox assigned · Evidence first",
    focusNode: "task",
    focusWorkerId: "coding-yuan",
    inspectorTab: "mission",
    nextAction: "Start evidence collection before any patch planning.",
    phaseLabel: "Assigned",
    roomTitle: "Codingape is reading the task",
    safetyLine: "This is still planning; no project write has happened.",
    sceneState: "assigned",
    workerSignal: "Codingape is preparing the workstation"
  },
  evidence_collecting: {
    commandMode: "Read-only evidence collection",
    focusNode: "evidence",
    focusWorkerId: "coding-yuan",
    inspectorTab: "evidence",
    nextAction: "Let Codingape finish command logs and repository evidence.",
    phaseLabel: "Collecting evidence",
    roomTitle: "Codingape is collecting evidence",
    safetyLine: "Only read-only checks are allowed in this phase.",
    sceneState: "working",
    workerSignal: "Codingape is collecting logs"
  },
  proposal_generating: {
    commandMode: "Patch blueprint · Sandbox only",
    focusNode: "proposal",
    focusWorkerId: "coding-yuan",
    inspectorTab: "evidence",
    nextAction: "Review the patch plan before verification.",
    phaseLabel: "Planning patch",
    roomTitle: "Codingape is drafting the patch plan",
    safetyLine: "The plan is evidence only; project files stay unchanged.",
    sceneState: "working",
    workerSignal: "Codingape is turning evidence into a patch plan"
  },
  verification_running: {
    commandMode: "Verification running · No deploy",
    focusNode: "verification",
    focusWorkerId: "judge-yuan",
    inspectorTab: "evidence",
    nextAction: "Wait for the allowed verification script to finish.",
    phaseLabel: "Verification running",
    roomTitle: "Judgeape is checking test evidence",
    safetyLine: "Verification cannot deploy, restart, or run external side effects.",
    sceneState: "verifying",
    workerSignal: "Judgeape is verifying the Evidence Pack"
  },
  verification_failed: {
    commandMode: "Verification failed · Rework needed",
    focusNode: "verification",
    focusWorkerId: "judge-yuan",
    inspectorTab: "evidence",
    nextAction: "Open evidence, review the failed check, then request rework.",
    phaseLabel: "Verification failed",
    roomTitle: "Judgeape rejected the evidence",
    safetyLine: "Failed verification stops the patch from advancing.",
    sceneState: "failed",
    workerSignal: "Judgeape is pausing this run"
  },
  judge_review: {
    commandMode: "Judge review · Evidence-backed",
    focusNode: "judge",
    focusWorkerId: "judge-yuan",
    inspectorTab: "evidence",
    nextAction: "Review Judgeape's evidence summary and risk notes.",
    phaseLabel: "Judge review",
    roomTitle: "Judgeape is reviewing the Evidence Pack",
    safetyLine: "This run is still behind the Human Gate.",
    sceneState: "reviewing",
    workerSignal: "Judgeape is comparing evidence and policy"
  },
  human_gate: {
    commandMode: "Waiting for approval · No project write",
    focusNode: "human",
    focusWorkerId: "judge-yuan",
    inspectorTab: "gate",
    nextAction: "Review evidence and diff first; request rework if unsure.",
    phaseLabel: "Waiting for approval",
    roomTitle: "Waiting for your next decision",
    safetyLine: "Sandbox patch preflight will not start before approval.",
    sceneState: "waiting-human",
    workerSignal: "Judgeape handed the evidence to you"
  },
  patch_running: {
    commandMode: "Patch preflight · Sandbox package",
    focusNode: "patch",
    focusWorkerId: "coding-yuan",
    inspectorTab: "evidence",
    nextAction: "Let Codingape package the sandbox patch and rollback snapshot.",
    phaseLabel: "Patch preflight",
    roomTitle: "Codingape is packaging the sandbox patch",
    safetyLine: "The patch runner writes review artifacts only, not project files.",
    sceneState: "working",
    workerSignal: "Codingape is writing the sandbox package"
  },
  diff_ready: {
    commandMode: "Sandbox diff ready · Review only",
    focusNode: "diff",
    focusWorkerId: "coding-yuan",
    inspectorTab: "evidence",
    nextAction: "Open evidence and inspect the diff preview before Apply Gate.",
    phaseLabel: "Diff ready",
    roomTitle: "Codingape prepared the diff preview",
    safetyLine: "Sandbox patch is generated; project files are unchanged.",
    sceneState: "diff-ready",
    workerSignal: "Codingape is presenting the patch archive"
  },
  apply_blocked: {
    commandMode: "Waiting for write confirmation · No auto-write",
    focusNode: "apply",
    focusWorkerId: "ops-yuan",
    inspectorTab: "gate",
    nextAction: "Review the diff; keep blocked until confirmation.",
    phaseLabel: "Waiting for write confirmation",
    roomTitle: "Ready to inspect; nothing written yet",
    safetyLine: "Project files have not changed; no write before the confirmation phrase passes.",
    sceneState: "blocked",
    workerSignal: "Opsape is holding Apply Gate"
  },
  completed: {
    commandMode: "Task complete · Evidence archived",
    focusNode: "report",
    focusWorkerId: "coding-yuan",
    inspectorTab: "evidence",
    nextAction: "Review the report, diff, and rollback location.",
    phaseLabel: "Completed",
    roomTitle: "Report generated",
    safetyLine: "Task completion is backed by recorded evidence.",
    sceneState: "completed",
    workerSignal: "Codingape submitted the report"
  },
  failed: {
    commandMode: "Task failed · Human review needed",
    focusNode: "report",
    focusWorkerId: "ops-yuan",
    inspectorTab: "gate",
    nextAction: "Inspect the failed evidence and keep risky actions blocked.",
    phaseLabel: "Failed",
    roomTitle: "Opsape is isolating the failed run",
    safetyLine: "Failed tasks still block direct writes.",
    sceneState: "failed",
    workerSignal: "Opsape is preserving failed-run evidence"
  }
};

function evidenceStatus(task) {
  return taskHasEvidencePath(task, "data/evidence/") ? "captured" : "missing";
}

function hasTaskPath(task, key, prefix) {
  return Boolean(task?.[key] || taskHasEvidencePath(task, prefix));
}

function evidenceCompleteness(task) {
  const checks = [
    taskHasEvidencePath(task, "data/evidence/"),
    hasTaskPath(task, "proposal", "data/proposals/"),
    hasTaskPath(task, "verification", "data/verifications/"),
    Boolean(task?.result?.humanGateStatus),
    hasTaskPath(task, "patchRun", "data/patch-runs/"),
    hasTaskPath(task, "applyRun", "data/patch-applies/")
  ];
  const completed = checks.filter(Boolean).length;
  const total = checks.length;
  return {
    completed,
    label: `${completed}/${total}`,
    percent: Math.round((completed / total) * 100),
    total
  };
}

function gateStatus(task) {
  if (task?.result?.applyStatus === "applied") return "Applied";
  if (task?.result?.applyStatus === "requires_confirmation") return "Requires confirmation";
  if (task?.result?.applyStatus === "blocked") return "Blocked";
  if (task?.result?.humanGateStatus === "approved") return "Approved";
  if (task?.result?.humanGateStatus === "changes_requested") return "Rework requested";
  return "Waiting";
}

function humanGateStatus(task) {
  if (task?.result?.humanGateStatus === "approved") return "Approved";
  if (task?.result?.humanGateStatus === "changes_requested") return "Rework requested";
  if (task?.result?.verificationStatus === "passed") return "Waiting";
  return "Pending";
}

function applyGateStatus(task) {
  if (task?.result?.applyStatus === "applied") return "Applied";
  if (task?.result?.applyStatus === "requires_confirmation") return "Requires confirmation";
  if (task?.result?.applyStatus === "blocked") return "Blocked";
  if (hasTaskPath(task, "applyRun", "data/patch-applies/")) return "Checked";
  return "Blocked by default";
}

function inspectorTitleForDirective(directive) {
  const labels = {
    evidence: "Evidence Inspector",
    gate: "Gate Inspector",
    mission: "Mission Inspector"
  };
  return labels[directive.inspectorTab] || "Mission Inspector";
}

export function missionDirectorForTask(task, options = {}) {
  const phase = runPhaseFromTask(task);
  const mode = missionModeFromTask(task);
  const modeDirective = mode === "review_only" && taskHasEvidencePath(task, "data/evidence/")
    ? {
        ...MISSION_PHASE_DIRECTIVES.evidence_collecting,
        commandMode: "Read-only evidence complete · No patch this run",
        nextAction: "Open the Evidence Pack; switch to proposal or full sandbox loop if you want to continue.",
        phaseLabel: "Evidence captured",
        roomTitle: "Codingape completed read-only evidence collection",
        safetyLine: "This run generated no patch, ran no verification, and modified no project files.",
        workerSignal: "Codingape is handing you the evidence for review"
      }
    : null;
  const directive = modeDirective || MISSION_PHASE_DIRECTIVES[phase] || MISSION_PHASE_DIRECTIVES.assigned;
  const applyRunnerEnabled = Boolean(options.applyRunnerEnabled);
  const commandMode = applyRunnerEnabled && phase === "apply_blocked"
    ? "Apply runner ready · Exact confirmation still required"
    : directive.commandMode;

  return {
    commandMode,
    applyGateStatus: applyGateStatus(task),
    evidenceCompleteness: evidenceCompleteness(task),
    evidenceStatus: evidenceStatus(task),
    focusNode: directive.focusNode,
    focusWorkerId: directive.focusWorkerId,
    gateStatus: gateStatus(task),
    humanGateStatus: humanGateStatus(task),
    inspectorTab: directive.inspectorTab,
    inspectorTitle: inspectorTitleForDirective(directive),
    nextAction: directive.nextAction,
    phase,
    phaseLabel: directive.phaseLabel,
    progress: modeDirective ? 35 : missionProgress(task),
    roomTitle: directive.roomTitle,
    runId: task?.id || "no active run",
    safetyLine: directive.safetyLine,
    sceneState: directive.sceneState,
    taskTitle: task?.title || options.project?.task?.current || "Waiting for mission",
    workerSignal: directive.workerSignal
  };
}
