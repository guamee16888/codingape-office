import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiPatchDraftsFromModelPatch,
  extractUnifiedDiffBlock,
  generateAiPlan,
  generateAiPatch,
  normalizeUnifiedDiffHeaders,
  runAiPatchGenerationV1,
  shouldAttemptDiffReformat,
  testModelProviderConnection,
  validateAiPlan
} from "../src/ai-patch-worker-v1.mjs";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

test("AI plan blocks high risk or sensitive files before patch generation", () => {
  const high = validateAiPlan({
    summary: "Touch env",
    filesToInspect: [".env"],
    filesToModify: [".env"],
    riskLevel: "high",
    testCommand: "npm test",
    planSteps: ["edit env"]
  });

  assert.equal(high.ok, false);
  assert.ok(high.blockers.some((blocker) => blocker.id === "ai_plan_sensitive_file"));
  assert.ok(high.blockers.some((blocker) => blocker.id === "ai_plan_high_risk"));
});

test("AI patch blocks paths outside root and sensitive files", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-ai-patch-"));
  writeFileSync(join(project, "README.md"), "# App\n", "utf8");
  const result = aiPatchDraftsFromModelPatch({
    projectPath: project,
    patch: {
      unifiedDiff: [
        "--- a/../outside.md",
        "+++ b/../outside.md",
        "@@ -1,1 +1,1 @@",
        "-old",
        "+new"
      ].join("\n"),
      files: [
        { path: "../outside.md", content: "new\n" },
        { path: ".env", content: "SECRET=1\n" }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.id === "ai_patch_path_invalid" || blocker.id === "ai_patch_outside_project_root"));
  assert.ok(result.blockers.some((blocker) => blocker.id === "ai_patch_sensitive_file"));
});

test("fenced diff block is safely extracted and applied", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-fenced-diff-"));
  writeFileSync(join(project, "README.md"), "# App\n", "utf8");
  const result = aiPatchDraftsFromModelPatch({
    projectPath: project,
    patch: {
      expectedTargetFiles: ["README.md"],
      unifiedDiff: [
        "```diff",
        "--- README.md",
        "+++ README.md",
        "@@ -1 +1 @@",
        "-# App",
        "+# Simple Node Example",
        "```"
      ].join("\n"),
      files: []
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.diffExtractionApplied, true);
  assert.equal(result.diffNormalizationApplied, true);
  assert.equal(result.drafts[0].file, "README.md");
  assert.equal(result.drafts[0].content, "# Simple Node Example\n");
});

test("prose plus a single diff block is extracted without accepting multiple candidates", () => {
  const prose = [
    "Here is the patch:",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1 +1 @@",
    "-# App",
    "+# Clear App",
    "Done."
  ].join("\n");
  const extracted = extractUnifiedDiffBlock(prose);

  assert.equal(extracted.ok, true);
  assert.equal(extracted.diffExtractionApplied, true);
  assert.match(extracted.text, /^--- a\/README\.md/);
  assert.doesNotMatch(extracted.text, /Done/);

  const ambiguous = extractUnifiedDiffBlock(`${prose}\n\n--- a/other.md\n+++ b/other.md\n@@ -1 +1 @@\n-a\n+b`);
  assert.equal(ambiguous.ok, false);
});

test("direct multi-file unified diff is one valid patch block", () => {
  const extracted = extractUnifiedDiffBlock([
    "--- a/src/button.js",
    "+++ b/src/button.js",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "--- a/checks/button.mjs",
    "+++ b/checks/button.mjs",
    "@@ -1 +1 @@",
    "-old test",
    "+new test"
  ].join("\n"));

  assert.equal(extracted.ok, true);
  assert.equal(extracted.reason, "direct_diff");
  assert.match(extracted.text, /--- a\/checks\/button\.mjs/);
});

test("bare README headers normalize only for expected target files", () => {
  const normalized = normalizeUnifiedDiffHeaders([
    "--- README.md",
    "+++ README.md",
    "@@ -1 +1 @@",
    "-# App",
    "+# Clear App"
  ].join("\n"), ["README.md"]);

  assert.equal(normalized.ok, true);
  assert.equal(normalized.diffNormalizationApplied, true);
  assert.match(normalized.text, /^--- a\/README\.md\n\+\+\+ b\/README\.md/);

  const unexpected = normalizeUnifiedDiffHeaders([
    "--- README.md",
    "+++ README.md",
    "@@ -1 +1 @@",
    "-# App",
    "+# Clear App"
  ].join("\n"), ["package.json"]);
  assert.equal(unexpected.ok, false);
});

test("sensitive and root-escaping patches stay blocked after diff normalization", () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-sensitive-diff-"));
  writeFileSync(join(project, "README.md"), "# App\n", "utf8");
  const sensitive = aiPatchDraftsFromModelPatch({
    projectPath: project,
    patch: {
      expectedTargetFiles: [".env"],
      unifiedDiff: "--- a/.env\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=1\n",
      files: []
    }
  });
  const outside = aiPatchDraftsFromModelPatch({
    projectPath: project,
    patch: {
      expectedTargetFiles: ["../outside.md"],
      unifiedDiff: "--- a/../outside.md\n+++ b/../outside.md\n@@ -0,0 +1 @@\n+outside\n",
      files: []
    }
  });

  assert.equal(sensitive.ok, false);
  assert.ok(sensitive.blockers.some((blocker) => blocker.id === "ai_patch_sensitive_file"));
  assert.equal(outside.ok, false);
  assert.ok(outside.blockers.some((blocker) => /path|diff|root/i.test(blocker.id)));
});

test("invalid diff triggers one reformat retry without a verification retry", async () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-diff-reformat-"));
  writeFileSync(join(project, "README.md"), "# App\n", "utf8");
  const responses = [
    {
      choices: [{ message: { content: JSON.stringify({
        summary: "Update README",
        filesToInspect: ["README.md"],
        filesToModify: ["README.md"],
        riskLevel: "low",
        testCommand: "npm test",
        planSteps: ["edit README"]
      }) } }]
    },
    {
      choices: [{ message: { content: JSON.stringify({
        summary: "Bad diff",
        unifiedDiff: "--- README.md\n+++ README.md\n-# App\n+# Clear App\n",
        files: [{ path: "README.md", content: "# Clear App\n" }]
      }) } }]
    },
    {
      choices: [{ message: { content: [
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1 @@",
        "-# App",
        "+# Clear App"
      ].join("\n") } }]
    }
  ];
  let index = 0;
  const result = await runAiPatchGenerationV1({
    settings: {
      providerMode: "local_model",
      provider: "openai_compatible",
      endpoint: "http://local.test/v1",
      model: "local"
    },
    context: {
      task: { title: "Update README" },
      files: [{ path: "README.md", content: "# App\n", reason: "readme" }],
      sentFiles: ["README.md"],
      testScripts: [{ name: "test", command: "node --test" }]
    },
    projectPath: project,
    fetchImpl: async () => jsonResponse(responses[index++]),
    verifyDrafts: async () => ({ ok: true })
  });

  assert.equal(result.ok, true);
  assert.equal(result.diffReformatAttempted, true);
  assert.equal(result.diffReformatRecovered, true);
  assert.equal(result.retryCount, 0);
  assert.equal(index, 3);
  assert.equal(result.patch.drafts[0].content, "# Clear App\n");
});

test("safety blocked patches do not trigger diff reformat retry", async () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-no-reformat-sensitive-"));
  writeFileSync(join(project, "README.md"), "# App\n", "utf8");
  const responses = [
    {
      choices: [{ message: { content: JSON.stringify({
        summary: "Update README",
        filesToInspect: ["README.md"],
        filesToModify: ["README.md"],
        riskLevel: "low",
        testCommand: "npm test",
        planSteps: ["edit README"]
      }) } }]
    },
    {
      choices: [{ message: { content: JSON.stringify({
        summary: "Touch env",
        unifiedDiff: "--- a/.env\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=1\n",
        files: [{ path: ".env", content: "SECRET=1\n" }]
      }) } }]
    }
  ];
  let index = 0;
  const result = await runAiPatchGenerationV1({
    settings: {
      providerMode: "local_model",
      provider: "openai_compatible",
      endpoint: "http://local.test/v1",
      model: "local"
    },
    context: {
      task: { title: "Update README" },
      files: [{ path: "README.md", content: "# App\n", reason: "readme" }],
      sentFiles: ["README.md"]
    },
    projectPath: project,
    fetchImpl: async () => jsonResponse(responses[index++])
  });

  assert.equal(result.ok, false);
  assert.equal(result.diffReformatAttempted, false);
  assert.equal(index, 2);
  assert.equal(shouldAttemptDiffReformat(result.patch), false);
});

test("failed verification triggers exactly one AI patch retry", async () => {
  const project = mkdtempSync(join(tmpdir(), "codex-office-ai-retry-"));
  writeFileSync(join(project, "README.md"), "# App\n", "utf8");
  const responses = [
    {
      choices: [{ message: { content: JSON.stringify({
        summary: "Update README",
        filesToInspect: ["README.md"],
        filesToModify: ["README.md"],
        riskLevel: "low",
        testCommand: "npm test",
        planSteps: ["edit README"]
      }) } }]
    },
    {
      choices: [{ message: { content: JSON.stringify({
        summary: "Bad patch",
        unifiedDiff: "--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,1 @@\n-# App\n+# Broken\n",
        files: [{ path: "README.md", content: "# Broken\n" }]
      }) } }]
    },
    {
      choices: [{ message: { content: JSON.stringify({
        summary: "Fixed patch",
        unifiedDiff: "--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,1 @@\n-# App\n+# Fixed\n",
        files: [{ path: "README.md", content: "# Fixed\n" }]
      }) } }]
    }
  ];
  let index = 0;
  const result = await runAiPatchGenerationV1({
    settings: {
      providerMode: "local_model",
      provider: "openai_compatible",
      endpoint: "http://local.test/v1",
      model: "local"
    },
    context: {
      task: { title: "Update README" },
      files: [{ path: "README.md", content: "# App\n", reason: "readme" }],
      sentFiles: ["README.md"],
      testScripts: [{ name: "test", command: "node --test" }]
    },
    projectPath: project,
    fetchImpl: async () => jsonResponse(responses[index++]),
    verifyDrafts: async (drafts) => ({
      ok: drafts[0]?.content.includes("Fixed"),
      output: "README heading was wrong"
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.retryCount, 1);
  assert.equal(result.patch.drafts[0].content, "# Fixed\n");
});

test("model provider test does not expose API key in result", async () => {
  const result = await testModelProviderConnection({
    settings: {
      providerMode: "byo_key",
      provider: "openai",
      endpoint: "http://provider.test/v1",
      model: "gpt-test",
      apiKey: "sk-secret"
    },
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.authorization, "Bearer sk-secret");
      return jsonResponse({ data: [] });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes("sk-secret"), false);
});

test("transport timeout retries model requests", async () => {
  let calls = 0;
  const result = await generateAiPlan({
    settings: {
      providerMode: "local_model",
      provider: "openai_compatible",
      endpoint: "http://local.test/v1",
      model: "local"
    },
    context: {
      task: { title: "Update README" },
      files: [{ path: "README.md", content: "# App\n", reason: "readme" }],
      sentFiles: ["README.md"]
    },
    retries: 1,
    retryBackoffMs: 0,
    timeoutMs: 5,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({
          summary: "Update README",
          filesToInspect: ["README.md"],
          filesToModify: ["README.md"],
          riskLevel: "low",
          testCommand: "npm test",
          planSteps: ["edit README"]
        }) } }]
      });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.equal(result.providerMeta.attempts, 2);
});

test("fetch failed retries model requests", async () => {
  let calls = 0;
  const result = await generateAiPlan({
    settings: {
      providerMode: "local_model",
      provider: "openai_compatible",
      endpoint: "http://local.test/v1",
      model: "local"
    },
    context: {
      task: { title: "Update README" },
      files: [{ path: "README.md", content: "# App\n", reason: "readme" }],
      sentFiles: ["README.md"]
    },
    retries: 1,
    retryBackoffMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({
          summary: "Update README",
          filesToInspect: ["README.md"],
          filesToModify: ["README.md"],
          riskLevel: "low",
          testCommand: "npm test",
          planSteps: ["edit README"]
        }) } }]
      });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("safety and sensitive file blocks do not trigger provider retry", async () => {
  let calls = 0;
  const result = await generateAiPlan({
    settings: {
      providerMode: "local_model",
      provider: "openai_compatible",
      endpoint: "http://local.test/v1",
      model: "local"
    },
    context: {
      task: { title: "Update .env" },
      files: [{ path: "README.md", content: "# App\n", reason: "readme" }],
      sentFiles: ["README.md"]
    },
    retries: 2,
    retryBackoffMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({
          summary: "Update secret config",
          filesToInspect: [".env"],
          filesToModify: [".env"],
          riskLevel: "high",
          testCommand: "npm test",
          planSteps: ["edit env"]
        }) } }]
      });
    }
  });

  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.ok(result.blockers.some((blocker) => blocker.id === "ai_plan_sensitive_file"));
});
