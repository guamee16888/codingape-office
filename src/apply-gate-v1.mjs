import { guardProjectWriteTargets } from "./project-root-guard.mjs";

function blocker(id, title, detail) {
  return { id, title, detail };
}

function verificationResultExists(verification = null) {
  return Boolean(
    verification?.result ||
    verification?.summary?.result ||
    verification?.verificationPath ||
    (verification?.status && verification.status !== "not_run")
  );
}

function targetFilesFromPatchRun(patchRun = null, sandboxManifest = null) {
  const sandboxFiles = Array.isArray(sandboxManifest?.files)
    ? sandboxManifest.files
    : Array.isArray(patchRun?.sandboxFiles)
      ? patchRun.sandboxFiles
      : [];
  const changed = sandboxFiles
    .filter((file) => file?.changed !== false)
    .map((file) => file?.file)
    .filter(Boolean);

  if (changed.length) return [...new Set(changed)];
  return [...new Set((patchRun?.allowedFiles || []).filter(Boolean))];
}

export function evaluateApplyGateV1({
  patchRun = null,
  verification = null,
  humanGate = null,
  projectPath = "",
  sandboxManifest = null,
  rollbackManifest = null,
  targetFiles = []
} = {}) {
  const files = targetFiles.length ? targetFiles : targetFilesFromPatchRun(patchRun, sandboxManifest);
  const rootGuard = guardProjectWriteTargets(projectPath, files);
  const diffReady = Boolean(
    patchRun?.status === "sandbox_written" &&
    (patchRun?.diffPath || patchRun?.diffPreview || sandboxManifest?.diffPath || sandboxManifest?.diffPreview)
  );
  const verificationReady = verificationResultExists(verification);
  const rollbackReady = Boolean(
    rollbackManifest?.ok ||
    patchRun?.rollbackSnapshotPath ||
    patchRun?.rollbackFiles?.length
  );
  const humanApproved = humanGate?.status === "approved";
  const blockers = [];

  if (!diffReady) {
    blockers.push(blocker(
      "apply_gate_diff_missing",
      "Patch diff is not ready",
      "Generate a sandbox patch diff before enabling project writes."
    ));
  }

  if (!verificationReady) {
    blockers.push(blocker(
      "apply_gate_verification_missing",
      "Verification result is missing",
      "Run verification and attach the result before enabling project writes."
    ));
  }

  if (!rollbackReady) {
    blockers.push(blocker(
      "apply_gate_rollback_missing",
      "Rollback snapshot is missing",
      "Create a rollback snapshot before enabling project writes."
    ));
  }

  if (!humanApproved) {
    blockers.push(blocker(
      "apply_gate_human_approval_missing",
      "Human approval is missing",
      "A human must approve the verified patch before Apply Approved Patch can run."
    ));
  }

  if (!files.length) {
    blockers.push(blocker(
      "apply_gate_targets_missing",
      "Target files are missing",
      "Apply Gate needs at least one patch target inside the selected project root."
    ));
  }

  if (!rootGuard.ok) {
    blockers.push(...rootGuard.blockers);
  }

  const canApply = blockers.length === 0;
  return {
    version: "v1",
    status: canApply ? "ready" : "blocked",
    canApply,
    requiredFacts: {
      diffReady,
      verificationResultExists: verificationReady,
      rollbackSnapshotReady: rollbackReady,
      humanApprovalGranted: humanApproved,
      allTargetFilesInsideProjectRoot: rootGuard.ok && files.length > 0
    },
    targetFiles: rootGuard.files.map((file) => file.file),
    blockedFiles: rootGuard.blockedFiles,
    blockers
  };
}
