import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSensitiveContextPath } from "./ai-context-builder-v1.mjs";
import { createUnifiedDiff } from "./patch-runner-artifacts.mjs";
import { classifyPatchFile, normalizePatchDrafts, normalizeRelativeProjectPath } from "./patch-runner-policy.mjs";
import { assertPathInsideProjectRoot } from "./project-root-guard.mjs";
import { modelProviderReady, normalizeModelProviderSettings } from "./model-provider-settings.mjs";

const DEFAULT_PROVIDER_TIMEOUT_MS = 120_000;
const DEFAULT_PROVIDER_RETRIES = 2;
const DEFAULT_PROVIDER_RETRY_BACKOFF_MS = 1000;

function trim(value = "", max = 4000) {
  const text = String(value || "").replace(/\0/g, "").trim();
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

function safeArray(value, max = 20) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function unique(value = []) {
  return [...new Set(value.filter(Boolean))];
}

function extractJson(text = "") {
  const value = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(value);
  } catch {
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(value.slice(first, last + 1));
    throw new Error("Model did not return valid JSON.");
  }
}

function providerUrl(settings, kind) {
  const endpoint = String(settings.endpoint || "").replace(/\/+$/, "");
  if (settings.provider === "openai") return `${endpoint || "https://api.openai.com/v1"}/chat/completions`;
  if (settings.provider === "anthropic") return `${endpoint || "https://api.anthropic.com/v1"}/messages`;
  if (settings.provider === "gemini") return `${endpoint || "https://generativelanguage.googleapis.com/v1beta"}/models/${settings.model}:generateContent?key=${encodeURIComponent(settings.apiKey || "")}`;
  if (settings.provider === "ollama") return `${endpoint || "http://127.0.0.1:11434"}/api/generate`;
  return `${endpoint || "http://127.0.0.1:1234/v1"}/chat/completions`;
}

function envNumber(name, fallback) {
  const value = Number(globalThis.process?.env?.[name]);
  return Number.isFinite(value) ? value : fallback;
}

function providerRetryConfig({ timeoutMs, retries, retryBackoffMs } = {}) {
  return {
    timeoutMs: Number.isFinite(Number(timeoutMs))
      ? Number(timeoutMs)
      : envNumber("AI_PROVIDER_TIMEOUT_MS", DEFAULT_PROVIDER_TIMEOUT_MS),
    retries: Number.isFinite(Number(retries))
      ? Math.max(0, Number(retries))
      : Math.max(0, envNumber("AI_PROVIDER_RETRIES", DEFAULT_PROVIDER_RETRIES)),
    retryBackoffMs: Number.isFinite(Number(retryBackoffMs))
      ? Math.max(0, Number(retryBackoffMs))
      : Math.max(0, envNumber("AI_PROVIDER_RETRY_BACKOFF_MS", DEFAULT_PROVIDER_RETRY_BACKOFF_MS))
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerError(message, fields = {}) {
  const error = new Error(message);
  Object.assign(error, fields);
  return error;
}

export function classifyProviderError(error = {}) {
  const message = String(error?.message || "");
  const code = String(error?.code || error?.cause?.code || "");
  const status = Number(error?.statusCode || error?.status || 0);
  if (error.failureCategory) return error.failureCategory;
  if (/timed out|timeout|AbortError/i.test(message) || ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(code)) return "timeout";
  if (status === 429) return "provider_rate_limited";
  if (status >= 500) return "provider_5xx";
  if (/fetch failed|network|socket/i.test(message) || ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(code)) return "transport_error";
  return "unknown";
}

function retryableProviderError(error = {}) {
  return ["transport_error", "timeout", "provider_rate_limited", "provider_5xx"].includes(classifyProviderError(error));
}

async function parseModelResponse(settings, response) {
  if (!response.ok) {
    throw providerError(`Model provider returned ${response.status}`, {
      statusCode: response.status,
      failureCategory: classifyProviderError({ statusCode: response.status })
    });
  }
  const data = await response.json();
  if (settings.provider === "anthropic") return data.content?.map((item) => item.text || "").join("\n") || "";
  if (settings.provider === "gemini") return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  if (settings.provider === "ollama") return data.response || "";
  return data.choices?.[0]?.message?.content || data.response || "";
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS) {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) return fetchImpl(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw providerError(`Model provider request timed out after ${timeout}ms.`, {
        code: "ETIMEDOUT",
        failureCategory: "timeout"
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(settings, prompt, {
  fetchImpl = globalThis.fetch,
  kind = "plan",
  timeoutMs,
  retries,
  retryBackoffMs
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Current runtime does not provide fetch.");
  const retryConfig = providerRetryConfig({ timeoutMs, retries, retryBackoffMs });
  const headers = { "content-type": "application/json" };
  let body;

  if (settings.providerMode === "byo_key" && settings.provider !== "gemini") {
    if (settings.provider === "anthropic") headers["x-api-key"] = settings.apiKey;
    else headers.authorization = `Bearer ${settings.apiKey}`;
  }
  if (settings.provider === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: settings.model,
      max_tokens: kind === "patch" ? 3000 : 1200,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }]
    };
  } else if (settings.provider === "gemini") {
    body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    };
  } else if (settings.provider === "ollama") {
    body = {
      model: settings.model,
      prompt,
      stream: false,
      format: "json",
      options: { temperature: 0.1 }
    };
  } else {
    body = {
      model: settings.model,
      temperature: 0.1,
      max_tokens: kind === "patch" ? 3000 : 1200,
      messages: [
        {
          role: "system",
          content: kind === "patch"
            ? "You are Coding猿, a cautious local AI patch worker. Follow the requested patch output format exactly. No extra prose."
            : "You are Coding猿, a cautious local AI patch worker. Output JSON only."
        },
        { role: "user", content: prompt }
      ]
    };
  }

  const startedAt = Date.now();
  const maxAttempts = retryConfig.retries + 1;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, providerUrl(settings, kind), {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      }, retryConfig.timeoutMs);
      const text = await parseModelResponse(settings, response);
      return {
        text,
        providerMeta: {
          attempts: attempt,
          providerLatencyMs: Date.now() - startedAt,
          timeoutMs: retryConfig.timeoutMs,
          retries: retryConfig.retries,
          retryBackoffMs: retryConfig.retryBackoffMs,
          modelCompleted: true
        }
      };
    } catch (error) {
      lastError = error;
      const category = classifyProviderError(error);
      const canRetry = retryableProviderError(error) && attempt < maxAttempts;
      if (!canRetry) {
        throw providerError(error?.message || "Model provider request failed.", {
          failureCategory: canRetry ? category : attempt > 1 && retryableProviderError(error) ? "retry_exhausted" : category,
          providerFailureCategory: category,
          statusCode: error?.statusCode || 0,
          attempts: attempt,
          providerLatencyMs: Date.now() - startedAt,
          timeoutMs: retryConfig.timeoutMs,
          retries: retryConfig.retries,
          retryBackoffMs: retryConfig.retryBackoffMs
        });
      }
      await sleep(retryConfig.retryBackoffMs * attempt);
    }
  }
  throw lastError;
}

function contextForPrompt(context = {}) {
  const fileBlocks = safeArray(context.files, 10).map((file) => [
    `FILE: ${file.path}`,
    `REASON: ${file.reason}`,
    "```",
    trim(file.content || "", 9000),
    "```"
  ].join("\n")).join("\n\n");
  return [
    `Task: ${context.task?.title || ""}`,
    `Project: ${context.project?.name || ""}`,
    `Git status:\n${trim(context.git?.status || "", 1800)}`,
    `Git diff stat:\n${trim(context.git?.diffStat || "", 1800)}`,
    `Detected test scripts: ${safeArray(context.testScripts, 8).map((script) => `${script.name}: ${script.command}`).join("; ") || "none"}`,
    `Files sent to model: ${(context.sentFiles || []).join(", ") || "none"}`,
    fileBlocks
  ].join("\n\n");
}

export function buildPlanPrompt(context = {}) {
  return [
    "Generate a cautious code-change plan for this local Mac app task.",
    "Do not ask for the entire project. Use only the provided snippets.",
    "Do not modify .env, secrets, private keys, wallet files, certificates, lockfiles, package managers, deployment files, or files outside the selected project root.",
    "Return JSON only with fields: summary, filesToInspect, filesToModify, riskLevel, testCommand, planSteps.",
    "",
    contextForPrompt(context)
  ].join("\n");
}

export function buildPatchPrompt(context = {}, plan = {}, failureLog = "") {
  return [
    "Generate a minimal patch for the approved plan.",
    "Return JSON only with fields: summary, unifiedDiff, files.",
    "files must be an array of { path, content } where content is the complete proposed file content.",
    "The unifiedDiff field must contain ONLY a valid unified diff. No prose. No markdown. No code fence.",
    "Every changed file in unifiedDiff must include --- a/<relative-path>, +++ b/<relative-path>, and at least one @@ hunk header.",
    "Paths must be project-root relative. Never output absolute paths, ../ traversal, .env, secrets, private keys, wallet files, or certificates.",
    "Do not output full files inside unifiedDiff. Output a patch.",
    "Keep the patch small. Do not modify sensitive files. Do not claim the patch has been applied.",
    failureLog ? `Previous verification failed. Fix once using this log:\n${trim(failureLog, 3000)}` : "",
    "",
    `PLAN:\n${JSON.stringify(plan, null, 2)}`,
    "",
    contextForPrompt(context)
  ].join("\n");
}

export function buildDiffReformatPrompt(previousOutput = "", validatorError = "") {
  return [
    "Reformat the previous patch output into a valid unified diff.",
    "Do not rethink the implementation. Do not change the intended files or behavior.",
    "Return ONLY the patch. No prose. No markdown. No code fence.",
    "Each file must include:",
    "--- a/<relative-path>",
    "+++ b/<relative-path>",
    "@@ hunk header",
    "Paths must be project-root relative and must not target sensitive files.",
    "",
    `Validator error: ${trim(validatorError, 600)}`,
    "",
    "Previous output excerpt:",
    trim(previousOutput, 3000)
  ].join("\n");
}

export function normalizeAiPlan(rawPlan = {}) {
  const riskLevel = ["low", "medium", "high"].includes(String(rawPlan.riskLevel || "").toLowerCase())
    ? String(rawPlan.riskLevel).toLowerCase()
    : "medium";
  return {
    summary: trim(rawPlan.summary || "", 800),
    filesToInspect: safeArray(rawPlan.filesToInspect, 12).map((file) => normalizeRelativeProjectPath(file)).filter(Boolean),
    filesToModify: safeArray(rawPlan.filesToModify, 12).map((file) => normalizeRelativeProjectPath(file)).filter(Boolean),
    riskLevel,
    testCommand: trim(rawPlan.testCommand || "", 240),
    planSteps: safeArray(rawPlan.planSteps, 12).map((step) => trim(step, 300)).filter(Boolean)
  };
}

export function validateAiPlan(plan = {}) {
  const normalized = normalizeAiPlan(plan);
  const blockers = [];
  for (const file of [...normalized.filesToInspect, ...normalized.filesToModify]) {
    if (isSensitiveContextPath(file)) {
      blockers.push({
        id: "ai_plan_sensitive_file",
        title: `AI plan targets a sensitive file: ${file}`,
        detail: "Sensitive files require explicit manual redesign and are blocked from AI patch generation."
      });
    }
  }
  if (normalized.riskLevel === "high") {
    blockers.push({
      id: "ai_plan_high_risk",
      title: "AI plan is high risk",
      detail: "High-risk AI plans must be narrowed before patch generation."
    });
  }
  return {
    ok: blockers.length === 0,
    plan: normalized,
    blockers
  };
}

export function validateUnifiedDiff(unifiedDiff = "") {
  const text = String(unifiedDiff || "").replace(/\r\n/g, "\n");
  const files = [];
  const blockers = [];
  const oldHeaders = [...text.matchAll(/^--- a\/(.+)$/gm)].map((match) => match[1].trim());
  const newHeaders = [...text.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1].trim());

  if (!text.trim()) {
    blockers.push({ id: "ai_patch_diff_missing", title: "AI patch diff is missing", detail: "The model must return a unified diff." });
  }
  if (!oldHeaders.length || oldHeaders.length !== newHeaders.length) {
    blockers.push({ id: "ai_patch_diff_headers_invalid", title: "AI patch diff headers are invalid", detail: "Unified diff must include matching --- a/file and +++ b/file headers." });
  }
  if (!/^@@ /m.test(text)) {
    blockers.push({ id: "ai_patch_diff_hunk_missing", title: "AI patch hunk is missing", detail: "Unified diff must include at least one @@ hunk." });
  }

  for (let index = 0; index < newHeaders.length; index += 1) {
    const file = normalizeRelativeProjectPath(newHeaders[index]);
    if (!file || file !== normalizeRelativeProjectPath(oldHeaders[index])) {
      blockers.push({ id: "ai_patch_diff_file_mismatch", title: `AI patch diff file mismatch: ${newHeaders[index] || "unknown"}`, detail: "Old and new diff headers must target the same relative file." });
      continue;
    }
    files.push(file);
  }

  return {
    ok: blockers.length === 0,
    files: [...new Set(files)],
    blockers
  };
}

function diffHeaderPairs(text = "") {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const pairs = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].startsWith("--- ")) continue;
    const next = lines[index + 1] || "";
    if (!next.startsWith("+++ ")) continue;
    pairs.push({
      oldLineIndex: index,
      newLineIndex: index + 1,
      oldPath: lines[index].slice(4).trim(),
      newPath: next.slice(4).trim()
    });
  }
  return pairs;
}

function stripDiffPrefix(path = "") {
  const value = String(path || "").trim();
  if (value.startsWith("a/") || value.startsWith("b/")) return value.slice(2);
  return value;
}

function expectedTargetsFromContext(context = {}) {
  return unique([
    ...(context.expectedTargetFiles || []),
    ...(context.targetFiles || []),
    ...(context.sentFiles || []),
    ...safeArray(context.files, 12).map((file) => file.path)
  ].map((file) => normalizeRelativeProjectPath(file)).filter(Boolean));
}

function containsUnifiedDiffMarkers(text = "") {
  return /^--- /m.test(text) && /^\+\+\+ /m.test(text) && /^@@ /m.test(text);
}

function isDiffPayloadLine(line = "") {
  return /^(diff --git |index |--- |\+\+\+ |@@ |[ +\-\\])/.test(line) || line === "";
}

function isOnlyDiffPayload(text = "") {
  return String(text || "").split("\n").every((line) => isDiffPayloadLine(line));
}

export function extractUnifiedDiffBlock(output = "") {
  const text = String(output || "").replace(/\r\n/g, "\n").trim();
  const fenced = [...text.matchAll(/```(?:diff|patch)?\s*\n([\s\S]*?)```/gi)]
    .map((match) => match[1].trim())
    .filter((body) => containsUnifiedDiffMarkers(body));
  if (fenced.length === 1) {
    return { ok: true, text: fenced[0], diffExtractionApplied: true, reason: "fenced_diff" };
  }
  if (fenced.length > 1) {
    return { ok: false, text, diffExtractionApplied: false, reason: "multiple_diff_fences" };
  }
  if (containsUnifiedDiffMarkers(text) && (/^--- /m.test(text) || /^diff --git /m.test(text))) {
    if (isOnlyDiffPayload(text)) {
      return { ok: true, text, diffExtractionApplied: false, reason: "direct_diff" };
    }
    const lines = text.split("\n");
    const blocks = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!/^(diff --git |--- )/.test(lines[index])) continue;
      const block = [];
      let sawHeader = false;
      let sawHunk = false;
      for (let cursor = index; cursor < lines.length; cursor += 1) {
        const line = lines[cursor];
        if (!isDiffPayloadLine(line) && sawHeader && sawHunk) break;
        if (!isDiffPayloadLine(line) && !sawHeader) break;
        block.push(line);
        if (line.startsWith("--- ") || line.startsWith("+++ ")) sawHeader = true;
        if (line.startsWith("@@ ")) sawHunk = true;
      }
      const candidate = block.join("\n").trim();
      if (containsUnifiedDiffMarkers(candidate)) {
        blocks.push(candidate);
        index += block.length - 1;
      }
    }
    const distinct = unique(blocks);
    if (distinct.length === 1) {
      return {
        ok: true,
        text: distinct[0],
        diffExtractionApplied: distinct[0] !== text,
        reason: distinct[0] === text ? "direct_diff" : "single_diff_block"
      };
    }
    if (distinct.length > 1) {
      return { ok: false, text, diffExtractionApplied: false, reason: "multiple_diff_blocks" };
    }
  }
  return { ok: true, text, diffExtractionApplied: false, reason: "raw_text" };
}

export function normalizeUnifiedDiffHeaders(unifiedDiff = "", expectedTargetFiles = []) {
  const text = String(unifiedDiff || "").replace(/\r\n/g, "\n");
  const expected = new Set(expectedTargetFiles.map((file) => normalizeRelativeProjectPath(file)).filter(Boolean));
  const pairs = diffHeaderPairs(text);
  if (!pairs.length) return { ok: true, text, diffNormalizationApplied: false, blockers: [] };

  const lines = text.split("\n");
  let changed = false;
  const blockers = [];
  for (const pair of pairs) {
    const oldAlready = pair.oldPath.startsWith("a/");
    const newAlready = pair.newPath.startsWith("b/");
    if (oldAlready && newAlready) continue;
    const oldRelative = normalizeRelativeProjectPath(stripDiffPrefix(pair.oldPath));
    const newRelative = normalizeRelativeProjectPath(stripDiffPrefix(pair.newPath));
    if (!oldRelative || !newRelative || oldRelative !== newRelative) {
      blockers.push({ id: "ai_patch_diff_header_path_ambiguous", title: "AI patch diff header path is ambiguous", detail: "Bare diff headers must target the same relative file." });
      continue;
    }
    if (!expected.has(oldRelative)) {
      blockers.push({ id: "ai_patch_diff_header_path_unexpected", title: `AI patch diff header path is unexpected: ${oldRelative}`, detail: "Bare headers are normalized only for expected target files." });
      continue;
    }
    lines[pair.oldLineIndex] = `--- a/${oldRelative}`;
    lines[pair.newLineIndex] = `+++ b/${oldRelative}`;
    changed = true;
  }
  return {
    ok: blockers.length === 0,
    text: lines.join("\n"),
    diffNormalizationApplied: changed,
    blockers
  };
}

function parseUnifiedDiffSections(unifiedDiff = "") {
  const lines = String(unifiedDiff || "").replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const oldHeader = lines[index].match(/^--- a\/(.+)$/);
    const newHeader = lines[index + 1]?.match(/^\+\+\+ b\/(.+)$/);
    if (oldHeader && newHeader) {
      if (current) sections.push(current);
      current = { file: normalizeRelativeProjectPath(newHeader[1]), lines: [lines[index], lines[index + 1]] };
      index += 1;
      continue;
    }
    if (current) current.lines.push(lines[index]);
  }
  if (current) sections.push(current);
  return sections.filter((section) => section.file);
}

function splitContentLines(content = "") {
  const text = String(content || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return {
    lines,
    trailingNewline: text.endsWith("\n")
  };
}

function applyUnifiedDiffSection(original = "", sectionLines = []) {
  const originalState = splitContentLines(original);
  const output = [];
  let originalIndex = 0;
  let cursor = 0;
  while (cursor < sectionLines.length) {
    const hunk = sectionLines[cursor].match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (!hunk) {
      cursor += 1;
      continue;
    }
    const hunkStart = Math.max(0, Number(hunk[1]) - 1);
    while (originalIndex < hunkStart && originalIndex < originalState.lines.length) {
      output.push(originalState.lines[originalIndex]);
      originalIndex += 1;
    }
    cursor += 1;
    while (cursor < sectionLines.length && !sectionLines[cursor].startsWith("@@ ")) {
      const line = sectionLines[cursor];
      if (line.startsWith(" ")) {
        output.push(line.slice(1));
        originalIndex += 1;
      } else if (line.startsWith("-")) {
        originalIndex += 1;
      } else if (line.startsWith("+")) {
        output.push(line.slice(1));
      }
      cursor += 1;
    }
  }
  while (originalIndex < originalState.lines.length) {
    output.push(originalState.lines[originalIndex]);
    originalIndex += 1;
  }
  const result = output.join("\n");
  return originalState.trailingNewline || /\n$/.test(sectionLines.join("\n")) ? `${result}\n` : result;
}

function draftsFromUnifiedDiff({ projectPath = "", unifiedDiff = "" } = {}) {
  const drafts = [];
  const blockers = [];
  for (const section of parseUnifiedDiffSections(unifiedDiff)) {
    const guarded = assertPathInsideProjectRoot(projectPath, section.file);
    if (!guarded.ok) {
      blockers.push({ id: "ai_patch_outside_project_root", title: `AI patch outside project root: ${section.file}`, detail: guarded.blockers?.[0]?.detail || "Target must stay inside selected project root." });
      continue;
    }
    let original = "";
    try {
      original = readFileSync(guarded.absolutePath, "utf8");
    } catch {
      original = "";
    }
    drafts.push({
      path: section.file,
      content: applyUnifiedDiffSection(original, section.lines)
    });
  }
  return { drafts, blockers };
}

export function inspectDiffContract({ rawOutput = "", unifiedDiff = "", expectedTargetFiles = [], blockers = [], provider = "", model = "", providerMeta = {} } = {}) {
  const text = String(unifiedDiff || rawOutput || "");
  const headers = diffHeaderPairs(text);
  return {
    hasMarkdownFence: /```/.test(String(rawOutput || unifiedDiff || "")),
    hasUnifiedDiffMarkers: containsUnifiedDiffMarkers(text),
    hasDiffGitHeader: /^diff --git /m.test(text),
    hasMinusPlusHeaders: /^--- /m.test(text) && /^\+\+\+ /m.test(text),
    headerPathsDetected: unique(headers.flatMap((pair) => [stripDiffPrefix(pair.oldPath), stripDiffPrefix(pair.newPath)])
      .map((file) => normalizeRelativeProjectPath(file)).filter(Boolean)),
    expectedTargetFiles: expectedTargetFiles.map((file) => normalizeRelativeProjectPath(file)).filter(Boolean),
    validatorError: blockers.map((blocker) => blocker.id).filter(Boolean).join(", ") || "",
    outputExcerptRedacted: trim(String(rawOutput || unifiedDiff || ""), 1000),
    provider,
    model,
    latencyMs: Number(providerMeta.providerLatencyMs || 0),
    attempts: Number(providerMeta.attempts || 0)
  };
}

export function aiPatchDraftsFromModelPatch({ projectPath = "", patch = {} } = {}) {
  const blockers = [];
  const expectedTargetFiles = safeArray(patch.expectedTargetFiles, 12).map((file) => normalizeRelativeProjectPath(file)).filter(Boolean);
  const extracted = extractUnifiedDiffBlock(patch.unifiedDiff || "");
  if (!extracted.ok) {
    blockers.push({ id: "ai_patch_diff_block_ambiguous", title: "AI patch diff block is ambiguous", detail: "The model returned multiple possible diff blocks." });
  }
  const normalizedDiff = normalizeUnifiedDiffHeaders(extracted.text || "", expectedTargetFiles);
  blockers.push(...normalizedDiff.blockers);
  const unifiedDiff = normalizedDiff.text || extracted.text || "";
  const diffReview = validateUnifiedDiff(unifiedDiff);
  blockers.push(...diffReview.blockers);
  const derived = safeArray(patch.files, 8).length
    ? { drafts: safeArray(patch.files, 8), blockers: [] }
    : draftsFromUnifiedDiff({ projectPath, unifiedDiff });
  blockers.push(...derived.blockers);
  const files = derived.drafts;
  const drafts = [];

  if (!files.length) {
    blockers.push({
      id: "ai_patch_files_missing",
      title: "AI patch full file contents are missing",
      detail: "Patch Generator v1 requires complete proposed file contents for sandbox packaging."
    });
  }

  for (const file of files) {
    const relativePath = normalizeRelativeProjectPath(file.path || file.file || "");
    if (!relativePath) {
      blockers.push({ id: "ai_patch_path_invalid", title: "AI patch path is invalid", detail: "Patch files must be relative project paths." });
      continue;
    }
    if (isSensitiveContextPath(relativePath)) {
      blockers.push({ id: "ai_patch_sensitive_file", title: `Sensitive file patch blocked: ${relativePath}`, detail: "Coding猿 does not allow model patches to sensitive files." });
      continue;
    }
    const classified = classifyPatchFile(relativePath);
    if (!classified.ok) {
      blockers.push({ id: "ai_patch_file_policy_blocked", title: `AI patch target blocked: ${relativePath}`, detail: classified.reason });
      continue;
    }
    const guarded = assertPathInsideProjectRoot(projectPath, relativePath);
    if (!guarded.ok) {
      blockers.push({ id: "ai_patch_outside_project_root", title: `AI patch outside project root: ${relativePath}`, detail: guarded.blockers?.[0]?.detail || "Target must stay inside selected project root." });
      continue;
    }
    if (diffReview.files.length && !diffReview.files.includes(relativePath)) {
      blockers.push({ id: "ai_patch_file_not_in_diff", title: `AI patch file missing from diff: ${relativePath}`, detail: "Every proposed file must appear in the unified diff." });
      continue;
    }
    drafts.push({
      file: relativePath,
      content: String(file.content ?? file.proposedContent ?? "")
    });
  }

  const normalized = normalizePatchDrafts(drafts, { maxFiles: 5 });
  blockers.push(...normalized.blockers);
  return {
    ok: blockers.length === 0 && normalized.drafts.length > 0,
    drafts: normalized.drafts,
    files: diffReview.files,
    blockers,
    unifiedDiff,
    diffExtractionApplied: extracted.diffExtractionApplied,
    diffNormalizationApplied: normalizedDiff.diffNormalizationApplied,
    recoveredBy: extracted.diffExtractionApplied
      ? "diff_extraction"
      : normalizedDiff.diffNormalizationApplied
        ? "diff_normalization"
        : ""
  };
}

function patchFailureCategory(blockers = []) {
  const ids = blockers.map((blocker) => blocker.id || "").join(" ");
  if (/sensitive/i.test(ids)) return "sensitive_file_blocked";
  if (/outside|root|path_invalid/i.test(ids)) return "outside_project_root";
  if (/safety|high_risk/i.test(ids)) return "safety_blocked";
  return "invalid_diff";
}

export async function generateAiPlan({
  settings = {},
  context = {},
  fetchImpl,
  timeoutMs,
  retries,
  retryBackoffMs
} = {}) {
  const normalized = normalizeModelProviderSettings(settings, settings);
  const ready = modelProviderReady(normalized);
  if (!ready.ok || normalized.providerMode === "demo_only") {
    return {
      ok: false,
      skipped: normalized.providerMode === "demo_only",
      status: ready.status,
      error: ready.reason,
      plan: null,
      blockers: ready.ok ? [] : [{ id: ready.status, title: ready.reason, detail: ready.reason }]
    };
  }
  const { text, providerMeta } = await callModel(normalized, buildPlanPrompt(context), {
    fetchImpl,
    kind: "plan",
    timeoutMs,
    retries,
    retryBackoffMs
  });
  let parsed;
  try {
    parsed = extractJson(text);
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      status: "blocked",
      provider: normalized.provider,
      model: normalized.model,
      plan: null,
      blockers: [{
        id: "ai_plan_model_invalid_output",
        title: "Model did not return a valid plan",
        detail: trim(error?.message || "Model returned invalid JSON.", 240)
      }],
      failureCategory: "model_invalid_output",
      providerMeta
    };
  }
  const review = validateAiPlan(parsed);
  return {
    ok: review.ok,
    skipped: false,
    status: review.ok ? "ready" : "blocked",
    provider: normalized.provider,
    model: normalized.model,
    plan: review.plan,
    blockers: review.blockers,
    failureCategory: review.ok ? "" : "safety_blocked",
    providerMeta
  };
}

export async function generateAiPatch({
  settings = {},
  context = {},
  plan = {},
  projectPath = "",
  failureLog = "",
  diffFormatError = "",
  previousPatchOutput = "",
  fetchImpl,
  timeoutMs,
  retries,
  retryBackoffMs
} = {}) {
  const normalized = normalizeModelProviderSettings(settings, settings);
  const prompt = diffFormatError
    ? buildDiffReformatPrompt(previousPatchOutput, diffFormatError)
    : buildPatchPrompt(context, plan, failureLog);
  const { text, providerMeta } = await callModel(normalized, prompt, {
    fetchImpl,
    kind: "patch",
    timeoutMs,
    retries,
    retryBackoffMs
  });
  let parsed;
  try {
    parsed = extractJson(text);
  } catch (error) {
    parsed = {
      summary: "",
      unifiedDiff: text,
      files: []
    };
  }
  const expectedTargetFiles = expectedTargetsFromContext(context);
  const drafts = aiPatchDraftsFromModelPatch({
    projectPath,
    patch: {
      ...parsed,
      expectedTargetFiles
    }
  });
  const diagnostics = inspectDiffContract({
    rawOutput: text,
    unifiedDiff: drafts.unifiedDiff || parsed.unifiedDiff || "",
    expectedTargetFiles,
    blockers: drafts.blockers,
    provider: normalized.provider,
    model: normalized.model,
    providerMeta
  });
  return {
    ok: drafts.ok,
    status: drafts.ok ? "ready" : "blocked",
    provider: normalized.provider,
    model: normalized.model,
    summary: trim(parsed.summary || "", 800),
    unifiedDiff: drafts.unifiedDiff || String(parsed.unifiedDiff || ""),
    drafts: drafts.drafts,
    files: drafts.files,
    blockers: drafts.blockers,
    failureCategory: drafts.ok ? "" : patchFailureCategory(drafts.blockers),
    providerMeta,
    rawModelOutputExcerpt: trim(text, 1000),
    diffDiagnostics: diagnostics,
    diffExtractionApplied: Boolean(drafts.diffExtractionApplied),
    diffNormalizationApplied: Boolean(drafts.diffNormalizationApplied),
    recoveredBy: drafts.recoveredBy || (drafts.ok ? "model_prompt_contract" : "")
  };
}

export function shouldAttemptDiffReformat(patchResult = {}) {
  if (patchResult.ok || patchResult.failureCategory !== "invalid_diff") return false;
  const ids = (patchResult.blockers || []).map((blocker) => blocker.id || "").join(" ");
  if (/sensitive|outside|root|safety|high_risk/i.test(ids)) return false;
  return /diff|file_not_in_diff|files_missing/i.test(ids);
}

export async function runAiPatchGenerationV1({
  settings = {},
  context = {},
  projectPath = "",
  fetchImpl,
  verifyDrafts,
  timeoutMs,
  retries,
  retryBackoffMs
} = {}) {
  const providerOptions = { fetchImpl, timeoutMs, retries, retryBackoffMs };
  const planResult = await generateAiPlan({ settings, context, ...providerOptions });
  if (!planResult.ok) {
    return {
      ok: false,
      status: planResult.status,
      plan: planResult.plan,
      patch: null,
      retryCount: 0,
      blockers: planResult.blockers,
      skipped: planResult.skipped
    };
  }

  let patchResult = await generateAiPatch({
    settings,
    context,
    plan: planResult.plan,
    projectPath,
    ...providerOptions
  });
  let retryCount = 0;
  let diffReformatAttempted = false;
  let diffReformatRecovered = false;
  let diffReformatFailureReason = "";

  if (shouldAttemptDiffReformat(patchResult)) {
    diffReformatAttempted = true;
    const validatorError = patchResult.blockers?.[0]?.id || patchResult.failureCategory || "invalid_diff";
    patchResult = await generateAiPatch({
      settings,
      context,
      plan: planResult.plan,
      projectPath,
      diffFormatError: validatorError,
      previousPatchOutput: patchResult.rawModelOutputExcerpt || patchResult.unifiedDiff || "",
      ...providerOptions
    });
    diffReformatRecovered = Boolean(patchResult.ok);
    diffReformatFailureReason = patchResult.ok ? "" : patchResult.blockers?.[0]?.id || patchResult.failureCategory || "invalid_diff";
    if (patchResult.ok && !patchResult.recoveredBy) patchResult.recoveredBy = "diff_reformat_retry";
  }

  if (patchResult.ok && typeof verifyDrafts === "function") {
    const verification = await verifyDrafts(patchResult.drafts);
    if (!verification?.ok) {
      retryCount = 1;
      patchResult = await generateAiPatch({
        settings,
        context,
        plan: planResult.plan,
        projectPath,
        failureLog: verification?.output || verification?.error || "Verification failed.",
        ...providerOptions
      });
    }
  }

  return {
    ok: patchResult.ok,
    status: patchResult.status,
    plan: planResult.plan,
    patch: patchResult,
    retryCount,
    diffReformatAttempted,
    diffReformatRecovered,
    diffReformatFailureReason,
    blockers: patchResult.blockers || []
  };
}

export async function testModelProviderConnection({
  settings = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  retries = 0,
  retryBackoffMs = 0
} = {}) {
  const normalized = normalizeModelProviderSettings(settings, settings);
  const ready = modelProviderReady(normalized);
  if (normalized.providerMode === "demo_only") {
    return {
      ok: true,
      status: "demo_only",
      provider: normalized.provider,
      model: normalized.model,
      note: "Demo Only does not call a model provider."
    };
  }
  if (!ready.ok) {
    return {
      ok: false,
      status: ready.status,
      provider: normalized.provider,
      model: normalized.model,
      error: ready.reason
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      status: "fetch_unavailable",
      provider: normalized.provider,
      model: normalized.model,
      error: "Current runtime does not provide fetch."
    };
  }

  try {
    let url = providerUrl(normalized, "test");
    const headers = {};
    if (normalized.provider === "ollama") {
      url = `${String(normalized.endpoint || "http://127.0.0.1:11434").replace(/\/+$/, "")}/api/tags`;
    } else if (["openai", "openai_compatible", "lm_studio"].includes(normalized.provider)) {
      url = `${String(normalized.endpoint || "http://127.0.0.1:1234/v1").replace(/\/+$/, "")}/models`;
      if (normalized.providerMode === "byo_key") headers.authorization = `Bearer ${normalized.apiKey}`;
    } else if (normalized.provider === "anthropic") {
      headers["x-api-key"] = normalized.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      url = `${String(normalized.endpoint || "https://api.anthropic.com/v1").replace(/\/+$/, "")}/models`;
    } else if (normalized.provider === "gemini") {
      url = `${String(normalized.endpoint || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "")}/models?key=${encodeURIComponent(normalized.apiKey || "")}`;
    }
    const response = await fetchWithTimeout(fetchImpl, url, { headers }, providerRetryConfig({ timeoutMs, retries, retryBackoffMs }).timeoutMs);
    return {
      ok: response.ok,
      status: response.ok ? "connected" : "failed",
      provider: normalized.provider,
      model: normalized.model,
      statusCode: response.status || 0,
      error: response.ok ? "" : `Provider returned ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      provider: normalized.provider,
      model: normalized.model,
      error: trim(error?.message || "Model provider connection failed.", 240)
    };
  }
}

export async function healthCheckModelCompletion({
  settings = {},
  fetchImpl = globalThis.fetch,
  timeoutMs,
  retries,
  retryBackoffMs
} = {}) {
  const normalized = normalizeModelProviderSettings(settings, settings);
  const ready = modelProviderReady(normalized);
  if (normalized.providerMode === "demo_only" || !ready.ok) {
    return {
      ok: false,
      status: normalized.providerMode === "demo_only" ? "demo_only" : ready.status,
      provider: normalized.provider,
      model: normalized.model,
      failureCategory: normalized.providerMode === "demo_only" ? "missing_model_config" : "missing_model_config",
      error: ready.reason
    };
  }
  try {
    const { text, providerMeta } = await callModel(
      normalized,
      "Return JSON only: {\"ok\":true,\"message\":\"ready\"}",
      { fetchImpl, kind: "health", timeoutMs, retries, retryBackoffMs }
    );
    return {
      ok: Boolean(String(text || "").trim()),
      status: "connected",
      provider: normalized.provider,
      model: normalized.model,
      providerMeta,
      failureCategory: "",
      error: ""
    };
  } catch (error) {
    return {
      ok: false,
      status: "provider_health_failed",
      provider: normalized.provider,
      model: normalized.model,
      failureCategory: error?.failureCategory || classifyProviderError(error),
      providerFailureCategory: error?.providerFailureCategory || classifyProviderError(error),
      attempts: error?.attempts || 1,
      providerLatencyMs: error?.providerLatencyMs || 0,
      timeoutMs: error?.timeoutMs || providerRetryConfig({ timeoutMs, retries, retryBackoffMs }).timeoutMs,
      error: trim(error?.message || "Model provider health check failed.", 240)
    };
  }
}

export function diffForFullContentPatch(projectPath, drafts = []) {
  return drafts.map((draft) => {
    const guarded = assertPathInsideProjectRoot(projectPath, draft.file);
    const original = guarded.ok && guarded.absolutePath ? (() => {
      try {
        return readFileSync(join(projectPath, guarded.relativePath), "utf8");
      } catch {
        return "";
      }
    })() : "";
    return createUnifiedDiff(draft.file, original, draft.content);
  }).filter(Boolean).join("\n");
}
