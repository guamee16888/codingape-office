export function affectedFilesFromTask(task) {
  if (!task) return [];
  const files = [
    ...(task.patchCandidates || []),
    ...(task.patchDrafts || []).map((draft) => draft.file),
    ...(task.result?.affectedFiles || [])
  ].filter(Boolean);

  if (!files.length && Number(task.result?.changedFiles || 0) > 0) {
    return [`Detected ${task.result.changedFiles} changed-file signals`];
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
      headline: "No Task Selected",
      subline: "Choose an evidence-backed task before approving any action.",
      proofLabel: proof.label,
      riskLabel: "No run",
      applyLabel: "Blocked by default"
    };
  }

  if (model.applyStatus === "applied") {
    return {
      tone: "passed",
      headline: "Written After Gate Checks",
      subline: "This run wrote project files only after approval and Apply Gate checks.",
      proofLabel: proof.label,
      riskLabel: "Applied",
      applyLabel: "Applied"
    };
  }

  if (model.applyStatus === "requires_confirmation") {
    return {
      tone: "blocked",
      headline: "Write Is Blocked",
      subline: "Evidence is ready, but project writes still require exact human confirmation.",
      proofLabel: proof.label,
      riskLabel: model.directWritesBlocked ? "No direct write" : "Review write",
      applyLabel: "Requires confirmation"
    };
  }

  if (model.patchStatus === "sandbox_written") {
    return {
      tone: "review",
      headline: "Sandbox Patch Ready",
      subline: "Review the diff and run Apply Gate before any project write path can open.",
      proofLabel: proof.label,
      riskLabel: "Sandbox only",
      applyLabel: "Not released"
    };
  }

  if (model.humanGateStatus !== "approved") {
    return {
      tone: "waiting",
      headline: "Human Decision Required",
      subline: "Judgeape needs a human decision before patch preflight can continue.",
      proofLabel: proof.label,
      riskLabel: "Waiting",
      applyLabel: "Blocked"
    };
  }

  return {
    tone: "review",
    headline: "Gate Holding",
    subline: "This run stays supervised until the next evidence gate passes.",
    proofLabel: proof.label,
    riskLabel: "Supervised",
    applyLabel: "Blocked"
  };
}

export function gateRiskExplanation(task) {
  const model = gateModelFromTask(task);
  if (!task) return "No task is selected.";
  if (model.applyStatus === "applied") return "The proposal was applied after gate checks.";
  if (model.applyStatus === "requires_confirmation") {
    return "Writes stay blocked until exact human confirmation and runner policy both allow project writes.";
  }
  if (model.patchStatus === "sandbox_written") {
    return "A sandbox patch exists, but project files stay unchanged until Apply Gate explicitly releases it.";
  }
  if (model.humanGateStatus !== "approved") {
    return "Judgeape needs a human decision before the task can enter patch preflight.";
  }
  return "Gate policy is keeping the task in supervised mode.";
}

export function gateApprovalChecklistFromTask(task) {
  const model = gateModelFromTask(task);
  const affectedFiles = model.affectedFiles.length ? model.affectedFiles : ["No candidate files captured"];
  const willHappen = [
    model.canReviewPatch ? "Open the sandbox patch and diff preview." : "Wait for the sandbox patch package.",
    "Review verification, Evidence Pack, and Judgeape notes.",
    model.canRunApplyGate ? "Run Apply Gate preflight without writing project files." : "Stay in read-only evidence mode."
  ];
  const willNotHappen = [
    "Project files are never modified around the Human Gate.",
    "No deploy, restart, dependency install, or production write is performed.",
    "No wallet, trading, external side-effect API, or irreversible action is triggered."
  ];
  const blockers = [];

  if (model.verificationStatus !== "passed") {
    blockers.push("Verification failed, so the write path stays closed.");
  }

  if (model.humanGateStatus !== "approved") {
    blockers.push("Human Gate has not approved this run.");
  }

  if (model.patchStatus !== "sandbox_written") {
    blockers.push("Sandbox patch package has not been generated.");
  }

  if (model.applyStatus === "requires_confirmation" || model.applyStatus === "not_run") {
    blockers.push("Exact apply confirmation is missing.");
  }

  if (!model.applyRunnerEnabled) {
    blockers.push("Apply runner is not enabled.");
  }

  if (model.directWritesBlocked) {
    blockers.push("Project file writes remain blocked.");
  }

  return {
    affectedFiles,
    blockers: [...new Set(blockers)],
    requiredConfirmation: task?.id ? `APPLY ${task.id}` : "",
    willHappen,
    willNotHappen
  };
}
