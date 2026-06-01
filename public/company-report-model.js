function metricValue(report, matchers, fallback = "0") {
  const metric = (report?.metrics || []).find((candidate) =>
    matchers.some((matcher) => String(candidate.label || "").toLowerCase().includes(matcher))
  );
  return metric?.value ?? fallback;
}

export function patchRunStatusLabel(status = "not_run") {
  const labels = {
    blocked: "Patch blocked",
    dry_run: "Patch dry run",
    failed: "Patch failed",
    not_run: "Waiting for patch",
    sandbox_written: "Sandbox patch generated"
  };
  return labels[status] || "Waiting for patch";
}

export function applyRunStatusLabel(status = "not_run") {
  const labels = {
    applied: "Applied by human approval",
    blocked: "Write blocked",
    failed: "Write failed",
    not_run: "Waiting for apply check",
    requires_confirmation: "Needs human confirmation"
  };
  return labels[status] || "Waiting for apply check";
}

export function verificationStatusLabel(status = "not_run") {
  const labels = {
    blocked: "Verification blocked",
    failed: "Verification failed",
    not_run: "Waiting for verification",
    passed: "Verification passed"
  };
  return labels[status] || "Waiting for verification";
}

export function companyReportMetrics(report = {}) {
  const tasksDone = metricValue(report, ["tasks done", "completed", "missions"], 0);
  const evidencePacks = metricValue(report, ["evidence packs", "evidence"], 0);
  const verified = metricValue(report, ["verified", "verification"], 0);
  const patchRuns = metricValue(report, ["patch runs", "controlled patch"], 0);
  const applyGates = metricValue(report, ["apply gates", "apply"], 0);
  const risksGated = metricValue(report, ["risks gated", "risk blocked", "blocked"], 0);
  const hoursSavedRaw = metricValue(report, ["hours saved", "saved"], 0);
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
      label: "Evidence",
      status: evidenceReady ? "ok" : "pending",
      value: evidenceReady ? `${latestLoop.checks || 0} checks` : "Waiting for capture"
    },
    {
      label: "Proposal",
      status: proposalReady ? "ok" : "pending",
      value: proposalReady ? "Generated" : "Waiting for proposal"
    },
    {
      label: "Verification",
      status: verificationStatus === "passed" ? "ok" : verificationStatus === "failed" ? "danger" : "pending",
      value: verificationStatusLabel(verificationStatus)
    },
    {
      label: "Sandbox Patch",
      status: patchStatus === "sandbox_written" || patchStatus === "dry_run" ? "ok" : patchStatus === "blocked" ? "danger" : "pending",
      value: patchRunStatusLabel(patchStatus)
    },
    {
      label: "Apply Gate",
      status: ["requires_confirmation", "blocked"].includes(applyStatus) ? "warn" : applyStatus === "applied" ? "ok" : "pending",
      value: applyRunStatusLabel(applyStatus)
    },
    {
      label: "Project Files",
      status: applyStatus === "applied" ? "warn" : "safe",
      value: applyStatus === "applied" ? "Written after confirmation" : "Not auto-modified"
    }
  ];
}

export function companyReportBullets(report = {}) {
  const metrics = companyReportMetrics(report);
  const latestLoop = report.latestLoop || {};
  const latestLoopBullets = latestLoop.taskId
    ? [
        `Latest loop: ${latestLoop.title || latestLoop.taskId}.`,
        latestLoop.patchRunStatus === "sandbox_written"
          ? "Sandbox patch generated; project files were not auto-modified."
          : `Patch status: ${patchRunStatusLabel(latestLoop.patchRunStatus || "not_run")}.`,
        ["requires_confirmation", "blocked"].includes(latestLoop.applyStatus)
          ? "Apply Gate is holding the write path until human confirmation."
          : `Apply Gate status: ${applyRunStatusLabel(latestLoop.applyStatus || "not_run")}.`
      ]
    : [];
  return [
    ...latestLoopBullets,
    `Codingape completed ${metrics.tasksDone} tasks.`,
    `Judgeape reviewed ${metrics.evidencePacks} Evidence Packs.`,
    `Opsape gated ${metrics.risksGated} risk points.`,
    `This worker office estimated about ${metrics.hoursSaved} of saved manual time.`,
    "No high-risk write bypassed the Human Gate."
  ];
}

export function companyReportShareLine(report = {}) {
  const metrics = companyReportMetrics(report);
  return (
    report.shareLine ||
    `My AI worker office completed ${metrics.tasksDone} tasks today, saved ${metrics.hoursSaved}, and blocked ${metrics.risksGated} risks.`
  );
}

export function buildCompanyShareCard(report = {}) {
  const metrics = companyReportMetrics(report);
  const headline = report.headline || "Your AI worker office is ready for evidence-backed real work.";
  const shareLine = companyReportShareLine(report);
  const safetyStamp = "No write bypassed the Human Gate";
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
    title: "My AI Worker Office Report"
  };
}

export { metricValue as companyMetricValue };
