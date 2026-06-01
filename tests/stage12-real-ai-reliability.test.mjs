import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildEvaluationReport,
  classifyBaselineVerification,
  shouldSkipModelForBaseline
} from "../scripts/evaluate-ai-patch-worker.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readProjectFile(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

test("Stage-12 task matrix defines at least 15 real small tasks without results", () => {
  const matrix = readProjectFile("docs/evaluation/REAL_AI_TASK_MATRIX.md");
  const taskRows = matrix.split("\n").filter((line) => line.startsWith("| AI-"));

  assert.ok(taskRows.length >= 15);
  assert.match(matrix, /README \/ 文档|README/);
  assert.match(matrix, /bug|修复/i);
  assert.match(matrix, /retry/i);
  assert.doesNotMatch(matrix, /passed:\s*15|success rate\s*100/i);
});

test("Stage-12 fixture projects are small, local, and verifiable", () => {
  const fixtures = [
    "add-number-sum-demo",
    "divide-zero-demo",
    "simple-node-readme",
    "js-bugfix-button",
    "failing-test-demo",
    "math-multiply-demo",
    "package-script-docs",
    "small-api-field-change"
  ];

  for (const fixture of fixtures) {
    const root = join(repoRoot, "test-fixtures", "ai-patch-worker", fixture);
    assert.equal(existsSync(join(root, "README.md")), true, `${fixture} README`);
    assert.equal(existsSync(join(root, "package.json")), true, `${fixture} package`);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.ok(pkg.scripts?.test, `${fixture} has npm test`);
    assert.equal(existsSync(join(root, ".env")), false, `${fixture} has no .env`);
  }
});

test("AI-TEST-002 uses an isolated divide-zero fixture with add already healthy", () => {
  const matrix = readProjectFile("docs/evaluation/REAL_AI_TASK_MATRIX.md");
  const fixtureRoot = join(repoRoot, "test-fixtures", "ai-patch-worker", "divide-zero-demo");
  const math = readFileSync(join(fixtureRoot, "src", "math.js"), "utf8");

  assert.match(matrix, /\| AI-TEST-002 \| divide-zero-demo \| 修复 divide 在除数为 0 时没有抛出 RangeError 的问题。/);
  assert.match(matrix, /add tests are not a failure cause/);
  assert.match(math, /return a \+ b;/);

  const addOutput = execFileSync("node", ["--input-type=module", "-e", `
    const { add } = await import(${JSON.stringify(pathToFileURL(join(fixtureRoot, "src", "math.js")).href)});
    console.log(add(2, 3));
  `], { encoding: "utf8" }).trim();
  assert.equal(addOutput, "5");
});

test("AI-TEST-002 baseline fails only in the divide task target", async () => {
  const fixtureRoot = join(repoRoot, "test-fixtures", "ai-patch-worker", "divide-zero-demo");
  const { add, divide } = await import(pathToFileURL(join(fixtureRoot, "src", "math.js")).href);
  const output = "failing tests:\n✖ divide throws RangeError for zero divisors\nAssertionError: Missing expected exception (RangeError).";

  assert.equal(add(2, 3), 5);
  assert.equal(divide(8, 2), 4);
  assert.equal(divide(5, 0), Infinity);

  const classification = classifyBaselineVerification({
    task: {
      taskId: "AI-TEST-002",
      fixture: "divide-zero-demo",
      userInput: "修复 divide 在除数为 0 时没有抛出 RangeError 的问题。",
      expectedImpactFiles: ["src/math.js", "checks/math.mjs"],
      successStandard: "divide(5, 0) throws RangeError and normal divide still works."
    },
    verification: { ok: false, output }
  });

  assert.equal(classification.baselineVerificationStatus, "fail");
  assert.equal(classification.expectedBaselineFailure, true);
  assert.equal(classification.expectedFailingScope, "task_target");
  assert.equal(classification.failureCategory, "baseline_verification_expected_failure");
  assert.equal(shouldSkipModelForBaseline(classification), false);
});

test("unrelated baseline failure is classified before any model call", async () => {
  const fixtureRoot = join(repoRoot, "test-fixtures", "ai-patch-worker", "failing-test-demo");
  const { add, divide } = await import(pathToFileURL(join(fixtureRoot, "src", "math.js")).href);
  const output = "failing tests:\n✖ add returns a number sum\nAssertionError: '23' !== 5";

  assert.equal(add(2, 3), "23");
  assert.equal(divide(8, 2), 4);

  const classification = classifyBaselineVerification({
    task: {
      taskId: "AI-TEST-002",
      fixture: "failing-test-demo",
      userInput: "修复 divide 在除数为 0 时没有抛出 RangeError 的问题。",
      expectedImpactFiles: ["src/math.js", "checks/math.mjs"],
      successStandard: "divide validates zero divisor."
    },
    verification: { ok: false, output }
  });

  assert.equal(classification.expectedFailingScope, "unrelated");
  assert.equal(classification.failureCategory, "pre_existing_unrelated_failure");
  assert.equal(shouldSkipModelForBaseline(classification), true);
});

test("missing multiply export is treated as the AI-TEST-003 task target", () => {
  const classification = classifyBaselineVerification({
    task: {
      taskId: "AI-TEST-003",
      fixture: "math-multiply-demo",
      userInput: "给 math 模块补一个 multiply 函数，让现有 multiply 测试通过。",
      successStandard: "multiply is exported, tested, and npm test passes while add/divide remain healthy.",
      failureStandard: "Incomplete export, missing product behavior, unrelated add/divide regression, or verification fails."
    },
    verification: {
      ok: false,
      output: "SyntaxError: The requested module '../src/math.js' does not provide an export named 'multiply'\nimport { add, divide, multiply } from '../src/math.js';"
    }
  });

  assert.equal(classification.expectedFailingScope, "task_target");
  assert.equal(classification.failureCategory, "baseline_verification_expected_failure");
  assert.equal(shouldSkipModelForBaseline(classification), false);
});

test("fixture-invalid tasks are not counted as model patch failures", () => {
  const report = buildEvaluationReport({
    settingsReady: true,
    redactedProvider: { providerMode: "byo_key", provider: "openai_compatible", model: "glm-4.7" },
    perTask: [
      {
        taskId: "AI-TEST-002",
        passed: false,
        skipped: false,
        modelEvaluationStarted: false,
        modelCompleted: false,
        failureCategory: "pre_existing_unrelated_failure",
        providerLatencyMs: 0,
        durationMs: 10
      },
      {
        taskId: "AI-README-001",
        passed: true,
        skipped: false,
        modelEvaluationStarted: true,
        modelCompleted: true,
        providerLatencyMs: 100,
        durationMs: 200
      }
    ]
  });

  assert.equal(report.rawTotal, 2);
  assert.equal(report.fixtureInvalid, 1);
  assert.equal(report.preExistingFailure, 1);
  assert.equal(report.modelEvaluationTotal, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.overallPassRate, 50);
  assert.equal(report.modelPassRate, 100);
});

test("evaluation runner skips honestly without model config and writes structured report", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "codingyuan-stage12-eval-"));
  const output = execFileSync("npm", ["run", "evaluate:ai-patch-worker"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_OFFICE_DATA_DIR: dataDir
    }
  });
  const jsonStart = output.indexOf("{");
  const summary = JSON.parse(output.slice(jsonStart));
  const report = JSON.parse(readFileSync(join(dataDir, "evaluation", "ai-patch-worker", "latest.json"), "utf8"));

  assert.equal(summary.ok, true);
  assert.equal(summary.total, 15);
  assert.equal(summary.skipped, 15);
  assert.equal(report.perTask.length, 15);
  assert.ok(report.perTask.every((task) => task.failureReason === "model_not_configured"));
  assert.ok(report.perTask.every((task) => task.failureCategory === "missing_model_config"));
});

test("evaluation runner and support path do not expose model API keys", () => {
  const script = readProjectFile("scripts/evaluate-ai-patch-worker.mjs");
  const server = readProjectFile("server.js");

  assert.match(script, /serialized\.includes\(settings\.apiKey\)/);
  assert.match(script, /refusing to write/);
  assert.match(script, /Invalid diff diagnostics would include an API key/);
  assert.match(script, /keyLeakDetected:\s*false/);
  assert.match(server, /modelProvider:\s*snapshot\.modelProvider \|\| modelProviderSnapshot\(\)/);
  assert.match(server, /redactedModelProviderSettings/);
});

test("evaluation report computes overall, completed, and transport rates", () => {
  const report = buildEvaluationReport({
    settingsReady: true,
    redactedProvider: { providerMode: "byo_key", provider: "openai_compatible", model: "glm-4.7" },
    perTask: [
      { taskId: "a", passed: true, modelCompleted: true, providerLatencyMs: 100, durationMs: 120 },
      { taskId: "b", passed: false, modelCompleted: true, failureCategory: "verification_failed", providerLatencyMs: 200, durationMs: 240 },
      { taskId: "c", passed: false, modelCompleted: false, failureCategory: "transport_error", providerFailureCategory: "transport_error", providerLatencyMs: 300, durationMs: 320 }
    ]
  });

  assert.equal(report.overallPassRate, 33.3);
  assert.equal(report.completedPassRate, 50);
  assert.equal(report.transportFailureRate, 33.3);
  assert.equal(report.modelCompleted, 2);
  assert.equal(report.transportFailed, 1);
});

test("evaluation report exposes diff contract metrics separately", () => {
  const report = buildEvaluationReport({
    settingsReady: true,
    redactedProvider: { providerMode: "byo_key", provider: "openai_compatible", model: "glm-4.7" },
    perTask: [
      {
        taskId: "a",
        passed: true,
        modelEvaluationStarted: true,
        modelCompleted: true,
        diffReformatAttempted: true,
        diffReformatRecovered: true,
        diffNormalizationApplied: true,
        recoveredBy: "diff_reformat_retry"
      },
      {
        taskId: "b",
        passed: false,
        modelEvaluationStarted: true,
        modelCompleted: true,
        failureCategory: "invalid_diff",
        diffExtractionApplied: true
      }
    ]
  });

  assert.equal(report.invalidDiffCount, 1);
  assert.equal(report.diffReformatAttempted, 1);
  assert.equal(report.diffReformatRecovered, 1);
  assert.equal(report.diffNormalizationApplied, 1);
  assert.equal(report.diffExtractionApplied, 1);
  assert.equal(report.finalModelPassRate, 50);
});

test("provider health failure does not fake evaluation success or leak keys", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "codingyuan-stage12-health-"));
  const settingsDir = join(dataDir);
  const secret = "stage12-health-secret";
  execFileSync("mkdir", ["-p", settingsDir]);
  execFileSync("node", ["-e", `
    const fs = require("fs");
    fs.writeFileSync(${JSON.stringify(join(dataDir, "model-provider-settings.json"))}, JSON.stringify({
      providerMode: "byo_key",
      provider: "openai_compatible",
      endpoint: "http://127.0.0.1:1/v1",
      model: "missing",
      apiKey: ${JSON.stringify(secret)}
    }, null, 2));
  `]);

  execFileSync("npm", ["run", "evaluate:ai-patch-worker"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_OFFICE_DATA_DIR: dataDir,
      AI_PROVIDER_TIMEOUT_MS: "10",
      AI_PROVIDER_RETRIES: "0",
      AI_PROVIDER_RETRY_BACKOFF_MS: "0"
    }
  });
  const reportText = readFileSync(join(dataDir, "evaluation", "ai-patch-worker", "latest.json"), "utf8");
  const report = JSON.parse(reportText);

  assert.equal(report.evaluationStatus, "provider_health_failed");
  assert.equal(report.passed, 0);
  assert.equal(report.skipped, 15);
  assert.equal(reportText.includes(secret), false);
});

test("Context Preview and First Real Order UX are wired without auto apply", () => {
  const html = readProjectFile("public/index.html");
  const app = readProjectFile("public/app.js");
  const server = readProjectFile("server.js");

  assert.match(html, /Run First Task: Update README/);
  assert.match(html, /id="contextPreviewPanel"/);
  assert.match(html, /不会默认上传整个项目/);
  assert.match(app, /previewAiContextForFirstRealOrder/);
  assert.match(app, /runFirstRealOrder/);
  assert.match(server, /handleAiContextPreview/);
  assert.match(server, /\/ai-context-preview/);
  assert.match(app, /patchCandidates:\s*Array\.isArray\(options\.patchCandidates\)/);
  assert.match(server, /captureApplyProposalEvidence/);
});

test("failure explanations cover invalid diff, sensitive files, root escape, verification, model config, and context", () => {
  const app = readProjectFile("public/app.js");
  const script = readProjectFile("scripts/evaluate-ai-patch-worker.mjs");
  const server = readProjectFile("server.js");

  assert.match(app, /模型没有返回有效 diff/);
  assert.match(app, /触碰敏感文件/);
  assert.match(app, /路径越过 project root/);
  assert.match(app, /retry 后仍失败/);
  assert.match(app, /模型未配置/);
  assert.match(app, /context 不足/);
  assert.match(script, /verification_failed_after_retry/);
  assert.match(script, /model_not_configured/);
  assert.match(server, /ai_patch_sandbox_verification_failed/);
  assert.match(server, /status:\s*"blocked"/);
  assert.match(server, /humanGate/);
});
