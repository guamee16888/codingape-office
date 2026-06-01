import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { safeProjectFilePath } from "./patch-runner-artifacts.mjs";
import { summarizeProjectRootGuard } from "./project-root-guard.mjs";

export const DEFAULT_MAX_APPLY_FILE_BYTES = 200_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function relativeDataPath(rootLabel, taskId, suffix) {
  return `${rootLabel}/${taskId}/${suffix}`.replaceAll("\\", "/");
}

export function patchApplyRunnerEnabled(env = process.env) {
  return env.CODEX_OFFICE_ENABLE_APPLY_RUNNER === "true";
}

export function applyConfirmationPhrase(taskId = "") {
  return `APPLY ${taskId}`;
}

export function applySandboxPatchPackage({
  taskId,
  projectPath,
  sandboxRoot,
  snapshotRoot,
  applyRoot,
  confirmation = "",
  env = process.env,
  relativeRoot = "data/patch-applies",
  maxBytes = DEFAULT_MAX_APPLY_FILE_BYTES
} = {}) {
  const startedAt = new Date().toISOString();
  const blockers = [];
  const appliedFiles = [];
  const requiredConfirmation = applyConfirmationPhrase(taskId || "");

  if (!taskId) {
    blockers.push({
      id: "apply_task_missing",
      title: "Apply task id is missing",
      detail: "Apply runs must be tied to an auditable task."
    });
  }

  if (!patchApplyRunnerEnabled(env)) {
    blockers.push({
      id: "apply_runner_disabled",
      title: "Apply runner is disabled",
      detail: "Set CODEX_OFFICE_ENABLE_APPLY_RUNNER=true only after approving direct project file writes."
    });
  }

  if (confirmation !== requiredConfirmation) {
    blockers.push({
      id: "apply_confirmation_required",
      title: "Exact apply confirmation is required",
      detail: `Send confirmation "${requiredConfirmation}" to apply sandbox files to the project.`
    });
  }

  if (!projectPath || !sandboxRoot || !snapshotRoot) {
    blockers.push({
      id: "apply_path_missing",
      title: "Apply paths are missing",
      detail: "Apply runs require project, sandbox, and rollback snapshot roots."
    });
  }

  const sandboxManifestPath = taskId && sandboxRoot ? join(sandboxRoot, taskId, "manifest.json") : "";
  const rollbackManifestPath = taskId && snapshotRoot ? join(snapshotRoot, taskId, "manifest.json") : "";
  const sandboxManifest = sandboxManifestPath ? readJsonFile(sandboxManifestPath) : null;
  const rollbackManifest = rollbackManifestPath ? readJsonFile(rollbackManifestPath) : null;

  if (!sandboxManifest?.ok) {
    blockers.push({
      id: "sandbox_manifest_not_ready",
      title: "Sandbox patch manifest is not ready",
      detail: "Run a successful sandbox patch package before applying a proposal."
    });
  }

  if (!rollbackManifest?.ok) {
    blockers.push({
      id: "rollback_manifest_not_ready",
      title: "Rollback manifest is not ready",
      detail: "Apply runs need a valid rollback snapshot to recover the previous file state."
    });
  }

  const sandboxFiles = Array.isArray(sandboxManifest?.files) ? sandboxManifest.files : [];
  const changedFiles = sandboxFiles.filter((file) => file?.changed);
  if (!changedFiles.length) {
    blockers.push({
      id: "no_changed_sandbox_files",
      title: "No changed sandbox files",
      detail: "The sandbox package has no proposed file changes to apply."
    });
  }

  const rollbackByFile = new Map((rollbackManifest?.files || []).map((file) => [file.file, file]));
  const preparedFiles = [];
  for (const file of changedFiles) {
    const projectFile = safeProjectFilePath(projectPath, file.file);
    const sandboxFile = safeProjectFilePath(join(sandboxRoot || "", taskId || "", "files"), file.file);
    const rollbackFile = rollbackByFile.get(file.file);

    if (!projectFile || !sandboxFile) {
      blockers.push({
        id: "apply_path_unsafe",
        title: `Apply path blocked: ${file.file || "unknown"}`,
        detail: "Apply source and target paths must remain inside their approved roots.",
        file: String(file.file || ""),
        source: "project_root_guard",
        guardId: "project_path_unsafe"
      });
      continue;
    }

    if (!existsSync(sandboxFile.absolutePath)) {
      blockers.push({
        id: "sandbox_file_missing",
        title: `Sandbox file missing: ${file.file}`,
        detail: "The proposed sandbox file must exist before apply."
      });
      continue;
    }

    const sandboxStat = statSync(sandboxFile.absolutePath);
    if (sandboxStat.size > maxBytes) {
      blockers.push({
        id: "sandbox_file_too_large",
        title: `Sandbox file too large: ${file.file}`,
        detail: `File is ${sandboxStat.size} bytes; limit is ${maxBytes} bytes.`
      });
      continue;
    }

    const proposed = readFileSync(sandboxFile.absolutePath);
    const proposedSha256 = sha256(proposed);
    if (file.proposedSha256 && proposedSha256 !== file.proposedSha256) {
      blockers.push({
        id: "sandbox_hash_mismatch",
        title: `Sandbox file hash mismatch: ${file.file}`,
        detail: "The sandbox file no longer matches the manifest hash."
      });
      continue;
    }

    if (!rollbackFile) {
      blockers.push({
        id: "rollback_file_missing",
        title: `Rollback file missing: ${file.file}`,
        detail: "Every applied file must have rollback metadata."
      });
      continue;
    }

    const existsNow = existsSync(projectFile.absolutePath);
    if (rollbackFile.existed && !existsNow) {
      blockers.push({
        id: "project_file_missing",
        title: `Project file missing: ${file.file}`,
        detail: "The project file changed after rollback snapshot capture."
      });
      continue;
    }

    if (!rollbackFile.existed && existsNow) {
      blockers.push({
        id: "project_file_unexpected",
        title: `Project file already exists: ${file.file}`,
        detail: "A file that was new at snapshot time now exists; rerun evidence and patch preflight."
      });
      continue;
    }

    let beforeSha256 = "";
    if (existsNow) {
      const current = readFileSync(projectFile.absolutePath);
      beforeSha256 = sha256(current);
      if (rollbackFile.sha256 && beforeSha256 !== rollbackFile.sha256) {
        blockers.push({
          id: "project_hash_drift",
          title: `Project file drifted: ${file.file}`,
          detail: "The project file no longer matches the rollback snapshot hash."
        });
        continue;
      }
    }

    preparedFiles.push({
      file: file.file,
      targetPath: projectFile.absolutePath,
      sourcePath: sandboxFile.absolutePath,
      beforeSha256,
      proposedSha256,
      bytes: sandboxStat.size
    });
  }

  const canApply = blockers.length === 0;
  if (canApply) {
    for (const file of preparedFiles) {
      mkdirSync(dirname(file.targetPath), { recursive: true });
      const proposed = readFileSync(file.sourcePath);
      writeFileSync(file.targetPath, proposed);
      appliedFiles.push({
        file: file.file,
        bytes: file.bytes,
        beforeSha256: file.beforeSha256,
        afterSha256: sha256(proposed)
      });
    }
  }

  const completedAt = new Date().toISOString();
  const status = canApply
    ? "applied"
    : blockers.some((blocker) => blocker.id === "apply_runner_disabled" || blocker.id === "apply_confirmation_required")
      ? "requires_confirmation"
      : "blocked";
  const rollbackAvailable = Boolean(rollbackManifest?.ok);
  const rollbackOption = {
    available: rollbackAvailable,
    rollbackSnapshotPath: taskId ? relativeDataPath("data/patch-snapshots", taskId, "manifest.json") : "",
    note: rollbackAvailable
      ? status === "applied"
        ? "Rollback snapshot is available if the approved patch needs to be reverted."
        : "No project writes happened; rollback snapshot remains available for operator review."
      : "Rollback is unavailable until a valid snapshot exists."
  };

  const summary = {
    taskId: taskId || "",
    startedAt,
    completedAt,
    status,
    requiredConfirmation,
    applyRunnerEnabled: patchApplyRunnerEnabled(env),
    sandboxManifestPath: taskId ? relativeDataPath("data/patch-sandbox", taskId, "manifest.json") : "",
    rollbackSnapshotPath: taskId ? relativeDataPath("data/patch-snapshots", taskId, "manifest.json") : "",
    applyPath: taskId ? relativeDataPath(relativeRoot, taskId, "manifest.json") : "",
    applyReportPath: taskId ? relativeDataPath(relativeRoot, taskId, "manifest.json") : "",
    appliedFiles,
    candidateFiles: preparedFiles.map((file) => ({
      file: file.file,
      bytes: file.bytes,
      beforeSha256: file.beforeSha256,
      proposedSha256: file.proposedSha256
    })),
    blockers,
    projectRootGuard: summarizeProjectRootGuard(blockers),
    rollbackAvailable,
    rollbackOption,
    applyReport: {
      status,
      generatedAt: completedAt,
      appliedFiles: appliedFiles.length,
      rollbackAvailable,
      rollbackOption
    },
    note: canApply
      ? "Apply runner wrote sandbox proposal files into the selected project after rollback and hash checks."
      : "Apply runner did not write project code because confirmation, environment, rollback, or drift checks are not satisfied."
  };

  if (taskId && applyRoot) {
    const manifestPath = join(applyRoot, taskId, "manifest.json");
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(summary, null, 2), "utf8");
  }

  return {
    ok: status === "applied",
    status,
    summary
  };
}
