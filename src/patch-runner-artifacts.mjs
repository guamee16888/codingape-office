import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_MAX_PATCH_DRAFT_BYTES,
  DEFAULT_MAX_PATCH_DRAFTS,
  normalizeRelativeProjectPath,
  validatePatchDraftsForRun
} from "./patch-runner-policy.mjs";
import { assertPathInsideProjectRoot } from "./project-root-guard.mjs";

export const DEFAULT_MAX_SNAPSHOT_FILE_BYTES = 200_000;
export const DEFAULT_MAX_SANDBOX_ORIGINAL_BYTES = 200_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function relativeDataPath(rootLabel, taskId, suffix) {
  return `${rootLabel}/${taskId}/${suffix}`.replaceAll("\\", "/");
}

function splitDiffLines(content = "") {
  const value = String(content);
  if (!value) return [];
  const lines = value.split("\n");
  if (value.endsWith("\n")) lines.pop();
  return lines;
}

function lineOperations(originalLines, proposedLines) {
  const rows = originalLines.length + 1;
  const cols = proposedLines.length + 1;

  if (rows * cols > 120_000) {
    return [
      ...originalLines.map((line) => ({ type: "delete", line })),
      ...proposedLines.map((line) => ({ type: "add", line }))
    ];
  }

  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = originalLines.length - 1; i >= 0; i -= 1) {
    for (let j = proposedLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] = originalLines[i] === proposedLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;
  while (i < originalLines.length || j < proposedLines.length) {
    if (i < originalLines.length && j < proposedLines.length && originalLines[i] === proposedLines[j]) {
      operations.push({ type: "context", line: originalLines[i] });
      i += 1;
      j += 1;
    } else if (j < proposedLines.length && (i === originalLines.length || dp[i][j + 1] >= dp[i + 1][j])) {
      operations.push({ type: "add", line: proposedLines[j] });
      j += 1;
    } else if (i < originalLines.length) {
      operations.push({ type: "delete", line: originalLines[i] });
      i += 1;
    }
  }

  return operations;
}

export function createUnifiedDiff(filePath, originalContent = "", proposedContent = "") {
  if (String(originalContent) === String(proposedContent)) return "";

  const originalLines = splitDiffLines(originalContent);
  const proposedLines = splitDiffLines(proposedContent);
  const operations = lineOperations(originalLines, proposedLines);
  const header = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${originalLines.length} +1,${proposedLines.length} @@`
  ];
  const body = operations.map((operation) => {
    const prefix = operation.type === "add" ? "+" : operation.type === "delete" ? "-" : " ";
    return `${prefix}${operation.line}`;
  });

  return `${header.concat(body).join("\n")}\n`;
}

export function safeProjectFilePath(projectPath, filePath) {
  const guarded = assertPathInsideProjectRoot(projectPath, filePath);
  if (!guarded.ok) return null;

  return {
    absolutePath: guarded.absolutePath,
    relativePath: guarded.relativePath
  };
}

function pathGuardBlocker(id, titlePrefix, filePath, guarded) {
  const guardBlocker = guarded.blockers?.[0];
  return {
    id,
    title: `${titlePrefix}: ${filePath || "unknown"}`,
    detail: guardBlocker?.detail || "Target must remain inside the selected project root.",
    file: String(filePath || ""),
    source: "project_root_guard",
    guardId: guardBlocker?.id || "project_path_unsafe"
  };
}

export function createRollbackSnapshot({
  taskId,
  projectPath,
  files = [],
  snapshotRoot,
  relativeRoot = "data/patch-snapshots",
  maxBytes = DEFAULT_MAX_SNAPSHOT_FILE_BYTES
} = {}) {
  const blockers = [];
  const snapshotFiles = [];

  if (!taskId) {
    blockers.push({
      id: "snapshot_task_missing",
      title: "Snapshot task id is missing",
      detail: "Rollback snapshots must be tied to a task."
    });
  }

  if (!projectPath || !snapshotRoot) {
    blockers.push({
      id: "snapshot_path_missing",
      title: "Snapshot root is missing",
      detail: "Rollback snapshots need both a project path and a snapshot root."
    });
  }

  for (const file of files) {
    const guarded = assertPathInsideProjectRoot(projectPath, file);
    if (!guarded.ok) {
      blockers.push(pathGuardBlocker("snapshot_path_unsafe", "Snapshot path blocked", file, guarded));
      continue;
    }
    const target = {
      absolutePath: guarded.absolutePath,
      relativePath: guarded.relativePath
    };

    const existed = existsSync(target.absolutePath);
    if (!existed) {
      snapshotFiles.push({
        file: target.relativePath,
        existed: false,
        bytes: 0,
        sha256: "",
        snapshotPath: ""
      });
      continue;
    }

    const stat = statSync(target.absolutePath);
    if (stat.size > maxBytes) {
      blockers.push({
        id: "snapshot_file_too_large",
        title: `Snapshot file too large: ${target.relativePath}`,
        detail: `File is ${stat.size} bytes; limit is ${maxBytes} bytes.`
      });
      continue;
    }

    const content = readFileSync(target.absolutePath);
    const snapshotPath = join(snapshotRoot, taskId, "files", target.relativePath);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, content);

    snapshotFiles.push({
      file: target.relativePath,
      existed: true,
      bytes: stat.size,
      sha256: sha256(content),
      snapshotPath: relativeDataPath(relativeRoot, taskId, `files/${target.relativePath}`)
    });
  }

  const manifest = {
    taskId: taskId || "",
    createdAt: new Date().toISOString(),
    projectPath: projectPath || "",
    maxBytes,
    ok: blockers.length === 0,
    files: snapshotFiles,
    blockers
  };

  if (taskId && snapshotRoot) {
    const manifestPath = join(snapshotRoot, taskId, "manifest.json");
    mkdirSync(dirname(manifestPath), { recursive: true });
    manifest.manifestPath = relativeDataPath(relativeRoot, taskId, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  } else {
    manifest.manifestPath = "";
  }

  return manifest;
}

export function createSandboxPatchPackage({
  taskId,
  projectPath,
  allowedFiles = [],
  patchDrafts = [],
  sandboxRoot,
  relativeRoot = "data/patch-sandbox",
  maxDrafts = DEFAULT_MAX_PATCH_DRAFTS,
  maxDraftBytes = DEFAULT_MAX_PATCH_DRAFT_BYTES,
  maxOriginalBytes = DEFAULT_MAX_SANDBOX_ORIGINAL_BYTES,
  summaryMarkdown = ""
} = {}) {
  const blockers = [];
  const preparedFiles = [];

  if (!taskId) {
    blockers.push({
      id: "sandbox_task_missing",
      title: "Sandbox task id is missing",
      detail: "Sandbox patch packages must be tied to a task."
    });
  }

  if (!projectPath || !sandboxRoot) {
    blockers.push({
      id: "sandbox_path_missing",
      title: "Sandbox root is missing",
      detail: "Sandbox patch packages need both a project path and a sandbox root."
    });
  }

  const validation = validatePatchDraftsForRun({
    patchDrafts,
    allowedFiles,
    maxFiles: maxDrafts,
    maxBytes: maxDraftBytes
  });
  blockers.push(...validation.blockers);

  for (const draft of validation.drafts) {
    const guarded = assertPathInsideProjectRoot(projectPath, draft.file);
    if (!guarded.ok) {
      blockers.push(pathGuardBlocker("sandbox_path_unsafe", "Sandbox path blocked", draft.file, guarded));
      continue;
    }
    const target = {
      absolutePath: guarded.absolutePath,
      relativePath: guarded.relativePath
    };

    const existed = existsSync(target.absolutePath);
    let originalBuffer = Buffer.from("");
    if (existed) {
      const stat = statSync(target.absolutePath);
      if (stat.size > maxOriginalBytes) {
        blockers.push({
          id: "sandbox_original_too_large",
          title: `Original file too large: ${target.relativePath}`,
          detail: `File is ${stat.size} bytes; limit is ${maxOriginalBytes} bytes.`
        });
        continue;
      }

      originalBuffer = readFileSync(target.absolutePath);
      if (originalBuffer.includes(0)) {
        blockers.push({
          id: "sandbox_original_binary",
          title: `Original file blocked: ${target.relativePath}`,
          detail: "Sandbox patch packages only support text files."
        });
        continue;
      }
    }

    const originalContent = originalBuffer.toString("utf8");
    const diff = createUnifiedDiff(target.relativePath, originalContent, draft.content);
    preparedFiles.push({
      file: target.relativePath,
      existed,
      originalBytes: Buffer.byteLength(originalContent, "utf8"),
      proposedBytes: draft.bytes,
      originalSha256: existed ? sha256(originalBuffer) : "",
      proposedSha256: sha256(draft.content),
      changed: Boolean(diff),
      content: draft.content,
      diff
    });
  }

  const manifest = {
    taskId: taskId || "",
    createdAt: new Date().toISOString(),
    projectPath: projectPath || "",
    allowedFiles: allowedFiles.map((file) => normalizeRelativeProjectPath(file)).filter(Boolean),
    maxDrafts,
    maxDraftBytes,
    maxOriginalBytes,
    ok: blockers.length === 0,
    files: preparedFiles.map((file) => ({
      file: file.file,
      existed: file.existed,
      changed: file.changed,
      originalBytes: file.originalBytes,
      proposedBytes: file.proposedBytes,
      originalSha256: file.originalSha256,
      proposedSha256: file.proposedSha256,
      sandboxPath: relativeDataPath(relativeRoot, taskId || "", `files/${file.file}`)
    })),
    blockers,
    diffPath: "",
    summaryPath: "",
    manifestPath: "",
    diffPreview: ""
  };

  if (taskId && sandboxRoot) {
    const taskRoot = join(sandboxRoot, taskId);
    mkdirSync(taskRoot, { recursive: true });

    if (manifest.ok) {
      for (const file of preparedFiles) {
        const sandboxPath = join(taskRoot, "files", file.file);
        mkdirSync(dirname(sandboxPath), { recursive: true });
        writeFileSync(sandboxPath, file.content, "utf8");
      }

      const diffContent = preparedFiles.map((file) => file.diff).filter(Boolean).join("\n");
      if (diffContent) {
        writeFileSync(join(taskRoot, "diff.patch"), diffContent, "utf8");
        manifest.diffPath = relativeDataPath(relativeRoot, taskId, "diff.patch");
        manifest.diffPreview = diffContent.slice(0, 5000);
      } else {
        manifest.diffPreview = "";
      }

      if (summaryMarkdown) {
        writeFileSync(join(taskRoot, "summary.md"), summaryMarkdown, "utf8");
        manifest.summaryPath = relativeDataPath(relativeRoot, taskId, "summary.md");
      }
    }

    manifest.manifestPath = relativeDataPath(relativeRoot, taskId, "manifest.json");
    writeFileSync(join(taskRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  }

  return manifest;
}
