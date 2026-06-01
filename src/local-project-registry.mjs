import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import { homedir } from "node:os";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeProjectRootPath(value = "", env = process.env) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      ok: false,
      blocker: {
        id: "project_root_empty",
        title: "Project root is required",
        detail: "Choose a local project folder before running evidence, diff, or apply."
      }
    };
  }

  if (raw.includes("\0")) {
    return {
      ok: false,
      blocker: {
        id: "project_root_null_byte",
        title: "Project root path is unsafe",
        detail: "Project root cannot contain null bytes."
      }
    };
  }

  const expanded = raw === "~" || raw.startsWith("~/")
    ? `${env.HOME || homedir()}${raw.slice(1)}`
    : raw;
  const rootPath = resolve(expanded);
  return {
    ok: true,
    path: rootPath
  };
}

export function localProjectIdForPath(rootPath = "") {
  return `local_${sha256(resolve(String(rootPath || ""))).slice(0, 16)}`;
}

export function readLocalProjectRegistry(registryPath) {
  if (!registryPath || !existsSync(registryPath)) {
    return {
      selectedProjectId: "",
      projects: []
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
    const projects = Array.isArray(parsed?.projects)
      ? parsed.projects.filter((project) => project?.id && project?.path)
      : [];
    return {
      selectedProjectId: String(parsed?.selectedProjectId || ""),
      projects
    };
  } catch {
    return {
      selectedProjectId: "",
      projects: []
    };
  }
}

export function saveLocalProjectRegistry(registryPath, registry) {
  mkdirSync(dirname(registryPath), { recursive: true });
  const payload = {
    selectedProjectId: registry?.selectedProjectId || "",
    projects: Array.isArray(registry?.projects) ? registry.projects : []
  };
  writeFileSync(registryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function upsertLocalProjectRecord(registryPath, input = {}, options = {}) {
  const normalized = normalizeProjectRootPath(input.path, options.env);
  if (!normalized.ok) {
    return {
      ok: false,
      status: "blocked",
      blocker: normalized.blocker
    };
  }

  if (!existsSync(normalized.path)) {
    return {
      ok: false,
      status: "blocked",
      blocker: {
        id: "project_root_missing",
        title: "Project root does not exist",
        detail: normalized.path
      }
    };
  }

  const stat = statSync(normalized.path);
  if (!stat.isDirectory()) {
    return {
      ok: false,
      status: "blocked",
      blocker: {
        id: "project_root_not_directory",
        title: "Project root must be a folder",
        detail: normalized.path
      }
    };
  }

  const now = options.now || new Date().toISOString();
  const registry = readLocalProjectRegistry(registryPath);
  const id = localProjectIdForPath(normalized.path);
  const existing = registry.projects.find((project) => project.id === id);
  const record = {
    id,
    name: String(input.name || existing?.name || basename(normalized.path) || "Local Project").trim().slice(0, 80),
    path: normalized.path,
    securityScopedBookmark: String(input.securityScopedBookmark || existing?.securityScopedBookmark || ""),
    authorizationSource: String(input.authorizationSource || existing?.authorizationSource || "local_path"),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastSelectedAt: input.selected === false ? existing?.lastSelectedAt || "" : now
  };
  const projects = [
    record,
    ...registry.projects.filter((project) => project.id !== id)
  ].slice(0, 30);
  const selectedProjectId = input.selected === false
    ? registry.selectedProjectId
    : id;
  const saved = saveLocalProjectRegistry(registryPath, {
    selectedProjectId,
    projects
  });

  return {
    ok: true,
    status: "saved",
    project: record,
    registry: saved
  };
}

export function selectLocalProjectRecord(registryPath, projectId, options = {}) {
  const registry = readLocalProjectRegistry(registryPath);
  const project = registry.projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return {
      ok: false,
      status: "blocked",
      blocker: {
        id: "local_project_not_found",
        title: "Local project record not found",
        detail: String(projectId || "")
      }
    };
  }

  const now = options.now || new Date().toISOString();
  const projects = registry.projects.map((candidate) =>
    candidate.id === project.id
      ? { ...candidate, updatedAt: now, lastSelectedAt: now }
      : candidate
  );
  const saved = saveLocalProjectRegistry(registryPath, {
    selectedProjectId: project.id,
    projects
  });

  return {
    ok: true,
    status: "selected",
    project: projects.find((candidate) => candidate.id === project.id),
    registry: saved
  };
}

export function selectedLocalProjectRecord(registry) {
  return registry?.projects?.find((project) => project.id === registry.selectedProjectId) || null;
}
