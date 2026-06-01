import { isAbsolute, relative, resolve } from "node:path";

export const PROJECT_ROOT_GUARD_SOURCE = "project_root_guard";

export function projectRootGuardBlocker(id, title, detail, filePath = "") {
  return {
    id,
    title,
    detail,
    file: String(filePath || ""),
    source: PROJECT_ROOT_GUARD_SOURCE
  };
}

export function normalizeProjectRelativePath(filePath = "") {
  const raw = String(filePath || "").replaceAll("\\", "/").trim();

  if (!raw) {
    return {
      ok: false,
      path: "",
      blocker: projectRootGuardBlocker(
        "project_path_empty",
        "Project path is empty",
        "Target paths must name a file inside the selected project.",
        filePath
      )
    };
  }

  if (raw.includes("\0")) {
    return {
      ok: false,
      path: "",
      blocker: projectRootGuardBlocker(
        "project_path_null_byte",
        "Project path contains a null byte",
        "Null bytes are not valid project file targets.",
        filePath
      )
    };
  }

  if (raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw)) {
    return {
      ok: false,
      path: "",
      blocker: projectRootGuardBlocker(
        "project_path_absolute",
        "Project path is absolute",
        "Write targets must be relative to the selected project root.",
        filePath
      )
    };
  }

  const parts = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      return {
        ok: false,
        path: "",
        blocker: projectRootGuardBlocker(
          "project_path_traversal",
          "Project path attempts traversal",
          "Write targets cannot use .. to leave the selected project root.",
          filePath
        )
      };
    }
    parts.push(part);
  }

  if (!parts.length) {
    return {
      ok: false,
      path: "",
      blocker: projectRootGuardBlocker(
        "project_path_empty",
        "Project path is empty",
        "Target paths must name a file inside the selected project.",
        filePath
      )
    };
  }

  return {
    ok: true,
    path: parts.join("/"),
    blocker: null
  };
}

export function assertPathInsideProjectRoot(projectRoot, filePath = "") {
  if (!projectRoot) {
    return {
      ok: false,
      absolutePath: "",
      relativePath: "",
      blockers: [
        projectRootGuardBlocker(
          "project_root_missing",
          "Project root is missing",
          "A selected project root is required before any project write can be prepared.",
          filePath
        )
      ]
    };
  }

  const normalized = normalizeProjectRelativePath(filePath);
  if (!normalized.ok) {
    return {
      ok: false,
      absolutePath: "",
      relativePath: "",
      blockers: [normalized.blocker]
    };
  }

  const root = resolve(projectRoot);
  const target = resolve(root, normalized.path);
  const rel = relative(root, target);

  if (!rel || rel.startsWith("..") || isAbsolute(rel) || resolve(root, rel) !== target) {
    return {
      ok: false,
      absolutePath: target,
      relativePath: normalized.path,
      blockers: [
        projectRootGuardBlocker(
          "project_path_outside_root",
          "Project path escapes the selected root",
          "The resolved write target is outside the selected project root.",
          filePath
        )
      ]
    };
  }

  return {
    ok: true,
    absolutePath: target,
    relativePath: rel.replaceAll("\\", "/"),
    blockers: []
  };
}

export function guardProjectWriteTargets(projectRoot, files = []) {
  const safeFiles = [];
  const blockedFiles = [];
  const blockers = [];

  for (const file of files) {
    const result = assertPathInsideProjectRoot(projectRoot, file);
    if (result.ok) {
      safeFiles.push({
        file: result.relativePath,
        absolutePath: result.absolutePath
      });
    } else {
      blockedFiles.push(String(file || ""));
      blockers.push(...result.blockers);
    }
  }

  return {
    ok: blockers.length === 0,
    files: safeFiles,
    blockedFiles,
    blockers
  };
}

export function isProjectRootGuardBlocker(blocker = {}) {
  return blocker.source === PROJECT_ROOT_GUARD_SOURCE || String(blocker.guardId || "").startsWith("project_path_");
}

export function summarizeProjectRootGuard(blockers = []) {
  const guardBlockers = blockers.filter(isProjectRootGuardBlocker);
  return {
    blocked: guardBlockers.length > 0,
    blockers: guardBlockers
  };
}
