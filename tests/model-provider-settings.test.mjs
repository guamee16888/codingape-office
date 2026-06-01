import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  modelProviderReady,
  readModelProviderSettings,
  redactedModelProviderSettings,
  writeModelProviderSettings
} from "../src/model-provider-settings.mjs";

test("no model config keeps Demo Only ready without token", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-office-model-settings-"));
  const settings = readModelProviderSettings(join(dir, "missing.json"));
  const ready = modelProviderReady(settings);

  assert.equal(settings.providerMode, "demo_only");
  assert.equal(ready.ok, true);
  assert.equal(ready.status, "demo_only");
});

test("BYO API key is stored locally but redacted from snapshots", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-office-model-settings-"));
  const settingsPath = join(dir, "model-provider-settings.json");
  const settings = writeModelProviderSettings(settingsPath, {
    providerMode: "byo_key",
    provider: "openai",
    model: "gpt-test",
    apiKey: "sk-real-secret-value"
  });
  const redacted = redactedModelProviderSettings(settings);

  assert.match(readFileSync(settingsPath, "utf8"), /sk-real-secret-value/);
  assert.equal(redacted.apiKeyConfigured, true);
  assert.equal(JSON.stringify(redacted).includes("sk-real-secret-value"), false);
  assert.equal(redacted.storage, "local_gitignored_config");
});
