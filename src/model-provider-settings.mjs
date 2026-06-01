import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const PROVIDER_MODES = new Set(["demo_only", "byo_key", "local_model"]);
export const PROVIDERS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "openai_compatible",
  "ollama",
  "lm_studio"
]);

const DEFAULTS = Object.freeze({
  providerMode: "demo_only",
  provider: "openai",
  endpoint: "",
  model: "",
  apiKey: "",
  updatedAt: ""
});

function clean(value = "", max = 240) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, max);
}

function providerDefaultForMode(providerMode) {
  return providerMode === "local_model" ? "ollama" : "openai";
}

function defaultEndpoint(provider) {
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "anthropic") return "https://api.anthropic.com/v1";
  if (provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
  if (provider === "ollama") return "http://127.0.0.1:11434";
  if (provider === "lm_studio" || provider === "openai_compatible") return "http://127.0.0.1:1234/v1";
  return "";
}

function defaultModel(provider) {
  if (provider === "openai") return "gpt-4.1-mini";
  if (provider === "anthropic") return "claude-3-5-haiku-latest";
  if (provider === "gemini") return "gemini-1.5-flash";
  if (provider === "ollama") return "qwen2.5-coder:7b";
  if (provider === "lm_studio" || provider === "openai_compatible") return "local-model";
  return "";
}

export function normalizeModelProviderSettings(input = {}, existing = {}) {
  const providerMode = PROVIDER_MODES.has(clean(input.providerMode || existing.providerMode))
    ? clean(input.providerMode || existing.providerMode)
    : DEFAULTS.providerMode;
  const requestedProvider = clean(input.provider || existing.provider || providerDefaultForMode(providerMode));
  const provider = PROVIDERS.has(requestedProvider) ? requestedProvider : providerDefaultForMode(providerMode);
  const endpoint = clean(input.endpoint ?? existing.endpoint ?? defaultEndpoint(provider), 500) || defaultEndpoint(provider);
  const model = clean(input.model ?? existing.model ?? defaultModel(provider), 160) || defaultModel(provider);
  const incomingKey = typeof input.apiKey === "string" ? clean(input.apiKey, 4000) : "";
  const apiKey = providerMode === "byo_key"
    ? incomingKey || clean(existing.apiKey || "", 4000)
    : "";

  return {
    providerMode,
    provider,
    endpoint,
    model,
    apiKey,
    updatedAt: input.updatedAt || existing.updatedAt || ""
  };
}

export function redactedModelProviderSettings(settings = {}) {
  const normalized = normalizeModelProviderSettings(settings, settings);
  return {
    providerMode: normalized.providerMode,
    provider: normalized.provider,
    endpoint: normalized.endpoint,
    model: normalized.model,
    apiKeyConfigured: Boolean(normalized.apiKey),
    updatedAt: normalized.updatedAt || "",
    storage: "local_gitignored_config",
    safetyNotice: "To generate code changes, Codingape may send task-relevant code snippets to the model provider you choose. It does not upload the whole project by default and will not write code before approval."
  };
}

export function readModelProviderSettings(filePath) {
  if (!filePath || !existsSync(filePath)) return normalizeModelProviderSettings(DEFAULTS);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return normalizeModelProviderSettings(parsed, DEFAULTS);
  } catch {
    return normalizeModelProviderSettings(DEFAULTS);
  }
}

export function writeModelProviderSettings(filePath, input = {}) {
  const existing = readModelProviderSettings(filePath);
  const settings = normalizeModelProviderSettings({
    ...input,
    updatedAt: new Date().toISOString()
  }, existing);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(settings, null, 2), { encoding: "utf8", mode: 0o600 });
  return settings;
}

export function modelProviderReady(settings = {}) {
  const normalized = normalizeModelProviderSettings(settings, settings);
  if (normalized.providerMode === "demo_only") {
    return {
      ok: true,
      status: "demo_only",
      reason: "Demo Only uses local deterministic safety flow and does not call a model."
    };
  }
  if (normalized.providerMode === "byo_key" && !normalized.apiKey) {
    return {
      ok: false,
      status: "missing_api_key",
      reason: "BYO API Key mode requires a user-provided provider key."
    };
  }
  if (normalized.providerMode === "local_model" && !normalized.endpoint) {
    return {
      ok: false,
      status: "missing_endpoint",
      reason: "Local Model mode requires an Ollama, LM Studio, or OpenAI-compatible endpoint."
    };
  }
  return {
    ok: true,
    status: "ready",
    reason: "Model provider is configured."
  };
}
