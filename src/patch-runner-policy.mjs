const DEFAULT_SAFE_EXTENSIONS = new Set([
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

export const DEFAULT_MAX_PATCH_DRAFTS = 5;
export const DEFAULT_MAX_PATCH_DRAFT_BYTES = 80_000;

const FORBIDDEN_PATH_PATTERN =
  /(^|\/)(\.env|\.git|node_modules|dist|build|coverage|private|secrets?|wallets?|keys?|credentials?)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|package\.json)$|(\.pem|\.key|\.p12|\.sqlite|\.db)$/i;

export function patchRunnerEnabled(env = process.env) {
  return env.CODEX_OFFICE_ENABLE_WRITE_RUNNER === "true";
}

export function patchRunnerMode(env = process.env) {
  return env.CODEX_OFFICE_PATCH_RUNNER_MODE === "sandbox" ? "sandbox" : "dry_run";
}

export function normalizeRelativeProjectPath(filePath = "") {
  const value = String(filePath || "").replaceAll("\\", "/").trim();
  if (!value || value.startsWith("/") || value.includes("\0")) return "";

  const parts = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") return "";
    parts.push(part);
  }

  return parts.join("/");
}

export function extensionOf(filePath = "") {
  const clean = normalizeRelativeProjectPath(filePath);
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index).toLowerCase() : "";
}

export function classifyPatchFile(filePath, options = {}) {
  const safeExtensions = options.safeExtensions || DEFAULT_SAFE_EXTENSIONS;
  const normalized = normalizeRelativeProjectPath(filePath);

  if (!normalized) {
    return {
      ok: false,
      file: "",
      reason: "Path must be a relative project file path."
    };
  }

  if (FORBIDDEN_PATH_PATTERN.test(normalized)) {
    return {
      ok: false,
      file: normalized,
      reason: "Path is blocked by the write-runner safety policy."
    };
  }

  const extension = extensionOf(normalized);
  if (!safeExtensions.has(extension)) {
    return {
      ok: false,
      file: normalized,
      reason: `File extension is not allowlisted: ${extension || "none"}`
    };
  }

  return {
    ok: true,
    file: normalized,
    reason: "allowlisted"
  };
}

export function normalizePatchDrafts(patchDrafts = [], options = {}) {
  const maxFiles = options.maxFiles || DEFAULT_MAX_PATCH_DRAFTS;
  const maxBytes = options.maxBytes || DEFAULT_MAX_PATCH_DRAFT_BYTES;
  const drafts = [];
  const blockers = [];
  const seen = new Set();

  if (!Array.isArray(patchDrafts)) {
    return {
      ok: true,
      drafts,
      blockers
    };
  }

  for (const rawDraft of patchDrafts.slice(0, Math.max(maxFiles + 1, 1))) {
    const review = classifyPatchFile(rawDraft?.file || rawDraft?.path || rawDraft?.filePath || "");
    if (!review.ok) {
      blockers.push({
        id: "draft_file_unsafe",
        title: `Draft file blocked: ${review.file || "unknown"}`,
        detail: review.reason
      });
      continue;
    }

    if (seen.has(review.file)) {
      blockers.push({
        id: "draft_file_duplicate",
        title: `Duplicate draft file: ${review.file}`,
        detail: "Each sandbox draft can target a file only once."
      });
      continue;
    }

    const contentValue = rawDraft?.content ?? rawDraft?.replacement ?? rawDraft?.proposedContent;
    if (contentValue === undefined || contentValue === null) {
      blockers.push({
        id: "draft_content_missing",
        title: `Draft content missing: ${review.file}`,
        detail: "Patch drafts must include proposed file content."
      });
      continue;
    }

    const content = String(contentValue);
    const bytes = Buffer.byteLength(content, "utf8");
    if (content.includes("\0")) {
      blockers.push({
        id: "draft_content_binary",
        title: `Draft content blocked: ${review.file}`,
        detail: "Patch drafts must be text; null bytes are not allowed."
      });
      continue;
    }

    if (bytes > maxBytes) {
      blockers.push({
        id: "draft_content_too_large",
        title: `Draft content too large: ${review.file}`,
        detail: `Draft is ${bytes} bytes; limit is ${maxBytes} bytes.`
      });
      continue;
    }

    seen.add(review.file);
    drafts.push({
      file: review.file,
      content,
      bytes
    });
  }

  if (Array.isArray(patchDrafts) && patchDrafts.length > maxFiles) {
    blockers.push({
      id: "too_many_patch_drafts",
      title: "Too many patch drafts",
      detail: `Patch runner only accepts ${maxFiles} draft file${maxFiles === 1 ? "" : "s"} in this phase.`
    });
  }

  return {
    ok: blockers.length === 0,
    drafts: drafts.slice(0, maxFiles),
    blockers
  };
}

export function validatePatchDraftsForRun({
  patchDrafts = [],
  allowedFiles = [],
  maxFiles = DEFAULT_MAX_PATCH_DRAFTS,
  maxBytes = DEFAULT_MAX_PATCH_DRAFT_BYTES
} = {}) {
  const normalized = normalizePatchDrafts(patchDrafts, { maxFiles, maxBytes });
  const allowed = new Set(allowedFiles.map((file) => normalizeRelativeProjectPath(file)).filter(Boolean));
  const blockers = [...normalized.blockers];

  if (allowed.size) {
    for (const draft of normalized.drafts) {
      if (!allowed.has(draft.file)) {
        blockers.push({
          id: "draft_outside_allowed_files",
          title: `Draft file outside approved patch surface: ${draft.file}`,
          detail: "Patch drafts must match the files approved by evidence, proposal, verification, and human gate."
        });
      }
    }
  }

  return {
    ok: blockers.length === 0,
    drafts: normalized.drafts.filter((draft) => !allowed.size || allowed.has(draft.file)),
    blockers
  };
}

export function classifyPatchRunPreflight({
  task = null,
  proposal = null,
  verification = null,
  humanGate = null,
  changedFiles = [],
  env = process.env,
  maxFiles = 5
} = {}) {
  const blockers = [];
  const fileReviews = [...new Set(changedFiles)]
    .slice(0, 20)
    .map((filePath) => classifyPatchFile(filePath));
  const unsafeFiles = fileReviews.filter((review) => !review.ok);
  const allowedFiles = fileReviews.filter((review) => review.ok).map((review) => review.file).slice(0, maxFiles);

  if (!patchRunnerEnabled(env)) {
    blockers.push({
      id: "write_runner_disabled",
      title: "Controlled write runner is disabled",
      detail: "Set CODEX_OFFICE_ENABLE_WRITE_RUNNER=true after policy, rollback, and approval checks are ready."
    });
  }

  if (!task?.id) {
    blockers.push({
      id: "task_missing",
      title: "Task is missing",
      detail: "Patch runs must be tied to an auditable task."
    });
  }

  if (!proposal) {
    blockers.push({
      id: "proposal_missing",
      title: "Patch proposal is missing",
      detail: "Draft a proposal before running the write runner."
    });
  }

  if (proposal?.risk === "high" || task?.risk === "high") {
    blockers.push({
      id: "risk_high",
      title: "High-risk task remains human-gated",
      detail: "High-risk work needs narrower scope before any write runner can execute."
    });
  }

  if (!verification?.result?.ok) {
    blockers.push({
      id: "verification_not_passing",
      title: "Verification has not passed",
      detail: "Run an allowlisted verification script and attach passing evidence first."
    });
  }

  if (humanGate?.status !== "approved") {
    blockers.push({
      id: "human_gate_not_approved",
      title: "Human gate is not approved",
      detail: "Judge猿 must receive explicit human approval before the write runner starts."
    });
  }

  if (!fileReviews.length) {
    blockers.push({
      id: "no_patch_candidates",
      title: "No safe patch candidate files",
      detail: "The proposal did not identify a concrete file surface for a controlled patch."
    });
  }

  if (fileReviews.length > maxFiles) {
    blockers.push({
      id: "too_many_files",
      title: "Patch surface is too wide",
      detail: `Patch runner only allows ${maxFiles} files in this phase.`
    });
  }

  for (const review of unsafeFiles.slice(0, 5)) {
    blockers.push({
      id: "unsafe_file",
      title: `Unsafe file blocked: ${review.file || "unknown"}`,
      detail: review.reason
    });
  }

  const mode = patchRunnerMode(env);
  return {
    ok: blockers.length === 0,
    status: blockers.length ? "blocked" : mode === "sandbox" ? "sandbox_ready" : "dry_run_ready",
    mode,
    maxFiles,
    allowedFiles,
    blockedFiles: unsafeFiles.map((review) => ({
      file: review.file,
      reason: review.reason
    })),
    blockers
  };
}
