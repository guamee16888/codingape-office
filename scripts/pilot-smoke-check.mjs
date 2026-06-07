#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number.parseInt(process.env.PORT || "4142", 10);

function parseArgs(argv) {
  const args = { json: false };
  for (const token of argv) {
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--help") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function usage() {
  return `Usage:
  npm run pilot:smoke
  npm run pilot:smoke -- --json

Checks the local source checkout before an external tester starts the 10-minute pilot.
`;
}

function commandVersion(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    ok: result.status === 0,
    value: String(result.stdout || result.stderr || "").trim().split("\n")[0] || null
  };
}

function checkPort(port) {
  return new Promise((resolveCheck) => {
    const server = createServer();
    server.once("error", () => resolveCheck(false));
    server.once("listening", () => {
      server.close(() => resolveCheck(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function addCheck(checks, id, ok, message, level = "required") {
  checks.push({ id, ok, level, message });
}

function packageJson() {
  return JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8"));
}

async function buildReport() {
  const checks = [];
  const warnings = [];
  const pkg = packageJson();
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  const git = commandVersion("git");
  const npm = commandVersion("npm");
  const gitRoot = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const portAvailable = await checkPort(PORT);

  addCheck(checks, "node_version", nodeMajor >= 20, `Node.js ${process.versions.node}; required >= 20`);
  addCheck(checks, "npm_available", npm.ok, npm.ok ? `npm available: ${npm.value}` : "npm is missing");
  addCheck(checks, "git_available", git.ok, git.ok ? `git available: ${git.value}` : "git is missing");
  addCheck(checks, "git_checkout", gitRoot.status === 0, "current folder is a git checkout");

  if (process.platform !== "darwin") {
    warnings.push({
      id: "macos_recommended",
      message: "Codingape Office targets macOS; source smoke checks can run elsewhere, but the pilot should be tested on a Mac."
    });
  }

  if (!portAvailable) {
    warnings.push({
      id: "port_4142_in_use",
      message: `Port ${PORT} is already in use. Stop the process or run the app with a different PORT.`
    });
  }

  const requiredFiles = [
    "README.md",
    "server.js",
    "public/index.html",
    "public/app.js",
    "docs/pilot/START_HERE.md",
    "docs/pilot/TESTER_INTAKE_CHECKLIST.md"
  ];
  for (const file of requiredFiles) {
    addCheck(checks, `file:${file}`, existsSync(join(ROOT_DIR, file)), `${file} exists`);
  }

  const requiredScripts = ["dev", "test", "pilot:smoke", "pilot:feedback-template", "pilot:record-tester", "beta:first-order"];
  for (const script of requiredScripts) {
    addCheck(checks, `script:${script}`, Boolean(pkg.scripts?.[script]), `npm script ${script} exists`);
  }

  const hardFailures = checks.filter((check) => check.level === "required" && !check.ok);
  return {
    ok: hardFailures.length === 0,
    summary: hardFailures.length === 0
      ? "Pilot smoke check passed. You can start the 10-minute pilot."
      : "Pilot smoke check failed. Fix required checks before starting the pilot.",
    packageVersion: pkg.version,
    port: PORT,
    checks,
    warnings
  };
}

function printHuman(report) {
  console.log(report.summary);
  console.log("");
  for (const check of report.checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id} - ${check.message}`);
  }
  for (const warning of report.warnings) {
    console.log(`WARN ${warning.id} - ${warning.message}`);
  }
  console.log("");
  console.log("Next:");
  console.log("1. Run npm run dev");
  console.log("2. Open http://127.0.0.1:4142/office");
  console.log("3. Follow docs/pilot/START_HERE.md");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const report = await buildReport();
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
