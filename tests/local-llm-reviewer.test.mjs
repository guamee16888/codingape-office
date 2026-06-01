import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildJudgeReviewPrompt,
  localLlmConfig,
  requestLocalJudgeReview,
  testLocalJudgeConnection
} from "../src/local-llm-reviewer.mjs";

const CONTEXT = {
  task: {
    id: "task_1",
    title: "优化函数并生成可审计补丁",
    projectName: "编程猿办公室",
    risk: "medium"
  },
  evidence: {
    commands: [
      {
        command: "git diff --stat",
        status: "completed"
      }
    ]
  },
  proposal: {
    risk: "medium",
    changedFiles: ["public/app.js"],
    diffStat: "public/app.js | 12 ++++++------",
    observations: ["发现 1 个本地变更信号"],
    recommendedSteps: ["运行允许的验证脚本"]
  }
};

test("local LLM config is disabled by default", () => {
  const config = localLlmConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.provider, "disabled");
});

test("judge review prompt keeps human gate safety explicit", () => {
  const prompt = buildJudgeReviewPrompt(CONTEXT.task, CONTEXT.evidence, CONTEXT.proposal);

  assert.match(prompt, /Judge猿/);
  assert.match(prompt, /不要建议自动写入/);
  assert.match(prompt, /人工闸门/);
  assert.match(prompt, /public\/app\.js/);
});

test("requestLocalJudgeReview skips without throwing when disabled", async () => {
  const result = await requestLocalJudgeReview(CONTEXT, {
    env: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.provider, "disabled");
});

test("requestLocalJudgeReview sends Ollama generate payload", async () => {
  let captured = null;
  const result = await requestLocalJudgeReview(CONTEXT, {
    env: {
      CODEX_OFFICE_LOCAL_LLM_PROVIDER: "ollama",
      CODEX_OFFICE_LOCAL_LLM_BASE_URL: "http://ollama.test",
      CODEX_OFFICE_LOCAL_LLM_MODEL: "qwen-test"
    },
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        async json() {
          return {
            response: JSON.stringify({
              summary: "可以继续，但必须保留人工闸门。",
              verdict: "caution",
              risks: ["需要复核 diff"],
              recommendations: ["先看证据包"]
            })
          };
        }
      };
    }
  });

  assert.equal(captured.url, "http://ollama.test/api/generate");
  assert.equal(captured.body.model, "qwen-test");
  assert.equal(captured.body.stream, false);
  assert.equal(result.ok, true);
  assert.equal(result.review.verdict, "caution");
});

test("requestLocalJudgeReview sends OpenAI-compatible chat payload", async () => {
  let captured = null;
  const result = await requestLocalJudgeReview(CONTEXT, {
    env: {
      CODEX_OFFICE_LOCAL_LLM_PROVIDER: "openai_compatible",
      CODEX_OFFICE_LOCAL_LLM_BASE_URL: "http://lmstudio.test/v1",
      CODEX_OFFICE_LOCAL_LLM_MODEL: "local-coder"
    },
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "建议返工前先补充验证。",
                    verdict: "rework",
                    risks: ["验证覆盖不足"],
                    recommendations: ["补充测试"]
                  })
                }
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(captured.url, "http://lmstudio.test/v1/chat/completions");
  assert.equal(captured.body.model, "local-coder");
  assert.equal(captured.body.messages.length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.review.verdict, "rework");
});

test("requestLocalJudgeReview converts fetch failures into non-throwing failed result", async () => {
  const result = await requestLocalJudgeReview(CONTEXT, {
    env: {
      CODEX_OFFICE_LOCAL_LLM_PROVIDER: "ollama"
    },
    fetchImpl: async () => {
      throw new Error("connection refused");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.equal(result.provider, "ollama");
  assert.match(result.error, /connection refused/);
});

test("testLocalJudgeConnection checks Ollama tags without generating text", async () => {
  let capturedUrl = "";
  const result = await testLocalJudgeConnection({
    env: {
      CODEX_OFFICE_LOCAL_LLM_PROVIDER: "ollama",
      CODEX_OFFICE_LOCAL_LLM_BASE_URL: "http://ollama.test",
      CODEX_OFFICE_LOCAL_LLM_MODEL: "qwen-test"
    },
    fetchImpl: async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        async json() {
          return {
            models: [{ name: "qwen-test" }]
          };
        }
      };
    }
  });

  assert.equal(capturedUrl, "http://ollama.test/api/tags");
  assert.equal(result.ok, true);
  assert.equal(result.status, "connected");
  assert.deepEqual(result.models, ["qwen-test"]);
});
