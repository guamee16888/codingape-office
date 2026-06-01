function metricValue(report, matchers, fallback = "0") {
  const metric = (report?.metrics || []).find((candidate) =>
    matchers.some((matcher) => String(candidate.label || "").toLowerCase().includes(matcher))
  );
  return metric?.value ?? fallback;
}

export function patchRunStatusLabel(status = "not_run") {
  const labels = {
    blocked: "补丁被阻断",
    dry_run: "补丁预演",
    failed: "补丁失败",
    not_run: "等待补丁",
    sandbox_written: "沙盒补丁已生成"
  };
  return labels[status] || "等待补丁";
}

export function applyRunStatusLabel(status = "not_run") {
  const labels = {
    applied: "已人工写入",
    blocked: "写入已阻断",
    failed: "写入失败",
    not_run: "等待写入检查",
    requires_confirmation: "需要人工确认"
  };
  return labels[status] || "等待写入检查";
}

export function verificationStatusLabel(status = "not_run") {
  const labels = {
    blocked: "验证被阻断",
    failed: "验证未通过",
    not_run: "等待验证",
    passed: "验证通过"
  };
  return labels[status] || "等待验证";
}

export function companyReportMetrics(report = {}) {
  const tasksDone = metricValue(report, ["tasks done", "completed", "missions", "任务完成", "完成任务"], 0);
  const evidencePacks = metricValue(report, ["evidence packs", "evidence", "证据包"], 0);
  const verified = metricValue(report, ["verified", "verification", "验证通过", "验证"], 0);
  const patchRuns = metricValue(report, ["patch runs", "controlled patch", "补丁预检", "补丁运行"], 0);
  const applyGates = metricValue(report, ["apply gates", "apply", "写入闸门"], 0);
  const risksGated = metricValue(report, ["risks gated", "risk blocked", "blocked", "风险阻断", "阻断"], 0);
  const hoursSavedRaw = metricValue(report, ["hours saved", "saved", "节省时间", "节省"], 0);
  const hoursSaved = String(hoursSavedRaw).includes("h") ? String(hoursSavedRaw) : `${hoursSavedRaw}h`;

  return {
    applyGates,
    evidencePacks,
    hoursSaved,
    patchRuns,
    risksGated,
    tasksDone,
    verified
  };
}

export function latestLoopEvidenceChain(report = {}) {
  const latestLoop = report.latestLoop || {};
  if (!latestLoop.taskId) return [];
  const evidenceReady = Boolean(latestLoop.evidenceCapturedAt || latestLoop.checks > 0);
  const proposalReady = Boolean(latestLoop.proposalCreatedAt || latestLoop.proposalSummary);
  const verificationStatus = latestLoop.verificationStatus || "not_run";
  const patchStatus = latestLoop.patchRunStatus || "not_run";
  const applyStatus = latestLoop.applyStatus || "not_run";

  return [
    {
      label: "证据",
      status: evidenceReady ? "ok" : "pending",
      value: evidenceReady ? `${latestLoop.checks || 0} 条检查` : "等待采集"
    },
    {
      label: "方案",
      status: proposalReady ? "ok" : "pending",
      value: proposalReady ? "已生成" : "等待方案"
    },
    {
      label: "验证",
      status: verificationStatus === "passed" ? "ok" : verificationStatus === "failed" ? "danger" : "pending",
      value: verificationStatusLabel(verificationStatus)
    },
    {
      label: "沙盒补丁",
      status: patchStatus === "sandbox_written" || patchStatus === "dry_run" ? "ok" : patchStatus === "blocked" ? "danger" : "pending",
      value: patchRunStatusLabel(patchStatus)
    },
    {
      label: "写入闸门",
      status: ["requires_confirmation", "blocked"].includes(applyStatus) ? "warn" : applyStatus === "applied" ? "ok" : "pending",
      value: applyRunStatusLabel(applyStatus)
    },
    {
      label: "项目文件",
      status: applyStatus === "applied" ? "warn" : "safe",
      value: applyStatus === "applied" ? "已按确认写入" : "未被自动修改"
    }
  ];
}

export function companyReportBullets(report = {}) {
  const metrics = companyReportMetrics(report);
  const latestLoop = report.latestLoop || {};
  const latestLoopBullets = latestLoop.taskId
    ? [
        `最新闭环：${latestLoop.title || latestLoop.taskId}。`,
        latestLoop.patchRunStatus === "sandbox_written"
          ? "沙盒补丁已生成，项目文件未被自动修改。"
          : `补丁状态：${patchRunStatusLabel(latestLoop.patchRunStatus || "not_run")}。`,
        ["requires_confirmation", "blocked"].includes(latestLoop.applyStatus)
          ? "写入闸门已拦住，需要人工确认。"
          : `写入闸门状态：${applyRunStatusLabel(latestLoop.applyStatus || "not_run")}。`
      ]
    : [];
  return [
    ...latestLoopBullets,
    `编程猿完成了 ${metrics.tasksDone} 个任务。`,
    `审核猿复核了 ${metrics.evidencePacks} 份证据包。`,
    `运维猿守住了 ${metrics.risksGated} 个风险点。`,
    `这家公司预计节省了约 ${metrics.hoursSaved} 的人工时间。`,
    "没有任何高风险写入绕过人工闸门。"
  ];
}

export function companyReportShareLine(report = {}) {
  const metrics = companyReportMetrics(report);
  return (
    report.shareLine ||
    `今天我的 AI 打工公司完成了 ${metrics.tasksDone} 个任务，省了 ${metrics.hoursSaved}，阻断了 ${metrics.risksGated} 次风险。`
  );
}

export function buildCompanyShareCard(report = {}) {
  const metrics = companyReportMetrics(report);
  const headline = report.headline || "你的 AI 打工公司已准备好开始有证据支撑的真实工作。";
  const shareLine = companyReportShareLine(report);
  const safetyStamp = "没有写入绕过人工闸门";
  const bullets = companyReportBullets(report);
  const evidenceChain = latestLoopEvidenceChain(report);
  const evidenceChainText = evidenceChain.map((item) => `${item.label}：${item.value}`);
  return {
    bullets,
    evidenceChain,
    evidenceChainText,
    headline,
    safetyStamp,
    metrics,
    shareLine,
    shareText: [headline, shareLine, safetyStamp, ...evidenceChainText, ...bullets].join("\n"),
    title: "我的 AI 打工公司战报"
  };
}

export { metricValue as companyMetricValue };
