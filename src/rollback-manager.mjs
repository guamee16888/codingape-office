import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertPathInsideProjectRoot, summarizeProjectRootGuard } from "./project-root-guard.mjs";

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

function pathBlocker(id, titlePrefix, filePath, guarded) {
  const guardBlocker = guarded.blockers?.[0];
  return {
    id,
    title: `${titlePrefix}: ${filePath || "unknown"}`,
    detail: guardBlocker?.detail || "Rollback target must remain inside the selected project root.",
    file: String(filePath || ""),
    source: "project_root_guard",
    guardId: guardBlocker?.id || "project_path_unsafe"
  };
}

export function restoreRollbackSnapshot({
  taskId,
  projectPath,
  snapshotRoot,
  rollbackRoot,
  relativeRoot = "data/rollbacks"
} = {}) {
  const startedAt = new Date().toISOString();
  const blockers = [];
  const restoredFiles = [];
  const removedFiles = [];
  const snapshotManifestPath = taskId && snapshotRoot ? join(snapshotRoot, taskId, "manifest.json") : "";
  const manifest = snapshotManifestPath ? readJsonFile(snapshotManifestPath) : null;

  if (!taskId) {
    blockers.push({
      id: "rollback_task_missing",
      title: "Rollback task id is missing",
      detail: "Rollback must be tied to an auditable task."
    });
  }

  if (!projectPath || !snapshotRoot || !rollbackRoot) {
    blockers.push({
      id: "rollback_path_missing",
      title: "Rollback paths are missing",
      detail: "Rollback needs project, snapshot, and report roots."
    });
  }

  if (!manifest?.ok) {
    blockers.push({
      id: "rollback_snapshot_not_ready",
      title: "Rollback snapshot is not ready",
      detail: "Create a valid rollback snapshot before restoring files."
    });
  }

  if (manifest?.projectPath && projectPath && resolve(manifest.projectPath) !== resolve(projectPath)) {
    blockers.push({
      id: "rollback_project_mismatch",
      title: "Rollback snapshot belongs to a different project root",
      detail: manifest.projectPath
    });
  }

  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const prepared = [];
  const snapshotFilesRoot = taskId && snapshotRoot ? join(snapshotRoot, taskId, "files") : "";
  for (const file of files) {
    const target = assertPathInsideProjectRoot(projectPath || "", file.file || "");
    if (!target.ok) {
      blockers.push(pathBlocker("rollback_target_unsafe", "Rollback target blocked", file.file, target));
      continue;
    }

    let snapshotFile = null;
    if (file.existed) {
      snapshotFile = assertPathInsideProjectRoot(snapshotFilesRoot, file.file || "");
      if (!snapshotFile.ok) {
        blockers.push(pathBlocker("rollback_snapshot_path_unsafe", "Rollback snapshot path blocked", file.file, snapshotFile));
        continue;
      }
      if (!existsSync(snapshotFile.absolutePath)) {
        blockers.push({
          id: "rollback_snapshot_file_missing",
          title: `Rollback snapshot file missing: ${file.file}`,
          detail: file.snapshotPath || ""
        });
        continue;
      }
    } else if (existsSync(target.absolutePath) && !statSync(target.absolutePath).isFile()) {
      blockers.push({
        id: "rollback_new_path_not_file",
        title: `Rollback new path is not a file: ${target.relativePath}`,
        detail: "A file that did not exist at snapshot time now points to a non-file path."
      });
      continue;
    }

    prepared.push({
      file: target.relativePath,
      targetPath: target.absolutePath,
      snapshotPath: snapshotFile?.absolutePath || "",
      existed: Boolean(file.existed)
    });
  }

  const canRestore = blockers.length === 0;
  if (canRestore) {
    for (const file of prepared) {
      if (file.existed) {
        const content = readFileSync(file.snapshotPath);
        mkdirSync(dirname(file.targetPath), { recursive: true });
        writeFileSync(file.targetPath, content);
        restoredFiles.push({
          file: file.file,
          bytes: content.length
        });
        continue;
      }

      if (existsSync(file.targetPath)) {
        unlinkSync(file.targetPath);
        removedFiles.push({ file: file.file });
      }
    }
  }

  const completedAt = new Date().toISOString();
  const status = blockers.length ? "blocked" : "rolled_back";
  const summary = {
    taskId: taskId || "",
    startedAt,
    completedAt,
    status,
    snapshotManifestPath: taskId ? relativeDataPath("data/patch-snapshots", taskId, "manifest.json") : "",
    rollbackReportPath: taskId ? relativeDataPath(relativeRoot, taskId, "manifest.json") : "",
    restoredFiles,
    removedFiles,
    blockers,
    projectRootGuard: summarizeProjectRootGuard(blockers),
    note: status === "rolled_back"
      ? "Rollback restored the selected project files to the pre-apply snapshot."
      : "Rollback did not change project files because the snapshot, root, or target checks failed."
  };

  if (taskId && rollbackRoot) {
    const reportPath = join(rollbackRoot, taskId, "manifest.json");
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(summary, null, 2), "utf8");
  }

  return {
    ok: status === "rolled_back",
    status,
    summary
  };
}
