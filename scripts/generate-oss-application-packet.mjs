#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.CODEX_OFFICE_DATA_DIR
  ? resolve(process.env.CODEX_OFFICE_DATA_DIR)
  : join(ROOT_DIR, "data");
const OUTPUT_DIR = join(DATA_DIR, "oss-application");
const PACKET_MD = join(OUTPUT_DIR, "latest.md");
const PACKET_JSON = join(OUTPUT_DIR, "latest.json");

const REPO = "guamee16888/codingape-office";
const REPO_URL = `https://github.com/${REPO}`;
const TRACKER_URL = `${REPO_URL}/issues/5`;

const SECRET_PATTERNS = [
  ["openai_or_provider_key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g],
  ["google_api_key", /\bAIza[A-Za-z0-9_-]{20,}\b/g],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  ["zhipu_style_key", /\b[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}\b/gi],
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["secret_assignment", /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|ZHIPU_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/gi],
  ["local_user_path", /\/Users\/[^\s)"']+/g]
];

function parseArgs(argv) {
  const args = { offline: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unknown positional argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (key === "offline" || key === "help") {
      args[key] = true;
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
  npm run oss:application-packet
  npm run oss:application-packet -- --offline

Writes:
  data/oss-application/latest.md
  data/oss-application/latest.json
`;
}

function readText(relativePath) {
  return readFileSync(join(ROOT_DIR, relativePath), "utf8");
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function ghJson(args) {
  const stdout = execFileSync("gh", args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(stdout);
}

function safeGhJson(args, fallback, offline) {
  if (offline) return fallback;
  try {
    return ghJson(args);
  } catch {
    return fallback;
  }
}

function gitOutput(args, fallback = "") {
  try {
    return execFileSync("git", args, {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return fallback;
  }
}

function extractSection(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n").trim();
}

function scanUnsafe(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  const matches = [];
  for (const [id, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) matches.push(id);
  }
  return [...new Set(matches)];
}

function sanitizeMarkdown(text) {
  return String(text || "")
    .replace(/\/Users\/[^\s)"']+/g, "<local-path>")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function repoFallback(pkg) {
  return {
    nameWithOwner: REPO,
    description: pkg.description,
    url: REPO_URL,
    stargazerCount: null,
    forkCount: null,
    licenseInfo: { key: "mit", name: "MIT License" },
    repositoryTopics: [],
    defaultBranchRef: { name: "main" }
  };
}

function buildPilotEvidence(tracker, localScorecard) {
  const comments = Array.isArray(tracker.comments) ? tracker.comments : [];
  const reservedSlots = comments.filter((comment) => /Status: reserved, no real tester result recorded yet/.test(comment.body || "")).length;
  const recordedResults = comments.filter((comment) => /Status: real tester result recorded/.test(comment.body || "")).length;
  return {
    trackerIssue: tracker.url || TRACKER_URL,
    trackerState: tracker.state || "unknown",
    reservedSlots,
    recordedResults,
    localTesterResultsRecorded: localScorecard?.testerResultsRecorded ?? 0,
    localUsableFirstRuns: localScorecard?.usableFirstRuns ?? 0,
    noFabricatedData: recordedResults === 0 && (localScorecard?.testerResultsRecorded ?? 0) === 0
      ? "No real tester results recorded yet."
      : "Real tester results are recorded separately from pending slots."
  };
}

function buildPacket({ offline = false } = {}) {
  const pkg = JSON.parse(readText("package.json"));
  const readme = readText("README.md");
  const applicationDraft = readText("docs/OPENAI_OSS_APPLICATION.md");
  const pilotScorecardDoc = readText("docs/pilot/PILOT_SCORECARD.md");
  const releaseNotes = readText("docs/releases/v0.1.0.md");
  const localPilotScorecard = readJsonIfExists(join(DATA_DIR, "pilot", "stage17-scorecard.json"));

  const repo = safeGhJson([
    "repo",
    "view",
    REPO,
    "--json",
    "nameWithOwner,description,url,stargazerCount,forkCount,licenseInfo,repositoryTopics,defaultBranchRef"
  ], repoFallback(pkg), offline);
  const tracker = safeGhJson([
    "issue",
    "view",
    "5",
    "--repo",
    REPO,
    "--json",
    "number,title,state,labels,url,comments"
  ], { url: TRACKER_URL, state: "unknown", comments: [] }, offline);

  const commit = gitOutput(["rev-parse", "--short", "HEAD"], "unknown");
  const latestTag = gitOutput(["describe", "--tags", "--abbrev=0"], "none");
  const testCountMatch = readText("tests/external-pilot-v1.test.mjs").match(/Pilot tester recorder writes redacted scorecard/);
  const topics = (repo.repositoryTopics || []).map((topic) => topic.name || topic).filter(Boolean).sort();
  const pilotEvidence = buildPilotEvidence(tracker, localPilotScorecard);

  const packet = {
    generatedAt: new Date().toISOString(),
    project: {
      name: "Codingape Office",
      repository: repo.url || REPO_URL,
      description: repo.description || pkg.description,
      license: repo.licenseInfo?.name || "MIT License",
      defaultBranch: repo.defaultBranchRef?.name || "main",
      stars: repo.stargazerCount,
      forks: repo.forkCount,
      topics,
      latestCommit: commit,
      latestStableTag: latestTag,
      release: `${REPO_URL}/releases/tag/v0.1.0`
    },
    application: {
      projectSummary: extractSection(applicationDraft, "Project Summary"),
      whyItMatters: extractSection(applicationDraft, "Why This Project Matters"),
      maintainerActivity: extractSection(applicationDraft, "Maintainer Activity"),
      supportAsk: extractSection(applicationDraft, "What Support Would Enable"),
      shortVersion: extractSection(applicationDraft, "Short Version")
    },
    evidence: {
      readmeHasPlainEnglishHero: /A local-first AI coding worker for Mac/.test(readme),
      releaseHasDemoGif: /Codingape Office demo/.test(releaseNotes),
      contributingPresent: existsSync(join(ROOT_DIR, "CONTRIBUTING.md")),
      securityPresent: existsSync(join(ROOT_DIR, "SECURITY.md")),
      issueTemplatesPresent: existsSync(join(ROOT_DIR, ".github", "ISSUE_TEMPLATE")),
      pullRequestTemplatePresent: existsSync(join(ROOT_DIR, ".github", "PULL_REQUEST_TEMPLATE.md")),
      pilotTracker: pilotEvidence,
      recorderSafetyTestPresent: Boolean(testCountMatch),
      scorecardSaysNoFabricatedData: /Do not fill this section with simulated data/.test(pilotScorecardDoc)
    },
    formFields: {
      projectName: "Codingape Office",
      repository: repo.url || REPO_URL,
      oneLineDescription: pkg.description,
      maintainerRole: "I am the maintainer and primary developer of Codingape Office. I maintain the safety workflow, AI patch worker, evaluation fixtures, macOS packaging pipeline, documentation, and contributor workflow.",
      openSourceImpact: "Codingape Office explores safety primitives for AI-assisted code changes: selected project roots, context minimization, sensitive file filtering, unified diff validation, sandbox apply, verification before apply, human approval gates, rollback snapshots, and redacted support bundles.",
      supportRequest: "Codex access would help improve AI patch reliability, expand evaluation fixtures, harden diff validation, improve first-run onboarding, document model provider setup, review external contributions, and support the macOS external pilot."
    }
  };

  const markdown = renderMarkdown(packet);
  const unsafe = scanUnsafe({ packet, markdown });
  if (unsafe.length > 0) {
    const error = new Error(`Refusing to write OSS application packet with unsafe content: ${unsafe.join(", ")}`);
    error.exitCode = 2;
    throw error;
  }
  return { packet, markdown };
}

function renderMarkdown(packet) {
  const app = packet.application;
  const evidence = packet.evidence;
  const project = packet.project;
  const pilot = evidence.pilotTracker;
  return sanitizeMarkdown(`# OpenAI OSS Application Packet

Generated: ${packet.generatedAt}

## Project

- Name: ${project.name}
- Repository: ${project.repository}
- Description: ${project.description}
- License: ${project.license}
- Default branch: ${project.defaultBranch}
- Stars: ${project.stars ?? "not checked"}
- Forks: ${project.forks ?? "not checked"}
- Latest commit: ${project.latestCommit}
- Latest stable tag: ${project.latestStableTag}
- Release: ${project.release}
- Topics: ${project.topics.length ? project.topics.join(", ") : "not checked"}

## Project Summary

${app.projectSummary}

## Why It Matters

${app.whyItMatters}

## Maintainer Activity

${app.maintainerActivity}

## What Support Would Enable

${app.supportAsk}

## Short Form Answer

${app.shortVersion}

## Evidence Checklist

- README plain-English hero: ${evidence.readmeHasPlainEnglishHero ? "yes" : "no"}
- v0.1.0 release includes demo GIF: ${evidence.releaseHasDemoGif ? "yes" : "no"}
- CONTRIBUTING.md present: ${evidence.contributingPresent ? "yes" : "no"}
- SECURITY.md present: ${evidence.securityPresent ? "yes" : "no"}
- GitHub issue templates present: ${evidence.issueTemplatesPresent ? "yes" : "no"}
- GitHub PR template present: ${evidence.pullRequestTemplatePresent ? "yes" : "no"}
- Pilot tracker: ${pilot.trackerIssue}
- Pilot tracker state: ${pilot.trackerState}
- Tester slots reserved: ${pilot.reservedSlots}
- Real tester results in tracker: ${pilot.recordedResults}
- Local tester results recorded: ${pilot.localTesterResultsRecorded}
- Local usable first runs: ${pilot.localUsableFirstRuns}
- Pilot data note: ${pilot.noFabricatedData}
- Recorder safety test present: ${evidence.recorderSafetyTestPresent ? "yes" : "no"}
- Scorecard prohibits fabricated data: ${evidence.scorecardSaysNoFabricatedData ? "yes" : "no"}

## Form Fields

Project name:
${packet.formFields.projectName}

Repository:
${packet.formFields.repository}

One-line description:
${packet.formFields.oneLineDescription}

Maintainer role:
${packet.formFields.maintainerRole}

Open-source impact:
${packet.formFields.openSourceImpact}

What access would help with:
${packet.formFields.supportRequest}

## Submission Safety

Do not include private credentials, API keys, Apple signing material, app-specific passwords, private source code, or private local paths in the submitted form.`);
}

function writePacket(result) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(PACKET_JSON, `${JSON.stringify(result.packet, null, 2)}\n`, "utf8");
  writeFileSync(PACKET_MD, `${result.markdown}\n`, "utf8");
  return { markdown: PACKET_MD, json: PACKET_JSON };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = buildPacket({ offline: args.offline });
  const paths = writePacket(result);
  console.log(JSON.stringify({ paths, project: result.packet.project, pilot: result.packet.evidence.pilotTracker }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(error.exitCode || 1);
}
