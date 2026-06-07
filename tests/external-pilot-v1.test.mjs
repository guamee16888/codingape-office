import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const execFileAsync = promisify(execFile);

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
  assert.match(readme, /A local-first AI coding worker for Mac/);
  assert.match(readme, /evidence first, diff before write, human approval before apply/);
  assert.match(runbook, /npm run dev/);
  assert.match(runbook, /BYO API Key/);
  assert.match(runbook, /Ollama, LM Studio/);
  assert.match(runbook, /Generate Support Bundle/);
  assert.match(invite, /Codingape Office should not write before you explicitly approve/);
  assert.match(scorecard, /Do not fill this section with simulated data/);
  assert.match(knownIssues, /invalid unified diff headers/);
});

test("Pilot tester recorder writes redacted scorecard and GitHub comment drafts", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "codingape-pilot-"));
  const scriptPath = fileURLToPath(new URL("../scripts/record-pilot-tester-result.mjs", import.meta.url));

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--tester-id", "T01",
    "--run-mode", "demo_only",
    "--install-status", "pass",
    "--project-selected", "pass",
    "--model-configured", "skipped",
    "--first-task", "pass",
    "--diff-visible", "yes",
    "--human-gate-understood", "yes",
    "--apply-attempted", "no",
    "--rollback-visible", "yes",
    "--support-bundle-generated", "no",
    "--main-blocker", "none",
    "--feedback-score", "4",
    "--next-fix", "Clarify /Users/dadada/private/project model setup"
  ], {
    env: { ...process.env, CODEX_OFFICE_DATA_DIR: tmp }
  });

  const result = JSON.parse(stdout);
  assert.equal(result.record.testerId, "T01");
  assert.equal(result.record.outcome, "usable_first_run");
  assert.equal(result.record.privacy.localPathsRedacted, true);

  const scorecard = JSON.parse(await readFile(join(tmp, "pilot", "stage17-scorecard.json"), "utf8"));
  assert.equal(scorecard.testerResultsRecorded, 1);
  assert.equal(scorecard.usableFirstRuns, 1);
  assert.equal(scorecard.keyLeakage, 0);
  assert.equal(scorecard.autoApplyAllowed, 0);

  const comment = await readFile(join(tmp, "pilot", "github-comments", "T01.md"), "utf8");
  assert.match(comment, /Tester slot T01/);
  assert.match(comment, /Human Gate understood: yes/);
  assert.match(comment, /<local-path>/);
  assert.doesNotMatch(comment, /\/Users\/dadada/);
});

test("Pilot tester recorder refuses API keys without echoing secrets", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "codingape-pilot-secret-"));
  const scriptPath = fileURLToPath(new URL("../scripts/record-pilot-tester-result.mjs", import.meta.url));
  const secret = "sk-1234567890abcdefghijklmnop";

  await assert.rejects(
    execFileAsync(process.execPath, [
      scriptPath,
      "--tester-id", "T02",
      "--run-mode", "demo_only",
      "--install-status", "pass",
      "--project-selected", "pass",
      "--model-configured", "skipped",
      "--first-task", "blocked",
      "--diff-visible", "no",
      "--human-gate-understood", "no",
      "--apply-attempted", "no",
      "--rollback-visible", "no",
      "--support-bundle-generated", "no",
      "--main-blocker", "model-provider",
      "--feedback-score", "2",
      "--notes", `tester pasted ${secret}`
    ], {
      env: { ...process.env, CODEX_OFFICE_DATA_DIR: tmp }
    }),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Unsafe tester result content refused/);
      assert.doesNotMatch(error.stderr, new RegExp(secret));
      return true;
    }
  );
});
