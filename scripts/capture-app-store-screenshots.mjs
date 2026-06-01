#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = join(repoRoot, "data/app-store-screenshots");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(outputRoot, `stage9-${runId}`);
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseUrl = process.env.CODEX_OFFICE_BASE_URL || "http://127.0.0.1:4142";

const frames = [
  {
    file: "01-demo-overview.png",
    label: "Demo overview",
    url: `${baseUrl}/demo?demoStep=1&recording=1`
  },
  {
    file: "02-evidence-pack.png",
    label: "Evidence pack",
    url: `${baseUrl}/demo?demoStep=2&recording=1`
  },
  {
    file: "03-human-gate.png",
    label: "Human Gate",
    url: `${baseUrl}/demo?demoStep=5&recording=1`
  },
  {
    file: "04-apply-gate-blocked.png",
    label: "Apply Gate blocked",
    url: `${baseUrl}/demo?demoStep=8&recording=1`
  },
  {
    file: "05-company-report.png",
    label: "Company report",
    url: `${baseUrl}/demo?demoStep=9&recording=1`
  }
];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertChrome() {
  if (!existsSync(chromePath)) {
    throw new Error(`Google Chrome is required for screenshot capture: ${chromePath}`);
  }
}

async function assertDemoAvailable() {
  const response = await fetch(`${baseUrl}/demo`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Demo route is not available at ${baseUrl}/demo`);
  }
}

function captureFrame(frame) {
  const path = join(runDir, frame.file);
  const result = spawnSync(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--hide-scrollbars",
    "--no-first-run",
    "--disable-background-networking",
    "--disable-component-update",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=3000",
    "--window-size=1440,900",
    "--timeout=8000",
    `--screenshot=${path}`,
    frame.url
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000
  });
  if (result.status !== 0 && !existsSync(path)) {
    throw new Error(`Screenshot failed for ${frame.label}: ${result.stderr || result.stdout}`);
  }
  return {
    ...frame,
    path,
    sha256: sha256(path)
  };
}

assertChrome();
await assertDemoAvailable();
mkdirSync(runDir, { recursive: true });

const captured = frames.map(captureFrame);
const summary = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  runDir,
  note: "Stage-9 App Store screenshots are captured from /demo seeded Demo Data to avoid private source code or credentials.",
  frames: captured
};

writeFileSync(join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
writeFileSync(join(outputRoot, "latest-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
