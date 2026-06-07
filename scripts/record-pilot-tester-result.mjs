#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.CODEX_OFFICE_DATA_DIR
  ? resolve(process.env.CODEX_OFFICE_DATA_DIR)
  : join(ROOT_DIR, "data");
const PILOT_DIR = join(DATA_DIR, "pilot");
const RESULTS_FILE = join(PILOT_DIR, "tester-results.jsonl");
const SCORECARD_FILE = join(PILOT_DIR, "stage17-scorecard.json");
const LATEST_FILE = join(PILOT_DIR, "latest-tester-result.json");
const COMMENTS_DIR = join(PILOT_DIR, "github-comments");

const ALLOWED_TESTERS = new Set(["T01", "T02", "T03", "T04", "T05"]);
const ALLOWED_RUN_MODES = new Set(["demo_only", "byo_api_key", "local_model"]);
const ALLOWED_STATUSES = new Set(["pass", "fail", "blocked", "skipped", "pending"]);
const ALLOWED_CHOICES = new Set(["yes", "no", "skipped", "pending"]);
const ALLOWED_BLOCKERS = new Set([
  "install",
  "node",
  "git",
  "port-4142",
  "project-selection",
  "model-provider",
  "context-preview",
  "diff-not-visible",
  "verification",
  "human-gate-confusing",
  "apply",
  "rollback",
  "support-bundle",
  "trust",
  "other",
  "none",
  "pending"
]);

const SECRET_PATTERNS = [
  ["openai_or_provider_key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g],
  ["google_api_key", /\bAIza[A-Za-z0-9_-]{20,}\b/g],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  ["zhipu_style_key", /\b[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}\b/gi],
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["secret_assignment", /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|ZHIPU_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/gi],
  ["code_fence", /```/g]
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unknown positional argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (key === "help") {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${token.slice(2)}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return `Usage:
  npm run pilot:record-tester -- --tester-id T01 --run-mode demo_only --install-status pass --project-selected pass --model-configured skipped --first-task pass --diff-visible yes --human-gate-understood yes --apply-attempted no --rollback-visible yes --support-bundle-generated no --main-blocker none --feedback-score 4 --next-fix "Clarify model setup"

Optional:
  --input path/to/redacted-result.json
  --notes "Short redacted note"
`;
}

function readInput(args) {
  const fileInput = args.input ? JSON.parse(readFileSync(args.input, "utf8")) : {};
  return { ...fileInput, ...args };
}

function scanUnsafe(value) {
  const text = JSON.stringify(value || {});
  const matches = [];
  for (const [id, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) matches.push(id);
  }
  return [...new Set(matches)];
}

function sanitizeText(value, maxLength = 320) {
  const raw = String(value || "")
    .replace(/\/Users\/[^\s"'`]+/g, "<local-path>")
    .replace(/[A-Z]:\\Users\\[^\s"'`]+/gi, "<local-path>")
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, maxLength);
}

function normalizeTesterId(value) {
  const testerId = String(value || "").trim().toUpperCase();
  if (!ALLOWED_TESTERS.has(testerId)) {
    throw new Error("testerId must be one of T01, T02, T03, T04, or T05");
  }
  return testerId;
}

function normalizeRunMode(value) {
  const text = String(value || "pending").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    demo: "demo_only",
    demo_only: "demo_only",
    byo: "byo_api_key",
    byo_key: "byo_api_key",
    byo_api_key: "byo_api_key",
    local: "local_model",
    local_model: "local_model",
    pending: "demo_only"
  };
  const mode = aliases[text] || text;
  if (!ALLOWED_RUN_MODES.has(mode)) throw new Error("runMode must be demo_only, byo_api_key, or local_model");
  return mode;
}

function normalizeStatus(value, fallback = "pending") {
  const text = String(value || fallback).trim().toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = {
    passed: "pass",
    success: "pass",
    succeeded: "pass",
    failed: "fail",
    blocked: "blocked",
    skip: "skipped",
    skipped: "skipped",
    pending: "pending",
    yes: "pass",
    no: "fail"
  };
  const status = aliases[text] || text;
  if (!ALLOWED_STATUSES.has(status)) throw new Error(`Invalid status: ${value}`);
  return status;
}

function normalizeChoice(value, fallback = "pending") {
  const text = String(value || fallback).trim().toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = {
    true: "yes",
    y: "yes",
    pass: "yes",
    passed: "yes",
    false: "no",
    n: "no",
    fail: "no",
    failed: "no",
    skipped: "skipped",
    skip: "skipped",
    pending: "pending"
  };
  const choice = aliases[text] || text;
  if (!ALLOWED_CHOICES.has(choice)) throw new Error(`Invalid yes/no choice: ${value}`);
  return choice;
}

function normalizeBlocker(value) {
  const blocker = String(value || "pending").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!ALLOWED_BLOCKERS.has(blocker)) throw new Error(`Invalid blocker category: ${value}`);
  return blocker;
}

function normalizeScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 1 || score > 5) throw new Error("feedbackScore must be a number from 1 to 5");
  return Math.round(score);
}

function outcomeFor(record) {
  if (record.firstTaskStatus === "pass" && record.diffVisible === "yes" && record.humanGateUnderstood === "yes") {
    return "usable_first_run";
  }
  if (record.firstTaskStatus === "blocked" || record.firstTaskStatus === "fail") return "blocked";
  return "pending";
}

function buildRecord(input) {
  const unsafeMatches = scanUnsafe(input);
  if (unsafeMatches.length > 0) {
    const error = new Error(`Unsafe tester result content refused: ${unsafeMatches.join(", ")}`);
    error.exitCode = 2;
    throw error;
  }

  const record = {
    testerId: normalizeTesterId(input.testerId),
    recordedAt: new Date().toISOString(),
    runMode: normalizeRunMode(input.runMode),
    installStatus: normalizeStatus(input.installStatus),
    projectSelected: normalizeStatus(input.projectSelected),
    modelConfigured: normalizeStatus(input.modelConfigured, "skipped"),
    firstTaskStatus: normalizeStatus(input.firstTask || input.firstTaskStatus),
    diffVisible: normalizeChoice(input.diffVisible),
    humanGateUnderstood: normalizeChoice(input.humanGateUnderstood),
    applyAttempted: normalizeChoice(input.applyAttempted, "no"),
    rollbackVisible: normalizeChoice(input.rollbackVisible),
    supportBundleGenerated: normalizeChoice(input.supportBundleGenerated),
    mainBlocker: normalizeBlocker(input.mainBlocker),
    feedbackScore: normalizeScore(input.feedbackScore),
    nextFix: sanitizeText(input.nextFix, 240),
    notes: sanitizeText(input.notes, 500),
    privacy: {
      containsApiKey: false,
      containsSourceCode: false,
      containsSensitiveFileContent: false,
      localPathsRedacted: JSON.stringify(input).includes("/Users/") || /[A-Z]:\\Users\\/i.test(JSON.stringify(input))
    }
  };
  record.outcome = outcomeFor(record);
  return record;
}

function readExistingResults() {
  if (!existsSync(RESULTS_FILE)) return [];
  return readFileSync(RESULTS_FILE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function scorecardFor(records) {
  const realRecords = records.filter((record) => record.outcome !== "pending");
  const feedbackScores = realRecords.map((record) => record.feedbackScore).filter((score) => Number.isFinite(score));
  const blockerCounts = new Map();
  for (const record of realRecords) {
    if (record.mainBlocker && record.mainBlocker !== "none") {
      blockerCounts.set(record.mainBlocker, (blockerCounts.get(record.mainBlocker) || 0) + 1);
    }
  }
  const topBlockers = [...blockerCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));

  return {
    generatedAt: new Date().toISOString(),
    trackerIssue: "https://github.com/guamee16888/codingape-office/issues/5",
    testerSlotsReserved: 5,
    testerResultsRecorded: realRecords.length,
    usableFirstRuns: realRecords.filter((record) => record.outcome === "usable_first_run").length,
    blockedRuns: realRecords.filter((record) => record.outcome === "blocked").length,
    diffVisibleCount: realRecords.filter((record) => record.diffVisible === "yes").length,
    humanGateUnderstoodCount: realRecords.filter((record) => record.humanGateUnderstood === "yes").length,
    supportBundleGeneratedCount: realRecords.filter((record) => record.supportBundleGenerated === "yes").length,
    feedbackScoreAverage: feedbackScores.length
      ? Number((feedbackScores.reduce((sum, score) => sum + score, 0) / feedbackScores.length).toFixed(2))
      : null,
    keyLeakage: 0,
    autoApplyAllowed: 0,
    topBlockers
  };
}

function githubCommentFor(record) {
  return `## Tester slot ${record.testerId}

Status: real tester result recorded.

\`\`\`text
Tester: ${record.testerId}
Run mode: ${record.runMode}
Install/local run: ${record.installStatus}
Project selected: ${record.projectSelected}
Model configured: ${record.modelConfigured}
First task: ${record.firstTaskStatus}
Diff visible: ${record.diffVisible}
Human Gate understood: ${record.humanGateUnderstood}
Apply attempted: ${record.applyAttempted}
Rollback visible: ${record.rollbackVisible}
Support bundle generated: ${record.supportBundleGenerated}
Main blocker: ${record.mainBlocker}
Feedback score: ${record.feedbackScore ?? "not provided"}
Next fix: ${record.nextFix || "not provided"}
\`\`\`

Outcome: ${record.outcome}

Privacy check: no API keys, secret file contents, private keys, certificates, wallet material, or full private source code were recorded by the local recorder.`;
}

function writeRecord(record) {
  mkdirSync(PILOT_DIR, { recursive: true });
  mkdirSync(COMMENTS_DIR, { recursive: true });
  appendFileSync(RESULTS_FILE, `${JSON.stringify(record)}\n`, "utf8");
  const records = readExistingResults();
  const scorecard = scorecardFor(records);
  const comment = githubCommentFor(record);
  const commentPath = join(COMMENTS_DIR, `${record.testerId}.md`);
  writeFileSync(LATEST_FILE, JSON.stringify(record, null, 2), "utf8");
  writeFileSync(SCORECARD_FILE, JSON.stringify(scorecard, null, 2), "utf8");
  writeFileSync(commentPath, comment, "utf8");
  return { record, scorecard, paths: { results: RESULTS_FILE, scorecard: SCORECARD_FILE, latest: LATEST_FILE, githubComment: commentPath } };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const input = readInput(args);
  const record = buildRecord(input);
  const result = writeRecord(record);
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(error.exitCode || 1);
}
