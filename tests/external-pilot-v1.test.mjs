import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Stage-13 external pilot UI exposes onboarding, first task, and feedback export", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");

  assert.match(html, /External Pilot/);
  assert.match(html, /Start The Codingape Office Pilot/);
  assert.match(html, /Run First Task: Update README/);
  assert.match(html, /id="pilotFeedbackForm"/);
  assert.match(html, /Export Pilot Feedback JSON/);
  assert.match(html, /does not collect API keys, full source code, or sensitive file contents/);
  assert.match(app, /function revealPilotFeedbackPanel/);
  assert.match(app, /function submitPilotFeedback/);
  assert.match(app, /\/api\/pilot\/feedback/);
});

test("Demo Only first real order falls back to safe local loop without model calls", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /preview\.providerMode === "demo_only"/);
  assert.match(app, /Demo Only does not call AI; it only shows the safety loop/);
  assert.match(app, /await runFirstOrder\(\)/);
  assert.match(app, /safeFirstOrder:\s*true/);
});

test("Pilot feedback API stores redacted local metrics without API keys or source", async () => {
  const server = await readProjectFile("server.js");

  assert.match(server, /const PILOT_FEEDBACK_DIR/);
  assert.match(server, /const PILOT_LATEST_FILE/);
  assert.match(server, /function redactPilotText/);
  assert.match(server, /settings\.apiKey/);
  assert.match(server, /containsApiKey:\s*false/);
  assert.match(server, /containsSourceCode:\s*false/);
  assert.match(server, /\/api\/pilot\/feedback/);
  assert.match(server, /x-codex-office-local"\] !== "pilot-feedback"/);
});

test("Pilot docs and README explain install, model modes, first task, support, and limits", async () => {
  const readme = await readProjectFile("README.md");
  const runbook = await readProjectFile("docs/pilot/EXTERNAL_PILOT_RUNBOOK.md");
  const invite = await readProjectFile("docs/pilot/TESTER_INVITE_TEMPLATE.md");
  const scorecard = await readProjectFile("docs/pilot/PILOT_SCORECARD.md");
  const knownIssues = await readProjectFile("docs/pilot/KNOWN_ISSUES.md");

  assert.match(readme, /First Pilot Task/);
  assert.match(readme, /A safe AI coding worker for your Mac/);
  assert.match(runbook, /npm run dev/);
  assert.match(runbook, /BYO API Key/);
  assert.match(runbook, /Ollama, LM Studio/);
  assert.match(runbook, /生成支持包/);
  assert.match(invite, /Codingape Office should not write before you explicitly approve/);
  assert.match(scorecard, /Do not fill this section with simulated data/);
  assert.match(knownIssues, /invalid unified diff headers/);
});
