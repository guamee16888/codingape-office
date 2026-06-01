import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAiPatchContext } from "../src/ai-context-builder-v1.mjs";
import {
  classifyProviderError,
  generateAiPatch,
  generateAiPlan,
  healthCheckModelCompletion,
  shouldAttemptDiffReformat
} from "../src/ai-patch-worker-v1.mjs";
import {
  modelProviderReady,
  readModelProviderSettings,
  redactedModelProviderSettings
} from "../src/model-provider-settings.mjs";
import { createUnifiedDiff } from "../src/patch-runner-artifacts.mjs";
import { assertPathInsideProjectRoot } from "../src/project-root-guard.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(process.env.CODEX_OFFICE_DATA_DIR || join(ROOT, "data"));
const SETTINGS_FILE = join(DATA_DIR, "model-provider-settings.json");
const MATRIX_FILE = join(ROOT, "docs", "evaluation", "REAL_AI_TASK_MATRIX.md");
const REPORT_FILE = join(DATA_DIR, "evaluation", "ai-patch-worker", "latest.json");
const INVALID_DIFF_DIAGNOSTICS_DIR = join(DATA_DIR, "evaluation", "ai-patch-worker");
const SCORECARD_FILE = process.env.CODEX_OFFICE_DATA_DIR
  ? join(DATA_DIR, "evaluation", "STAGE12_SCORECARD.md")
  : join(ROOT, "docs", "evaluation", "STAGE12_SCORECARD.md");
const LATENCY_REPORT_FILE = process.env.CODEX_OFFICE_DATA_DIR
  ? join(DATA_DIR, "evaluation", "PROVIDER_LATENCY_REPORT.md")
  : join(ROOT, "docs", "evaluation", "PROVIDER_LATENCY_REPORT.md");
const FIXTURE_ROOT = join(ROOT, "test-fixtures", "ai-patch-worker");

export const FAILURE_CATEGORIES = new Set([
  "transport_error",
  "timeout",
  "provider_rate_limited",
  "provider_5xx",
  "model_invalid_output",
  "invalid_diff",
  "patch_apply_failed",
  "verification_failed",
  "retry_exhausted",
  "safety_blocked",
  "sensitive_file_blocked",
  "outside_project_root",
  "missing_model_config",
  "fixture_invalid",
  "pre_existing_unrelated_failure",
  "baseline_verification_failed",
  "baseline_verification_expected_failure",
  "unknown"
]);

const TRANSPORT_CATEGORIES = new Set([
  "transport_error",
  "timeout",
  "provider_rate_limited",
  "provider_5xx",
  "retry_exhausted"
]);

const FIXTURE_INVALID_CATEGORIES = new Set([
  "fixture_invalid",
  "pre_existing_unrelated_failure",
  "baseline_verification_failed"
]);

const BASELINE_TARGET_TOKENS = [
  "add",
  "divide",
  "multiply",
  "rangeerror",
  "getbuttonlabel",
  "button",
  "label",
  "disabled",
  "normalizeuser",
  "displayname",
  "email",
  "role",
  "readme",
  "troubleshooting",
  "script"
];

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const PROVIDER_OPTIONS = {
  timeoutMs: numberFromEnv("AI_PROVIDER_TIMEOUT_MS", numberFromEnv("CODEX_OFFICE_MODEL_TIMEOUT_MS", 120_000)),
  retries: Math.max(0, numberFromEnv("AI_PROVIDER_RETRIES", 2)),
  retryBackoffMs: Math.max(0, numberFromEnv("AI_PROVIDER_RETRY_BACKOFF_MS", 1000))
};

function progress(message) {
  console.error(`[evaluate-ai-patch-worker] ${message}`);
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function loadTaskMatrix() {
  const lines = readFileSync(MATRIX_FILE, "utf8").split("\n");
  const rows = lines
    .filter((line) => line.startsWith("| AI-"))
    .map(splitMarkdownRow);

  return rows.map((row) => ({
    taskId: row[0],
    fixture: row[1],
    userInput: row[2],
    expectedImpactFiles: row[3].split(",").map((file) => file.trim()).filter(Boolean),
    riskLevel: row[4],
    recommendedVerification: row[5],
    successStandard: row[6],
    failureStandard: row[7],
    retryOnce: /^yes$/i.test(row[8] || "")
  }));
}

function sanitizeText(value = "", settings = {}) {
  let text = String(value || "");
  if (settings.apiKey) text = text.split(settings.apiKey).join("[REDACTED]");
  text = text
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(/(api[_-]?key=)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/(key=)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/(authorization:\s*bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
  return text.slice(0, 1000);
}

function redactPatchOutputExcerpt(value = "", settings = {}) {
  return sanitizeText(value, settings)
    .replace(/"(content|unifiedDiff)"\s*:\s*"(?:(?:\\.)|[^"\\])*"/gs, "\"$1\":\"[REDACTED_PATCH_FIELD]\"")
    .replace(/(content|unifiedDiff):\s*[\s\S]{80,}/gi, "$1: [REDACTED_PATCH_FIELD]");
}

function taskSlug(taskId = "") {
  return String(taskId || "task").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "task";
}

function normalizeFailureCategory(category = "") {
  return FAILURE_CATEGORIES.has(category) ? category : "unknown";
}

function baselineTokens(text = "") {
  const lower = String(text || "").toLowerCase();
  const tokens = new Set();
  for (const token of BASELINE_TARGET_TOKENS) {
    if (lower.includes(token)) tokens.add(token);
  }
  if (lower.includes("除数") || lower.includes("除以") || lower.includes("除 0")) {
    tokens.add("divide");
    tokens.add("rangeerror");
  }
  if (lower.includes("相加") || lower.includes("加法")) tokens.add("add");
  if (lower.includes("乘法") || lower.includes("乘")) tokens.add("multiply");
  if (lower.includes("文案")) tokens.add("label");
  return tokens;
}

function baselineTaskText(task = {}) {
  return [
    task.taskId,
    task.userInput,
    task.successStandard,
    task.failureStandard
  ].join(" ");
}

function baselineFailureFocus(output = "") {
  const text = String(output || "");
  const lower = text.toLowerCase();
  const failingIndex = lower.lastIndexOf("failing tests:");
  if (failingIndex >= 0) {
    const focus = text.slice(failingIndex);
    return baselineTokens(focus).size ? focus : text;
  }
  const focusedLines = text
    .split("\n")
    .filter((line) => /✖|not ok|AssertionError|SyntaxError|Error/i.test(line))
    .join("\n");
  return focusedLines && baselineTokens(focusedLines).size ? focusedLines : text;
}

export function classifyBaselineVerification({ task = {}, verification = null } = {}) {
  if (!verification) {
    return {
      baselineVerificationStatus: "skipped",
      baselineFailureReason: "",
      baselineFailureOutput: "",
      expectedBaselineFailure: false,
      expectedFailingScope: "unknown",
      failureCategory: ""
    };
  }

  if (verification.ok) {
    return {
      baselineVerificationStatus: "pass",
      baselineFailureReason: "",
      baselineFailureOutput: "",
      expectedBaselineFailure: false,
      expectedFailingScope: "unknown",
      failureCategory: ""
    };
  }

  const taskTokens = baselineTokens(baselineTaskText(task));
  const outputTokens = baselineTokens(baselineFailureFocus(verification.output || ""));
  const matchedTarget = [...outputTokens].some((token) => taskTokens.has(token));
  const matchedUnrelated = [...outputTokens].some((token) => !taskTokens.has(token));
  const expectedFailingScope = matchedTarget ? "task_target" : matchedUnrelated ? "unrelated" : "unknown";
  const failureCategory = expectedFailingScope === "task_target"
    ? "baseline_verification_expected_failure"
    : expectedFailingScope === "unrelated"
      ? "pre_existing_unrelated_failure"
      : "baseline_verification_failed";

  return {
    baselineVerificationStatus: "fail",
    baselineFailureReason: failureCategory,
    baselineFailureOutput: sanitizeText(verification.output || ""),
    expectedBaselineFailure: expectedFailingScope === "task_target",
    expectedFailingScope,
    failureCategory
  };
}

export function shouldSkipModelForBaseline(classification = {}) {
  return classification.baselineVerificationStatus === "fail" && classification.expectedFailingScope !== "task_target";
}

function blockerCategory(blockers = []) {
  const ids = blockers.map((blocker) => blocker.id || "").join(" ");
  if (/sensitive/i.test(ids)) return "sensitive_file_blocked";
  if (/outside|root|path/i.test(ids)) return "outside_project_root";
  if (/diff|file_not_in_diff|files_missing/i.test(ids)) return "invalid_diff";
  if (/high_risk|safety|blocked/i.test(ids)) return "safety_blocked";
  if (/model_invalid_output/i.test(ids)) return "model_invalid_output";
  return "unknown";
}

function blockerReason(blockers = []) {
  return blockers[0]?.id || "ai_patch_blocked";
}

function providerFailure(error = {}) {
  const category = normalizeFailureCategory(error?.failureCategory || classifyProviderError(error));
  return {
    category,
    providerFailureCategory: normalizeFailureCategory(error?.providerFailureCategory || classifyProviderError(error)),
    reason: sanitizeText(error?.message || category),
    attempts: Number(error?.attempts || 1),
    providerLatencyMs: Number(error?.providerLatencyMs || 0),
    timeoutMs: Number(error?.timeoutMs || PROVIDER_OPTIONS.timeoutMs)
  };
}

function copyFixture(fixtureName) {
  const source = join(FIXTURE_ROOT, fixtureName);
  if (!existsSync(source)) throw new Error(`Fixture not found: ${fixtureName}`);
  const tempRoot = mkdtempSync(join(tmpdir(), "codingyuan-eval-"));
  const projectPath = join(tempRoot, fixtureName);
  cpSync(source, projectPath, {
    recursive: true,
    filter(sourcePath) {
      return !/(^|\/)(node_modules|\.git|\.env|secrets?|wallets?|keys?|credentials?)(\/|$)/i.test(sourcePath.replaceAll("\\", "/"));
    }
  });
  return { tempRoot, projectPath };
}

function restoreFixture(tempRoot, fixtureName) {
  rmSync(join(tempRoot, fixtureName), { recursive: true, force: true });
  cpSync(join(FIXTURE_ROOT, fixtureName), join(tempRoot, fixtureName), { recursive: true });
  return join(tempRoot, fixtureName);
}

function commandForVerification(command = "npm test") {
  const value = String(command || "npm test").trim();
  if (/^npm\s+test$/i.test(value)) return { command: "npm", args: ["test"] };
  const runMatch = value.match(/^npm\s+run\s+([A-Za-z0-9:_-]+)$/i);
  if (runMatch) return { command: "npm", args: ["run", runMatch[1]] };
  if (/^node\s+--test$/i.test(value)) return { command: "node", args: ["--test"] };
  return { command: "npm", args: ["test"] };
}

function runVerification(projectPath, command, settings) {
  const selected = commandForVerification(command);
  try {
    const output = execFileSync(selected.command, selected.args, {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000
    });
    return {
      ok: true,
      command: [selected.command, ...selected.args].join(" "),
      output: sanitizeText(output, settings)
    };
  } catch (error) {
    return {
      ok: false,
      command: [selected.command, ...selected.args].join(" "),
      output: sanitizeText(`${error.stdout || ""}${error.stderr || ""}`.trim() || error.message, settings)
    };
  }
}

function applyDraftsToSandbox(projectPath, drafts = []) {
  const modified = [];
  const diffs = [];
  for (const draft of drafts) {
    const guarded = assertPathInsideProjectRoot(projectPath, draft.file);
    if (!guarded.ok) {
      return {
        ok: false,
        modified,
        diff: "",
        failureCategory: "outside_project_root",
        failureReason: guarded.blockers?.[0]?.detail || "Patch target escaped project root."
      };
    }

    let original = "";
    try {
      original = readFileSync(guarded.absolutePath, "utf8");
    } catch {
      original = "";
    }
    mkdirSync(dirname(guarded.absolutePath), { recursive: true });
    writeFileSync(guarded.absolutePath, draft.content, "utf8");
    modified.push(guarded.relativePath);
    diffs.push(createUnifiedDiff(guarded.relativePath, original, draft.content));
  }

  return {
    ok: true,
    modified,
    diff: diffs.filter(Boolean).join("\n")
  };
}

function emptyTaskResult(task) {
  return {
    taskId: task.taskId,
    fixture: task.fixture,
    status: "failed",
    attempts: 0,
    modelCompleted: false,
    patchGenerated: false,
    sandboxApplied: false,
    verificationPassed: false,
    passed: false,
    skipped: false,
    safetyBlocked: false,
    retryUsed: false,
    retryRecovered: false,
    diffReformatAttempted: false,
    diffReformatRecovered: false,
    diffReformatFailureReason: "",
    diffNormalizationApplied: false,
    diffExtractionApplied: false,
    recoveredBy: "",
    providerRetryUsed: false,
    providerRetryRecovered: false,
    failureCategory: "",
    providerFailureCategory: "",
    failureReason: "",
    durationMs: 0,
    providerLatencyMs: 0,
    timeoutMs: PROVIDER_OPTIONS.timeoutMs,
    modelEvaluationStarted: false,
    baselineVerificationStatus: "skipped",
    baselineFailureCategory: "",
    baselineFailureReason: "",
    baselineFailureOutput: "",
    expectedBaselineFailure: false,
    expectedFailingScope: "unknown",
    filesSentToModelCount: 0,
    filesSentToModel: [],
    filesModifiedInSandboxCount: 0,
    filesModifiedInSandbox: [],
    verificationResult: null
  };
}

function applyProviderMeta(result, meta = {}) {
  const attempts = Number(meta.attempts || 0);
  result.attempts += attempts;
  result.providerLatencyMs += Number(meta.providerLatencyMs || 0);
  result.timeoutMs = Number(meta.timeoutMs || result.timeoutMs || PROVIDER_OPTIONS.timeoutMs);
  result.modelCompleted = Boolean(result.modelCompleted || meta.modelCompleted);
  if (attempts > 1) result.providerRetryUsed = true;
}

function failTask(result, category, reason, options = {}) {
  result.status = options.skipped ? "skipped" : options.status || "failed";
  result.skipped = Boolean(options.skipped);
  result.failureCategory = normalizeFailureCategory(category);
  result.providerFailureCategory = options.providerFailureCategory || "";
  result.failureReason = sanitizeText(reason || result.failureCategory);
  result.safetyBlocked = ["safety_blocked", "sensitive_file_blocked", "outside_project_root"].includes(result.failureCategory);
  return result;
}

function applyDiffContractMeta(result, patchResult = {}) {
  result.diffNormalizationApplied = Boolean(result.diffNormalizationApplied || patchResult.diffNormalizationApplied);
  result.diffExtractionApplied = Boolean(result.diffExtractionApplied || patchResult.diffExtractionApplied);
  if (patchResult.recoveredBy) result.recoveredBy = patchResult.recoveredBy;
}

function validatorReason(patchResult = {}) {
  if (patchResult.ok) return "";
  return patchResult.blockers?.[0]?.id || patchResult.failureCategory || "invalid_diff";
}

function writeInvalidDiffDiagnostics(task, patchResult, settings) {
  const diagnostics = patchResult.diffDiagnostics || {};
  const payload = {
    generatedAt: new Date().toISOString(),
    taskId: task.taskId,
    fixture: task.fixture,
    status: patchResult.ok ? "passed" : "failed",
    failureCategory: patchResult.ok ? "" : patchResult.failureCategory || "invalid_diff",
    failureReason: patchResult.ok ? "" : validatorReason(patchResult),
    recoveredBy: patchResult.recoveredBy || "",
    diffExtractionApplied: Boolean(patchResult.diffExtractionApplied),
    diffNormalizationApplied: Boolean(patchResult.diffNormalizationApplied),
    hasMarkdownFence: Boolean(diagnostics.hasMarkdownFence),
    hasUnifiedDiffMarkers: Boolean(diagnostics.hasUnifiedDiffMarkers),
    hasDiffGitHeader: Boolean(diagnostics.hasDiffGitHeader),
    hasMinusPlusHeaders: Boolean(diagnostics.hasMinusPlusHeaders),
    headerPathsDetected: diagnostics.headerPathsDetected || [],
    expectedTargetFiles: task.expectedImpactFiles || diagnostics.expectedTargetFiles || [],
    validatorError: patchResult.ok ? "" : diagnostics.validatorError || validatorReason(patchResult),
    outputExcerptRedacted: redactPatchOutputExcerpt(diagnostics.outputExcerptRedacted || patchResult.rawModelOutputExcerpt || patchResult.unifiedDiff || "", settings),
    provider: diagnostics.provider || patchResult.provider || "",
    model: diagnostics.model || patchResult.model || "",
    latencyMs: Number(diagnostics.latencyMs || patchResult.providerMeta?.providerLatencyMs || 0),
    attempts: Number(diagnostics.attempts || patchResult.providerMeta?.attempts || 0)
  };
  const serialized = JSON.stringify(payload, null, 2);
  if (settings.apiKey && serialized.includes(settings.apiKey)) {
    throw new Error("Invalid diff diagnostics would include an API key; refusing to write.");
  }
  mkdirSync(INVALID_DIFF_DIAGNOSTICS_DIR, { recursive: true });
  writeFileSync(join(INVALID_DIFF_DIAGNOSTICS_DIR, `invalid-diff-${taskSlug(task.taskId)}.latest.json`), serialized, "utf8");
}

async function reformatInvalidDiffOnce({ task, settings, context, plan, projectPath, patchResult, result }) {
  if (!shouldAttemptDiffReformat(patchResult)) return patchResult;
  result.diffReformatAttempted = true;
  const failureReason = validatorReason(patchResult);
  let reformatted;
  try {
    reformatted = await generateAiPatch({
      settings,
      context,
      plan,
      projectPath,
      diffFormatError: failureReason,
      previousPatchOutput: patchResult.rawModelOutputExcerpt || patchResult.unifiedDiff || "",
      ...PROVIDER_OPTIONS
    });
    applyProviderMeta(result, reformatted.providerMeta);
    applyDiffContractMeta(result, reformatted);
  } catch (error) {
    const failure = providerFailure(error);
    result.attempts += failure.attempts;
    result.providerLatencyMs += failure.providerLatencyMs;
    result.timeoutMs = failure.timeoutMs;
    result.diffReformatFailureReason = failure.reason;
    if (failure.attempts > 1) result.providerRetryUsed = true;
    return {
      ok: false,
      status: "blocked",
      failureCategory: failure.category,
      blockers: [{ id: failure.category, title: failure.reason, detail: failure.reason }],
      providerFailureCategory: failure.providerFailureCategory
    };
  }
  result.diffReformatRecovered = Boolean(reformatted.ok);
  result.diffReformatFailureReason = reformatted.ok ? "" : validatorReason(reformatted);
  if (reformatted.ok && !reformatted.recoveredBy) reformatted.recoveredBy = "diff_reformat_retry";
  if (reformatted.ok) result.recoveredBy = "diff_reformat_retry";
  if (!reformatted.ok && reformatted.failureCategory === "invalid_diff") writeInvalidDiffDiagnostics(task, reformatted, settings);
  return reformatted;
}

async function evaluateTask(task, settings) {
  const startedAt = Date.now();
  let tempRoot = "";
  let projectPath = "";
  const result = emptyTaskResult(task);

  try {
    ({ tempRoot, projectPath } = copyFixture(task.fixture));
    const baselineVerification = runVerification(projectPath, task.recommendedVerification, settings);
    const baselineClassification = classifyBaselineVerification({ task, verification: baselineVerification });
    Object.assign(result, {
      ...baselineClassification,
      baselineFailureCategory: baselineClassification.failureCategory || ""
    });
    if (shouldSkipModelForBaseline(baselineClassification)) {
      return failTask(result, baselineClassification.failureCategory, baselineClassification.baselineFailureReason, {
        status: "fixture_invalid"
      });
    }
    result.failureCategory = "";
    result.failureReason = "";

    const context = buildAiPatchContext({
      projectPath,
      projectName: task.fixture,
      task: {
        id: task.taskId,
        title: task.userInput,
        risk: task.riskLevel
      },
      userFiles: task.expectedImpactFiles
    });
    result.filesSentToModel = context.sentFiles || [];
    result.filesSentToModelCount = result.filesSentToModel.length;

    if (!context.ok) {
      return failTask(result, "unknown", "context_insufficient");
    }

    let planResult;
    try {
      result.modelEvaluationStarted = true;
      planResult = await generateAiPlan({ settings, context, ...PROVIDER_OPTIONS });
      applyProviderMeta(result, planResult.providerMeta);
    } catch (error) {
      const failure = providerFailure(error);
      Object.assign(result, {
        attempts: failure.attempts,
        providerLatencyMs: failure.providerLatencyMs,
        timeoutMs: failure.timeoutMs,
        providerRetryUsed: failure.attempts > 1
      });
      return failTask(result, failure.category, failure.reason, {
        providerFailureCategory: failure.providerFailureCategory
      });
    }

    if (!planResult.ok) {
      const category = planResult.failureCategory || blockerCategory(planResult.blockers);
      result.modelCompleted = true;
      return failTask(result, category, blockerReason(planResult.blockers));
    }

    let patchResult;
    try {
      patchResult = await generateAiPatch({
        settings,
        context,
        plan: planResult.plan,
        projectPath,
        ...PROVIDER_OPTIONS
      });
      applyProviderMeta(result, patchResult.providerMeta);
    } catch (error) {
      const failure = providerFailure(error);
      result.attempts += failure.attempts;
      result.providerLatencyMs += failure.providerLatencyMs;
      result.timeoutMs = failure.timeoutMs;
      if (failure.attempts > 1) result.providerRetryUsed = true;
      return failTask(result, failure.category, failure.reason, {
        providerFailureCategory: failure.providerFailureCategory
      });
    }

    result.patchGenerated = Boolean(patchResult.ok);
    applyDiffContractMeta(result, patchResult);
    if (task.taskId === "AI-README-003") writeInvalidDiffDiagnostics(task, patchResult, settings);
    if (!patchResult.ok && patchResult.failureCategory === "invalid_diff") {
      writeInvalidDiffDiagnostics(task, patchResult, settings);
      patchResult = await reformatInvalidDiffOnce({
        task,
        settings,
        context,
        plan: planResult.plan,
        projectPath,
        patchResult,
        result
      });
      result.patchGenerated = Boolean(patchResult.ok);
      applyDiffContractMeta(result, patchResult);
    }
    if (!patchResult.ok) {
      const category = patchResult.failureCategory || blockerCategory(patchResult.blockers);
      return failTask(result, category, blockerReason(patchResult.blockers));
    }

    let applied = applyDraftsToSandbox(projectPath, patchResult.drafts);
    if (!applied.ok) {
      return failTask(result, applied.failureCategory || "patch_apply_failed", applied.failureReason || "patch_apply_failed");
    }
    result.sandboxApplied = true;
    result.filesModifiedInSandbox = applied.modified;
    result.filesModifiedInSandboxCount = result.filesModifiedInSandbox.length;
    let verification = runVerification(projectPath, task.recommendedVerification, settings);

    if (!verification.ok && task.retryOnce) {
      result.retryUsed = true;
      projectPath = restoreFixture(tempRoot, task.fixture);
      try {
        patchResult = await generateAiPatch({
          settings,
          context,
          plan: planResult.plan,
          projectPath,
          failureLog: verification.output || "Verification failed.",
          ...PROVIDER_OPTIONS
        });
        applyProviderMeta(result, patchResult.providerMeta);
      } catch (error) {
        const failure = providerFailure(error);
        result.attempts += failure.attempts;
        result.providerLatencyMs += failure.providerLatencyMs;
        result.timeoutMs = failure.timeoutMs;
        if (failure.attempts > 1) result.providerRetryUsed = true;
        result.verificationResult = verification;
        return failTask(result, failure.category, failure.reason, {
          providerFailureCategory: failure.providerFailureCategory
        });
      }
      if (!patchResult.ok) {
        applyDiffContractMeta(result, patchResult);
        if (patchResult.failureCategory === "invalid_diff") {
          writeInvalidDiffDiagnostics(task, patchResult, settings);
          patchResult = await reformatInvalidDiffOnce({
            task,
            settings,
            context,
            plan: planResult.plan,
            projectPath,
            patchResult,
            result
          });
        }
        if (!patchResult.ok) {
          result.verificationResult = verification;
          const category = patchResult.failureCategory || blockerCategory(patchResult.blockers);
          return failTask(result, category, blockerReason(patchResult.blockers));
        }
      }
      applyDiffContractMeta(result, patchResult);
      applied = applyDraftsToSandbox(projectPath, patchResult.drafts);
      if (!applied.ok) {
        result.verificationResult = verification;
        return failTask(result, applied.failureCategory || "patch_apply_failed", applied.failureReason || "patch_apply_failed");
      }
      result.sandboxApplied = true;
      result.filesModifiedInSandbox = applied.modified;
      result.filesModifiedInSandboxCount = result.filesModifiedInSandbox.length;
      verification = runVerification(projectPath, task.recommendedVerification, settings);
    }

    result.verificationResult = verification;
    result.verificationPassed = Boolean(verification.ok);
    if (verification.ok) {
      result.status = "passed";
      result.passed = true;
      result.retryRecovered = result.retryUsed;
      result.providerRetryRecovered = result.providerRetryUsed;
    } else {
      return failTask(result, "verification_failed", result.retryUsed ? "verification_failed_after_retry" : "verification_failed");
    }
    return result;
  } catch (error) {
    return failTask(result, "unknown", sanitizeText(error?.message || "evaluation_failed", settings));
  } finally {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    result.durationMs = Date.now() - startedAt;
  }
}

function percentile(values = [], p = 0.5) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

function topBy(items = [], key = "failureCategory") {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] || "none";
    if (!value || value === "none") continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
}

function rate(numerator, denominator) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

export function buildEvaluationReport({
  perTask = [],
  startedAt = new Date().toISOString(),
  settingsReady = false,
  redactedProvider = {},
  providerHealth = null,
  onlyFailed = false
} = {}) {
  const total = perTask.length;
  const rawTotal = total;
  const passed = perTask.filter((task) => task.passed).length;
  const skipped = perTask.filter((task) => task.skipped).length;
  const safetyBlocked = perTask.filter((task) => task.safetyBlocked).length;
  const fixtureInvalid = perTask.filter((task) => FIXTURE_INVALID_CATEGORIES.has(task.failureCategory)).length;
  const preExistingFailure = perTask.filter((task) => task.failureCategory === "pre_existing_unrelated_failure").length;
  const modelEvaluationTotal = perTask.filter((task) => task.modelEvaluationStarted).length;
  const evaluatedTaskCount = perTask.filter((task) => !task.skipped && !FIXTURE_INVALID_CATEGORIES.has(task.failureCategory)).length;
  const modelCompleted = perTask.filter((task) => task.modelCompleted).length;
  const transportFailed = perTask.filter((task) =>
    TRANSPORT_CATEGORIES.has(task.failureCategory) || TRANSPORT_CATEGORIES.has(task.providerFailureCategory)
  ).length;
  const timedOut = perTask.filter((task) => task.failureCategory === "timeout" || task.providerFailureCategory === "timeout").length;
  const providerRateLimited = perTask.filter((task) => task.failureCategory === "provider_rate_limited" || task.providerFailureCategory === "provider_rate_limited").length;
  const provider5xx = perTask.filter((task) => task.failureCategory === "provider_5xx" || task.providerFailureCategory === "provider_5xx").length;
  const providerRetryRecovered = perTask.filter((task) => task.providerRetryRecovered).length;
  const invalidDiffCount = perTask.filter((task) => task.failureCategory === "invalid_diff").length;
  const diffReformatAttempted = perTask.filter((task) => task.diffReformatAttempted).length;
  const diffReformatRecovered = perTask.filter((task) => task.diffReformatRecovered).length;
  const diffNormalizationApplied = perTask.filter((task) => task.diffNormalizationApplied).length;
  const diffExtractionApplied = perTask.filter((task) => task.diffExtractionApplied).length;
  const latencyValues = perTask.map((task) => task.providerLatencyMs || 0);
  const durationValues = perTask.map((task) => task.durationMs || 0);

  return {
    generatedAt: new Date().toISOString(),
    startedAt,
    evaluationStatus: providerHealth && !providerHealth.ok && settingsReady ? "provider_health_failed" : "completed",
    matrixPath: "docs/evaluation/REAL_AI_TASK_MATRIX.md",
    reportPath: "data/evaluation/ai-patch-worker/latest.json",
    onlyFailed,
    rawTotal,
    total,
    passed,
    failed: perTask.filter((task) =>
      !task.passed &&
      !task.skipped &&
      !task.safetyBlocked &&
      !FIXTURE_INVALID_CATEGORIES.has(task.failureCategory)
    ).length,
    skipped,
    safetyBlocked,
    fixtureInvalid,
    preExistingFailure,
    evaluatedTaskCount,
    modelEvaluationTotal,
    modelCompleted,
    transportFailed,
    timedOut,
    providerRateLimited,
    provider5xx,
    overallPassRate: rate(passed, total),
    modelPassRate: rate(passed, modelEvaluationTotal),
    completedPassRate: rate(passed, modelCompleted),
    transportFailureRate: rate(transportFailed, total),
    invalidDiffCount,
    diffReformatAttempted,
    diffReformatRecovered,
    diffNormalizationApplied,
    diffExtractionApplied,
    finalModelPassRate: rate(passed, modelEvaluationTotal),
    retryUsed: perTask.filter((task) => task.retryUsed || task.providerRetryUsed).length,
    retryRecovered: perTask.filter((task) => task.retryRecovered || task.providerRetryRecovered).length,
    retryRecoveryRate: rate(
      perTask.filter((task) => task.retryRecovered || task.providerRetryRecovered).length,
      perTask.filter((task) => task.retryUsed || task.providerRetryUsed).length
    ),
    providerRetryRecovered,
    averageDurationMs: durationValues.length
      ? Math.round(durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length)
      : 0,
    modelConfigured: settingsReady,
    modelProvider: redactedProvider.providerMode || "demo_only",
    modelName: redactedProvider.model || "",
    provider: redactedProvider.provider || "",
    providerHealth,
    providerPolicy: PROVIDER_OPTIONS,
    providerLatency: {
      p50Ms: percentile(latencyValues, 0.5),
      p95Ms: percentile(latencyValues, 0.95),
      maxMs: latencyValues.length ? Math.max(...latencyValues) : 0
    },
    keyLeakDetected: false,
    autoApplyCount: 0,
    topFailureReasons: topBy(perTask, "failureReason"),
    topFailureCategories: topBy(perTask, "failureCategory"),
    perTask
  };
}

function writeScorecard(report) {
  const meetsExternal =
    report.rawTotal >= 15 &&
    report.modelEvaluationTotal >= 15 &&
    report.modelPassRate >= 60 &&
    report.fixtureInvalid === 0 &&
    report.safetyBlocked === 0 &&
    report.keyLeakDetected === false &&
    report.autoApplyCount === 0;
  const categories = report.topFailureCategories.length
    ? report.topFailureCategories.map((item) => `${item.reason} (${item.count})`).join(", ")
    : "none";
  const content = [
    "# Stage-12 Scorecard",
    "",
    `Status: ${report.evaluationStatus}.`,
    "",
    "| Metric | Current value |",
    "| --- | --- |",
    `| Real model configured | ${report.modelConfigured ? "yes" : "no"} |`,
    `| Raw task total | ${report.rawTotal} |`,
    `| Evaluated task count | ${report.evaluatedTaskCount} |`,
    `| Model evaluation total | ${report.modelEvaluationTotal} |`,
    `| Passed | ${report.passed} |`,
    `| Failed | ${report.failed} |`,
    `| Skipped | ${report.skipped} |`,
    `| Fixture invalid | ${report.fixtureInvalid} |`,
    `| Pre-existing unrelated failure | ${report.preExistingFailure} |`,
    `| Model completed | ${report.modelCompleted} |`,
    `| Transport failed | ${report.transportFailed} |`,
    `| Timed out | ${report.timedOut} |`,
    `| Overall pass rate | ${report.overallPassRate}% |`,
    `| Model pass rate | ${report.modelPassRate}% |`,
    `| Completed pass rate | ${report.completedPassRate}% |`,
    `| Transport failure rate | ${report.transportFailureRate}% |`,
    `| Invalid diff count | ${report.invalidDiffCount} |`,
    `| Diff reformat attempted | ${report.diffReformatAttempted} |`,
    `| Diff reformat recovered | ${report.diffReformatRecovered} |`,
    `| Diff normalization applied | ${report.diffNormalizationApplied} |`,
    `| Diff extraction applied | ${report.diffExtractionApplied} |`,
    `| Final model pass rate | ${report.finalModelPassRate}% |`,
    `| Safety blocked | ${report.safetyBlocked} |`,
    `| Retry recovered | ${report.retryRecovered} |`,
    `| Retry recovery rate | ${report.retryRecoveryRate}% |`,
    `| Top failure categories | ${categories} |`,
    `| Meets external-test standard | ${meetsExternal ? "yes" : "no"} |`,
    "",
    "Diff contract status:",
    "",
    report.invalidDiffCount
      ? `- Invalid diff failures remain: ${report.invalidDiffCount}. These are output-contract failures, not fixture, provider transport, or safety failures unless another category is also present.`
      : "- No final invalid diff failures.",
    report.diffReformatAttempted
      ? `- Diff reformat retry recovered ${report.diffReformatRecovered}/${report.diffReformatAttempted}.`
      : "- Diff reformat retry was not needed.",
    report.diffNormalizationApplied || report.diffExtractionApplied
      ? `- Safe extraction/normalization applied to ${report.diffExtractionApplied + report.diffNormalizationApplied} task result marker(s).`
      : "- Safe extraction/normalization was not needed.",
    "",
    "External-test standard:",
    "",
    "- At least 15 raw tasks defined and 15 tasks eligible for model evaluation.",
    "- Usable Diff success rate >= 60%.",
    "- Fixture-invalid tasks: 0.",
    "- Safety violations: 0.",
    "- Key leaks: 0.",
    "- Automatic apply: 0.",
    "",
    report.modelConfigured
      ? `Latest report: ${report.reportPath}`
      : "No real model provider is configured, so Stage-12 reliability is not yet proven. Demo Only remains available, but Demo Only does not count as real AI coding success.",
    ""
  ].join("\n");
  mkdirSync(dirname(SCORECARD_FILE), { recursive: true });
  writeFileSync(SCORECARD_FILE, content, "utf8");
}

function writeLatencyReport(report) {
  const content = [
    "# Provider Latency Report",
    "",
    `Provider: ${report.provider || "unknown"}`,
    `Model: ${report.modelName || "unknown"}`,
    `Timeout: ${report.providerPolicy.timeoutMs}ms`,
    `Retries: ${report.providerPolicy.retries}`,
    `Retry backoff: ${report.providerPolicy.retryBackoffMs}ms`,
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| p50 latency | ${report.providerLatency.p50Ms}ms |`,
    `| p95 latency | ${report.providerLatency.p95Ms}ms |`,
    `| max latency | ${report.providerLatency.maxMs}ms |`,
    `| fetch failed / transport error count | ${report.perTask.filter((task) => task.failureCategory === "transport_error" || task.providerFailureCategory === "transport_error").length} |`,
    `| timeout count | ${report.timedOut} |`,
    `| 429 count | ${report.providerRateLimited} |`,
    `| 5xx count | ${report.provider5xx} |`,
    `| retry recovered count | ${report.providerRetryRecovered} |`,
    "",
    "Top failure categories:",
    "",
    ...(report.topFailureCategories.length
      ? report.topFailureCategories.map((item) => `- ${item.reason}: ${item.count}`)
      : ["- none"]),
    ""
  ].join("\n");
  mkdirSync(dirname(LATENCY_REPORT_FILE), { recursive: true });
  writeFileSync(LATENCY_REPORT_FILE, content, "utf8");
}

function loadOnlyFailedTasks(tasks) {
  const taskIndex = process.argv.indexOf("--task");
  if (taskIndex >= 0) {
    const taskId = process.argv[taskIndex + 1] || "";
    return {
      tasks: tasks.filter((task) => task.taskId === taskId),
      onlyFailed: false,
      taskFilter: taskId
    };
  }
  if (!process.argv.includes("--only-failed")) return { tasks, onlyFailed: false, taskFilter: "" };
  if (!existsSync(REPORT_FILE)) return { tasks, onlyFailed: true };
  try {
    const previous = JSON.parse(readFileSync(REPORT_FILE, "utf8"));
    const failedIds = new Set((previous.perTask || [])
      .filter((task) => !task.passed && !task.skipped)
      .map((task) => task.taskId));
    return {
      tasks: tasks.filter((task) => failedIds.has(task.taskId)),
      onlyFailed: true,
      taskFilter: ""
    };
  } catch {
    return { tasks, onlyFailed: true, taskFilter: "" };
  }
}

function skippedResults(tasks, category, reason) {
  return tasks.map((task) => ({
    ...emptyTaskResult(task),
    status: "skipped",
    skipped: true,
    failureCategory: normalizeFailureCategory(category),
    failureReason: reason
  }));
}

async function main() {
  const settings = readModelProviderSettings(SETTINGS_FILE);
  const redactedProvider = redactedModelProviderSettings(settings);
  const ready = modelProviderReady(settings);
  const selected = loadOnlyFailedTasks(loadTaskMatrix());
  const tasks = selected.tasks;
  const startedAt = new Date().toISOString();
  let perTask = [];
  let providerHealth = null;

  if (!ready.ok || settings.providerMode === "demo_only") {
    perTask = skippedResults(tasks, "missing_model_config", "model_not_configured");
  } else {
    providerHealth = await healthCheckModelCompletion({ settings, ...PROVIDER_OPTIONS });
    if (!providerHealth.ok) {
      perTask = skippedResults(tasks, providerHealth.failureCategory || "transport_error", "provider_health_failed");
    } else {
      let index = 0;
      for (const task of tasks) {
        index += 1;
        progress(`${index}/${tasks.length} ${task.taskId} ${task.fixture} started`);
        const taskResult = await evaluateTask(task, settings);
        perTask.push(taskResult);
        progress(`${index}/${tasks.length} ${task.taskId} ${taskResult.status}${taskResult.failureCategory ? ` ${taskResult.failureCategory}` : ""} ${taskResult.durationMs}ms`);
      }
    }
  }

  const report = buildEvaluationReport({
    perTask,
    startedAt,
    settingsReady: ready.ok && settings.providerMode !== "demo_only",
    redactedProvider,
    providerHealth,
    onlyFailed: selected.onlyFailed
  });
  report.taskFilter = selected.taskFilter || "";

  const serialized = JSON.stringify(report, null, 2);
  if (settings.apiKey && serialized.includes(settings.apiKey)) {
    throw new Error("Evaluation report would include an API key; refusing to write.");
  }

  mkdirSync(dirname(REPORT_FILE), { recursive: true });
  writeFileSync(REPORT_FILE, serialized, "utf8");
  writeScorecard(report);
  writeLatencyReport(report);
  console.log(JSON.stringify({
    ok: true,
    reportPath: report.reportPath,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    skipped: report.skipped,
    rawTotal: report.rawTotal,
    evaluatedTaskCount: report.evaluatedTaskCount,
    modelEvaluationTotal: report.modelEvaluationTotal,
    fixtureInvalid: report.fixtureInvalid,
    preExistingFailure: report.preExistingFailure,
    modelCompleted: report.modelCompleted,
    transportFailed: report.transportFailed,
    timedOut: report.timedOut,
    overallPassRate: report.overallPassRate,
    modelPassRate: report.modelPassRate,
    completedPassRate: report.completedPassRate,
    transportFailureRate: report.transportFailureRate,
    invalidDiffCount: report.invalidDiffCount,
    diffReformatAttempted: report.diffReformatAttempted,
    diffReformatRecovered: report.diffReformatRecovered,
    diffNormalizationApplied: report.diffNormalizationApplied,
    diffExtractionApplied: report.diffExtractionApplied,
    finalModelPassRate: report.finalModelPassRate,
    safetyBlocked: report.safetyBlocked,
    retryRecovered: report.retryRecovered,
    modelProvider: report.modelProvider,
    modelName: report.modelName,
    evaluationStatus: report.evaluationStatus
  }, null, 2));
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: sanitizeText(error?.message || "evaluate_ai_patch_worker_failed")
    }, null, 2));
    process.exitCode = 1;
  });
}
