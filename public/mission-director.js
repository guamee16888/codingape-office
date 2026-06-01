import { missionModeFromTask, missionProgress, runPhaseFromTask, taskHasEvidencePath } from "./ui-state-map.js";

export const MISSION_PHASE_DIRECTIVES = {
  queued: {
    commandMode: "沙盒排队 · 写入需人工闸门",
    focusNode: "task",
    focusWorkerId: "coding-yuan",
    inspectorTab: "mission",
    nextAction: "把任务分配给编程猿，并先开始只读证据采集。",
    phaseLabel: "排队中",
    roomTitle: "任务已进入队列",
    safetyLine: "还没有执行任何命令。",
    sceneState: "queued",
    workerSignal: "编程猿正在等待分配"
  },
  assigned: {
    commandMode: "沙盒已分配 · 证据优先",
    focusNode: "task",
    focusWorkerId: "coding-yuan",
    inspectorTab: "mission",
    nextAction: "任何补丁规划前，先启动证据采集。",
    phaseLabel: "已分配",
    roomTitle: "编程猿正在阅读任务",
    safetyLine: "当前仍在规划阶段，没有项目写入。",
    sceneState: "assigned",
    workerSignal: "编程猿正在准备工作台"
  },
  evidence_collecting: {
    commandMode: "只读证据采集",
    focusNode: "evidence",
    focusWorkerId: "coding-yuan",
    inspectorTab: "evidence",
    nextAction: "让编程猿完成命令日志和仓库证据采集。",
    phaseLabel: "采集证据",
    roomTitle: "编程猿正在采集证据",
    safetyLine: "这个阶段只允许只读检查。",
    sceneState: "working",
    workerSignal: "编程猿正在收集日志"
  },
  proposal_generating: {
    commandMode: "补丁蓝图 · 仅沙盒",
    focusNode: "proposal",
    focusWorkerId: "coding-yuan",
    inspectorTab: "evidence",
    nextAction: "进入验证前，先复核补丁方案。",
    phaseLabel: "规划补丁",
    roomTitle: "编程猿正在起草补丁方案",
    safetyLine: "方案只是证据产物，项目文件保持不变。",
    sceneState: "working",
    workerSignal: "编程猿正在把证据整理成补丁方案"
  },
  verification_running: {
    commandMode: "验证运行中 · 不部署",
    focusNode: "verification",
    focusWorkerId: "judge-yuan",
    inspectorTab: "evidence",
    nextAction: "等待允许的验证脚本完成。",
    phaseLabel: "验证运行中",
    roomTitle: "审核猿正在检查测试证据",
    safetyLine: "验证不能部署、重启或执行外部副作用。",
    sceneState: "verifying",
    workerSignal: "审核猿正在验证证据包"
  },
  verification_failed: {
    commandMode: "验证失败 · 需要返工",
    focusNode: "verification",
    focusWorkerId: "judge-yuan",
    inspectorTab: "evidence",
    nextAction: "打开证据，查看失败检查，然后要求返工。",
    phaseLabel: "验证失败",
    roomTitle: "审核猿驳回了证据",
    safetyLine: "验证失败会阻止补丁继续推进。",
    sceneState: "failed",
    workerSignal: "审核猿正在暂停这次运行"
  },
  judge_review: {
    commandMode: "审核复核 · 证据支撑",
    focusNode: "judge",
    focusWorkerId: "judge-yuan",
    inspectorTab: "evidence",
    nextAction: "复核审核猿的证据摘要和风险说明。",
    phaseLabel: "审核复核",
    roomTitle: "审核猿正在复核证据包",
    safetyLine: "这次运行仍在人工闸门之后。",
    sceneState: "reviewing",
    workerSignal: "审核猿正在比对证据和策略"
  },
  human_gate: {
    commandMode: "等你审批 · 仍未写入项目",
    focusNode: "human",
    focusWorkerId: "judge-yuan",
    inspectorTab: "gate",
    nextAction: "先看证据和 Diff；不确定就返工。",
    phaseLabel: "等待你审批",
    roomTitle: "等待你确认下一步",
    safetyLine: "你批准前不会进入沙盒补丁预检。",
    sceneState: "waiting-human",
    workerSignal: "审核猿把证据交给你"
  },
  patch_running: {
    commandMode: "补丁预检 · 沙盒包",
    focusNode: "patch",
    focusWorkerId: "coding-yuan",
    inspectorTab: "evidence",
    nextAction: "让编程猿打包沙盒补丁和回滚快照。",
    phaseLabel: "补丁预检",
    roomTitle: "编程猿正在打包沙盒补丁",
    safetyLine: "补丁执行器只写审核产物，不写项目文件。",
    sceneState: "working",
    workerSignal: "编程猿正在写入沙盒包"
  },
  diff_ready: {
    commandMode: "沙盒差异就绪 · 仅供复核",
    focusNode: "diff",
    focusWorkerId: "coding-yuan",
    inspectorTab: "evidence",
    nextAction: "进入写入闸门前，先打开证据并检查差异预览。",
    phaseLabel: "差异就绪",
    roomTitle: "编程猿已准备好差异预览",
    safetyLine: "沙盒补丁已生成，项目文件未被改动。",
    sceneState: "diff-ready",
    workerSignal: "编程猿正在展示补丁档案"
  },
  apply_blocked: {
    commandMode: "等待写入确认 · 默认不改代码",
    focusNode: "apply",
    focusWorkerId: "ops-yuan",
    inspectorTab: "gate",
    nextAction: "看 Diff；确认前保持阻断。",
    phaseLabel: "等待写入确认",
    roomTitle: "可以检查，但还没写入",
    safetyLine: "现在没有改项目文件；确认语通过前不会修改项目文件。",
    sceneState: "blocked",
    workerSignal: "运维猿守住 Apply Gate"
  },
  completed: {
    commandMode: "任务完成 · 证据已归档",
    focusNode: "report",
    focusWorkerId: "coding-yuan",
    inspectorTab: "evidence",
    nextAction: "复核报告、Diff 和回滚位置。",
    phaseLabel: "已完成",
    roomTitle: "报告已生成",
    safetyLine: "任务完成由已记录证据支撑。",
    sceneState: "completed",
    workerSignal: "编程猿提交报告"
  },
  failed: {
    commandMode: "任务失败 · 需要人工复核",
    focusNode: "report",
    focusWorkerId: "ops-yuan",
    inspectorTab: "gate",
    nextAction: "检查失败证据，并保持风险动作阻断。",
    phaseLabel: "失败",
    roomTitle: "运维猿正在隔离失败运行",
    safetyLine: "失败任务仍会阻断直接写入。",
    sceneState: "failed",
    workerSignal: "运维猿正在保存失败证据"
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
  if (task?.result?.applyStatus === "applied") return "已写入";
  if (task?.result?.applyStatus === "requires_confirmation") return "需要确认";
  if (task?.result?.applyStatus === "blocked") return "已阻断";
  if (task?.result?.humanGateStatus === "approved") return "已批准";
  if (task?.result?.humanGateStatus === "changes_requested") return "返工";
  return "等待中";
}

function humanGateStatus(task) {
  if (task?.result?.humanGateStatus === "approved") return "已批准";
  if (task?.result?.humanGateStatus === "changes_requested") return "返工";
  if (task?.result?.verificationStatus === "passed") return "等待中";
  return "待处理";
}

function applyGateStatus(task) {
  if (task?.result?.applyStatus === "applied") return "已写入";
  if (task?.result?.applyStatus === "requires_confirmation") return "需要确认";
  if (task?.result?.applyStatus === "blocked") return "已阻断";
  if (hasTaskPath(task, "applyRun", "data/patch-applies/")) return "已检查";
  return "默认阻断";
}

function inspectorTitleForDirective(directive) {
  const labels = {
    evidence: "证据检查器",
    gate: "闸门检查器",
    mission: "任务检查器"
  };
  return labels[directive.inspectorTab] || "任务检查器";
}

export function missionDirectorForTask(task, options = {}) {
  const phase = runPhaseFromTask(task);
  const mode = missionModeFromTask(task);
  const modeDirective = mode === "review_only" && taskHasEvidencePath(task, "data/evidence/")
    ? {
        ...MISSION_PHASE_DIRECTIVES.evidence_collecting,
        commandMode: "只读证据已完成 · 本次不生成补丁",
        nextAction: "打开证据包复核；如果要继续，再切换到方案或完整沙盒闭环模式。",
        phaseLabel: "证据已采集",
        roomTitle: "编程猿已完成只读证据采集",
        safetyLine: "本次没有生成补丁、没有运行验证、没有修改项目文件。",
        workerSignal: "编程猿正在把证据交给你复核"
      }
    : null;
  const directive = modeDirective || MISSION_PHASE_DIRECTIVES[phase] || MISSION_PHASE_DIRECTIVES.assigned;
  const applyRunnerEnabled = Boolean(options.applyRunnerEnabled);
  const commandMode = applyRunnerEnabled && phase === "apply_blocked"
    ? "写入执行器已准备 · 仍需要精确确认"
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
