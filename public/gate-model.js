export function affectedFilesFromTask(task) {
  if (!task) return [];
  const files = [
    ...(task.patchCandidates || []),
    ...(task.patchDrafts || []).map((draft) => draft.file),
    ...(task.result?.affectedFiles || [])
  ].filter(Boolean);

  if (!files.length && Number(task.result?.changedFiles || 0) > 0) {
    return [`检测到 ${task.result.changedFiles} 个变更文件信号`];
  }

  return [...new Set(files)];
}

export function gateModelFromTask(task) {
  const affectedFiles = affectedFilesFromTask(task);
  const verificationStatus = task?.result?.verificationStatus || (task?.verification ? "passed" : "not_run");
  const humanGateStatus = task?.result?.humanGateStatus || "pending";
  const patchStatus = task?.result?.patchRunStatus || "not_run";
  const applyStatus = task?.result?.applyStatus || "not_run";
  const hasPatchRun = Boolean(task?.patchRun || task?.result?.patchRunPath || patchStatus !== "not_run");
  const applyRunnerEnabled = Boolean(task?.result?.applyRunnerEnabled);

  return {
    affectedFiles,
    applyRunnerEnabled,
    applyStatus,
    canReviewPatch: hasPatchRun,
    canRunApplyGate: hasPatchRun,
    directWritesBlocked: applyStatus !== "applied",
    hasRollback: Boolean(task?.result?.rollbackSnapshotPath || task?.result?.patchRunStatus === "sandbox_written"),
    humanGateStatus,
    patchStatus,
    requiresExactConfirmation: applyStatus === "requires_confirmation" || applyStatus === "not_run",
    requiresHumanApproval: humanGateStatus !== "approved" || applyStatus !== "applied",
    verificationStatus
  };
}

function hasEvidencePath(task, prefix) {
  return Boolean(task?.evidence?.some((item) => String(item).startsWith(prefix)));
}

export function gateProofSummaryFromTask(task) {
  const checks = [
    hasEvidencePath(task, "data/evidence/"),
    Boolean(task?.proposal || hasEvidencePath(task, "data/proposals/")),
    Boolean(task?.verification || hasEvidencePath(task, "data/verifications/")),
    Boolean(task?.result?.humanGateStatus),
    Boolean(task?.patchRun || hasEvidencePath(task, "data/patch-runs/")),
    Boolean(task?.applyRun || hasEvidencePath(task, "data/patch-applies/"))
  ];
  const completed = checks.filter(Boolean).length;
  return {
    completed,
    label: `${completed}/${checks.length}`,
    ready: completed === checks.length,
    total: checks.length
  };
}

export function gateVerdictFromTask(task) {
  const model = gateModelFromTask(task);
  const proof = gateProofSummaryFromTask(task);

  if (!task) {
    return {
      tone: "idle",
      headline: "未选择任务",
      subline: "批准任何动作前，请先选择带证据的任务。",
      proofLabel: proof.label,
      riskLabel: "暂无运行",
      applyLabel: "默认阻断"
    };
  }

  if (model.applyStatus === "applied") {
    return {
      tone: "passed",
      headline: "闸门检查后已写入",
      subline: "这次运行在审批和写入闸门检查后，才写入项目文件。",
      proofLabel: proof.label,
      riskLabel: "已写入",
      applyLabel: "已写入"
    };
  }

  if (model.applyStatus === "requires_confirmation") {
    return {
      tone: "blocked",
      headline: "写入已阻断",
      subline: "证据已就绪，但项目写入仍需要精确人工确认。",
      proofLabel: proof.label,
      riskLabel: model.directWritesBlocked ? "没有直接写入" : "需要复核写入",
      applyLabel: "需要确认"
    };
  }

  if (model.patchStatus === "sandbox_written") {
    return {
      tone: "review",
      headline: "沙盒补丁已就绪",
      subline: "先复核差异并运行写入闸门，之后才可能进入项目写入路径。",
      proofLabel: proof.label,
      riskLabel: "仅沙盒",
      applyLabel: "未放行"
    };
  }

  if (model.humanGateStatus !== "approved") {
    return {
      tone: "waiting",
      headline: "需要人工决定",
      subline: "审核猿需要人工决定，才能继续进入补丁预检。",
      proofLabel: proof.label,
      riskLabel: "等待中",
      applyLabel: "已阻断"
    };
  }

  return {
    tone: "review",
    headline: "闸门保持中",
    subline: "下一道证据闸门通过前，这次运行会保持受监督模式。",
    proofLabel: proof.label,
    riskLabel: "受监督",
    applyLabel: "已阻断"
  };
}

export function gateRiskExplanation(task) {
  const model = gateModelFromTask(task);
  if (!task) return "未选择任务。";
  if (model.applyStatus === "applied") return "提案已在闸门检查后写入。";
  if (model.applyStatus === "requires_confirmation") {
    return "写入会保持阻断，直到精确人工确认和执行器策略都允许项目写入。";
  }
  if (model.patchStatus === "sandbox_written") {
    return "沙盒补丁已存在，但写入闸门明确放行前，项目文件保持不变。";
  }
  if (model.humanGateStatus !== "approved") {
    return "审核猿需要人工决定，任务才能继续进入补丁预检。";
  }
  return "闸门策略正在让任务保持受监督模式。";
}

export function gateApprovalChecklistFromTask(task) {
  const model = gateModelFromTask(task);
  const affectedFiles = model.affectedFiles.length ? model.affectedFiles : ["未采集到候选文件"];
  const willHappen = [
    model.canReviewPatch ? "打开沙盒补丁和差异预览。" : "等待沙盒补丁包生成。",
    "复核验证结果、证据包和审核猿结论。",
    model.canRunApplyGate ? "运行写入闸门预检，但不写项目文件。" : "保持只读证据模式。"
  ];
  const willNotHappen = [
    "不会绕过人工闸门修改项目文件。",
    "不会部署、重启、安装依赖或执行生产写入。",
    "不会触发钱包、交易、外部副作用接口或不可逆操作。"
  ];
  const blockers = [];

  if (model.verificationStatus !== "passed") {
    blockers.push("验证未通过，不能进入写入路径。");
  }

  if (model.humanGateStatus !== "approved") {
    blockers.push("人工闸门尚未批准。");
  }

  if (model.patchStatus !== "sandbox_written") {
    blockers.push("沙盒补丁包尚未生成。");
  }

  if (model.applyStatus === "requires_confirmation" || model.applyStatus === "not_run") {
    blockers.push("缺少精确写入确认语。");
  }

  if (!model.applyRunnerEnabled) {
    blockers.push("写入执行器当前未启用。");
  }

  if (model.directWritesBlocked) {
    blockers.push("项目文件写入保持阻断。");
  }

  return {
    affectedFiles,
    blockers: [...new Set(blockers)],
    requiredConfirmation: task?.id ? `APPLY ${task.id}` : "",
    willHappen,
    willNotHappen
  };
}
