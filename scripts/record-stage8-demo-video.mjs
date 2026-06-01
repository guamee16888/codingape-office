#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = join(repoRoot, "data/stage8-recordings");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(outputRoot, `demo-${runId}`);
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseUrl = process.env.CODEX_OFFICE_BASE_URL || "http://127.0.0.1:4142";
const frameCount = 10;

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertTool(pathOrName, label) {
  const result = pathOrName.startsWith("/")
    ? existsSync(pathOrName)
    : spawnSync("/usr/bin/env", ["which", pathOrName], { encoding: "utf8" });
  const ok = typeof result === "boolean" ? result : result.status === 0;
  if (!ok) {
    throw new Error(`${label} is required for Stage-8 recording.`);
  }
}

async function assertOfficeAvailable() {
  const response = await fetch(`${baseUrl}/demo`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Office demo route is not available at ${baseUrl}/demo`);
  }
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

assertTool(chromePath, "Google Chrome");
assertTool("ffmpeg", "ffmpeg");
await assertOfficeAvailable();
mkdirSync(runDir, { recursive: true });

const frames = [];
for (let step = 0; step < frameCount; step += 1) {
  const framePath = join(runDir, `frame-${String(step).padStart(2, "0")}.png`);
  const url = `${baseUrl}/demo?demoStep=${step}&recording=1`;
  run(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--window-size=1440,1000",
    `--screenshot=${framePath}`,
    url
  ], `Chrome screenshot step ${step}`);
  frames.push({ step, url, path: framePath, sha256: sha256(framePath) });
}

const videoPath = join(runDir, "codingyuan-stage8-demo-3min.mp4");
run("ffmpeg", [
  "-y",
  "-framerate",
  "1/18",
  "-i",
  join(runDir, "frame-%02d.png"),
  "-c:v",
  "libx264",
  "-r",
  "30",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  videoPath
], "ffmpeg demo video render");

const summary = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  runDir,
  videoPath,
  videoSha256: sha256(videoPath),
  durationSeconds: 180,
  frames,
  note: "Stage-8 demo recording uses real /demo rendering with seeded Demo Data and deterministic demoStep URLs."
};
writeFileSync(join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
writeFileSync(join(outputRoot, "latest-demo-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
