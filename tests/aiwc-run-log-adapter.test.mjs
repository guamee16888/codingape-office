import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAiWorkerRunLogPayload,
  recordAiWorkerRunLog,
  redactRunLogValue
} from "../src/aiwc/run-log-adapter.mjs";

const CONFIG = {
  baseUrl: "https://aiwc.example.test/",
  ingestionApiKey: "aiwc_live_test_secret_1234567890",
  projectId: "project_test",
  agentId: "agent_test",
  now: () => 1_800_000_000_000
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

test("recordAiWorkerRunLog skips cleanly when configuration is missing", async () => {
  const result = await recordAiWorkerRunLog({
    input: "run a task",
    output: "done",
    model: "local",
    provider: "local",
    status: "completed"
  }, {
    env: {},
    fetch: () => {
      throw new Error("fetch should not be called");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "missing_configuration");
  assert.ok(result.missing.includes("AIWC_BASE_URL"));
  assert.ok(result.missing.includes("AIWC_INGESTION_API_KEY"));
});

test("recordAiWorkerRunLog sends signed payloads to /api/runs", async () => {
  const calls = [];
  const result = await recordAiWorkerRunLog({
    run_id_external: "external-1",
    input: "Collect evidence",
    output: "Evidence captured",
    model: "codex-office-evidence-runner",
    provider: "local",
    tools_used: ["git status --short"],
    cost: 0,
    latency: 0.12,
    status: "completed",
    metadata: {
      workflow_name: "task_evidence_capture",
      task_id: "task_1"
    }
  }, {
    ...CONFIG,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(201, { run_id: "run_1", deduplicated: false });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://aiwc.example.test/api/runs");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${CONFIG.ingestionApiKey}`);
  assert.match(calls[0].init.headers["x-aiwc-signature"], /^sha256=[a-f0-9]{64}$/);

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.project_id, "project_test");
  assert.equal(payload.agent_id, "agent_test");
  assert.equal(payload.run_id_external, "external-1");
  assert.equal(payload.metadata.source_system, "codex-office");
  assert.equal(payload.metadata.workflow_name, "task_evidence_capture");
});

test("recordAiWorkerRunLog redacts secrets without removing token telemetry", async () => {
  let sentPayload;
  await recordAiWorkerRunLog({
    run_id_external: "external-redaction",
    input: {
      username: "operator",
      password: "super-secret",
      nested: {
        apiKey: "sk-proj-abcdefghijklmnopqrstuvwxyz",
        authorization: "Bearer abc.def.ghi",
        note: "Bearer plain-token-value"
      }
    },
    output: {
      ok: true,
      session_token: "session-secret",
      message: "created with aiwc_live_abcdefghijklmnopqrstuvwxyz"
    },
    metadata: {
      workflow_name: "secret_test",
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      token_cost_known: true,
      access_token: "access-secret"
    }
  }, {
    ...CONFIG,
    fetch: async (_url, init) => {
      sentPayload = JSON.parse(init.body);
      return jsonResponse(201, { run_id: "run_redacted" });
    }
  });

  assert.equal(sentPayload.input.password, "[REDACTED]");
  assert.equal(sentPayload.input.nested.apiKey, "[REDACTED]");
  assert.equal(sentPayload.input.nested.authorization, "[REDACTED]");
  assert.equal(sentPayload.input.nested.note, "Bearer [REDACTED]");
  assert.equal(sentPayload.output.session_token, "[REDACTED]");
  assert.equal(sentPayload.output.message, "created with [REDACTED]");
  assert.equal(sentPayload.metadata.access_token, "[REDACTED]");
  assert.equal(sentPayload.metadata.prompt_tokens, 10);
  assert.equal(sentPayload.metadata.completion_tokens, 5);
  assert.equal(sentPayload.metadata.total_tokens, 15);
  assert.equal(sentPayload.metadata.token_cost_known, true);
});

test("recordAiWorkerRunLog returns failure results without throwing on network errors", async () => {
  const result = await recordAiWorkerRunLog({
    run_id_external: "external-network",
    input: "run",
    output: "done"
  }, {
    ...CONFIG,
    fetch: async () => {
      throw new Error("network unavailable");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.run_id_external, "external-network");
  assert.match(result.error, /network unavailable/);
});

test("recordAiWorkerRunLog times out without affecting caller control flow", async () => {
  const result = await recordAiWorkerRunLog({
    run_id_external: "external-timeout",
    input: "run",
    output: "done"
  }, {
    ...CONFIG,
    timeoutMs: 5,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.run_id_external, "external-timeout");
  assert.match(result.error, /timed out/);
});

test("buildAiWorkerRunLogPayload derives stable idempotent run ids", () => {
  const first = buildAiWorkerRunLogPayload({
    input: "same input",
    output: "same output",
    metadata: {
      workflow_name: "research",
      task_id: "task_123"
    }
  }, CONFIG);
  const second = buildAiWorkerRunLogPayload({
    input: "same input",
    output: "same output",
    metadata: {
      workflow_name: "research",
      task_id: "task_123"
    }
  }, CONFIG);

  assert.equal(first.run_id_external, "codex-office:research:task_123");
  assert.equal(second.run_id_external, first.run_id_external);
});

test("redactRunLogValue handles circular objects", () => {
  const value = { safe: true };
  value.self = value;

  assert.deepEqual(redactRunLogValue(value), {
    safe: true,
    self: "[CIRCULAR]"
  });
});
