const CRITICAL_CHECKS = new Set([
  "local_service",
  "local_project",
  "evidence_pack",
  "patch_proposal",
  "verification",
  "rollback_snapshot",
  "apply_gate",
  "company_report"
]);

function okCheck(id, label, detail, weight = 10, critical = CRITICAL_CHECKS.has(id), evidence = []) {
  return { id, label, status: "passed", detail, weight, critical, evidence };
}

function blockedCheck(id, label, detail, weight = 10, critical = CRITICAL_CHECKS.has(id), evidence = []) {
  return { id, label, status: "blocked", detail, weight, critical, evidence };
}

function advisoryCheck(id, label, detail, weight = 4, evidence = []) {
  return { id, label, status: "advisory", detail, weight, critical: false, evidence };
}

function newestByDate(items = [], key = "completedAt") {
  return [...items]
    .filter(Boolean)
    .sort((a, b) => Date.parse(b?.[key] || b?.createdAt || b?.capturedAt || 0) - Date.parse(a?.[key] || a?.createdAt || a?.capturedAt || 0))[0] || null;
}

export function buildOperationalReadiness({
  serviceHealth = {},
  localProjects = {},
  tasks = [],
  evidencePacks = [],
  proposalPacks = [],
  verificationPacks = [],
  patchRunPacks = [],
  patchApplyPacks = [],
  taskReports = [],
  aiwcConfigured = false,
  aiwcHealth = null,
  hasSupportBundle = true,
  stableTag = ""
} = {}) {
  const latestEvidence = newestByDate(evidencePacks, "capturedAt");
  const latestProposal = newestByDate(proposalPacks, "createdAt");
  const latestVerification = newestByDate(verificationPacks, "completedAt");
  const latestPatchRun = newestByDate(patchRunPacks, "completedAt");
  const latestApply = newestByDate(patchApplyPacks, "completedAt");
  const latestReport = newestByDate(taskReports, "generatedAt");
  const completedTasks = tasks.filter((task) => task?.status === "completed").length;
  const hasAiwcHealthStatus = Boolean(aiwcHealth && typeof aiwcHealth === "object");
  const aiwcReady = hasAiwcHealthStatus ? Boolean(aiwcHealth.ok) : Boolean(aiwcConfigured);
  const aiwcMissing = Array.isArray(aiwcHealth?.missing) ? aiwcHealth.missing : [];
  const aiwcDetail = aiwcReady
    ? aiwcHealth?.detail || "Run logs are mirrored into the integrated control plane."
    : aiwcMissing.length
      ? `缺少配置项：${aiwcMissing.join(", ")}。`
      : aiwcHealth?.detail || "不阻断本地 beta，但运营期建议接入集中日志。";

  const checks = [
    serviceHealth.local?.status === "online"
      ? okCheck("local_service", "本地服务在线", serviceHealth.local.detail || "Local server is responding.", 10)
      : blockedCheck("local_service", "本地服务未确认", "127.0.0.1:4142 必须稳定响应。", 10),
    ["managed", "configured"].includes(serviceHealth.daemon?.status)
      ? okCheck("daemon", "后台守护已配置", serviceHealth.daemon.detail || "macOS launchd can keep the local server alive.", 8, false)
      : advisoryCheck("daemon", "后台守护待配置", "建议用 launchd 托管，避免关掉终端后公网入口失效。", 5),
    ["configured", "managed"].includes(serviceHealth.publicEntry?.status)
      ? okCheck("public_entry", "公网入口已配置", serviceHealth.publicEntry.detail || "Public home can route to the local service.", 6, false)
      : advisoryCheck("public_entry", "公网入口待配置", "Beta 用户入口需要 geoaifactory.com 或等价公网入口。", 4),
    localProjects.selectedProjectId
      ? okCheck("local_project", "已选择本地项目", localProjects.selectedPath || localProjects.selectedName || "Local project root is selected.", 10)
      : blockedCheck("local_project", "未选择本地项目", "真实任务必须绑定明确的 project root。", 10),
    latestEvidence
      ? okCheck("evidence_pack", "Evidence Pack 已生成", latestEvidence.taskId || "Evidence exists.", 10, true, [latestEvidence.taskId].filter(Boolean))
      : blockedCheck("evidence_pack", "缺少 Evidence Pack", "至少跑通一次只读证据采集。", 10),
    latestProposal
      ? okCheck("patch_proposal", "Patch Proposal 已生成", latestProposal.summary || latestProposal.taskId || "Proposal exists.", 10, true, [latestProposal.proposalPath].filter(Boolean))
      : blockedCheck("patch_proposal", "缺少 Patch Proposal", "需要从证据生成可审计的补丁方案。", 10),
    latestVerification?.result?.ok
      ? okCheck("verification", "Verification 已通过", latestVerification.script || "A safe verification script passed.", 10, true, [latestVerification.verificationPath].filter(Boolean))
      : blockedCheck("verification", "缺少通过的 Verification", "至少一次白名单验证要通过。", 10),
    latestPatchRun?.rollbackSnapshotPath
      ? okCheck("rollback_snapshot", "Rollback Snapshot 已准备", latestPatchRun.rollbackSnapshotPath, 9, true, [latestPatchRun.rollbackSnapshotPath])
      : blockedCheck("rollback_snapshot", "缺少 Rollback Snapshot", "Apply 前必须能回退。", 9),
    latestApply
      ? okCheck("apply_gate", "Apply Gate 已检查", latestApply.status || "Apply gate evidence exists.", 9, true, [latestApply.applyPath].filter(Boolean))
      : blockedCheck("apply_gate", "缺少 Apply Gate 证据", "需要至少一次写入闸门检查。", 9),
    latestReport || completedTasks
      ? okCheck("company_report", "Company Report 可用", latestReport?.reportPath || `${completedTasks} completed task(s).`, 8, true, [latestReport?.reportPath].filter(Boolean))
      : blockedCheck("company_report", "缺少任务报告", "完成任务后必须生成用户能看懂的报告。", 8),
    hasSupportBundle
      ? okCheck("support_bundle", "支持包可生成", "Support bundle endpoint is available for beta support.", 6, false)
      : advisoryCheck("support_bundle", "支持包待生成", "运营需要能导出脱敏日志和最近任务状态。", 4),
    stableTag
      ? okCheck("git_checkpoint", "Git 回退点存在", stableTag, 5, false)
      : advisoryCheck("git_checkpoint", "Git 回退点待确认", "建议每个运营里程碑都打 stable tag。", 4),
    aiwcReady
      ? okCheck("aiwc_ingestion", "AIWC 日志已接入", aiwcDetail, 5, false, [aiwcHealth?.runIdExternal].filter(Boolean))
      : advisoryCheck("aiwc_ingestion", "AIWC 日志未连通", aiwcDetail, 3)
  ];

  const maxScore = checks.reduce((sum, check) => sum + check.weight, 0);
  const score = Math.round(checks.reduce((sum, check) => sum + (check.status === "passed" ? check.weight : 0), 0) / maxScore * 100);
  const blockers = checks.filter((check) => check.critical && check.status !== "passed");
  const advisories = checks.filter((check) => !check.critical && check.status !== "passed");
  const status = blockers.length
    ? "blocked"
    : advisories.length
      ? "beta_ready"
      : "operational";

  return {
    version: "v1",
    generatedAt: new Date().toISOString(),
    status,
    statusLabel: status === "operational" ? "可运营" : status === "beta_ready" ? "Beta 可运营" : "未可运营",
    score,
    maxScore: 100,
    summary: blockers.length
      ? `距离可运营还差 ${blockers.length} 个硬阻断：${blockers.slice(0, 3).map((check) => check.label).join("、")}。`
      : advisories.length
        ? `付费闭环已具备 beta 运营条件，还有 ${advisories.length} 个运营增强项。`
        : "本地闭环、证据、回滚、报告、服务和支持能力都已具备。",
    checks,
    blockers,
    advisories,
    nextActions: [...blockers, ...advisories].slice(0, 5).map((check) => ({
      id: check.id,
      title: check.label,
      detail: check.detail
    }))
  };
}
