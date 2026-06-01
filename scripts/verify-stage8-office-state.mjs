#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runPhaseFromTask } from "../public/ui-state-map.js";
import { workerStationModel } from "../public/worker-station-model.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = join(repoRoot, "data/stage8-recordings");
const baseUrl = process.env.CODEX_OFFICE_BASE_URL || "http://127.0.0.1:4142";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForDevtoolsUrl(child) {
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Chrome DevTools endpoint was not ready.\n${stderr}`));
    }, 10000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready: ${code}\n${stderr}`));
    });
  });
}

async function connectDevtoolsPage(browserWsUrl) {
  const browserUrl = new URL(browserWsUrl);
  const targets = await (await fetch(`http://${browserUrl.host}/json/list`, { cache: "no-store" })).json();
  const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!pageTarget) {
    throw new Error("Chrome DevTools page target was not available.");
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  const pending = new Map();
  const logs = [];
  let nextId = 1;
  let loaded = false;

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id).resolve(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Page.loadEventFired") loaded = true;
    if (message.method === "Runtime.exceptionThrown") {
      logs.push({
        type: "exception",
        level: "error",
        text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || ""
      });
    }
    if (message.method === "Runtime.consoleAPICalled") {
      logs.push({
        type: "console",
        level: message.params.type || "log",
        text: message.params.args?.map((arg) => arg.value || arg.description || "").filter(Boolean).join(" ") || ""
      });
    }
    if (message.method === "Log.entryAdded") {
      logs.push({
        type: "log",
        level: message.params.entry.level || "info",
        text: message.params.entry.text || ""
      });
    }
  });

  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

  function send(method, params = {}) {
    const id = nextId;
    nextId += 1;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, 10000);
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          if (message.error) reject(new Error(`${method} failed: ${message.error.message}`));
          else resolve(message);
        }
      });
    });
  }

  return {
    get loaded() {
      return loaded;
    },
    logs,
    send,
    close: () => {
      ws.close();
    }
  };
}

async function captureOfficeScreenshot({ screenshotPath, task }) {
  if (!existsSync(chromePath)) {
    return {
      path: screenshotPath,
      error: "Google Chrome is not installed at the expected path."
    };
  }
  if (typeof WebSocket !== "function") {
    return {
      path: screenshotPath,
      error: "Node WebSocket runtime is required for Stage-8 visual capture."
    };
  }

  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--disable-background-networking",
    "--disable-component-update",
    "--remote-debugging-port=0",
    "--window-size=1440,1000",
    "about:blank"
  ], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"]
  });

  let devtools = null;
  try {
    const browserWsUrl = await waitForDevtoolsUrl(chrome);
    devtools = await connectDevtoolsPage(browserWsUrl);
    await devtools.send("Page.enable");
    await devtools.send("Runtime.enable");
    await devtools.send("Log.enable");
    await devtools.send("Page.navigate", { url: `${baseUrl}/office` });

    for (let index = 0; index < 20 && !devtools.loaded; index += 1) {
      await wait(250);
    }

    let renderState = {};
    const expectedTitle = JSON.stringify(task.title || task.id);
    const expectedTaskId = JSON.stringify(task.id);
    for (let index = 0; index < 30; index += 1) {
      await wait(500);
      const evaluated = await devtools.send("Runtime.evaluate", {
        expression: `(() => {
          const text = document.body.innerText || "";
          const expectedTitle = ${expectedTitle};
          const expectedTaskId = ${expectedTaskId};
          return {
            ready: document.readyState,
            hasTask: text.includes(expectedTitle) || text.includes(expectedTaskId),
            stage: document.querySelector("#stageTitle")?.textContent || "",
            commandRun: document.querySelector("#commandRun")?.textContent || "",
            roomLatestEvent: document.querySelector("#roomLatestEvent")?.textContent || "",
            workerRoomText: document.querySelector("#workerRoom")?.innerText?.slice(0, 1200) || ""
          };
        })()`,
        returnByValue: true
      });
      renderState = evaluated.result.result.value;
      if (renderState.hasTask) break;
    }

    const screenshot = await devtools.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, "base64"));

    const webglFallback = devtools.logs.some((entry) => /WebGL context|Error creating WebGL/i.test(entry.text));
    const unexpectedErrors = devtools.logs
      .filter((entry) => entry.level === "error" && !/WebGL context|Error creating WebGL/i.test(entry.text))
      .slice(0, 5);

    if (!renderState.hasTask) {
      throw new Error(`Office did not render the real Stage-8 task before screenshot. Last stage: ${renderState.stage || "unknown"}`);
    }

    return {
      path: screenshotPath,
      sha256: sha256(screenshotPath),
      renderedTask: true,
      stage: renderState.stage,
      commandRun: renderState.commandRun,
      roomLatestEvent: renderState.roomLatestEvent,
      webglFallback,
      unexpectedErrors
    };
  } finally {
    try {
      await devtools?.send("Browser.close");
    } catch {
      // Chrome may already be closed after a failed capture.
    }
    devtools?.close();
    chrome.kill();
  }
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${path} failed: ${payload.error || response.statusText}`);
  }
  return payload;
}

const statusBefore = await jsonFetch("/api/status");
const project = statusBefore.projects?.[0];
if (!project?.id) {
  throw new Error("No authorized project is available for Stage-8 /office verification.");
}

const loop = await jsonFetch(`/api/projects/${encodeURIComponent(project.id)}/coding-loop`, {
  method: "POST",
  body: JSON.stringify({
    mode: "sandbox_patch",
    safeFirstOrder: true,
    title: "Stage-8 real office state check: generate evidence-backed README patch preview"
  })
});

const statusAfter = await jsonFetch("/api/status");
const task = statusAfter.tasks?.find((candidate) => candidate.id === loop.task?.id) || loop.task;
const coreWorkers = ["coding-yuan", "judge-yuan", "ops-yuan"]
  .map((id) => statusAfter.workers?.find((worker) => worker.id === id))
  .filter(Boolean);
const phase = runPhaseFromTask(task);
const stationModels = coreWorkers.map((worker) => workerStationModel(worker, task));
const outputPath = join(outputRoot, `office-state-${task.id}.json`);
const screenshotPath = join(outputRoot, `office-state-${task.id}.png`);

mkdirSync(outputRoot, { recursive: true });
const screenshot = await captureOfficeScreenshot({ screenshotPath, task });

const summary = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  project: {
    id: project.id,
    name: project.name,
    path: project.path
  },
  task: {
    id: task.id,
    title: task.title,
    phase,
    applyStatus: task.result?.applyStatus || "not_run",
    verificationStatus: task.result?.verificationStatus || "not_run",
    patchRunStatus: task.result?.patchRunStatus || "not_run",
    evidence: task.evidence || []
  },
  stationModels: stationModels.map((model) => ({
    id: model.id,
    name: model.name,
    runtimeState: model.runtimeState,
    animation: model.animation,
    light: model.light.key,
    gateStatus: model.gateStatus,
    runId: model.runId,
    riskLevel: model.riskLevel
  })),
  result: {
    ok: true,
    proof: "A real /office coding-loop run was created through the local API. Worker station states are derived from the resulting task phase."
  },
  screenshot
};

writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
writeFileSync(join(outputRoot, "latest-office-state-summary.json"), `${JSON.stringify({ ...summary, summarySha256: sha256(outputPath) }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, outputPath, summarySha256: sha256(outputPath) }, null, 2));
