import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { assertPathInsideProjectRoot } from "./project-root-guard.mjs";
import { normalizeRelativeProjectPath } from "./patch-runner-policy.mjs";

export const DEFAULT_MAX_CONTEXT_FILES = 8;
export const DEFAULT_MAX_CONTEXT_CHARS = 32_000;
export const DEFAULT_MAX_FILE_CHARS = 8_000;

export const SENSITIVE_CONTEXT_PATH_PATTERN =
  /(^|\/)(\.env|\.git|node_modules|dist|build|coverage|private|secrets?|wallets?|keys?|credentials?|certificates?)(\/|$)|(^|\/)(id_rsa|id_ed25519|known_hosts)$|(\.pem|\.key|\.p12|\.pfx|\.cer|\.crt|\.sqlite|\.db)$/i;

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target"
]);

const CONTEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx"
]);

function oneLine(value = "", max = 500) {
  return String(value || "").replace(/\0/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000
    }).trim();
  } catch (error) {
    return String(error?.stdout || error?.stderr || error?.message || "").trim();
  }
}

export function isSensitiveContextPath(filePath = "") {
  const normalized = normalizeRelativeProjectPath(filePath);
  return !normalized || SENSITIVE_CONTEXT_PATH_PATTERN.test(normalized);
}

function extractTaskFileRefs(text = "") {
  const refs = [];
  const pattern = /(?:^|[\s`"'(])([A-Za-z0-9_./-]+\.(?:md|mjs|js|jsx|ts|tsx|json|css|html))(?:$|[\s`"',)])/g;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    refs.push(match[1]);
  }
  return refs;
}

function keywordsFromTask(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[`"'()[\]{}.,:;!?]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !["coding", "yuan", "office", "please", "update", "change", "生成", "修改"].includes(word))
    .slice(0, 12);
}

function candidateExists(projectPath, filePath) {
  const guarded = assertPathInsideProjectRoot(projectPath, filePath);
  return guarded.ok && existsSync(guarded.absolutePath) && statSync(guarded.absolutePath).isFile();
}

function candidateDirectoryExists(projectPath, filePath) {
  const guarded = assertPathInsideProjectRoot(projectPath, filePath);
  return guarded.ok && existsSync(guarded.absolutePath) && statSync(guarded.absolutePath).isDirectory();
}

function addCandidate(candidates, filePath, reason) {
  const normalized = normalizeRelativeProjectPath(filePath);
  if (!normalized) return;
  if (!candidates.has(normalized)) candidates.set(normalized, reason);
}

function packageScripts(projectPath) {
  const path = join(projectPath, "package.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")).scripts || {};
  } catch {
    return {};
  }
}

function collectFiles(projectPath, limit = 220) {
  const files = [];
  const queue = [""];
  while (queue.length && files.length < limit) {
    const rel = queue.shift();
    const abs = join(projectPath, rel);
    let entries = [];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !isSensitiveContextPath(child)) queue.push(child);
      } else if (entry.isFile()) {
        files.push(child);
        if (files.length >= limit) break;
      }
    }
  }
  return files;
}

function collectFilesUnder(projectPath, startRel, limit = 40) {
  const start = normalizeRelativeProjectPath(startRel);
  if (!start || !candidateDirectoryExists(projectPath, start)) return [];
  return collectFiles(join(projectPath, start), limit)
    .map((file) => `${start}/${file}`)
    .filter((file) => !isSensitiveContextPath(file));
}

function addKeywordCandidates(candidates, projectPath, taskTitle) {
  const keywords = keywordsFromTask(taskTitle);
  if (!keywords.length) return;
  for (const file of collectFiles(projectPath)) {
    if (candidates.size >= 24) break;
    const name = `${basename(file)} ${dirname(file)}`.toLowerCase();
    if (keywords.some((keyword) => name.includes(keyword))) {
      addCandidate(candidates, file, "task_keyword_match");
    }
  }
}

function addUserFileCandidates(candidates, projectPath, userFiles = []) {
  for (const file of userFiles) {
    const normalized = normalizeRelativeProjectPath(file);
    if (!normalized) continue;
    if (candidateDirectoryExists(projectPath, normalized)) {
      for (const child of collectFilesUnder(projectPath, normalized, 30)) {
        addCandidate(candidates, child, "user_specified_directory");
      }
    } else {
      addCandidate(candidates, normalized, "user_specified_file");
    }
  }
}

function changedFilesFromEvidence(evidence = {}) {
  const output = evidence.commands?.find((item) => item.command === "git diff --name-only")?.output || "";
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function buildAiPatchContext({
  projectPath = "",
  projectName = "",
  task = {},
  evidence = {},
  userFiles = [],
  maxFiles = DEFAULT_MAX_CONTEXT_FILES,
  maxChars = DEFAULT_MAX_CONTEXT_CHARS,
  maxFileChars = DEFAULT_MAX_FILE_CHARS
} = {}) {
  const blockers = [];
  const skippedFiles = [];
  const files = [];
  const candidates = new Map();

  if (!projectPath || !existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    return {
      ok: false,
      blockers: [{
        id: "ai_context_project_missing",
        title: "Project root is missing",
        detail: "Choose a local project root before building AI context."
      }],
      files,
      sentFiles: [],
      skippedFiles
    };
  }

  for (const file of ["package.json", "README.md", "README.markdown"]) {
    if (candidateExists(projectPath, file)) addCandidate(candidates, file, file === "package.json" ? "package_manifest" : "readme");
  }
  for (const file of changedFilesFromEvidence(evidence)) addCandidate(candidates, file, "git_diff_changed_file");
  for (const file of extractTaskFileRefs(task.title || "")) addCandidate(candidates, file, "task_file_reference");
  addUserFileCandidates(candidates, projectPath, userFiles);
  addKeywordCandidates(candidates, projectPath, task.title || "");

  let usedChars = 0;
  for (const [file, reason] of candidates) {
    if (files.length >= maxFiles) {
      skippedFiles.push({ file, reason: "max_files_reached" });
      continue;
    }
    if (isSensitiveContextPath(file)) {
      skippedFiles.push({ file, reason: "sensitive_path_skipped" });
      continue;
    }
    const ext = extname(file).toLowerCase();
    if (!CONTEXT_EXTENSIONS.has(ext)) {
      skippedFiles.push({ file, reason: `extension_skipped:${ext || "none"}` });
      continue;
    }
    const guarded = assertPathInsideProjectRoot(projectPath, file);
    if (!guarded.ok) {
      skippedFiles.push({ file, reason: guarded.blockers?.[0]?.id || "project_root_guard_blocked" });
      continue;
    }
    if (!existsSync(guarded.absolutePath)) {
      skippedFiles.push({ file: guarded.relativePath, reason: "file_missing" });
      continue;
    }
    const stat = statSync(guarded.absolutePath);
    if (!stat.isFile()) {
      skippedFiles.push({ file: guarded.relativePath, reason: "not_a_file" });
      continue;
    }
    if (stat.size > maxFileChars * 3) {
      skippedFiles.push({ file: guarded.relativePath, reason: "file_too_large" });
      continue;
    }
    const buffer = readFileSync(guarded.absolutePath);
    if (buffer.includes(0)) {
      skippedFiles.push({ file: guarded.relativePath, reason: "binary_file_skipped" });
      continue;
    }
    let content = buffer.toString("utf8");
    const truncated = content.length > maxFileChars;
    if (truncated) content = content.slice(0, maxFileChars);
    if (usedChars + content.length > maxChars) {
      skippedFiles.push({ file: guarded.relativePath, reason: "max_context_chars_reached" });
      continue;
    }
    usedChars += content.length;
    files.push({
      path: guarded.relativePath,
      reason,
      bytes: stat.size,
      chars: content.length,
      truncated,
      content
    });
  }

  const scripts = packageScripts(projectPath);
  const testScripts = Object.entries(scripts)
    .filter(([name]) => /test|check|lint|type|verify|qa/i.test(name))
    .slice(0, 8)
    .map(([name, command]) => ({ name, command: oneLine(command, 300) }));

  return {
    ok: blockers.length === 0,
    blockers,
    task: {
      id: task.id || "",
      title: oneLine(task.title || "", 500),
      risk: task.risk || "low"
    },
    project: {
      name: oneLine(projectName || task.projectName || "Local project", 200),
      rootLabel: basename(projectPath)
    },
    git: {
      status: evidence.commands?.find((item) => item.command === "git status --short")?.output || run("git", ["status", "--short"], projectPath),
      diffStat: evidence.commands?.find((item) => item.command === "git diff --stat")?.output || run("git", ["diff", "--stat"], projectPath)
    },
    testScripts,
    files,
    sentFiles: files.map((file) => file.path),
    skippedFiles,
    limits: {
      maxFiles,
      maxChars,
      maxFileChars,
      usedChars
    },
    safety: {
      sendsWholeProject: false,
      skippedSensitiveFiles: skippedFiles.filter((file) => file.reason === "sensitive_path_skipped").map((file) => file.file)
    }
  };
}
