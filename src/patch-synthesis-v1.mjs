import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { classifyPatchFile, normalizePatchDrafts, normalizeRelativeProjectPath } from "./patch-runner-policy.mjs";
import { assertPathInsideProjectRoot } from "./project-root-guard.mjs";

const DEFAULT_NOTE_FILE = "docs/coding-yuan-task-notes.md";
const DEFAULT_REPORT_FILE = "docs/company-report.md";
const MAX_EXISTING_BYTES = 80_000;
const MARKER_PREFIX = "coding-yuan-synthesis";
const QUOTED_FILE_PATTERN = /[`"']([^`"']+\.(?:md|markdown|html|css|js|jsx|mjs|ts|tsx|json))[`"']/gi;
const PATH_FILE_PATTERN = /(?:^|\s)((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:md|markdown|html|css|js|jsx|mjs|ts|tsx|json))(?:\s|$|[),，。])/gi;
const DOC_FILE_PATTERN = /\b(README\.md|CHANGELOG\.md|TODO\.md)\b/gi;

function oneLine(value = "", max = 180) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function extractPatchSynthesisFileRefs(text = "") {
  const input = String(text || "");
  const refs = [];

  for (const match of input.matchAll(QUOTED_FILE_PATTERN)) refs.push(match[1]);
  for (const match of input.matchAll(PATH_FILE_PATTERN)) refs.push(match[1]);
  for (const match of input.matchAll(DOC_FILE_PATTERN)) refs.push(match[1]);

  return unique(refs.map((ref) => ref.replaceAll("\\", "/").trim()));
}

function targetFileForTask(title = "", projectPath = "") {
  const refs = extractPatchSynthesisFileRefs(title);
  const reviews = refs.map((file) => classifyPatchFile(file));
  const unsafe = reviews.filter((review) => !review.ok);
  if (unsafe.length) {
    return {
      ok: false,
      blockers: unsafe.map((review) => ({
        id: "patch_synthesis_target_unsafe",
        title: `Patch synthesis target blocked: ${review.file || "unknown"}`,
        detail: review.reason
      }))
    };
  }

  if (reviews[0]?.file) {
    return {
      ok: true,
      file: reviews[0].file,
      reason: "explicit_file_reference"
    };
  }

  if (/readme|说明|介绍|安装|启动/i.test(title) && existsSync(join(projectPath, "README.md"))) {
    return {
      ok: true,
      file: "README.md",
      reason: "readme_task"
    };
  }

  if (/report|company report|报告|战报/i.test(title)) {
    return {
      ok: true,
      file: DEFAULT_REPORT_FILE,
      reason: "report_task"
    };
  }

  return {
    ok: true,
    file: DEFAULT_NOTE_FILE,
    reason: "task_note"
  };
}

function commentSyntax(filePath = "") {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (ext === ".html") return ["<!--", "-->"];
  if (ext === ".css" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".ts" || ext === ".tsx") {
    return ["/*", "*/"];
  }
  return ["", ""];
}

function markdownSection({ task, projectName, file, reason, now }) {
  const taskId = oneLine(task?.id || "draft", 80);
  const title = oneLine(task?.title || "Untitled task", 220);
  return [
    `<!-- ${MARKER_PREFIX}:${taskId} -->`,
    `## Coding猿 Patch Draft - ${now.slice(0, 10)}`,
    "",
    `- Task: ${title}`,
    `- Project: ${oneLine(projectName || task?.projectName || task?.projectId || "Local project", 160)}`,
    `- Target file: ${file}`,
    `- Synthesis reason: ${reason}`,
    "- Safety: draft only, no project file is changed until Human Gate and Apply Gate pass.",
    "",
    "### Proposed Change",
    "",
    `Record the task intent and create an auditable patch surface for: ${title}`,
    "",
    "### Verification",
    "",
    "- Run the selected project verification script before Apply Gate.",
    "- Review the generated diff before enabling local writes.",
    `<!-- /${MARKER_PREFIX}:${taskId} -->`,
    ""
  ].join("\n");
}

function commentedSection({ task, projectName, file, reason, now }) {
  const [open, close] = commentSyntax(file);
  if (!open || !close) return "";
  const title = oneLine(task?.title || "Untitled task", 220);
  return [
    open,
    ` * Coding猿 Patch Draft - ${now.slice(0, 10)}`,
    ` * Task: ${title}`,
    ` * Project: ${oneLine(projectName || task?.projectName || task?.projectId || "Local project", 160)}`,
    ` * Synthesis reason: ${reason}`,
    " * Safety: draft only until Human Gate and Apply Gate pass.",
    close,
    ""
  ].join("\n");
}

function draftContentForTarget({ task, projectName, projectPath, file, reason, now }) {
  const target = assertPathInsideProjectRoot(projectPath, file);
  if (!target.ok) {
    return {
      ok: false,
      blocker: target.blockers?.[0] || {
        id: "patch_synthesis_target_outside_root",
        title: "Patch synthesis target is outside project root",
        detail: file
      }
    };
  }

  const existed = existsSync(target.absolutePath);
  let existing = "";
  if (existed) {
    const stat = statSync(target.absolutePath);
    if (stat.size > MAX_EXISTING_BYTES) {
      return {
        ok: false,
        blocker: {
          id: "patch_synthesis_target_too_large",
          title: `Patch synthesis target too large: ${target.relativePath}`,
          detail: `File is ${stat.size} bytes; limit is ${MAX_EXISTING_BYTES} bytes.`
        }
      };
    }
    const buffer = readFileSync(target.absolutePath);
    if (buffer.includes(0)) {
      return {
        ok: false,
        blocker: {
          id: "patch_synthesis_target_binary",
          title: `Patch synthesis target is binary: ${target.relativePath}`,
          detail: "Patch synthesis v1 only prepares text file drafts."
        }
      };
    }
    existing = buffer.toString("utf8");
  }

  const ext = target.relativePath.slice(target.relativePath.lastIndexOf(".")).toLowerCase();
  const section = ext === ".md" || ext === ".markdown"
    ? markdownSection({ task, projectName, file: target.relativePath, reason, now })
    : commentedSection({ task, projectName, file: target.relativePath, reason, now });

  if (!section) {
    return {
      ok: false,
      blocker: {
        id: "patch_synthesis_format_unsupported",
        title: `Patch synthesis format unsupported: ${target.relativePath}`,
        detail: "Patch synthesis v1 only drafts Markdown or comment-safe text files."
      }
    };
  }

  const prefix = existed
    ? existing.replace(/\s*$/, "\n\n")
    : target.relativePath === DEFAULT_NOTE_FILE
      ? "# Coding猿 Task Notes\n\n"
      : `${target.relativePath.startsWith("docs/") ? `# ${dirname(target.relativePath).split("/").at(-1) || "Coding猿"}\n\n` : ""}`;

  return {
    ok: true,
    draft: {
      file: normalizeRelativeProjectPath(target.relativePath),
      content: `${prefix}${section}`
    },
    existed
  };
}

export function synthesizePatchDraftsV1({
  task = {},
  projectPath = "",
  projectName = "",
  now = new Date().toISOString()
} = {}) {
  const blockers = [];
  const title = oneLine(task.title || "", 220);

  if (!title) {
    return {
      ok: false,
      drafts: [],
      blockers: [{
        id: "patch_synthesis_task_missing",
        title: "Patch synthesis task title is missing",
        detail: "A task title is required before creating a patch draft."
      }],
      summary: null
    };
  }

  if (!projectPath || !existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    return {
      ok: false,
      drafts: [],
      blockers: [{
        id: "patch_synthesis_project_missing",
        title: "Patch synthesis project root is missing",
        detail: "Choose a local project root before synthesizing a patch draft."
      }],
      summary: null
    };
  }

  const target = targetFileForTask(title, projectPath);
  if (!target.ok) {
    return {
      ok: false,
      drafts: [],
      blockers: target.blockers,
      summary: null
    };
  }

  const content = draftContentForTarget({
    task,
    projectName,
    projectPath,
    file: target.file,
    reason: target.reason,
    now
  });

  if (!content.ok) blockers.push(content.blocker);
  const normalized = normalizePatchDrafts(content.ok ? [content.draft] : [], { maxFiles: 1 });
  blockers.push(...normalized.blockers);

  return {
    ok: blockers.length === 0 && normalized.drafts.length > 0,
    drafts: normalized.drafts,
    blockers,
    summary: normalized.drafts[0]
      ? {
          version: "v1",
          generatedAt: now,
          strategy: "deterministic_task_note",
          targetFile: normalized.drafts[0].file,
          targetReason: target.reason,
          targetExisted: Boolean(content.existed),
          note: "Patch synthesis v1 prepares a reviewable draft only; Apply Gate still controls project writes."
        }
      : null
  };
}
