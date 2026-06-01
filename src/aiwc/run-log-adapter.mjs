import { createHash, createHmac } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_SOURCE_SYSTEM = "codex-office";
const DEFAULT_SOURCE = "codex_office_adapter";
const DEFAULT_MODEL = "codex-office-local";
const DEFAULT_PROVIDER = "local";
const MAX_STRING_LENGTH = 6000;
const MAX_ARRAY_LENGTH = 80;
const MAX_OBJECT_KEYS = 120;
const MAX_DEPTH = 7;
const REDACTED = "[REDACTED]";
const RUN_STATUSES = new Set(["completed", "failed", "errored", "timeout", "cancelled", "running"]);

const SECRET_VALUE_PATTERN =
  /\b(?:sk-proj-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,}|aiwc_live_[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)\b/g;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueFromEnv(env, key, fallback = "") {
  const value = env?.[key];
  return value === undefined || value === null || value === "" ? fallback : value;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function cleanIdPart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9:_./@-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 240);
}

function nonEmptyString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function nonNegativeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizedStatus(value) {
  const status = nonEmptyString(value, "completed").toLowerCase();
  if (RUN_STATUSES.has(status)) return status;
  if (status === "done" || status === "success" || status === "succeeded") return "completed";
  if (status === "error") return "errored";
  return "completed";
}

function isSensitiveKey(key) {
  const normalized = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!normalized) return false;

  const telemetryTokenKeys = new Set([
    "prompttokens",
    "completiontokens",
    "totaltokens",
    "tokencostknown"
  ]);
  if (telemetryTokenKeys.has(normalized)) return false;

  return (
    normalized.includes("password") ||
    normalized.includes("passwd") ||
    normalized.includes("secret") ||
    normalized.includes("apikey") ||
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("privatekey") ||
    normalized.includes("accesskey") ||
    normalized.includes("accesstoken") ||
    normalized.includes("refreshtoken") ||
    normalized.includes("sessiontoken") ||
    normalized.includes("bearertoken") ||
    normalized === "jwt" ||
    normalized.endsWith("token")
  );
}

function redactString(value) {
  const redacted = String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(SECRET_VALUE_PATTERN, REDACTED);

  if (redacted.length <= MAX_STRING_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED ${redacted.length - MAX_STRING_LENGTH} chars]`;
}

export function redactRunLogValue(value, key = "", depth = 0, seen = new WeakSet()) {
  if (isSensitiveKey(key)) return REDACTED;
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";

  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_LENGTH).map((item) => redactRunLogValue(item, key, depth + 1, seen));
    if (value.length > MAX_ARRAY_LENGTH) {
      items.push(`[TRUNCATED ${value.length - MAX_ARRAY_LENGTH} items]`);
    }
    seen.delete(value);
    return items;
  }

  const output = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    output[entryKey] = redactRunLogValue(entryValue, entryKey, depth + 1, seen);
  }
  if (Object.keys(value).length > MAX_OBJECT_KEYS) {
    output.__truncated_keys = Object.keys(value).length - MAX_OBJECT_KEYS;
  }
  seen.delete(value);
  return output;
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function hashValue(value) {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

export function resolveAiWorkerConfig(options = {}) {
  const env = options.env || process.env || {};
  const timeoutMs = nonNegativeNumber(
    options.timeoutMs ?? valueFromEnv(env, "AIWC_RUN_LOG_TIMEOUT_MS", valueFromEnv(env, "AIWC_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)),
    DEFAULT_TIMEOUT_MS
  );

  return {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? valueFromEnv(env, "AIWC_BASE_URL")),
    ingestionApiKey: nonEmptyString(options.ingestionApiKey ?? valueFromEnv(env, "AIWC_INGESTION_API_KEY")),
    projectId: nonEmptyString(options.projectId ?? valueFromEnv(env, "AIWC_PROJECT_ID")),
    agentId: nonEmptyString(options.agentId ?? valueFromEnv(env, "AIWC_AGENT_ID")),
    sourceSystem: nonEmptyString(options.sourceSystem ?? valueFromEnv(env, "AIWC_SOURCE_SYSTEM"), DEFAULT_SOURCE_SYSTEM),
    source: nonEmptyString(options.source ?? valueFromEnv(env, "AIWC_SOURCE"), DEFAULT_SOURCE),
    environment: nonEmptyString(
      options.environment ??
        valueFromEnv(env, "AIWC_ENVIRONMENT", valueFromEnv(env, "CODEX_OFFICE_ENV", valueFromEnv(env, "NODE_ENV", "development"))),
      "development"
    ),
    defaultModel: nonEmptyString(options.defaultModel ?? valueFromEnv(env, "AIWC_DEFAULT_MODEL"), DEFAULT_MODEL),
    defaultProvider: nonEmptyString(options.defaultProvider ?? valueFromEnv(env, "AIWC_DEFAULT_PROVIDER"), DEFAULT_PROVIDER),
    timeoutMs
  };
}

export function deriveAiWorkerRunId(payload, config = {}) {
  const metadata = isPlainObject(payload?.metadata) ? payload.metadata : {};
  const sourceSystem = nonEmptyString(metadata.source_system ?? config.sourceSystem, DEFAULT_SOURCE_SYSTEM);
  const workflowName = nonEmptyString(
    metadata.workflow_name ?? payload?.workflow_name ?? metadata.task_type ?? payload?.task_type,
    "run"
  );
  const sourceRunId =
    metadata.run_id ||
    metadata.task_id ||
    metadata.execution_id ||
    metadata.trace_id ||
    metadata.event_id ||
    payload?.id ||
    payload?.task_id;

  if (sourceRunId) {
    return cleanIdPart(`${sourceSystem}:${workflowName}:${sourceRunId}`);
  }

  return cleanIdPart(`${sourceSystem}:${workflowName}:${hashValue(redactRunLogValue(payload)).slice(0, 20)}`);
}

export function buildAiWorkerRunLogPayload(payload, options = {}) {
  const config = resolveAiWorkerConfig(options);
  const source = isPlainObject(payload) ? payload : { input: payload };
  const payloadMetadata = isPlainObject(source.metadata) ? source.metadata : {};
  const extensionMetadata = isPlainObject(options.metadata) ? options.metadata : {};
  const workflowName = nonEmptyString(
    payloadMetadata.workflow_name ?? extensionMetadata.workflow_name ?? source.workflow_name ?? payloadMetadata.task_type ?? source.task_type,
    "generic_run"
  );
  const metadata = {
    source: config.source,
    source_system: config.sourceSystem,
    workflow_name: workflowName,
    task_type: workflowName,
    environment: config.environment,
    ...extensionMetadata,
    ...payloadMetadata
  };

  const normalized = {
    project_id: nonEmptyString(source.project_id ?? source.projectId ?? config.projectId),
    agent_id: nonEmptyString(source.agent_id ?? source.agentId ?? config.agentId),
    run_id_external: nonEmptyString(source.run_id_external ?? source.runIdExternal) || deriveAiWorkerRunId({ ...source, metadata }, config),
    input: redactRunLogValue(source.input ?? source.prompt ?? source.title ?? "(input not captured)", "input"),
    output: redactRunLogValue(source.output ?? null, "output"),
    model: nonEmptyString(source.model ?? config.defaultModel, DEFAULT_MODEL),
    provider: nonEmptyString(source.provider ?? config.defaultProvider, DEFAULT_PROVIDER),
    tools_used: Array.isArray(source.tools_used)
      ? source.tools_used.map((tool) => nonEmptyString(tool)).filter(Boolean).slice(0, MAX_ARRAY_LENGTH)
      : [],
    cost: nonNegativeNumber(source.cost, 0),
    latency: nonNegativeNumber(source.latency, 0),
    status: normalizedStatus(source.status),
    metadata: redactRunLogValue(metadata, "metadata")
  };

  if (!normalized.project_id) throw new Error("AIWC project_id is required");
  if (!normalized.agent_id) throw new Error("AIWC agent_id is required");
  if (!normalized.run_id_external) throw new Error("AIWC run_id_external is required");
  if (!normalized.model) throw new Error("AIWC model is required");
  if (!normalized.provider) throw new Error("AIWC provider is required");

  return normalized;
}

function signBody(body, apiKey, nowMs) {
  const timestamp = Math.floor(nowMs / 1000).toString();
  const signature = `sha256=${createHmac("sha256", apiKey).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
  return { timestamp, signature };
}

async function readResponseBody(response) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return null;
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

function failureResult(result, options) {
  if (options.throwOnError) {
    throw new Error(result.error || result.reason || "AIWC run-log ingestion failed");
  }
  return result;
}

export async function recordAiWorkerRunLog(payload, options = {}) {
  const config = resolveAiWorkerConfig(options);
  const source = isPlainObject(payload) ? payload : { input: payload };
  const fetchImpl = options.fetch || options.fetchImpl || globalThis.fetch;
  const projectId = nonEmptyString(source.project_id ?? source.projectId ?? config.projectId);
  const agentId = nonEmptyString(source.agent_id ?? source.agentId ?? config.agentId);
  const missing = [];

  if (!config.baseUrl) missing.push("AIWC_BASE_URL");
  if (!config.ingestionApiKey) missing.push("AIWC_INGESTION_API_KEY");
  if (!projectId) missing.push("AIWC_PROJECT_ID or payload.project_id");
  if (!agentId) missing.push("AIWC_AGENT_ID or payload.agent_id");
  if (typeof fetchImpl !== "function") missing.push("fetch");

  if (missing.length) {
    return failureResult({
      ok: false,
      skipped: true,
      reason: "missing_configuration",
      missing
    }, options);
  }

  let runPayload;
  try {
    runPayload = buildAiWorkerRunLogPayload({ ...source, project_id: projectId, agent_id: agentId }, options);
  } catch (error) {
    return failureResult({
      ok: false,
      skipped: true,
      reason: "invalid_payload",
      error: error instanceof Error ? error.message : String(error)
    }, options);
  }

  const body = JSON.stringify(runPayload);
  const { timestamp, signature } = signBody(body, config.ingestionApiKey, typeof options.now === "function" ? options.now() : Date.now());
  const controller = new AbortController();
  let timeout = null;

  if (config.timeoutMs > 0) {
    timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    timeout.unref?.();
  }

  try {
    const response = await fetchImpl(`${config.baseUrl}/api/runs`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${config.ingestionApiKey}`,
        "content-type": "application/json",
        "x-aiwc-timestamp": timestamp,
        "x-aiwc-signature": signature
      },
      body,
      signal: controller.signal
    });
    const responseBody = await readResponseBody(response);

    if (!response.ok) {
      return failureResult({
        ok: false,
        status: response.status,
        run_id_external: runPayload.run_id_external,
        error: typeof responseBody === "string" ? responseBody : responseBody?.error || "AIWC ingestion request failed",
        response: responseBody
      }, options);
    }

    return {
      ok: true,
      status: response.status,
      run_id_external: runPayload.run_id_external,
      response: responseBody
    };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return failureResult({
      ok: false,
      run_id_external: runPayload.run_id_external,
      error: timedOut
        ? `AIWC ingestion timed out after ${config.timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error)
    }, options);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
