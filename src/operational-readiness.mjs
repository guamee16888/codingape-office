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
      ? `Missing config items: ${aiwcMissing.join(", ")}.`
      : aiwcHealth?.detail || "This does not block local beta use, but centralized logs are recommended for operations.";

  const checks = [
    serviceHealth.local?.status === "online"
      ? okCheck("local_service", "Local service online", serviceHealth.local.detail || "Local server is responding.", 10)
      : blockedCheck("local_service", "Local service not confirmed", "127.0.0.1:4142 must respond reliably.", 10),
    ["managed", "configured"].includes(serviceHealth.daemon?.status)
      ? okCheck("daemon", "Daemon configured", serviceHealth.daemon.detail || "macOS launchd can keep the local server alive.", 8, false)
      : advisoryCheck("daemon", "Daemon not configured", "Use launchd to keep the public entry available after the terminal closes.", 5),
    ["configured", "managed"].includes(serviceHealth.publicEntry?.status)
      ? okCheck("public_entry", "Public entry configured", serviceHealth.publicEntry.detail || "Public home can route to the local service.", 6, false)
      : advisoryCheck("public_entry", "Public entry not configured", "Beta users need geoaifactory.com or an equivalent public entry.", 4),
    localProjects.selectedProjectId
      ? okCheck("local_project", "Local project selected", localProjects.selectedPath || localProjects.selectedName || "Local project root is selected.", 10)
      : blockedCheck("local_project", "No local project selected", "Real tasks must be bound to an explicit project root.", 10),
    latestEvidence
      ? okCheck("evidence_pack", "Evidence Pack generated", latestEvidence.taskId || "Evidence exists.", 10, true, [latestEvidence.taskId].filter(Boolean))
      : blockedCheck("evidence_pack", "Evidence Pack missing", "Run at least one read-only evidence capture.", 10),
    latestProposal
      ? okCheck("patch_proposal", "Patch Proposal generated", latestProposal.summary || latestProposal.taskId || "Proposal exists.", 10, true, [latestProposal.proposalPath].filter(Boolean))
      : blockedCheck("patch_proposal", "Patch Proposal missing", "Generate an auditable patch proposal from evidence.", 10),
    latestVerification?.result?.ok
      ? okCheck("verification", "Verification passed", latestVerification.script || "A safe verification script passed.", 10, true, [latestVerification.verificationPath].filter(Boolean))
      : blockedCheck("verification", "Passing Verification missing", "At least one allowlisted verification must pass.", 10),
    latestPatchRun?.rollbackSnapshotPath
      ? okCheck("rollback_snapshot", "Rollback Snapshot ready", latestPatchRun.rollbackSnapshotPath, 9, true, [latestPatchRun.rollbackSnapshotPath])
      : blockedCheck("rollback_snapshot", "Rollback Snapshot missing", "Rollback must be available before Apply.", 9),
    latestApply
      ? okCheck("apply_gate", "Apply Gate checked", latestApply.status || "Apply gate evidence exists.", 9, true, [latestApply.applyPath].filter(Boolean))
      : blockedCheck("apply_gate", "Apply Gate evidence missing", "Run at least one Apply Gate check.", 9),
    latestReport || completedTasks
      ? okCheck("company_report", "Company Report available", latestReport?.reportPath || `${completedTasks} completed task(s).`, 8, true, [latestReport?.reportPath].filter(Boolean))
      : blockedCheck("company_report", "Task report missing", "Completed tasks must generate a user-readable report.", 8),
    hasSupportBundle
      ? okCheck("support_bundle", "Support bundle available", "Support bundle endpoint is available for beta support.", 6, false)
      : advisoryCheck("support_bundle", "Support bundle not generated", "Operations need exportable redacted logs and recent task state.", 4),
    stableTag
      ? okCheck("git_checkpoint", "Git rollback point exists", stableTag, 5, false)
      : advisoryCheck("git_checkpoint", "Git rollback point not confirmed", "Create a stable tag for each operational milestone.", 4),
    aiwcReady
      ? okCheck("aiwc_ingestion", "AIWC logs connected", aiwcDetail, 5, false, [aiwcHealth?.runIdExternal].filter(Boolean))
      : advisoryCheck("aiwc_ingestion", "AIWC logs not connected", aiwcDetail, 3)
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
    statusLabel: status === "operational" ? "Operational" : status === "beta_ready" ? "Beta ready" : "Not operational",
    score,
    maxScore: 100,
    summary: blockers.length
      ? `${blockers.length} hard blocker(s) remain before operational readiness: ${blockers.slice(0, 3).map((check) => check.label).join(", ")}.`
      : advisories.length
        ? `The paid loop is beta-ready, with ${advisories.length} operational enhancement(s) remaining.`
        : "Local loop, evidence, rollback, reports, service health, and support capability are ready.",
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
