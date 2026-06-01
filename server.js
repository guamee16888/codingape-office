import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  recordAiWorkerRunLog,
  resolveAiWorkerConfig
} from "./src/aiwc/run-log-adapter.mjs";
import {
  codingLoopDemoProfile,
  sandboxApplyGateEnv,
  sandboxPatchRunnerEnv
} from "./src/coding-loop-demo.mjs";
import { evaluateApplyGateV1 } from "./src/apply-gate-v1.mjs";
import {
  localLlmConfig,
  requestLocalJudgeReview,
  testLocalJudgeConnection
} from "./src/local-llm-reviewer.mjs";
import {
  readLocalProjectRegistry,
  selectLocalProjectRecord,
  selectedLocalProjectRecord,
  upsertLocalProjectRecord
} from "./src/local-project-registry.mjs";
import {
  hostAllowsNativeFolderPicker,
  openMacNativeFolderPicker
} from "./src/native-folder-picker.mjs";
import { buildOperationalReadiness } from "./src/operational-readiness.mjs";
import { buildBetaOpsDashboard } from "./src/beta-ops-dashboard.mjs";
import { buildAiPatchContext } from "./src/ai-context-builder-v1.mjs";
import {
  generateAiPatch,
  generateAiPlan,
  testModelProviderConnection
} from "./src/ai-patch-worker-v1.mjs";
import {
  modelProviderReady,
  readModelProviderSettings,
  redactedModelProviderSettings,
  writeModelProviderSettings
} from "./src/model-provider-settings.mjs";
import { applySandboxPatchPackage } from "./src/patch-apply-runner.mjs";
import {
  createRollbackSnapshot,
  createSandboxPatchPackage
} from "./src/patch-runner-artifacts.mjs";
import {
  classifyPatchRunPreflight,
  normalizeRelativeProjectPath,
  normalizePatchDrafts
} from "./src/patch-runner-policy.mjs";
import { synthesizePatchDraftsV1 } from "./src/patch-synthesis-v1.mjs";
import {
  assertPathInsideProjectRoot,
  summarizeProjectRootGuard
} from "./src/project-root-guard.mjs";
import { restoreRollbackSnapshot } from "./src/rollback-manager.mjs";

const __dirname = resolve(fileURLToPath(new URL(".", import.meta.url)));
const WORKSPACE_ROOT = resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 4142);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = join(__dirname, "public");
const DATA_DIR = resolve(process.env.CODEX_OFFICE_DATA_DIR || join(__dirname, "data"));
const TASK_LOG_FILE = join(DATA_DIR, "tasks.jsonl");
const EVENT_LOG_FILE = join(DATA_DIR, "worker-events.jsonl");
const APPROVAL_LOG_FILE = join(DATA_DIR, "approvals.jsonl");
const LOCAL_PROJECTS_FILE = join(DATA_DIR, "local-projects.json");
const MODEL_PROVIDER_SETTINGS_FILE = join(DATA_DIR, "model-provider-settings.json");
const AIWC_HEALTH_FILE = join(DATA_DIR, "aiwc-health.json");
const EVIDENCE_DIR = join(DATA_DIR, "evidence");
const PROPOSAL_DIR = join(DATA_DIR, "proposals");
const VERIFICATION_DIR = join(DATA_DIR, "verifications");
const PATCH_RUN_DIR = join(DATA_DIR, "patch-runs");
const PATCH_APPLY_DIR = join(DATA_DIR, "patch-applies");
const PATCH_SANDBOX_DIR = join(DATA_DIR, "patch-sandbox");
const PATCH_SNAPSHOT_DIR = join(DATA_DIR, "patch-snapshots");
const ROLLBACK_DIR = join(DATA_DIR, "rollbacks");
const TASK_REPORT_DIR = join(DATA_DIR, "task-reports");
const SUPPORT_BUNDLE_DIR = join(DATA_DIR, "support-bundles");
const PILOT_FEEDBACK_DIR = join(DATA_DIR, "pilot-feedback");
const PILOT_METRICS_DIR = join(DATA_DIR, "pilot");
const PILOT_LATEST_FILE = join(PILOT_METRICS_DIR, "latest.json");
const BETA_OPS_DIR = join(DATA_DIR, "beta-ops");
const BETA_TESTER_RUNS_FILE = join(BETA_OPS_DIR, "tester-runs.jsonl");
const BETA_SUPPORT_BUNDLE_DIR = join(BETA_OPS_DIR, "support-bundles");
const DISTRIBUTION_REPORT_FILE = join(__dirname, "dist", "mac-distribution", "distribution-report.json");
const STATUS_STREAM_CLIENTS = new Set();
const PUBLIC_ENTRY_URL = process.env.CODEX_OFFICE_PUBLIC_URL || "https://geoaifactory.com";
const CLOUDFLARED_CONFIG_FILE = join(__dirname, "cloudflared-geoaifactory.yml");
const CODEX_OFFICE_LAUNCH_AGENT = join(
  process.env.HOME || "/tmp",
  "Library/LaunchAgents/com.geoaifactory.codex-office.plist"
);
const CLOUDFLARE_LAUNCH_AGENT = join(
  process.env.HOME || "/tmp",
  "Library/LaunchAgents/com.cloudflare.cloudflared.plist"
);
const DEMO_PLAYBACK_DELAY_MS = Math.max(
  0,
  Math.min(1200, Number(process.env.CODEX_OFFICE_DEMO_PLAYBACK_DELAY_MS || 220))
);
const FIRST_ORDER_TITLE = "Add a Codingape pilot note to README";

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target"
]);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

const WORKER_BLUEPRINTS = [
  {
    id: "coding-yuan",
    name: "Codingape",
    mark: "A",
    domain: "Engineering",
    accent: "teal",
    idleTask: "Waiting for code, test, and pull request tasks",
    tools: ["codex", "terminal", "git", "browser"]
  },
  {
    id: "quant-yuan",
    name: "Quantape",
    mark: "Q",
    domain: "Markets",
    accent: "gold",
    idleTask: "Watching market systems and strategy queues",
    tools: ["signals", "risk", "wallet", "charts"]
  },
  {
    id: "security-yuan",
    name: "Securityape",
    mark: "S",
    domain: "Security",
    accent: "rose",
    idleTask: "Ready to run scans, policy checks, and attack-path analysis",
    tools: ["scanner", "policy", "audit", "evidence"]
  },
  {
    id: "ops-yuan",
    name: "Opsape",
    mark: "O",
    domain: "Runtime",
    accent: "mint",
    idleTask: "Monitoring deployments, edge services, and incident surfaces",
    tools: ["cloud", "logs", "runtime", "ssh"]
  },
  {
    id: "judge-yuan",
    name: "Judgeape",
    mark: "J",
    domain: "Governance",
    accent: "violet",
    idleTask: "Waiting for review, approval, and release evidence",
    tools: ["review", "evals", "checks", "approvals"]
  },
  {
    id: "hunter-yuan",
    name: "Hunterape",
    mark: "H",
    domain: "Intel",
    accent: "cyan",
    idleTask: "Scanning research, domains, and external signals",
    tools: ["browser", "search", "intel", "notes"]
  }
];

const WORKER_BY_ID = new Map(WORKER_BLUEPRINTS.map((worker) => [worker.id, worker]));
const LAUNCH_CORE_WORKER_IDS = new Set(["coding-yuan", "judge-yuan", "ops-yuan"]);
const RISK_WEIGHT = { low: 0, medium: 1, high: 2 };
const STATUS_WEIGHT = { running: 0, active: 1, draft: 2, ready: 3, idle: 4 };

function titleCase(value) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readJsonLines(filePath) {
  if (!existsSync(filePath)) return [];

  try {
    return readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function appendJsonLine(filePath, record) {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function readModelSettings() {
  return readModelProviderSettings(MODEL_PROVIDER_SETTINGS_FILE);
}

function modelProviderSnapshot() {
  return redactedModelProviderSettings(readModelSettings());
}

function writeStatusEvent(response) {
  response.write(`event: status\n`);
  response.write(`data: ${JSON.stringify(buildSnapshot())}\n\n`);
}

function broadcastStatusEvent() {
  if (!STATUS_STREAM_CLIENTS.size) return;
  for (const client of [...STATUS_STREAM_CLIENTS]) {
    try {
      writeStatusEvent(client);
    } catch {
      STATUS_STREAM_CLIENTS.delete(client);
    }
  }
}

function demoPlaybackPause() {
  return new Promise((resolve) => setTimeout(resolve, DEMO_PLAYBACK_DELAY_MS));
}

function readTaskLog() {
  const latestById = new Map();

  for (const record of readJsonLines(TASK_LOG_FILE)
    .filter((task) => task?.id && task?.title)
    .slice(-240)) {
    latestById.set(record.id, {
      ...(latestById.get(record.id) || {}),
      ...record
    });
  }

  return [...latestById.values()]
    .sort((a, b) => Date.parse(a.createdAt || a.updatedAt) - Date.parse(b.createdAt || b.updatedAt))
    .slice(-120);
}

function readManualEventLog() {
  return readJsonLines(EVENT_LOG_FILE)
    .filter((event) => event?.id && event?.title)
    .slice(-160);
}

function readApprovalDecisionLog() {
  return readJsonLines(APPROVAL_LOG_FILE)
    .filter((decision) => decision?.approvalId && decision?.status)
    .slice(-160);
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function workerById(workerId) {
  return WORKER_BY_ID.get(workerId) || WORKER_BLUEPRINTS[0];
}

function projectById(projects, projectId) {
  return projects.find((project) => project.id === projectId) || null;
}

function activeTask(task) {
  return !["done", "cancelled", "reviewed", "completed"].includes(task.status);
}

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2500
    }).trim();
  } catch {
    return "";
  }
}

function runCapture(command, args, cwd, timeout = 4000) {
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout
    }).trim();

    return {
      command: [command, ...args].join(" "),
      ok: true,
      output: output.slice(0, 6000)
    };
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`.trim();
    return {
      command: [command, ...args].join(" "),
      ok: false,
      output: output.slice(0, 6000) || error.message
    };
  }
}

function getRootGitChanges() {
  const output = run("git", ["status", "--porcelain=v1"], WORKSPACE_ROOT);
  const byFolder = new Map();

  for (const line of output.split("\n").filter(Boolean)) {
    const filePath = line.slice(3).replace(/^"|"$/g, "");
    const top = filePath.split("/")[0];
    if (!top || top === "codex-office") continue;
    const bucket = byFolder.get(top) || [];
    bucket.push({ code: line.slice(0, 2), path: filePath });
    byFolder.set(top, bucket);
  }

  return byFolder;
}

function getListeningPorts() {
  const output = run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], WORKSPACE_ROOT);
  const ports = new Set();

  for (const line of output.split("\n").slice(1)) {
    const match = line.match(/TCP\s+[^:]+:(\d+)\s+\(LISTEN\)/);
    if (match) ports.add(Number(match[1]));
  }

  return ports;
}

function packageFiles(projectPath, depth = 0, found = []) {
  if (depth > 2 || found.length > 6) return found;

  let entries = [];
  try {
    entries = readdirSync(projectPath, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.name === "package.json") {
      found.push(join(projectPath, entry.name));
      continue;
    }

    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
      packageFiles(join(projectPath, entry.name), depth + 1, found);
    }
  }

  return found;
}

function inferRole(name, pkg) {
  const text = `${name} ${pkg?.description || ""}`.toLowerCase();
  if (/paperclip|worker|control|agent|ai/.test(text)) return "Agent Systems";
  if (/trade|trader|quant|stock|gmgn|binance|betting|wallet|reserve/.test(text)) return "Market Desk";
  if (/cloudflare|edge|tunnel|worker/.test(text)) return "Edge Lab";
  if (/face|swap|vision|image/.test(text)) return "Vision Studio";
  if (/hg|crown|prototype|web/.test(text)) return "Ops Console";
  return "Project Lab";
}

function inferAccent(name, index) {
  const palette = ["teal", "coral", "gold", "mint", "ink", "violet", "rose", "cyan"];
  const text = name.toLowerCase();
  if (/trade|stock|gmgn|binance|wallet/.test(text)) return "gold";
  if (/cloudflare|edge|tunnel/.test(text)) return "coral";
  if (/face|vision|image/.test(text)) return "rose";
  if (/paperclip|worker|agent|ai/.test(text)) return "teal";
  if (/hg|crown|web/.test(text)) return "mint";
  return palette[index % palette.length];
}

function inferWorkerId(name, primaryPackage, packages = []) {
  const scriptText = packages
    .flatMap((pkg) => Object.values(pkg.scripts || {}))
    .join(" ");
  const profileText = `${name} ${primaryPackage?.name || ""} ${primaryPackage?.description || ""}`.toLowerCase();
  const operationalText = `${profileText} ${scriptText}`.toLowerCase();

  if (/security|attack|vuln|compliance|audit|auth/.test(profileText)) {
    return "security-yuan";
  }
  if (/cloudflare|edge|tunnel|wrangler|deploy|runtime|ops|incident|hg|crown|prototype/.test(profileText)) {
    return "ops-yuan";
  }
  if (/trade|trader|quant|stock|gmgn|binance|betting|wallet|reserve|pnl|market/.test(profileText)) {
    return "quant-yuan";
  }
  if (/review|judge|eval|certification|approval|governance|release|decision/.test(profileText)) {
    return "judge-yuan";
  }
  if (/research|intel|domain|radar|anomaly|lead|crawl|scrape|search/.test(profileText)) {
    return "hunter-yuan";
  }
  if (/paperclip|worker|control|agent|ai|codex|face|vision|image/.test(profileText)) {
    return "coding-yuan";
  }
  if (/security|attack|vuln|compliance|audit/.test(operationalText)) {
    return "security-yuan";
  }
  if (/cloudflare|edge|tunnel|wrangler|runtime|ops|incident/.test(operationalText)) {
    return "ops-yuan";
  }
  if (/review|judge|eval|certification|approval|governance|decision/.test(operationalText)) {
    return "judge-yuan";
  }
  if (/research|intel|domain|radar|lead|crawl|scrape|search/.test(operationalText)) {
    return "hunter-yuan";
  }
  return "coding-yuan";
}

function projectSort(a, b) {
  const statusDelta = (STATUS_WEIGHT[a.status.key] ?? 9) - (STATUS_WEIGHT[b.status.key] ?? 9);
  if (statusDelta) return statusDelta;
  return (b.activity.latest || 0) - (a.activity.latest || 0);
}

function scriptNames(packages) {
  return [...new Set(packages.flatMap((pkg) => Object.keys(pkg.scripts || {})))];
}

function hasScript(packages, pattern) {
  return packages.some((pkg) =>
    Object.entries(pkg.scripts || {}).some(([name, script]) => pattern.test(`${name} ${script}`))
  );
}

function inferProjectRisk({ entryName, packages, repo, status }) {
  const text = `${entryName} ${scriptNames(packages).join(" ")} ${packages
    .flatMap((pkg) => Object.values(pkg.scripts || {}))
    .join(" ")}`.toLowerCase();

  if (/deploy|restart|production|settle|funds|wallet|private|secret|trade|trader|binance|gmgn|ssh|scp/.test(text)) {
    return {
      key: "high",
      label: "Human gate",
      requiresApproval: true
    };
  }

  if (
    repo.changeCount > 10 ||
    /security|compliance|auth|risk|payment|policy|approval/.test(text) ||
    (repo.changeCount > 0 && (status.key === "active" || status.key === "draft"))
  ) {
    return {
      key: "medium",
      label: "Review",
      requiresApproval: false
    };
  }

  return {
    key: "low",
    label: "Low",
    requiresApproval: false
  };
}

function inferProjectTask({ projectName, workerName, status, repo, runningPorts, packages }) {
  if (runningPorts.length) {
    return `${workerName} is watching live runtime on ${runningPorts.map((port) => `:${port}`).join(", ")}`;
  }

  if (status.key === "active") {
    return `${workerName} is working through ${repo.changeCount} local change(s) in ${projectName}`;
  }

  if (status.key === "draft") {
    return `${workerName} is packaging ${repo.changeCount} pending change(s) for review`;
  }

  const scripts = scriptNames(packages);
  const verificationScripts = scripts.filter((script) => /test|check|lint|type|verify|qa/i.test(script));
  if (status.key === "ready" && verificationScripts.length) {
    return `${workerName} has runnable verification: ${verificationScripts.slice(0, 3).join(", ")}`;
  }

  return `${workerName} is standing by for the next assignment`;
}

function inferNextAction({ packages, repo, risk, status }) {
  if (risk.requiresApproval) {
    return "Ask the human before deploy, trade, wallet, restart, or production writes";
  }

  if (hasScript(packages, /test|check|lint|type|verify|qa/i)) {
    return status.key === "idle" ? "Run verification after assignment" : "Run verification and attach evidence";
  }

  if (repo.changeCount > 0) {
    return "Review the diff and create an evidence summary";
  }

  return "Assign a concrete task or connect a live runtime";
}

function projectSignal(project) {
  if (project.runningPorts.length) return `${project.runningPorts.length} port signal(s) online`;
  if (project.repo.changeCount) return `${project.repo.changeCount} Git change signal(s)`;
  if (project.activity.recentFiles.length) return `${project.activity.recentFiles.length} recent file signal(s)`;
  if (project.packages.length) return `${project.packages.length} package signal(s)`;
  return "Quiet workspace signal";
}

function buildWorkers(projects, tasks = []) {
  return WORKER_BLUEPRINTS.map((blueprint) => {
    const assignedProjects = projects
      .filter((project) => project.workerId === blueprint.id)
      .sort(projectSort);
    const assignedTasks = tasks
      .filter((task) => task.workerId === blueprint.id && activeTask(task))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
    const liveProjects = assignedProjects.filter((project) => project.status.key !== "idle");
    const primaryProject = liveProjects[0] || assignedProjects[0] || null;
    const primaryTask = assignedTasks[0] || null;
    const risks = [
      ...assignedProjects.map((project) => project.risk.key),
      ...assignedTasks.map((task) => task.risk || "low")
    ];
    const risk = risks.sort((a, b) => (RISK_WEIGHT[b] ?? 0) - (RISK_WEIGHT[a] ?? 0))[0] || "low";
    const hasRunning = assignedProjects.some((project) => project.status.key === "running");
    const hasWorking = assignedProjects.some((project) => project.status.key === "active" || project.status.key === "draft");
    const hasReady = assignedProjects.some((project) => project.status.key === "ready");
    const hasBlockedTask = assignedTasks.some((task) => task.status === "blocked");
    const lastEventAt = Math.max(
      0,
      ...assignedProjects.map((project) => project.activity.latest || 0),
      ...assignedTasks.map((task) => Date.parse(task.updatedAt || task.createdAt) || 0)
    );

    let status = "available";
    let statusLabel = "Available";
    if (hasBlockedTask) {
      status = "blocked";
      statusLabel = "Blocked";
    } else if (hasRunning) {
      status = "running";
      statusLabel = "Running";
    } else if (hasWorking || assignedTasks.length) {
      status = "working";
      statusLabel = "Working";
    } else if (hasReady) {
      status = "ready";
      statusLabel = "Ready";
    } else if (assignedProjects.length) {
      status = "watching";
      statusLabel = "Watching";
    }

    return {
      id: blueprint.id,
      name: blueprint.name,
      mark: blueprint.mark,
      domain: blueprint.domain,
      accent: blueprint.accent,
      launchTier: LAUNCH_CORE_WORKER_IDS.has(blueprint.id) ? "core" : "bench",
      launchLabel: LAUNCH_CORE_WORKER_IDS.has(blueprint.id) ? "Core worker" : "Next hire",
      status,
      statusLabel,
      queue: liveProjects.length + assignedTasks.length,
      projectCount: assignedProjects.length,
      currentProjectId: primaryTask?.projectId || primaryProject?.id || null,
      currentTask: primaryTask?.title || primaryProject?.task.current || blueprint.idleTask,
      risk,
      tools: blueprint.tools,
      lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null,
      taskIds: assignedTasks.map((task) => task.id),
      projectIds: assignedProjects.map((project) => project.id)
    };
  });
}

function eventTimestamp(project, offsetMs = 0) {
  const base = project.activity.latest || Date.now();
  return new Date(base - offsetMs).toISOString();
}

function eventWorkerName(workerId) {
  return workerById(workerId).name;
}

function normalizeManualEvent(event) {
  return {
    id: event.id,
    taskId: event.taskId || "",
    mode: optionalCodingLoopMode(event.mode),
    source: event.source || "",
    workerId: event.workerId,
    workerName: event.workerName || eventWorkerName(event.workerId),
    projectId: event.projectId || "",
    type: event.type || "operator_event",
    title: event.title,
    detail: event.detail || "Operator log",
    risk: event.risk || "low",
    timestamp: event.timestamp || event.createdAt || new Date().toISOString(),
    evidence: event.evidence || []
  };
}

function taskEvent(task) {
  const action =
    task.status === "completed"
      ? "Completed"
      : task.status === "running"
        ? "Running"
        : task.status === "blocked"
          ? "Blocked"
          : "Queued";
  return {
    id: `evt_${task.id}`,
    taskId: task.id,
    mode: task.source?.startsWith("mission_") ? normalizeCodingLoopMode(task.source.replace("mission_", "")) : "",
    source: task.source || "",
    workerId: task.workerId,
    workerName: eventWorkerName(task.workerId),
    projectId: task.projectId || "",
    type: `task_${task.status || "queued"}`,
    title: `${action}: ${task.title}`,
    detail: task.projectName || "Worker task",
    risk: task.risk || "low",
    timestamp: task.updatedAt || task.createdAt,
    evidence: task.evidence || []
  };
}

function approvalEvent(approval) {
  const statusText = approval.status === "pending" ? "Approval required" : `Approval status: ${gateStatusLabel(approval.status)}`;
  return {
    id: `evt_${approval.id}`,
    workerId: approval.workerId,
    workerName: approval.workerName,
    projectId: approval.projectId,
    type: "approval_gate",
    title: `${statusText}: ${approval.title}`,
    detail: approval.projectName || "Human Gate",
    risk: approval.risk,
    timestamp: approval.updatedAt || approval.createdAt,
    evidence: approval.evidence || []
  };
}

function buildScanEvents(projects) {
  const events = [];
  for (const [index, project] of [...projects].sort(projectSort).entries()) {
    const worker = workerById(project.workerId);
    const evidence = project.activity.recentFiles
      .slice(0, 2)
      .map((file) => join(project.path, file.path));

    if (project.runningPorts.length) {
      events.push({
        id: `evt_${project.id}_runtime`,
        workerId: worker.id,
        workerName: worker.name,
        projectId: project.id,
        type: "runtime",
        title: `${worker.name} is monitoring port(s) ${project.runningPorts.map((port) => `:${port}`).join(", ")}`,
        detail: project.name,
        risk: project.risk.key,
        timestamp: new Date(Date.now() - index * 1100).toISOString(),
        evidence
      });
    }

    if (project.repo.changeCount > 0) {
      events.push({
        id: `evt_${project.id}_git`,
        workerId: worker.id,
        workerName: worker.name,
        projectId: project.id,
        type: "git_signal",
        title: `${project.repo.changeCount} local change(s) need evidence`,
        detail: project.name,
        risk: project.risk.key,
        timestamp: eventTimestamp(project, index * 1700),
        evidence: project.repo.changes.slice(0, 3)
      });
    }

    if (project.activity.recentFiles[0]) {
      events.push({
        id: `evt_${project.id}_file`,
        workerId: worker.id,
        workerName: worker.name,
        projectId: project.id,
        type: "file_touch",
        title: `Recent touch: ${project.activity.recentFiles[0].path}`,
        detail: project.name,
        risk: "low",
        timestamp: eventTimestamp(project, 900 + index * 1300),
        evidence
      });
    }

    const verificationScripts = scriptNames(project.packages).filter((script) => /test|check|lint|type|verify|qa/i.test(script));
    if (verificationScripts.length) {
      events.push({
        id: `evt_${project.id}_verify`,
        workerId: worker.id,
        workerName: worker.name,
        projectId: project.id,
        type: "verification",
        title: `Verification path ready: ${verificationScripts.slice(0, 2).join(", ")}`,
        detail: project.name,
        risk: "low",
        timestamp: eventTimestamp(project, 2600 + index * 1500),
        evidence: verificationScripts.slice(0, 4)
      });
    }
  }

  return events;
}

function buildEvents(projects, tasks = [], manualEvents = [], approvals = []) {
  const taskEvents = tasks.map(taskEvent);
  const manual = manualEvents.map(normalizeManualEvent);
  const approvalEvents = approvals
    .filter((approval) => approval.status === "pending" || approval.status === "held")
    .map(approvalEvent);
  const events = [
    ...manual,
    ...taskEvents,
    ...approvalEvents,
    ...buildScanEvents(projects)
  ];

  return events
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 28);
}

function latestApprovalDecisions(decisions) {
  return decisions.reduce((acc, decision) => {
    acc.set(decision.approvalId, decision);
    return acc;
  }, new Map());
}

function closeLoopApprovalId(taskId) {
  return `approval_close_loop_${taskId}`;
}

function taskIdFromCloseLoopApprovalId(approvalId = "") {
  return approvalId.startsWith("approval_close_loop_")
    ? approvalId.slice("approval_close_loop_".length)
    : "";
}

function gateStatusLabel(status = "pending") {
  const labels = {
    approved: "Approved",
    changes_requested: "Rework requested",
    held: "Held",
    pending: "Pending approval",
    reviewed: "Reviewed"
  };
  return labels[status] || "Pending approval";
}

function gateRiskLabel(risk = "medium") {
  const labels = {
    high: "High risk",
    low: "Low risk",
    medium: "Medium risk"
  };
  return labels[risk] || "Medium risk";
}

function buildApprovalQueue(projects, tasks = [], decisions = []) {
  const latestDecisions = latestApprovalDecisions(decisions);
  const approvals = [];

  for (const project of projects) {
    if (!project.risk.requiresApproval) continue;
    if (project.status.key === "idle" && project.repo.changeCount === 0) continue;

    const worker = workerById(project.workerId);
    const id = `approval_project_${project.id}`;
    const decision = latestDecisions.get(id);
    approvals.push({
      id,
      workerId: worker.id,
      workerName: worker.name,
      projectId: project.id,
      projectName: project.name,
      title: project.task.nextAction,
      reason: project.task.signal,
      risk: "high",
      status: decision?.status || "pending",
      gateType: "project_risk",
      requiresHuman: true,
      createdAt: project.activity.latest ? new Date(project.activity.latest).toISOString() : new Date().toISOString(),
      updatedAt: decision?.updatedAt || decision?.createdAt || null,
      evidence: project.repo.changes.slice(0, 3)
    });
  }

  for (const task of tasks.filter((candidate) => activeTask(candidate) && candidate.risk === "high")) {
    const worker = workerById(task.workerId);
    const id = `approval_task_${task.id}`;
    const decision = latestDecisions.get(id);
    approvals.push({
      id,
      workerId: worker.id,
      workerName: worker.name,
      projectId: task.projectId,
      projectName: task.projectName || "Worker task",
      title: task.title,
      reason: "High-risk queued tasks must pass Human Gate before execution",
      risk: "high",
      status: decision?.status || "pending",
      gateType: "task_execution",
      taskId: task.id,
      requiresHuman: true,
      createdAt: task.createdAt,
      updatedAt: decision?.updatedAt || decision?.createdAt || task.updatedAt,
      evidence: task.evidence || []
    });
  }

  for (const task of tasks.filter((candidate) => candidate.status === "completed" && candidate.proposal)) {
    const id = closeLoopApprovalId(task.id);
    const decision = latestDecisions.get(id);
    const verificationPassed = task.result?.verificationStatus === "passed";
    const status = decision?.status || task.result?.humanGateStatus || "pending";
    approvals.push({
      id,
      workerId: "judge-yuan",
      workerName: eventWorkerName("judge-yuan"),
      projectId: task.projectId,
      projectName: task.projectName || "Worker task",
      title: `Review Gate: ${task.title}`,
      reason: verificationPassed
        ? "Verification passed; a human can approve this supervised loop result."
        : "Evidence exists, but verification did not pass; keep human supervision in place.",
      risk: verificationPassed ? "medium" : "high",
      status,
      gateType: "close_loop",
      taskId: task.id,
      requiresHuman: true,
      createdAt: task.completedAt || task.updatedAt || task.createdAt,
      updatedAt: decision?.updatedAt || decision?.createdAt || task.result?.humanGateAt || null,
      evidence: [...new Set([task.evidence?.[0], task.proposal, task.verification].filter(Boolean))].slice(0, 5)
    });
  }

  return approvals.sort((a, b) => {
    const pendingDelta = Number(b.status === "pending") - Number(a.status === "pending");
    if (pendingDelta) return pendingDelta;
    return Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt);
  });
}

function inferPorts(packages) {
  const ports = new Set();

  for (const pkg of packages) {
    for (const script of Object.values(pkg.scripts || {})) {
      const matches = [...String(script).matchAll(/(?:--port\s+|--port=|PORT=|localhost:|127\.0\.0\.1:)(\d{3,5})/g)];
      for (const match of matches) ports.add(Number(match[1]));

      if (/vite/.test(script) && !matches.length) ports.add(5173);
      if (/next\s+dev/.test(script) && !matches.length) ports.add(3000);
      if (/wrangler\s+(dev|pages\s+dev)/.test(script) && !matches.length) ports.add(8787);
    }
  }

  return [...ports].slice(0, 4);
}

function latestActivity(projectPath, depth = 0, state = { count: 0, latest: 0, files: [] }) {
  if (depth > 3 || state.count > 450) return state;

  let entries = [];
  try {
    entries = readdirSync(projectPath, { withFileTypes: true });
  } catch {
    return state;
  }

  for (const entry of entries) {
    if (state.count > 450) break;
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = join(projectPath, entry.name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      latestActivity(fullPath, depth + 1, state);
      continue;
    }

    state.count += 1;
    if (stats.mtimeMs > state.latest) state.latest = stats.mtimeMs;
    state.files.push({
      name: entry.name,
      path: relative(projectPath, fullPath),
      mtime: stats.mtimeMs
    });
  }

  state.files.sort((a, b) => b.mtime - a.mtime);
  state.files = state.files.slice(0, 5);
  return state;
}

function getRepoStatus(projectPath, rootChanges) {
  if (existsSync(join(projectPath, ".git"))) {
    const branch = run("git", ["branch", "--show-current"], projectPath) || "detached";
    const status = run("git", ["status", "--short"], projectPath);
    const lastCommit = run("git", ["log", "-1", "--pretty=format:%h %s"], projectPath);

    return {
      kind: "repo",
      branch,
      changeCount: status ? status.split("\n").filter(Boolean).length : 0,
      changes: status.split("\n").filter(Boolean).slice(0, 6),
      lastCommit
    };
  }

  const key = relative(WORKSPACE_ROOT, projectPath).split("/")[0];
  const changes = rootChanges.get(key) || [];

  return {
    kind: "Workspace",
    branch: "Workspace",
    changeCount: changes.length,
    changes: changes.slice(0, 6).map((change) => `${change.code} ${change.path}`),
    lastCommit: ""
  };
}

function statusFor({ repo, packages, activity, runningPorts }) {
  const minutesSinceTouch = activity.latest ? (Date.now() - activity.latest) / 60000 : Infinity;

  if (runningPorts.length) return { key: "running", label: "Running", tone: "live" };
  if (repo.changeCount > 0 && minutesSinceTouch < 90) return { key: "active", label: "Working", tone: "hot" };
  if (repo.changeCount > 0) return { key: "draft", label: "Draft", tone: "warm" };
  if (packages.some((pkg) => pkg.scripts?.test || pkg.scripts?.check)) return { key: "ready", label: "Ready", tone: "cool" };
  return { key: "idle", label: "Idle", tone: "quiet" };
}

function buildProjectFromPath({ id, folder, name, projectPath, index, rootChanges, listeningPorts, source = "workspace", selected = false }) {
  const packages = packageFiles(projectPath).map((filePath) => {
    const pkg = readJson(filePath) || {};
    return {
      name: pkg.name || titleCase(folder),
      path: relative(projectPath, filePath),
      description: pkg.description || "",
      scripts: pkg.scripts || {}
    };
  });
  const primaryPackage = packages[0] || null;
  const inferredPorts = inferPorts(packages);
  const runningPorts = inferredPorts.filter((port) => listeningPorts.has(port));
  const repo = getRepoStatus(projectPath, rootChanges);
  const activity = latestActivity(projectPath);
  const status = statusFor({ repo, packages, activity, runningPorts });
  const workerId = inferWorkerId(folder, primaryPackage, packages);
  const worker = WORKER_BY_ID.get(workerId) || WORKER_BLUEPRINTS[0];
  const risk = inferProjectRisk({ entryName: folder, packages, repo, status });
  const projectName = name || (primaryPackage?.name ? titleCase(primaryPackage.name) : titleCase(folder));
  const task = {
    current: inferProjectTask({
      projectName,
      workerName: worker.name,
      status,
      repo,
      runningPorts,
      packages
    }),
    nextAction: inferNextAction({ packages, repo, risk, status }),
    signal: "",
    risk
  };

  const project = {
    id,
    name: projectName,
    folder,
    path: projectPath,
    source,
    selected,
    role: inferRole(folder, primaryPackage),
    workerId,
    workerName: worker.name,
    accent: inferAccent(folder, index),
    status,
    risk,
    task,
    repo,
    packages,
    inferredPorts,
    runningPorts,
    activity: {
      latest: activity.latest,
      recentFiles: activity.files
    }
  };

  project.task.signal = projectSignal(project);
  return project;
}

function discoverProjects() {
  const localRegistry = readLocalProjectRegistry(LOCAL_PROJECTS_FILE);
  const listeningPorts = getListeningPorts();
  const rootChanges = new Map();
  return localRegistry.projects
    .filter((record) => existsSync(record.path))
    .map((record, index) => buildProjectFromPath({
      id: record.id,
      folder: record.name || record.id,
      name: record.name,
      projectPath: record.path,
      index,
      rootChanges,
      listeningPorts,
      source: "local_record",
      selected: record.id === localRegistry.selectedProjectId
    }));
}

function buildLocalProjectsSnapshot(projects = []) {
  const registry = readLocalProjectRegistry(LOCAL_PROJECTS_FILE);
  const selected = registry.projects.find((project) => project.id === registry.selectedProjectId) || null;
  const selectedProject = selected
    ? projects.find((project) => project.id === selected.id) || null
    : null;
  const publicRecord = (record = {}) => ({
    id: record.id,
    name: record.name,
    path: record.path,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastSelectedAt: record.lastSelectedAt,
    authorizationSource: record.authorizationSource || "local_path",
    hasSecurityScopedBookmark: Boolean(record.securityScopedBookmark)
  });
  return {
    selectedProjectId: registry.selectedProjectId,
    selectedPath: selected?.path || "",
    selectedName: selected?.name || "",
    selectedAuthorizationSource: selected?.authorizationSource || "",
    selectedHasSecurityScopedBookmark: Boolean(selected?.securityScopedBookmark),
    selectedProject,
    records: registry.projects.map(publicRecord),
    count: registry.projects.length
  };
}

function authorizedProjectSelection(projects = [], projectId = "") {
  const localProjects = buildLocalProjectsSnapshot(projects);
  const selectedId = localProjects.selectedProjectId;

  if (!selectedId) {
    return {
      ok: false,
      status: 409,
      blocker: {
        id: "project_root_required",
        title: "Project root must be selected",
        detail: "Choose a local project folder before running evidence, diff, apply, or rollback."
      },
      localProjects
    };
  }

  const requestedId = projectId || selectedId;
  const project = projectById(projects, requestedId);
  if (!project || project.id !== selectedId) {
    return {
      ok: false,
      status: 409,
      blocker: {
        id: "project_root_not_authorized",
        title: "Task is outside the current authorized project root",
        detail: localProjects.selectedPath || selectedId
      },
      localProjects
    };
  }

  return {
    ok: true,
    project,
    localProjects
  };
}

function sendProjectSelectionBlocked(response, selection) {
  sendJson(response, {
    ok: false,
    status: "blocked",
    blocker: selection.blocker,
    localProjects: selection.localProjects,
    error: selection.blocker?.title || "Project root is required"
  }, selection.status || 409);
}

function aiwcConfigured() {
  return Boolean(
    process.env.AIWC_BASE_URL &&
      process.env.AIWC_INGESTION_API_KEY &&
      process.env.AIWC_PROJECT_ID &&
      process.env.AIWC_AGENT_ID
  );
}

function buildAiwcConfigStatus(env = process.env) {
  const config = resolveAiWorkerConfig({ env });
  const items = [
    {
      key: "AIWC_BASE_URL",
      label: "Control plane URL",
      configured: Boolean(config.baseUrl),
      secret: false,
      displayValue: config.baseUrl || ""
    },
    {
      key: "AIWC_INGESTION_API_KEY",
      label: "Ingestion key",
      configured: Boolean(config.ingestionApiKey),
      secret: true,
      displayValue: config.ingestionApiKey ? "Configured, hidden" : ""
    },
    {
      key: "AIWC_PROJECT_ID",
      label: "Project ID",
      configured: Boolean(config.projectId),
      secret: false,
      displayValue: config.projectId || ""
    },
    {
      key: "AIWC_AGENT_ID",
      label: "Agent ID",
      configured: Boolean(config.agentId),
      secret: false,
      displayValue: config.agentId || ""
    }
  ];
  const missing = items.filter((item) => !item.configured).map((item) => item.key);

  return {
    configured: missing.length === 0,
    missing,
    items,
    timeoutMs: config.timeoutMs
  };
}

function buildAiwcHealthSnapshot() {
  const config = buildAiwcConfigStatus();
  const latest = readJson(AIWC_HEALTH_FILE);
  const ok = Boolean(config.configured && latest?.ok);
  const status = !config.configured
    ? "missing_configuration"
    : ok
      ? "connected"
      : latest?.checkedAt
        ? "failed"
        : "not_tested";

  return {
    configured: config.configured,
    ok,
    status,
    statusLabel: status === "connected"
      ? "Connected"
      : status === "not_tested"
        ? "Not tested"
        : status === "failed"
          ? "Connection failed"
          : "Missing config",
    missing: config.missing,
    items: config.items,
    lastCheckedAt: latest?.checkedAt || "",
    lastError: ok ? "" : latest?.error || "",
    runIdExternal: latest?.runIdExternal || "",
    detail: ok
      ? "AIWC health-check succeeded; run logs can be mirrored into the integrated control plane."
      : config.missing.length
        ? `${config.missing.length} config item(s) missing.`
        : latest?.error || "Config is present, but health-check has not completed yet."
  };
}

function latestStableTag() {
  const headTags = run("git", ["tag", "--points-at", "HEAD"], __dirname)
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const headStableTag = headTags.find((tag) => tag.startsWith("stable/"));
  if (headStableTag) return headStableTag;

  return run("git", ["tag", "--list", "stable/*", "--sort=-creatordate"], __dirname)
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean)[0] || "";
}

function buildAutonomyReadiness({ tasks = [], approvals = [], evidencePacks = [], proposalPacks = [], verificationPacks = [], patchRunPacks = [], patchApplyPacks = [] }) {
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const pendingHighRiskApprovals = approvals.filter((approval) => approval.status === "pending" && approval.risk === "high").length;
  const approvedCloseLoopGates = approvals.filter((approval) => approval.gateType === "close_loop" && approval.status === "approved").length;
  const successfulPatchRuns = patchRunPacks.filter((pack) => ["dry_run", "sandbox_written"].includes(pack?.status)).length;
  const applyGateChecks = patchApplyPacks.filter((pack) => ["requires_confirmation", "blocked", "applied"].includes(pack?.status)).length;
  const appliedPatchRuns = patchApplyPacks.filter((pack) => pack?.status === "applied").length;
  const hasEvidence = evidencePacks.length > 0;
  const hasProposal = proposalPacks.length > 0;
  const hasVerification = verificationPacks.some((pack) => pack?.result?.ok);
  const hasHumanGate = approvedCloseLoopGates > 0;
  const hasPatchRunEvidence = successfulPatchRuns > 0;
  const hasApplyGateEvidence = applyGateChecks > 0;
  const hasAiWcIngestion = aiwcConfigured();
  const hasWriteRunner = process.env.CODEX_OFFICE_ENABLE_WRITE_RUNNER === "true";
  const hasApplyRunner = process.env.CODEX_OFFICE_ENABLE_APPLY_RUNNER === "true";
  const hasNightlyReport = process.env.CODEX_OFFICE_ENABLE_NIGHTLY_REPORT === "true";
  const score = Math.min(
    100,
    32 +
      (hasEvidence ? 14 : 0) +
      (hasProposal ? 10 : 0) +
      (hasVerification ? 8 : 0) +
      (completedTasks ? 6 : 0) +
      (hasHumanGate ? 6 : 0) +
      (hasPatchRunEvidence ? 4 : 0) +
      (hasApplyGateEvidence ? 4 : 0) +
      (hasAiWcIngestion ? 12 : 0) +
      (hasWriteRunner ? 12 : 0) +
      (hasNightlyReport ? 8 : 0)
  );
  const hardBlockers = [];

  if (!hasEvidence) {
    hardBlockers.push({
      id: "evidence_required",
      title: "No complete Evidence Pack yet",
      owner: "Codingape",
      severity: "high",
      remediation: "Run the Codingape closed-loop demo first, or collect evidence for a queued task."
    });
  }

  if (!hasProposal) {
    hardBlockers.push({
      id: "proposal_required",
      title: "No patch or review proposal yet",
      owner: "Judgeape",
      severity: "medium",
      remediation: "Generate a patch proposal from evidence before claiming autonomy readiness."
    });
  }

  if (!hasWriteRunner) {
    hardBlockers.push({
      id: "write_runner_gated",
      title: "Code write runner is still disabled",
      owner: "Judgeape",
      severity: "high",
      remediation: "Keep writes gated until command allowlists, tests, rollback, and approval checks are ready."
    });
  }

  if (pendingHighRiskApprovals) {
    hardBlockers.push({
      id: "human_gates_pending",
      title: `${pendingHighRiskApprovals} high-risk Human Gate item(s) pending`,
      owner: "Judgeape",
      severity: "high",
      remediation: "Review or hold each high-risk action before increasing autonomy."
    });
  }

  const objectives = [
    {
      id: "coding_loop",
      label: "Codingape closed-loop demo",
      status: hasEvidence && hasProposal ? "complete" : "next",
      metric: `${evidencePacks.length} evidence pack(s) / ${proposalPacks.length} proposal(s)`
    },
    {
      id: "judge_gate",
      label: "Judgeape evidence review",
      status: hasHumanGate ? "complete" : proposalPacks.length ? "active" : "blocked",
      metric: `${approvedCloseLoopGates} approved / ${pendingHighRiskApprovals} high-risk pending`
    },
    {
      id: "verification",
      label: "Allowlisted verification evidence",
      status: hasVerification ? "complete" : evidencePacks.length ? "next" : "blocked",
      metric: `${verificationPacks.filter((pack) => pack?.result?.ok).length} passed / ${verificationPacks.length} run(s)`
    },
    {
      id: "aiwc_ingestion",
      label: "Run-log ingestion",
      status: hasAiWcIngestion ? "complete" : "warning",
      metric: hasAiWcIngestion ? "Configured" : "Missing env config; does not block local beta"
    },
    {
      id: "write_runner",
      label: "Controlled code edit and test runner",
      status: hasPatchRunEvidence ? "complete" : hasWriteRunner ? "active" : "blocked",
      metric: hasPatchRunEvidence ? `${successfulPatchRuns} patch-run evidence pack(s)` : hasWriteRunner ? "Enabled" : "Disabled"
    },
    {
      id: "apply_gate",
      label: "Apply proposal gate",
      status: appliedPatchRuns ? "complete" : hasApplyGateEvidence ? "active" : hasApplyRunner ? "next" : "blocked",
      metric: appliedPatchRuns ? `${appliedPatchRuns} applied` : hasApplyGateEvidence ? `${applyGateChecks} gate check(s)` : hasApplyRunner ? "Enabled" : "Disabled"
    },
    {
      id: "nightly_report",
      label: "Daily AI company report",
      status: hasNightlyReport ? "active" : "next",
      metric: hasNightlyReport ? "Scheduled" : "Local preview"
    }
  ];

  return {
    score,
    maxScore: 100,
    level: score >= 80 ? "L3 Trusted Operator" : score >= 60 ? "L2 Supervised Pilot" : "L1 Demo Readiness",
    verdict: score >= 80 ? "certification_candidate" : score >= 60 ? "supervised_only" : "not_autonomous",
    summary:
      score >= 80
        ? "Ready for customer-style supervised evidence review."
        : score >= 60
          ? "The demo loop is strong, but autonomy must still pass Human Gate."
          : "Base capability is visible, but autonomy stays gated until real work evidence and log ingestion mature.",
    hardBlockers: hardBlockers.slice(0, 5),
    objectives,
    metrics: {
      completedTasks,
      blockedTasks,
      evidencePacks: evidencePacks.length,
      proposalPacks: proposalPacks.length,
      verificationPacks: verificationPacks.length,
      passingVerificationPacks: verificationPacks.filter((pack) => pack?.result?.ok).length,
      patchRunPacks: patchRunPacks.length,
      successfulPatchRuns,
      patchApplyPacks: patchApplyPacks.length,
      applyGateChecks,
      appliedPatchRuns,
      approvedCloseLoopGates,
      pendingHighRiskApprovals,
      aiwcConfigured: hasAiWcIngestion,
      writeRunnerEnabled: hasWriteRunner,
      applyRunnerEnabled: hasApplyRunner,
      nightlyReportEnabled: hasNightlyReport
    }
  };
}

function buildCompanyReport({ tasks = [], approvals = [], evidencePacks = [], proposalPacks = [], verificationPacks = [], patchRunPacks = [], patchApplyPacks = [], workers = [], projects = [] }) {
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const queuedTasks = tasks.filter((task) => task.status === "queued").length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  const approvedCloseLoopGates = approvals.filter((approval) => approval.gateType === "close_loop" && approval.status === "approved").length;
  const successfulPatchRuns = patchRunPacks.filter((pack) => ["dry_run", "sandbox_written"].includes(pack?.status)).length;
  const applyGateChecks = patchApplyPacks.filter((pack) => ["requires_confirmation", "blocked", "applied"].includes(pack?.status)).length;
  const appliedPatchRuns = patchApplyPacks.filter((pack) => pack?.status === "applied").length;
  const activeWorkers = workers.filter((worker) => ["working", "running", "blocked"].includes(worker.status)).length;
  const passedVerifications = verificationPacks.filter((pack) => pack?.result?.ok).length;
  const hoursSaved = Number((evidencePacks.length * 0.45 + proposalPacks.length * 0.35 + passedVerifications * 0.25 + approvedCloseLoopGates * 0.15 + successfulPatchRuns * 0.2 + applyGateChecks * 0.15 + completedTasks * 0.25).toFixed(1));
  const riskBlocked = pendingApprovals + blockedTasks;
  const latestLoop = latestArtifactSummary(evidencePacks, proposalPacks, verificationPacks, patchRunPacks, patchApplyPacks);
  const latestLoopLine = latestLoop.taskId && latestLoop.patchRunStatus === "sandbox_written"
    ? `Latest loop "${latestLoop.title}" generated a sandbox patch. Apply Gate is ${companyApplyStatusLabel(latestLoop.applyStatus)}, and project files were not modified automatically.`
    : "";

  return {
    headline: completedTasks
      ? `Your AI worker company completed ${completedTasks} task(s) with traceable evidence.`
      : "Your AI worker company is ready to start the first real work loop.",
    generatedAt: new Date().toISOString(),
    metrics: [
      { label: "Tasks done", value: completedTasks },
      { label: "Evidence packs", value: evidencePacks.length },
      { label: "Patch plans", value: proposalPacks.length },
      { label: "Verifications passed", value: passedVerifications },
      { label: "Human approvals", value: approvedCloseLoopGates },
      { label: "Patch preflights", value: successfulPatchRuns },
      { label: "Apply gates", value: applyGateChecks },
      { label: "Applied", value: appliedPatchRuns },
      { label: "Risks gated", value: riskBlocked },
      { label: "Hours saved", value: hoursSaved }
    ],
    queue: {
      queuedTasks,
      blockedTasks,
      pendingApprovals,
      activeWorkers,
      watchedProjects: projects.length
    },
    latestLoop,
    latestLoopLine,
    shareLine: completedTasks
      ? `${latestLoopLine || `Today my AI worker company completed ${completedTasks} task(s), produced ${evidencePacks.length} evidence pack(s), passed ${passedVerifications} verification run(s), approved ${approvedCloseLoopGates} supervised result(s), ran ${successfulPatchRuns} controlled patch preflight(s), checked ${applyGateChecks} Apply Gate(s), and blocked ${riskBlocked} risk(s).`}`
      : "Today my AI worker company is ready to start the first evidence-backed Codingape run."
  };
}

function companyApplyStatusLabel(status = "not_run") {
  const labels = {
    applied: "Applied by human approval",
    blocked: "Apply blocked",
    failed: "Apply failed",
    not_run: "Waiting for Apply check",
    requires_confirmation: "Requires confirmation"
  };
  return labels[status] || "Waiting for Apply check";
}

function taskReportList(items = [], empty = "None") {
  const values = items.filter(Boolean);
  return values.length ? values.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function writeTaskCompanyReport(task) {
  if (!task?.id) return null;
  const evidence = readEvidencePack(task.id);
  const proposal = readProposalPack(task.id);
  const verification = readVerificationPack(task.id);
  const patchRun = readPatchRunPack(task.id);
  const applyRun = readPatchApplyPack(task.id);
  const rollback = readRollbackPack(task.id);
  const humanGate = buildHumanGateSummary(task);
  const diffPreview = patchRun?.diffPreview
    ? ["```diff", patchRun.diffPreview.slice(0, 4000), "```"].join("\n")
    : "No diff preview yet.";
  const applied = applyRun?.status === "applied";
  const markdown = [
    `# Company Report: ${task.title}`,
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Project: ${task.projectName || task.projectId || "Unnamed project"}`,
    `Task ID: ${task.id}`,
    "",
    "## What Changed",
    taskReportList([
      evidence ? `Generated Evidence Pack: ${evidenceRelativePath(task.id)}` : "",
      proposal ? `Generated Patch Proposal: ${proposalRelativePath(task.id)}` : "",
      verification ? `Ran Verification: ${verificationRelativePath(task.id)} (${verification.status || "unknown"})` : "",
      patchRun ? `Generated Diff Preview / Sandbox Patch: ${patchRun.patchRunPath || patchRunRelativePath(task.id)}` : "",
      applyRun ? `Checked Apply Gate: ${applyRun.applyPath || patchApplyRelativePath(task.id)} (${companyApplyStatusLabel(applyRun.status)})` : "",
      rollback ? `Ran Rollback: ${rollback.rollbackReportPath || rollbackRelativePath(task.id)} (${rollback.status || "unknown"})` : ""
    ]),
    "",
    "## Evidence",
    taskReportList([
      evidence?.summary ? `Evidence summary: ${evidence.summary}` : "",
      evidence?.commandCount ? `Read-only check count: ${evidence.commandCount}` : "",
      ...(evidence?.commands || []).slice(0, 6).map((command) => `${command.ok ? "PASS" : "FAIL"} ${command.command}`)
    ]),
    "",
    "## Diff",
    diffPreview,
    "",
    "## Test Result",
    taskReportList([
      verification?.summary?.script ? `Script: ${verification.summary.script}` : "",
      verification?.result ? `Result: ${verification.result.ok ? "Passed" : "Failed"}` : "",
      verification?.summary?.result?.output ? `Output: ${String(verification.summary.result.output).slice(0, 1000)}` : ""
    ]),
    "",
    "## Human Gate",
    taskReportList([
      `Status: ${humanGate?.label || "Pending approval"}`,
      humanGate?.note ? `Note: ${humanGate.note}` : "",
      humanGate?.decidedAt ? `Time: ${humanGate.decidedAt}` : ""
    ]),
    "",
    "## Write Status",
    taskReportList([
      applyRun ? `Apply status: ${companyApplyStatusLabel(applyRun.status)}` : "Apply Gate has not run yet",
      applied ? `Applied files: ${(applyRun.appliedFiles || []).map((file) => file.file).join(", ") || "none"}` : "Project files were not written",
      applyRun?.applyReportPath ? `Apply Report: ${applyRun.applyReportPath}` : ""
    ]),
    "",
    "## Rollback",
    taskReportList([
      applyRun?.rollbackOption?.available || patchRun?.rollbackSnapshotPath
        ? `Rollback snapshot: ${applyRun?.rollbackOption?.rollbackSnapshotPath || patchRun.rollbackSnapshotPath}`
        : "No rollback snapshot available yet",
      rollback?.rollbackReportPath ? `Latest rollback report: ${rollback.rollbackReportPath}` : "",
      rollback?.status === "rolled_back" ? "Latest status: rolled back to snapshot" : ""
    ]),
    ""
  ].join("\n");

  mkdirSync(TASK_REPORT_DIR, { recursive: true });
  writeFileSync(taskCompanyReportPathForTask(task.id), markdown, "utf8");
  return {
    taskId: task.id,
    reportPath: taskCompanyReportRelativePath(task.id),
    markdown
  };
}

function attachTaskCompanyReport(task) {
  const report = writeTaskCompanyReport(task);
  if (!report) return { task, report: null };
  const updated = appendTaskUpdate(task, {
    companyReport: report.reportPath,
    evidence: [...new Set([...(task.evidence || []), report.reportPath])].slice(0, 10)
  });
  return {
    task: updated,
    report
  };
}

function latestArtifactSummary(evidencePacks = [], proposalPacks = [], verificationPacks = [], patchRunPacks = [], patchApplyPacks = []) {
  const latestEvidence = evidencePacks[0] || null;
  const taskId = latestEvidence?.taskId || proposalPacks[0]?.taskId || verificationPacks[0]?.taskId || patchRunPacks[0]?.taskId || patchApplyPacks[0]?.taskId || null;
  const latestProposal = taskId
    ? proposalPacks.find((pack) => pack?.taskId === taskId) || null
    : proposalPacks[0] || null;
  const latestVerification = taskId
    ? verificationPacks.find((pack) => pack?.taskId === taskId) || null
    : verificationPacks[0] || null;
  const latestPatchRun = taskId
    ? patchRunPacks.find((pack) => pack?.taskId === taskId) || null
    : patchRunPacks[0] || null;
  const latestPatchApply = taskId
    ? patchApplyPacks.find((pack) => pack?.taskId === taskId) || null
    : patchApplyPacks[0] || null;

  return {
    taskId,
    title: latestEvidence?.taskTitle || latestProposal?.title || "No evidence yet",
    evidenceCapturedAt: latestEvidence?.capturedAt || null,
    proposalCreatedAt: latestProposal?.createdAt || null,
    checks: latestEvidence?.commands?.length || 0,
    changedFiles: latestEvidence ? changedFilesFromEvidence(latestEvidence).slice(0, 6) : [],
    proposalRisk: latestProposal?.risk || null,
    proposalSummary: latestProposal?.summary || "",
    verificationStatus: latestVerification?.result?.ok ? "passed" : latestVerification ? "failed" : "not_run",
    verificationScript: latestVerification?.script || null,
    patchRunStatus: latestPatchRun?.status || "not_run",
    patchRunMode: latestPatchRun?.mode || null,
    applyStatus: latestPatchApply?.status || "not_run",
    applyRunnerEnabled: latestPatchApply?.applyRunnerEnabled || false
  };
}

function buildLaunchSnapshot({ workers = [], events = [], autonomy, companyReport, evidencePacks = [], proposalPacks = [], verificationPacks = [], patchRunPacks = [], patchApplyPacks = [], approvals = [] }) {
  const coreWorkers = workers.filter((worker) => LAUNCH_CORE_WORKER_IDS.has(worker.id));
  const benchWorkers = workers.filter((worker) => !LAUNCH_CORE_WORKER_IDS.has(worker.id));
  const latestEvidence = latestArtifactSummary(evidencePacks, proposalPacks, verificationPacks, patchRunPacks, patchApplyPacks);
  const latestVerified = latestEvidence.verificationStatus === "passed";
  const latestGate = approvals.find((approval) => approval.gateType === "close_loop" && approval.taskId === latestEvidence.taskId);

  return {
    narrative: "I run a 24/7 AI worker company with logs, evidence, gates, and replay.",
    focus: "Codingape closed-loop demo",
    coreWorkerIds: [...LAUNCH_CORE_WORKER_IDS],
    coreWorkers,
    benchWorkers,
    latestEvidence: {
      ...latestEvidence,
      gateStatus: latestGate?.status || "pending",
      gateLabel: latestGate ? gateStatusLabel(latestGate.status) : "Pending approval",
      approvalId: latestGate?.id || null
    },
    currentStage:
      latestEvidence.applyStatus === "applied"
        ? "已按回滚证据写入提案"
        : ["requires_confirmation", "blocked"].includes(latestEvidence.applyStatus)
        ? "写入提案闸门"
        : ["dry_run", "sandbox_written"].includes(latestEvidence.patchRunStatus)
        ? "受控补丁预检"
        : latestGate?.status === "approved"
        ? "人工已批准的演示闭环"
        : evidencePacks.length && proposalPacks.length && latestVerified
        ? "已验证的演示闭环"
        : evidencePacks.length && proposalPacks.length
        ? "证据支撑的演示闭环"
        : events.some((event) => event.type === "task_queued")
          ? "任务已排队，等待证据"
          : "准备第一次编程猿运行",
    autonomy,
    companyReport
  };
}

function buildSnapshot() {
  const projects = discoverProjects();
  const localProjects = buildLocalProjectsSnapshot(projects);
  const tasks = readTaskLog();
  const manualEvents = readManualEventLog();
  const approvalDecisions = readApprovalDecisionLog();
  const approvals = buildApprovalQueue(projects, tasks, approvalDecisions);
  const workers = buildWorkers(projects, tasks);
  const events = buildEvents(projects, tasks, manualEvents, approvals);
  const evidencePacks = readEvidencePacks();
  const proposalPacks = readProposalPacks();
  const verificationPacks = readVerificationPacks();
  const patchRunPacks = readPatchRunPacks();
  const patchApplyPacks = readPatchApplyPacks();
  const taskReports = readTaskCompanyReports();
  const autonomy = buildAutonomyReadiness({ tasks, approvals, evidencePacks, proposalPacks, verificationPacks, patchRunPacks, patchApplyPacks });
  const companyReport = buildCompanyReport({ tasks, approvals, evidencePacks, proposalPacks, verificationPacks, patchRunPacks, patchApplyPacks, workers, projects });
  const launch = buildLaunchSnapshot({ workers, events, autonomy, companyReport, evidencePacks, proposalPacks, verificationPacks, patchRunPacks, patchApplyPacks, approvals });
  const localJudgeConfig = localLlmConfig(process.env);
  const modelProvider = modelProviderSnapshot();
  const latestLocalJudgeProposal = proposalPacks.find((proposal) => proposal?.localJudgeReviewStatus) || null;
  const localJudge = {
    enabled: localJudgeConfig.enabled,
    provider: localJudgeConfig.provider,
    model: localJudgeConfig.enabled ? localJudgeConfig.model : "",
    timeoutMs: localJudgeConfig.timeoutMs,
    latestStatus: latestLocalJudgeProposal?.localJudgeReviewStatus || "none",
    latestTaskId: latestLocalJudgeProposal?.taskId || "",
    latestAt: latestLocalJudgeProposal?.createdAt || "",
    latestVerdict: latestLocalJudgeProposal?.localJudgeReview?.review?.verdict || "",
    latestSummary: latestLocalJudgeProposal?.localJudgeReview?.review?.summary || latestLocalJudgeProposal?.localJudgeReview?.error || ""
  };
  const serviceHealth = buildServiceHealthSummary();
  const aiwcHealth = buildAiwcHealthSnapshot();
  const operationalReadiness = buildOperationalReadiness({
    serviceHealth,
    localProjects,
    tasks,
    evidencePacks,
    proposalPacks,
    verificationPacks,
    patchRunPacks,
    patchApplyPacks,
    taskReports,
    aiwcConfigured: aiwcConfigured(),
    aiwcHealth,
    hasSupportBundle: true,
    stableTag: latestStableTag()
  });
  const firstRunChecklist = buildFirstRunChecklist({ serviceHealth, localProjects, aiwcHealth });
  const onboarding = buildFirstRunOnboarding({ localProjects, firstRunChecklist });
  const supportCenter = buildSupportCenterSnapshot({
    operationalReadiness,
    firstRunChecklist,
    aiwcHealth,
    localProjects,
    events,
    tasks
  });
  const betaOps = buildBetaOpsDashboard({
    distributionReport: readDistributionReport(),
    codeSigningIdentityOutput: detectCodeSigningIdentities(),
    testerRuns: readBetaTesterRuns(),
    supportBundles: readBetaSupportBundles(),
    patchApplyPacks
  });
  const counts = projects.reduce(
    (acc, project) => {
      acc[project.status.key] = (acc[project.status.key] || 0) + 1;
      return acc;
    },
    {}
  );

  return {
    generatedAt: new Date().toISOString(),
    workspace: WORKSPACE_ROOT,
    counts,
    workers,
    events,
    tasks: tasks.slice(-40).reverse(),
    approvals,
    autonomy,
    localJudge,
    modelProvider,
    serviceHealth,
    operationalReadiness,
    companyReport,
    aiwc: aiwcHealth,
    firstRunChecklist,
    onboarding,
    supportCenter,
    betaOps,
    launch,
    localProjects,
    projects
  };
}

function detectCodeSigningIdentities() {
  return run("security", ["find-identity", "-p", "codesigning", "-v"], __dirname);
}

function readDistributionReport() {
  return readJson(DISTRIBUTION_REPORT_FILE);
}

function readBetaTesterRuns() {
  return readJsonLines(BETA_TESTER_RUNS_FILE);
}

function readJsonFilesInDirectory(directory, limit = 80) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => readJson(join(directory, fileName)))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b?.generatedAt || b?.recordedAt || 0) - Date.parse(a?.generatedAt || a?.recordedAt || 0))
    .slice(0, limit);
}

function readBetaSupportBundles() {
  return [
    ...readJsonFilesInDirectory(BETA_SUPPORT_BUNDLE_DIR, 80),
    ...readJsonFilesInDirectory(SUPPORT_BUNDLE_DIR, 20)
  ];
}

function buildServiceHealthSummary() {
  const appLaunchAgentInstalled = existsSync(CODEX_OFFICE_LAUNCH_AGENT);
  const tunnelConfigured = existsSync(CLOUDFLARED_CONFIG_FILE);
  const tunnelLaunchAgentInstalled = existsSync(CLOUDFLARE_LAUNCH_AGENT);
  const localUrl = `http://${HOST}:${PORT}`;

  return {
    generatedAt: new Date().toISOString(),
    local: {
      label: "Local service",
      status: "online",
      statusLabel: "Online",
      url: localUrl,
      detail: `This page is served from ${localUrl}; the service process is responding to snapshot requests.`
    },
    publicEntry: {
      label: "Public entry",
      status: tunnelConfigured ? "configured" : "missing",
      statusLabel: tunnelConfigured ? "Configured" : "Pending",
      url: PUBLIC_ENTRY_URL,
      detail: tunnelConfigured
        ? "The public domain points to the local office through a Cloudflare tunnel."
        : "Cloudflare tunnel config file was not found."
    },
    tunnel: {
      label: "Cloudflare tunnel",
      status: tunnelConfigured && tunnelLaunchAgentInstalled ? "managed" : tunnelConfigured ? "configured" : "missing",
      statusLabel: tunnelConfigured && tunnelLaunchAgentInstalled ? "Managed" : tunnelConfigured ? "Configured" : "Pending",
      detail: tunnelConfigured
        ? tunnelLaunchAgentInstalled
          ? "Cloudflare tunnel is configured to run automatically after login."
          : "Tunnel config exists, but the login launch agent was not detected."
        : "Configure the Cloudflare tunnel first."
    },
    daemon: {
      label: "Background daemon",
      status: appLaunchAgentInstalled ? "managed" : "manual",
      statusLabel: appLaunchAgentInstalled ? "Managed" : "Manual",
      detail: appLaunchAgentInstalled
        ? "Codingape Office is managed by the macOS background launch agent."
        : "The current service may have been started manually and may need to be started again after restart."
    }
  };
}

function commandVersion(command, args = ["--version"]) {
  const output = run(command, args, __dirname);
  return {
    ok: Boolean(output),
    value: output.split("\n")[0] || ""
  };
}

function dataDirectoryWritable(directory) {
  try {
    mkdirSync(directory, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function firstRunCheck(id, label, status, detail, critical = false) {
  return { id, label, status, detail, critical };
}

function firstRunOnboardingStep(id, label, status, detail) {
  return { id, label, status, detail };
}

function buildFirstRunChecklist({ serviceHealth = {}, localProjects = {}, aiwcHealth = {} } = {}) {
  const git = commandVersion("git");
  const node = commandVersion("node");
  const npm = commandVersion("npm");
  const selectedPath = localProjects.selectedPath || "";
  const hasSelectedProject = Boolean(localProjects.selectedProjectId && selectedPath && existsSync(selectedPath));
  const selectedProjectIsGitRepo = hasSelectedProject && existsSync(join(selectedPath, ".git"));
  const patchRunnerEnabled = process.env.CODEX_OFFICE_ENABLE_WRITE_RUNNER === "true";
  const supportWritable = dataDirectoryWritable(SUPPORT_BUNDLE_DIR);
  const checks = [
    firstRunCheck(
      "project_root",
      "项目目录已选择",
      hasSelectedProject ? "passed" : "blocked",
      hasSelectedProject ? selectedPath : "首次运行前需要选择一个本地 project root。",
      true
    ),
    firstRunCheck("git", "Git 可用", git.ok ? "passed" : "blocked", git.value || "未检测到 git --version。", true),
    firstRunCheck("node", "Node 可用", node.ok ? "passed" : "blocked", node.value || "未检测到 node --version。", true),
    firstRunCheck("npm", "npm 可用", npm.ok ? "passed" : "blocked", npm.value || "未检测到 npm --version。", true),
    firstRunCheck(
      "git_repo",
      "项目是 Git repo",
      !hasSelectedProject ? "warning" : selectedProjectIsGitRepo ? "passed" : "warning",
      !hasSelectedProject
        ? "选择项目后会检查 .git。"
        : selectedProjectIsGitRepo
          ? "已检测到 .git，可在写入前创建可回退快照。"
          : "未检测到 .git；建议先运行 git init 或选择已有仓库，回退仍会依赖 Coding猿 rollback snapshot。",
      false
    ),
    firstRunCheck(
      "api_key",
      "API Key 已配置",
      aiwcHealth.items?.find((item) => item.key === "AIWC_INGESTION_API_KEY")?.configured ? "passed" : "warning",
      aiwcHealth.items?.find((item) => item.key === "AIWC_INGESTION_API_KEY")?.configured
        ? "AIWC_INGESTION_API_KEY 已配置，密钥不会在界面显示。"
        : "缺少 AIWC_INGESTION_API_KEY；本地 beta 不阻断，集中日志会停用。",
      false
    ),
    firstRunCheck("evidence_runner", "Evidence runner 可用", "passed", "只读证据采集器已加载。", true),
    firstRunCheck(
      "patch_runner",
      "Patch runner 可用",
      patchRunnerEnabled ? "passed" : "warning",
      patchRunnerEnabled
        ? "受控补丁执行器已启用，仍受验证、回滚和人工闸门保护。"
        : "补丁执行器默认关闭；沙盒闭环会在受控配置中运行，真实写入仍需人工闸门。",
      false
    ),
    firstRunCheck(
      "support_bundle",
      "Support bundle 可生成",
      supportWritable ? "passed" : "blocked",
      supportWritable ? "支持包目录可写。" : "支持包目录不可写。",
      true
    ),
    firstRunCheck(
      "local_service",
      "Local service healthy",
      serviceHealth.local?.status === "online" ? "passed" : "blocked",
      serviceHealth.local?.detail || "本地服务未确认。",
      true
    )
  ];
  const blockers = checks.filter((check) => check.critical && check.status !== "passed");
  const warnings = checks.filter((check) => !check.critical && check.status !== "passed");

  return {
    status: blockers.length ? "blocked" : warnings.length ? "ready_with_warnings" : "ready",
    statusLabel: blockers.length ? "需处理" : warnings.length ? "可启动，有提示" : "首次运行就绪",
    checks,
    blockers,
    warnings,
    summary: blockers.length
      ? `首次运行还差 ${blockers.length} 个关键项。`
      : warnings.length
        ? `首次运行关键项齐备，还有 ${warnings.length} 个运营提示。`
        : "首次运行检查全部通过。"
  };
}

function buildFirstRunOnboarding({ localProjects = {}, firstRunChecklist = {} } = {}) {
  const checks = firstRunChecklist.checks || [];
  const byId = new Map(checks.map((check) => [check.id, check]));
  const selectedPath = localProjects.selectedPath || "";
  const hasProject = Boolean(localProjects.selectedProjectId && selectedPath);
  const runtimeOk = ["git", "node", "npm"].every((id) => byId.get(id)?.status === "passed");
  const modelSettings = readModelSettings();
  const provider = redactedModelProviderSettings(modelSettings);
  const providerReady = modelProviderReady(modelSettings);
  const modelConfigured = provider.providerMode === "demo_only" || providerReady.ok;
  const safetyOk = !firstRunChecklist.blockers?.length;

  return {
    required: !hasProject,
    status: hasProject ? "complete" : "needs_project",
    title: "Start The Codingape Office Pilot",
    summary: "Codingape Office is your local AI coding worker for Mac. It shows evidence and diffs before any code write.",
    selectedPath,
    safeTaskTitle: FIRST_ORDER_TITLE,
    steps: [
      firstRunOnboardingStep("welcome", "Welcome", "passed", "Local AI coding worker; writes only after approval."),
      firstRunOnboardingStep("project_root", "Choose local project folder", hasProject ? "passed" : "blocked", hasProject ? selectedPath : "Choose one project root."),
      firstRunOnboardingStep("runtime", "Check Git / Node / npm", runtimeOk ? "passed" : "blocked", runtimeOk ? "Runtime is available." : "Install or fix Git, Node, and npm."),
      firstRunOnboardingStep("model_mode", "Choose model mode", "ready", "Demo Only can run the safety loop first; BYO API Key or Local Model can generate real diffs."),
      firstRunOnboardingStep("api_key", "Test model connection", modelConfigured ? "passed" : "warning", modelConfigured ? "Model mode is available; secrets are hidden." : "Without a model, Codingape Office enters Demo Only and does not call AI."),
      firstRunOnboardingStep("self_check", "Run safety self-check", safetyOk ? "passed" : "blocked", firstRunChecklist.summary || "Refresh status to see the safety self-check."),
      firstRunOnboardingStep("safe_task", "Run first task", hasProject ? "ready" : "blocked", FIRST_ORDER_TITLE)
    ]
  };
}

function recoveryItem(id, title, detail, fix, severity = "warning") {
  return {
    id,
    title,
    detail,
    fix,
    severity,
    supportBundle: true
  };
}

function buildErrorRecoveryGuide({ firstRunChecklist = {}, localProjects = {}, aiwcHealth = {} } = {}) {
  const checks = new Map((firstRunChecklist.checks || []).map((check) => [check.id, check]));
  const hasProject = Boolean(localProjects.selectedProjectId && localProjects.selectedPath);
  const projectIsGitRepo = checks.get("git_repo")?.status === "passed";
  return [
    recoveryItem("local_service_start_failed", "本地服务启动失败", "App 无法从本机服务拿到 /office。", "先复制重启提示；如果仍失败，生成支持包并附上 ~/Library/Logs/com.geoaifactory.codex-office.err.log。", "error"),
    recoveryItem("port_4142_busy", "Port 4142 is busy", "Another process is using the Codingape Office default port.", "Run lsof -nP -iTCP:4142 -sTCP:LISTEN, stop the old service, then reopen the app.", "error"),
    recoveryItem("node_missing", "Node/npm 缺失", checks.get("node")?.detail || checks.get("npm")?.detail || "未检测到 Node 或 npm。", "安装 Node.js LTS，或确认 /opt/homebrew/bin/node 和 npm 在 PATH 中。", checks.get("node")?.status === "passed" && checks.get("npm")?.status === "passed" ? "info" : "error"),
    recoveryItem("git_missing", "Git 缺失", checks.get("git")?.detail || "未检测到 git。", "安装 Xcode Command Line Tools，或运行 xcode-select --install。", checks.get("git")?.status === "passed" ? "info" : "error"),
    recoveryItem("api_key_missing", "API Key 缺失", aiwcHealth.missing?.length ? `缺少 ${aiwcHealth.missing.join(", ")}` : "集中日志 key 未配置。", "本地 beta 可继续；要开启 AIWC 集中日志，请在启动环境里配置 AIWC_BASE_URL、AIWC_INGESTION_API_KEY、AIWC_PROJECT_ID、AIWC_AGENT_ID。", aiwcHealth.configured ? "info" : "warning"),
    recoveryItem("project_root_missing", "无授权项目", hasProject ? localProjects.selectedPath : "还没有选择 project root。", "点击“选择文件夹”，只授权你要测试的本地代码项目；系统不会默认扫描全盘。", hasProject ? "info" : "error"),
    recoveryItem("project_not_git_repo", "项目不是 git repo", projectIsGitRepo ? "已检测到 .git。" : "当前授权项目没有 .git。", "建议先运行 git init 或选择已有仓库；Coding猿 仍会在 apply 前创建 rollback snapshot。", projectIsGitRepo ? "info" : "warning"),
    recoveryItem("apply_failed", "apply 失败", "写入可能被确认语、环境开关、漂移检查、Project Root Guard 或 rollback 条件阻断。", "打开写入闸门详情，按提示补齐 diff、verification、rollback、人审和 project root；失败后使用 rollback option。", "warning"),
    recoveryItem("rollback_failed", "rollback 失败", "回滚可能因为 project root mismatch 或 snapshot 缺失被阻断。", "确认当前授权项目仍是原 project root，再生成支持包，把 rollback report 一起发给支持。", "warning")
  ];
}

function buildRecentErrors(events = [], tasks = [], limit = 20) {
  const eventErrors = events
    .filter((event) => /failed|blocked|error/i.test(event?.type || "") || event?.risk === "high")
    .map((event) => ({
      id: event.id,
      source: "event",
      timestamp: event.timestamp || "",
      title: event.title || event.type || "运行事件",
      detail: String(event.detail || "").slice(0, 360),
      severity: event.risk === "high" ? "high" : /failed|error/i.test(event?.type || "") ? "error" : "warning"
    }));
  const taskErrors = tasks
    .filter((task) => ["blocked", "failed"].includes(task?.status))
    .map((task) => ({
      id: task.id,
      source: "task",
      timestamp: task.updatedAt || task.createdAt || "",
      title: task.title || task.id,
      detail: `${task.projectName || task.projectId || "项目"} · ${task.status}`,
      severity: task.status === "failed" ? "error" : "warning"
    }));

  return [...eventErrors, ...taskErrors]
    .sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0))
    .slice(0, limit);
}

function buildDiagnosticSummary({ operationalReadiness = {}, firstRunChecklist = {}, aiwcHealth = {}, recentErrors = [] } = {}) {
  return [
    `Codingape Office diagnostic summary`,
    `运营状态：${operationalReadiness.statusLabel || "未知"} (${operationalReadiness.score || 0}/100)`,
    `First Run：${firstRunChecklist.statusLabel || "未知"}`,
    `AIWC：${aiwcHealth.statusLabel || "未知"}${aiwcHealth.missing?.length ? `，缺少 ${aiwcHealth.missing.join(", ")}` : ""}`,
    `最近错误：${recentErrors.length}`,
    `重启提示：launchctl kickstart -k gui/$(id -u)/com.geoaifactory.codex-office`
  ].join("\n");
}

function buildSupportCenterSnapshot({ operationalReadiness = {}, firstRunChecklist = {}, aiwcHealth = {}, localProjects = {}, events = [], tasks = [] } = {}) {
  const recentErrors = buildRecentErrors(events, tasks);

  return {
    supportBundleDirectory: SUPPORT_BUNDLE_DIR,
    supportBundleRelativeDirectory: "data/support-bundles",
    restartHint: "launchctl kickstart -k gui/$(id -u)/com.geoaifactory.codex-office",
    recentErrors,
    recoveryGuide: buildErrorRecoveryGuide({ firstRunChecklist, localProjects, aiwcHealth }),
    diagnosticSummary: buildDiagnosticSummary({
      operationalReadiness,
      firstRunChecklist,
      aiwcHealth,
      recentErrors
    })
  };
}

function markdownList(items = [], formatter = (item) => `- ${item}`) {
  return items.length ? items.map(formatter).join("\n") : "- 暂无";
}

function dossierStatusLabel(status = "not_run") {
  const labels = {
    applied: "已写入",
    blocked: "已阻断",
    dry_run: "干跑",
    failed: "失败",
    none: "无",
    not_autonomous: "未自治",
    not_run: "未运行",
    passed: "通过",
    requires_confirmation: "需要确认",
    sandbox: "沙盒",
    sandbox_written: "沙盒已写入"
  };
  return labels[status] || status;
}

function buildReadinessDossier(snapshot) {
  const autonomy = snapshot.autonomy || {};
  const report = snapshot.companyReport || {};
  const launch = snapshot.launch || {};
  const latest = launch.latestEvidence || {};
  const blockers = autonomy.hardBlockers || [];
  const objectives = autonomy.objectives || [];
  const markdown = [
    "# 编程猿自治就绪档案",
    "",
    `- 核心叙事：${launch.narrative || "带证据和闸门的 AI 打工公司"}`,
    `- 当前阶段：${launch.currentStage || "未知"}`,
    `- 就绪分：${autonomy.score || 0}/${autonomy.maxScore || 100}`,
    `- 级别：${autonomy.level || "L1 演示就绪"}`,
    `- 结论：${dossierStatusLabel(autonomy.verdict || "not_autonomous")}`,
    `- 摘要：${autonomy.summary || "暂无就绪摘要"}`,
    "",
    "## 公司战报",
    "",
    report.headline || "暂无战报。",
    "",
    markdownList(report.metrics || [], (metric) => `- ${metric.label}: ${metric.value}`),
    "",
    "## 最新证据",
    "",
    `- 任务：${latest.title || "暂无证据"}`,
    `- 任务 ID：${latest.taskId || "无"}`,
    `- 检查数：${latest.checks || 0}`,
    `- 验证：${dossierStatusLabel(latest.verificationStatus || "not_run")}${latest.verificationScript ? `（${latest.verificationScript}）` : ""}`,
    `- 人工闸门：${latest.gateLabel || gateStatusLabel(latest.gateStatus || "pending")}`,
    `- 补丁执行器：${dossierStatusLabel(latest.patchRunStatus || "not_run")}${latest.patchRunMode ? `（${dossierStatusLabel(latest.patchRunMode)}）` : ""}`,
    `- 写入闸门：${dossierStatusLabel(latest.applyStatus || "not_run")}`,
    `- 方案风险：${dossierStatusLabel(latest.proposalRisk || "none")}`,
    "",
    "## 硬阻断",
    "",
    markdownList(blockers, (blocker) => `- [${blocker.severity}] ${blocker.title} (${blocker.owner}) - ${blocker.remediation}`),
    "",
    "## 路线图目标",
    "",
    markdownList(objectives, (objective) => `- [${objective.status}] ${objective.label} - ${objective.metric}`),
    "",
    "## Safety Boundary",
    "",
    "- Code-writing, deploy, restart, install, wallet/trading, production, and migration actions remain gated.",
    "- Verification runner only allows safety-filtered test/check/lint/type/verify/qa scripts.",
    "- AIWC ingestion remains a旁路 adapter; failures do not block the main workflow."
  ].join("\n");

  return {
    generatedAt: new Date().toISOString(),
    score: autonomy.score || 0,
    level: autonomy.level || "L1 demo readiness",
    verdict: autonomy.verdict || "not_autonomous",
    blockers,
    objectives,
    companyReport: report,
    latestEvidence: latest,
    markdown
  };
}

async function handleReadinessDossier(_request, response) {
  sendJson(response, {
    ok: true,
    dossier: buildReadinessDossier(buildSnapshot())
  });
}

function buildSupportBundle(snapshot = buildSnapshot()) {
  const gitStatusLines = run("git", ["status", "--short"], __dirname)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const tasks = readTaskLog();
  const projects = snapshot.projects || discoverProjects();
  const approvals = buildApprovalQueue(projects, tasks, readApprovalDecisionLog());
  const events = buildEvents(projects, tasks, readManualEventLog(), approvals);

  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: "Codingape Office",
      version: "0.1.0",
      branch: run("git", ["branch", "--show-current"], __dirname) || "detached",
      commit: run("git", ["rev-parse", "--short", "HEAD"], __dirname),
      stableTag: latestStableTag(),
      dirtyFiles: gitStatusLines.length
    },
    serviceHealth: snapshot.serviceHealth,
    aiwc: snapshot.aiwc,
    modelProvider: snapshot.modelProvider || modelProviderSnapshot(),
    firstRunChecklist: snapshot.firstRunChecklist,
    supportCenter: snapshot.supportCenter,
    operationalReadiness: snapshot.operationalReadiness,
    localProjects: {
      selectedProjectId: snapshot.localProjects?.selectedProjectId || "",
      selectedName: snapshot.localProjects?.selectedName || "",
      selectedPath: snapshot.localProjects?.selectedPath || "",
      count: snapshot.localProjects?.count || 0,
      records: (snapshot.localProjects?.records || []).slice(0, 20).map((record) => ({
        id: record.id,
        name: record.name,
        path: record.path,
        selected: record.id === snapshot.localProjects?.selectedProjectId
      }))
    },
    artifacts: {
      evidencePacks: readEvidencePacks(20).map((pack) => ({
        taskId: pack.taskId,
        capturedAt: pack.capturedAt,
        evidencePath: pack.evidencePath
      })),
      proposalPacks: readProposalPacks(20).map((pack) => ({
        taskId: pack.taskId,
        createdAt: pack.createdAt,
        proposalPath: pack.proposalPath,
        risk: pack.risk
      })),
      verificationPacks: readVerificationPacks(20).map((pack) => ({
        taskId: pack.taskId,
        completedAt: pack.completedAt,
        verificationPath: pack.verificationPath,
        ok: Boolean(pack.result?.ok)
      })),
      patchRuns: readPatchRunPacks(20).map((pack) => ({
        taskId: pack.taskId,
        completedAt: pack.completedAt,
        patchRunPath: pack.patchRunPath,
        status: pack.status,
        rollbackSnapshotPath: pack.rollbackSnapshotPath
      })),
      applyRuns: readPatchApplyPacks(20).map((pack) => ({
        taskId: pack.taskId,
        completedAt: pack.completedAt,
        applyPath: pack.applyPath,
        status: pack.status,
        rollbackAvailable: Boolean(pack.rollbackAvailable)
      })),
      taskReports: readTaskCompanyReports(20)
    },
    recentTasks: tasks.slice(-25).reverse().map((task) => ({
      id: task.id,
      projectId: task.projectId,
      projectName: task.projectName,
      title: task.title,
      status: task.status,
      risk: task.risk,
      mode: task.mode || task.result?.mode || "",
      evidence: task.evidence || [],
      proposal: task.proposal || "",
      verification: task.verification || "",
      patchRun: task.patchRun || "",
      applyRun: task.applyRun || "",
      updatedAt: task.updatedAt || task.createdAt
    })),
    recentEvents: events.slice(0, 40).map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      projectId: event.projectId,
      title: event.title,
      detail: String(event.detail || "").slice(0, 360),
      evidence: event.evidence || []
    })),
    approvals: (snapshot.approvals || []).slice(0, 20).map((approval) => ({
      id: approval.id,
      taskId: approval.taskId,
      status: approval.status,
      risk: approval.risk,
      gateType: approval.gateType,
      title: approval.title
    }))
  };
}

function writeSupportBundle() {
  const generatedAt = new Date();
  const fileName = `${generatedAt.toISOString().replace(/[:.]/g, "-")}.json`;
  const bundle = buildSupportBundle();
  const filePath = join(SUPPORT_BUNDLE_DIR, fileName);
  mkdirSync(SUPPORT_BUNDLE_DIR, { recursive: true });
  writeFileSync(filePath, JSON.stringify(bundle, null, 2), "utf8");
  return {
    ...bundle,
    fileName,
    bundlePath: supportBundleRelativePath(fileName)
  };
}

function pilotFeedbackRelativePath(fileName) {
  return `data/pilot-feedback/${fileName}`;
}

function redactPilotText(value = "", maxLength = 600) {
  const settings = readModelSettings();
  let text = String(value || "");
  if (settings.apiKey) text = text.split(settings.apiKey).join("[REDACTED]");
  text = text
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]")
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^"'\s]+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLength);
}

function normalizePilotChoice(value = "") {
  const text = redactPilotText(value, 80).toLowerCase();
  if (["yes", "true", "understood", "safe", "ok", "1", "是"].includes(text)) return "yes";
  if (["no", "false", "not_sure", "0", "否"].includes(text)) return "no";
  if (["unsure", "maybe", "不确定"].includes(text)) return "unsure";
  return text || "unspecified";
}

function normalizePilotScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.max(1, Math.min(5, Math.round(score)));
}

function buildPilotFeedbackRecord(body = {}) {
  const snapshot = buildSnapshot();
  const provider = snapshot.modelProvider || modelProviderSnapshot();
  return {
    testerId: redactPilotText(body.testerId || `pilot-${Date.now().toString(36)}`, 80),
    submittedAt: new Date().toISOString(),
    understoodTool: normalizePilotChoice(body.understoodTool),
    understoodNoAutoWrite: normalizePilotChoice(body.understoodNoAutoWrite),
    blockedAt: redactPilotText(body.blockedAt, 320),
    trustRealProject: normalizePilotChoice(body.trustRealProject),
    feedbackScore: normalizePilotScore(body.feedbackScore),
    willingToPay: redactPilotText(body.willingToPay, 160),
    notes: redactPilotText(body.notes, 600),
    installStatus: "local_service_reached",
    modelConfigStatus: provider.providerMode === "demo_only"
      ? "demo_only"
      : provider.apiKeyConfigured || provider.providerMode === "local_model"
        ? "configured"
        : "missing",
    firstTaskStatus: redactPilotText(body.firstTaskStatus || "unknown", 80),
    diffVisible: normalizePilotChoice(body.diffVisible),
    humanGateUnderstood: normalizePilotChoice(body.humanGateUnderstood || body.understoodNoAutoWrite),
    applyClicked: normalizePilotChoice(body.applyClicked),
    rollbackAvailable: normalizePilotChoice(body.rollbackAvailable),
    supportBundleGenerated: normalizePilotChoice(body.supportBundleGenerated),
    blockerCategory: redactPilotText(body.blockerCategory || body.blockedAt || "", 120),
    modelProvider: {
      providerMode: provider.providerMode,
      provider: provider.provider,
      model: provider.model,
      apiKeyConfigured: Boolean(provider.apiKeyConfigured)
    },
    privacy: {
      containsApiKey: false,
      containsSourceCode: false,
      containsSensitiveFileContent: false
    }
  };
}

function writePilotFeedback(body = {}) {
  const record = buildPilotFeedbackRecord(body);
  const fileName = `${record.submittedAt.replace(/[:.]/g, "-")}-${record.testerId.replace(/[^a-z0-9_-]/gi, "_")}.json`;
  mkdirSync(PILOT_FEEDBACK_DIR, { recursive: true });
  mkdirSync(PILOT_METRICS_DIR, { recursive: true });
  writeFileSync(join(PILOT_FEEDBACK_DIR, fileName), JSON.stringify(record, null, 2), "utf8");
  writeFileSync(PILOT_LATEST_FILE, JSON.stringify(record, null, 2), "utf8");
  return {
    ...record,
    fileName,
    feedbackPath: pilotFeedbackRelativePath(fileName),
    metricsPath: "data/pilot/latest.json"
  };
}

async function handlePilotFeedback(request, response) {
  const body = await readRequestJson(request);
  if (
    !hostAllowsNativeFolderPicker(request.headers.host || "") ||
    request.headers["x-codex-office-local"] !== "pilot-feedback"
  ) {
    sendJson(response, {
      ok: false,
      status: "blocked",
      error: "Pilot feedback export is only available from localhost."
    }, 403);
    return;
  }

  const feedback = writePilotFeedback(body);
  appendWorkerEvent({
    workerId: "ops-yuan",
    workerName: eventWorkerName("ops-yuan"),
    projectId: selectedLocalProjectRecord(readLocalProjectRegistry(LOCAL_PROJECTS_FILE))?.id || "",
    type: "pilot_feedback_exported",
    title: "Pilot feedback JSON exported",
    detail: feedback.feedbackPath,
    risk: "low",
    evidence: [feedback.feedbackPath, feedback.metricsPath]
  });
  sendJson(response, {
    ok: true,
    feedback: {
      testerId: feedback.testerId,
      submittedAt: feedback.submittedAt,
      feedbackPath: feedback.feedbackPath,
      metricsPath: feedback.metricsPath,
      feedbackScore: feedback.feedbackScore,
      blockerCategory: feedback.blockerCategory
    }
  });
}

async function handlePilotMetrics(_request, response) {
  sendJson(response, {
    ok: true,
    pilot: readJson(PILOT_LATEST_FILE) || null
  });
}

async function handleOperationalReadiness(_request, response) {
  sendJson(response, {
    ok: true,
    operationalReadiness: buildSnapshot().operationalReadiness
  });
}

async function handleBetaOps(_request, response) {
  sendJson(response, {
    ok: true,
    betaOps: buildSnapshot().betaOps
  });
}

async function handleAiwcHealthCheck(_request, response) {
  const config = buildAiwcConfigStatus();
  const checkedAt = new Date().toISOString();

  if (!config.configured) {
    const health = {
      ok: false,
      status: "missing_configuration",
      checkedAt,
      missing: config.missing,
      error: "Missing AIWC configuration."
    };
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(AIWC_HEALTH_FILE, JSON.stringify(health, null, 2), "utf8");
    sendJson(response, {
      ok: false,
      aiwc: buildAiwcHealthSnapshot()
    });
    return;
  }

  const result = await recordAiWorkerRunLog({
    run_id_external: `codex-office:aiwc-health:${Date.now().toString(36)}`,
    input: {
      workflow: "aiwc_health_check",
      source: "Codingape Office"
    },
    output: {
      ok: true,
      message: "AIWC health check from Codingape Office."
    },
    model: "codex-office-health-check",
    provider: "local",
    tools_used: ["GET /api/aiwc/health-check"],
    cost: 0,
    latency: 0,
    status: "completed",
    metadata: {
      workflow_name: "aiwc_health_check",
      health_check: true
    }
  });
  const health = {
    ok: Boolean(result.ok),
    status: result.ok ? "connected" : "failed",
    checkedAt,
    missing: [],
    error: result.ok ? "" : result.error || result.reason || "AIWC health-check failed.",
    statusCode: result.status || 0,
    runIdExternal: result.run_id_external || ""
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(AIWC_HEALTH_FILE, JSON.stringify(health, null, 2), "utf8");
  sendJson(response, {
    ok: health.ok,
    aiwc: buildAiwcHealthSnapshot()
  });
}

async function handleGetModelProviderSettings(_request, response) {
  sendJson(response, {
    ok: true,
    modelProvider: modelProviderSnapshot()
  });
}

async function handleSaveModelProviderSettings(request, response) {
  const body = await readRequestJson(request);
  const settings = writeModelProviderSettings(MODEL_PROVIDER_SETTINGS_FILE, {
    providerMode: body.providerMode,
    provider: body.provider,
    endpoint: body.endpoint,
    model: body.model,
    apiKey: body.apiKey
  });
  appendWorkerEvent({
    workerId: "ops-yuan",
    workerName: eventWorkerName("ops-yuan"),
    projectId: selectedLocalProjectRecord(readLocalProjectRegistry(LOCAL_PROJECTS_FILE))?.id || "",
    type: "model_provider_settings_updated",
    title: "模型提供方设置已更新",
    detail: `${settings.providerMode} · ${settings.provider} · key ${settings.apiKey ? "configured" : "not stored"}`,
    risk: "low",
    evidence: []
  });
  sendJson(response, {
    ok: true,
    modelProvider: redactedModelProviderSettings(settings)
  });
}

async function handleTestModelProvider(request, response) {
  const body = await readRequestJson(request);
  const settings = Object.keys(body || {}).length
    ? writeModelProviderSettings(MODEL_PROVIDER_SETTINGS_FILE, body)
    : readModelSettings();
  const result = await testModelProviderConnection({ settings });
  sendJson(response, {
    ok: result.ok,
    result: {
      ...result,
      apiKeyConfigured: Boolean(settings.apiKey),
      apiKey: undefined
    },
    modelProvider: redactedModelProviderSettings(settings)
  }, result.ok ? 200 : 200);
}

function buildAiContextPreviewPayload({ project, title = "", userFiles = [] } = {}) {
  const settings = readModelSettings();
  const provider = redactedModelProviderSettings(settings);
  const ready = modelProviderReady(settings);
  const context = buildAiPatchContext({
    projectPath: project.path,
    projectName: project.name,
    task: {
      id: "context_preview",
      title,
      projectName: project.name,
      risk: "low"
    },
    evidence: {},
    userFiles
  });
  const status = provider.providerMode === "demo_only"
    ? "demo_only"
    : !ready.ok
      ? ready.status
      : context.ok
        ? "ready"
        : "blocked";
  return {
    ok: context.ok && ready.ok && provider.providerMode !== "demo_only",
    providerMode: provider.providerMode,
    provider: provider.provider,
    model: provider.model,
    apiKeyConfigured: provider.apiKeyConfigured,
    status,
    notice: "Coding猿 只会把与任务相关的代码片段发送给你选择的模型，不会默认上传整个项目。还没有写入项目。",
    files: (context.files || []).map((file) => ({
      path: file.path,
      reason: file.reason,
      chars: file.chars,
      bytes: file.bytes,
      truncated: Boolean(file.truncated)
    })),
    skippedFiles: context.skippedFiles || [],
    hasGitDiff: Boolean(String(context.git?.diffStat || "").trim()),
    includesTestLogs: false,
    limits: context.limits || {},
    blockers: context.blockers || []
  };
}

async function handleAiContextPreview(request, response, projectId) {
  const body = await readRequestJson(request);
  const projects = discoverProjects();
  const selection = authorizedProjectSelection(projects, projectId);

  if (!selection.ok) {
    sendProjectSelectionBlocked(response, selection);
    return;
  }

  sendJson(response, {
    ok: true,
    contextPreview: buildAiContextPreviewPayload({
      project: selection.project,
      title: body.title || "",
      userFiles: Array.isArray(body.userFiles) ? body.userFiles : body.patchCandidates || []
    })
  });
}

async function handleSupportBundle(request, response) {
  await readRequestJson(request);
  if (
    !hostAllowsNativeFolderPicker(request.headers.host || "") ||
    request.headers["x-codex-office-local"] !== "support-bundle"
  ) {
    sendJson(response, {
      ok: false,
      status: "blocked",
      error: "Support bundle generation is only available from localhost."
    }, 403);
    return;
  }

  const bundle = writeSupportBundle();
  appendWorkerEvent({
    workerId: "ops-yuan",
    workerName: eventWorkerName("ops-yuan"),
    projectId: bundle.localProjects.selectedProjectId || "",
    type: "support_bundle_generated",
    title: "运营支持包已生成",
    detail: bundle.bundlePath,
    risk: "low",
    evidence: [bundle.bundlePath]
  });
  sendJson(response, {
    ok: true,
    bundle: {
      generatedAt: bundle.generatedAt,
      bundlePath: bundle.bundlePath,
      status: bundle.operationalReadiness?.status || "unknown",
      score: bundle.operationalReadiness?.score || 0,
      blockers: bundle.operationalReadiness?.blockers || []
    }
  });
}

async function handleOpenSupportBundleDirectory(request, response) {
  await readRequestJson(request);
  if (
    !hostAllowsNativeFolderPicker(request.headers.host || "") ||
    request.headers["x-codex-office-local"] !== "support-bundle-open"
  ) {
    sendJson(response, {
      ok: false,
      status: "blocked",
      error: "Support bundle directory can only be opened from localhost."
    }, 403);
    return;
  }

  mkdirSync(SUPPORT_BUNDLE_DIR, { recursive: true });
  try {
    execFileSync("open", [SUPPORT_BUNDLE_DIR], {
      stdio: "ignore",
      timeout: 2500
    });
    sendJson(response, {
      ok: true,
      directory: SUPPORT_BUNDLE_DIR
    });
  } catch (error) {
    sendJson(response, {
      ok: false,
      directory: SUPPORT_BUNDLE_DIR,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function serverErrorMessageZh(message = "") {
  const text = String(message || "");
  if (/Task title is required/i.test(text)) return "Task title is required";
  if (/Task is already running/i.test(text)) return "Task is already running. Try again after it finishes.";
  if (/Task not found/i.test(text)) return "Task not found";
  if (/Project not found/i.test(text)) return "Project not found";
  if (/Evidence pack not found/i.test(text)) return "Evidence Pack not found";
  if (/Run evidence before verification/i.test(text)) return "Run evidence collection before verification";
  if (/Run evidence before drafting a patch plan/i.test(text)) return "Run evidence collection before drafting a patch plan";
  if (/Draft a proposal before requesting human gate approval/i.test(text)) return "Draft a proposal before requesting Human Gate approval";
  if (/Event title is required/i.test(text)) return "Event title is required";
  if (/Method not allowed/i.test(text)) return "Method not allowed";
  if (/Internal server error/i.test(text)) return "Internal server error; no business workflow was released";
  if (/Verification script not found or not allowed/i.test(text)) return text;
  if (/No safe verification script found/i.test(text)) return "No safe allowlisted verification script was found";
  if (/Verification script is blocked by safety policy/i.test(text)) return text;
  return text || "Request failed";
}

function sendError(response, status, message) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify({ error: serverErrorMessageZh(message) }, null, 2));
}

function readRequestJson(request) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        rejectBody(new Error("Request body is too large"));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!raw.trim()) {
        resolveBody({});
        return;
      }

      try {
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(new Error("Invalid JSON body"));
      }
    });

    request.on("error", rejectBody);
  });
}

function createTaskFromBody(body, projects) {
  const project = projectById(projects, body.projectId);
  const worker = workerById(body.workerId || project?.workerId || "coding-yuan");
  const title = String(body.title || "").trim().slice(0, 180);
  if (!title) return null;

  const status = ["queued", "blocked"].includes(body.status) ? body.status : "queued";
  const risk = ["low", "medium", "high"].includes(body.risk) ? body.risk : project?.risk?.key || "low";
  const taskId = makeId("task");
  const now = new Date().toISOString();
  const patchDrafts = normalizePatchDrafts(body.patchDrafts, { maxFiles: 6 });
  const shouldSynthesizePatch = !Array.isArray(body.patchDrafts) &&
    String(body.source || "").startsWith("mission_") &&
    body.disablePatchSynthesis !== true;
  const synthesized = shouldSynthesizePatch
    ? synthesizePatchDraftsV1({
        task: {
          id: taskId,
          title,
          projectId: project?.id || body.projectId || "",
          projectName: project?.name || body.projectName || "Worker task"
        },
        projectPath: project?.path || "",
        projectName: project?.name || body.projectName || "Worker task",
        now
      })
    : null;
  const finalPatchDrafts = patchDrafts.drafts.length
    ? patchDrafts.drafts
    : synthesized?.drafts || [];
  const finalPatchBlockers = [
    ...patchDrafts.blockers,
    ...(synthesized?.blockers || [])
  ];
  const synthesizedCandidates = synthesized?.summary?.targetFile
    ? [synthesized.summary.targetFile]
    : [];

  return {
    id: taskId,
    workerId: worker.id,
    workerName: worker.name,
    projectId: project?.id || body.projectId || "",
    projectName: project?.name || body.projectName || "Worker task",
    title,
    status,
    risk,
    priority: body.priority || "normal",
    source: body.source || "operator",
    patchCandidates: Array.isArray(body.patchCandidates)
      ? [...new Set([
          ...body.patchCandidates.map((candidate) => String(candidate || "").trim()).filter(Boolean),
          ...synthesizedCandidates
        ])].slice(0, 6)
      : synthesizedCandidates,
    patchDrafts: finalPatchDrafts,
    patchDraftBlockers: finalPatchBlockers,
    patchSynthesis: synthesized?.summary || null,
    evidence: Array.isArray(body.evidence) ? body.evidence.slice(0, 8) : [],
    createdAt: now,
    updatedAt: now
  };
}

function safeFirstOrderPatchDraft(project) {
  const readmeFile = "README.md";
  const fallbackFile = "README.codingape-beta.md";
  const targetFile = existsSync(join(project.path, readmeFile)) ? readmeFile : fallbackFile;
  const guarded = assertPathInsideProjectRoot(project.path, targetFile);
  if (!guarded.ok) {
    return {
      ok: false,
      blockers: guarded.blockers || [{
        id: "first_order_path_blocked",
        title: "First order target blocked",
        detail: targetFile
      }]
    };
  }

  let existing = "";
  let targetExisted = false;
  if (existsSync(guarded.absolutePath)) {
    targetExisted = true;
    const stat = statSync(guarded.absolutePath);
    if (stat.size > 80_000) {
      return {
        ok: false,
        blockers: [{
          id: "first_order_target_too_large",
          title: `First order target too large: ${targetFile}`,
          detail: `File is ${stat.size} bytes; limit is 80000 bytes.`
        }]
      };
    }
    const buffer = readFileSync(guarded.absolutePath);
    if (buffer.includes(0)) {
      return {
        ok: false,
        blockers: [{
          id: "first_order_target_binary",
          title: `First order target is binary: ${targetFile}`,
          detail: "The safe first task only writes Markdown text."
        }]
      };
    }
    existing = buffer.toString("utf8");
  }

  const section = [
    "<!-- coding-yuan-external-pilot:start -->",
    "## Codingape Pilot Note",
    "",
    "This project has been tested with the Codingape Office pilot safety loop: Evidence Pack first, then Patch Proposal and Diff Preview, then Verification, with Apply Approved Patch allowed only after Human Gate.",
    "",
    "- A rollback snapshot is created before writes.",
    "- Every target file must stay inside the authorized project root.",
    "- Project files are not modified before user approval.",
    "",
    "<!-- coding-yuan-external-pilot:end -->",
    ""
  ].join("\n");
  const content = targetExisted
    ? `${existing.replace(/\s*$/, "\n\n")}${section}`
    : `# Codingape External Pilot\n\n${section}`;

  return {
    ok: true,
    targetFile,
    targetExisted,
    patchCandidates: [targetFile],
    patchDrafts: [{
      file: targetFile,
      content
    }]
  };
}

function normalizeCodingLoopMode(value = "") {
  return ["review_only", "proposal", "verify", "sandbox_patch"].includes(value) ? value : "sandbox_patch";
}

function optionalCodingLoopMode(value = "") {
  return ["review_only", "proposal", "verify", "sandbox_patch"].includes(value) ? value : "";
}

function codingLoopModeLabel(mode) {
  const labels = {
    review_only: "只采集证据",
    proposal: "生成方案",
    verify: "审查并验证",
    sandbox_patch: "完整沙盒闭环"
  };
  return labels[mode] || labels.sandbox_patch;
}

function missionEventContext(task, mode) {
  return {
    taskId: task?.id || "",
    mode: normalizeCodingLoopMode(mode),
    source: `mission_${normalizeCodingLoopMode(mode)}`
  };
}

function appendWorkerEvent(event) {
  appendJsonLine(EVENT_LOG_FILE, {
    id: makeId("event"),
    ...event,
    timestamp: event.timestamp || new Date().toISOString()
  });
  broadcastStatusEvent();
}

function appendProjectRootGuardBlockEvent(task, project, guardSummary, evidence = []) {
  if (!guardSummary?.blocked) return;
  appendWorkerEvent({
    workerId: "ops-yuan",
    workerName: eventWorkerName("ops-yuan"),
    projectId: project?.id || task?.projectId || "",
    type: "project_root_guard_blocked",
    title: `Project Root Guard 阻断：${task?.title || task?.id || "unknown task"}`,
    detail: guardSummary.blockers?.[0]?.title || "A target path was blocked outside the selected project root.",
    risk: "high",
    evidence: evidence.filter(Boolean)
  });
}

function appendPatchSynthesisEvent(task) {
  const synthesis = task?.patchSynthesis;
  const blockers = (task?.patchDraftBlockers || []).filter((blocker) =>
    String(blocker?.id || "").startsWith("patch_synthesis")
  );
  if (!synthesis && !blockers.length) return;

  appendWorkerEvent({
    workerId: "coding-yuan",
    workerName: eventWorkerName("coding-yuan"),
    projectId: task.projectId,
    type: synthesis ? "patch_synthesis_ready" : "patch_synthesis_blocked",
    title: synthesis
      ? `Patch synthesis v1 已生成草稿：${task.title}`
      : `Patch synthesis v1 已阻断：${task.title}`,
    detail: synthesis?.targetFile || blockers[0]?.title || "Patch synthesis did not produce a safe draft.",
    risk: synthesis ? "low" : "medium",
    evidence: synthesis?.targetFile ? [synthesis.targetFile] : []
  });
}

function writeEvidenceSummary(summary) {
  if (!summary?.taskId) return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(evidencePathForTask(summary.taskId), JSON.stringify(summary, null, 2), "utf8");
}

const AI_PATCH_SANDBOX_SKIP_PATTERN =
  /(^|\/)(\.git|node_modules|data|dist|build|coverage|\.env(?:\..*)?|private|secrets?|wallets?|keys?|credentials?)(\/|$)|(\.pem|\.key|\.p12|\.certSigningRequest|\.sqlite|\.db)$/i;

function requestedVerificationScriptFromPlan(plan = {}) {
  const command = String(plan?.testCommand || "").trim();
  if (/^npm\s+test(?:\s|$)/i.test(command)) return "test";

  const runMatch = command.match(/^npm\s+run\s+(?:--if-present\s+)?([A-Za-z0-9:_-]+)/i);
  return runMatch?.[1] || "";
}

function copyProjectForAiPatchSandbox(projectPath, sandboxProjectPath) {
  const root = resolve(projectPath);
  cpSync(root, sandboxProjectPath, {
    recursive: true,
    dereference: false,
    filter(source) {
      const relativePath = relative(root, source).replaceAll("\\", "/");
      if (!relativePath) return true;

      const normalized = normalizeRelativeProjectPath(relativePath);
      if (!normalized) return false;
      return !AI_PATCH_SANDBOX_SKIP_PATTERN.test(normalized) && normalized !== "node_modules";
    }
  });

  const nodeModulesPath = join(root, "node_modules");
  const sandboxNodeModulesPath = join(sandboxProjectPath, "node_modules");
  if (existsSync(nodeModulesPath) && !existsSync(sandboxNodeModulesPath)) {
    symlinkSync(nodeModulesPath, sandboxNodeModulesPath, "dir");
  }
}

function runAiPatchDraftVerificationInSandbox({ task, project, drafts = [], plan = {} } = {}) {
  const startedAt = new Date().toISOString();
  const tempRoot = mkdtempSync(join(tmpdir(), "codingyuan-ai-patch-"));
  const sandboxProjectPath = join(tempRoot, "project");

  try {
    copyProjectForAiPatchSandbox(project.path, sandboxProjectPath);

    for (const draft of drafts) {
      const guarded = assertPathInsideProjectRoot(sandboxProjectPath, draft.file);
      if (!guarded.ok) {
        return {
          ok: false,
          status: "blocked",
          startedAt,
          completedAt: new Date().toISOString(),
          script: "",
          command: "",
          output: guarded.blockers?.[0]?.detail || "AI patch draft escaped the sandbox project root."
        };
      }

      mkdirSync(dirname(guarded.absolutePath), { recursive: true });
      writeFileSync(guarded.absolutePath, draft.content, "utf8");
    }

    const selected = findVerificationScript(
      {
        ...project,
        path: sandboxProjectPath,
        packages: (project.packages || []).map((pkg) => ({ ...pkg }))
      },
      requestedVerificationScriptFromPlan(plan)
    );

    if (!selected.ok) {
      return {
        ok: false,
        status: "blocked",
        startedAt,
        completedAt: new Date().toISOString(),
        script: "",
        command: "",
        output: selected.error
      };
    }

    const result = runCapture("npm", ["run", "--if-present", selected.scriptName], selected.cwd, 20000);
    return {
      ok: result.ok,
      status: result.ok ? "passed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      script: selected.scriptName,
      command: result.command,
      output: result.output,
      sandbox: "temporary_project_copy"
    };
  } catch (error) {
    return {
      ok: false,
      status: "blocked",
      startedAt,
      completedAt: new Date().toISOString(),
      script: "",
      command: "",
      output: error?.message || "AI patch sandbox verification failed before tests could run."
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function generateAiPatchWithSandboxVerification({ settings, context, plan, project, task } = {}) {
  let patchResult = await generateAiPatch({
    settings,
    context,
    plan,
    projectPath: project.path
  });
  let retryCount = 0;
  const sandboxVerificationHistory = [];

  if (patchResult.ok) {
    let sandboxVerification = runAiPatchDraftVerificationInSandbox({
      task,
      project,
      drafts: patchResult.drafts,
      plan
    });
    sandboxVerificationHistory.push(sandboxVerification);

    if (sandboxVerification.status === "failed") {
      retryCount = 1;
      patchResult = await generateAiPatch({
        settings,
        context,
        plan,
        projectPath: project.path,
        failureLog: sandboxVerification.output || "Verification failed."
      });

      if (patchResult.ok) {
        sandboxVerification = runAiPatchDraftVerificationInSandbox({
          task,
          project,
          drafts: patchResult.drafts,
          plan
        });
        sandboxVerificationHistory.push(sandboxVerification);
      }
    }

    const latestVerification = sandboxVerificationHistory.at(-1);
    if (patchResult.ok && latestVerification && !latestVerification.ok) {
      patchResult = {
        ...patchResult,
        ok: false,
        status: "blocked",
        blockers: [
          ...(patchResult.blockers || []),
          {
            id: latestVerification.status === "blocked"
              ? "ai_patch_sandbox_verification_blocked"
              : "ai_patch_sandbox_verification_failed",
            title: latestVerification.status === "blocked"
              ? "AI patch sandbox verification was blocked"
              : "AI patch sandbox verification failed after one retry",
            detail: latestVerification.output || "The generated patch did not pass sandbox verification."
          }
        ]
      };
    }
  }

  return {
    patchResult,
    retryCount,
    sandboxVerification: sandboxVerificationHistory.at(-1) || null,
    sandboxVerificationHistory
  };
}

async function maybeGenerateAiPatchForTask(task, project, evidence) {
  const settings = readModelSettings();
  const provider = redactedModelProviderSettings(settings);
  if (provider.providerMode === "demo_only") {
    return {
      task,
      evidence,
      aiPatch: null,
      skipped: true
    };
  }

  const context = buildAiPatchContext({
    projectPath: project.path,
    projectName: project.name,
    task,
    evidence: evidence.summary,
    userFiles: task.patchCandidates || []
  });
  evidence.summary.aiContext = {
    providerMode: provider.providerMode,
    provider: provider.provider,
    model: provider.model,
    sentFiles: context.sentFiles || [],
    skippedFiles: context.skippedFiles || [],
    limits: context.limits || {},
    safetyNotice: provider.safetyNotice
  };
  writeEvidenceSummary(evidence.summary);

  appendWorkerEvent({
    ...missionEventContext(task, normalizeCodingLoopMode(String(task.source || "").replace(/^mission_/, ""))),
    workerId: "coding-yuan",
    workerName: eventWorkerName("coding-yuan"),
    projectId: task.projectId,
    type: "ai_context_ready",
    title: `AI 上下文已最小化：${task.title}`,
    detail: `${context.sentFiles?.length || 0} 个文件片段会发送给 ${provider.provider}；不会默认上传整个项目。`,
    risk: "low",
    evidence: [evidence.evidencePath]
  });

  if (!context.ok) {
    evidence.summary.patchDrafts = [];
    writeEvidenceSummary(evidence.summary);
    const blocked = appendTaskUpdate(task, {
      patchDrafts: [],
      patchCandidates: [],
      risk: "high",
      aiPatch: {
        status: "blocked",
        provider: provider.provider,
        model: provider.model,
        files: [],
        blockers: context.blockers || []
      }
    });
    return {
      task: blocked,
      evidence,
      aiPatch: null,
      skipped: false,
      blockers: context.blockers
    };
  }

  const planResult = await generateAiPlan({ settings, context });
  evidence.summary.aiPlan = planResult.plan
    ? {
        ...planResult.plan,
        status: planResult.status,
        blockers: planResult.blockers || []
      }
    : {
        status: planResult.status,
        blockers: planResult.blockers || []
      };
  writeEvidenceSummary(evidence.summary);

  appendWorkerEvent({
    ...missionEventContext(task, normalizeCodingLoopMode(String(task.source || "").replace(/^mission_/, ""))),
    workerId: planResult.ok ? "judge-yuan" : "ops-yuan",
    workerName: eventWorkerName(planResult.ok ? "judge-yuan" : "ops-yuan"),
    projectId: task.projectId,
    type: planResult.ok ? "ai_plan_ready" : "ai_plan_blocked",
    title: `${planResult.ok ? "AI 修改方案已生成" : "AI 修改方案已阻断"}：${task.title}`,
    detail: planResult.plan?.summary || planResult.blockers?.[0]?.title || "AI plan did not pass policy.",
    risk: planResult.plan?.riskLevel || "medium",
    evidence: [evidence.evidencePath]
  });

  if (!planResult.ok) {
    evidence.summary.patchDrafts = [];
    writeEvidenceSummary(evidence.summary);
    const blocked = appendTaskUpdate(task, {
      patchDrafts: [],
      patchCandidates: [],
      risk: "high",
      aiPatch: {
        status: "blocked",
        provider: provider.provider,
        model: provider.model,
        plan: planResult.plan,
        files: [],
        blockers: planResult.blockers || []
      }
    });
    return {
      task: blocked,
      evidence,
      aiPatch: null,
      skipped: false,
      blockers: planResult.blockers
    };
  }

  const aiPatchGeneration = await generateAiPatchWithSandboxVerification({
    settings,
    context,
    plan: planResult.plan,
    project,
    task
  });
  const patchResult = aiPatchGeneration.patchResult;
  const aiPatch = {
    status: patchResult.status,
    provider: provider.provider,
    model: provider.model,
    summary: patchResult.summary || "",
    plan: planResult.plan,
    files: patchResult.drafts.map((draft) => draft.file),
    unifiedDiffReady: Boolean(patchResult.unifiedDiff),
    blockers: patchResult.blockers || [],
    retryCount: aiPatchGeneration.retryCount,
    sandboxVerification: aiPatchGeneration.sandboxVerification,
    sandboxVerificationHistory: aiPatchGeneration.sandboxVerificationHistory,
    contextSentFiles: context.sentFiles || []
  };
  evidence.summary.aiPatch = aiPatch;
  evidence.summary.patchDrafts = patchResult.drafts.map((draft) => ({
    file: draft.file,
    bytes: draft.bytes
  }));
  writeEvidenceSummary(evidence.summary);

  appendWorkerEvent({
    ...missionEventContext(task, normalizeCodingLoopMode(String(task.source || "").replace(/^mission_/, ""))),
    workerId: patchResult.ok ? "coding-yuan" : "ops-yuan",
    workerName: eventWorkerName(patchResult.ok ? "coding-yuan" : "ops-yuan"),
    projectId: task.projectId,
    type: patchResult.ok ? "ai_patch_ready" : "ai_patch_blocked",
    title: `${patchResult.ok ? "AI patch 已进入沙盒候选" : "AI patch 已阻断"}：${task.title}`,
    detail: patchResult.ok
      ? `${aiPatch.retryCount ? "测试失败，Coding猿 已返工一次。" : ""}这些代码片段会发送给你选择的模型；还没有写入项目。目标：${aiPatch.files.join(", ")}`
      : patchResult.blockers?.[0]?.title || "AI patch did not pass policy.",
    risk: patchResult.ok ? planResult.plan.riskLevel : "high",
    evidence: [evidence.evidencePath]
  });

  if (!patchResult.ok) {
    const blocked = appendTaskUpdate(task, {
      patchDrafts: [],
      patchCandidates: [],
      risk: "high",
      aiPatch
    });
    return {
      task: blocked,
      evidence,
      aiPatch,
      skipped: false,
      blockers: patchResult.blockers
    };
  }

  const updated = appendTaskUpdate(task, {
    patchDrafts: patchResult.drafts,
    patchCandidates: patchResult.drafts.map((draft) => draft.file),
    patchSynthesis: null,
    aiPatch
  });
  evidence.changedFiles = patchResult.drafts.map((draft) => draft.file);
  return {
    task: updated,
    evidence,
    aiPatch,
    skipped: false,
    blockers: []
  };
}

function appendTaskUpdate(task, patch) {
  const updated = {
    ...task,
    ...patch,
    updatedAt: patch.updatedAt || new Date().toISOString()
  };
  appendJsonLine(TASK_LOG_FILE, updated);
  broadcastStatusEvent();
  return updated;
}

function evidenceRelativePath(taskId) {
  return `data/evidence/${taskId}.json`;
}

function proposalRelativePath(taskId) {
  return `data/proposals/${taskId}.json`;
}

function verificationRelativePath(taskId) {
  return `data/verifications/${taskId}.json`;
}

function patchRunRelativePath(taskId) {
  return `data/patch-runs/${taskId}.json`;
}

function patchApplyRelativePath(taskId) {
  return `data/patch-applies/${taskId}/manifest.json`;
}

function patchSandboxRelativePath(taskId) {
  return `data/patch-sandbox/${taskId}/summary.md`;
}

function patchSandboxManifestRelativePath(taskId) {
  return `data/patch-sandbox/${taskId}/manifest.json`;
}

function patchSandboxDiffRelativePath(taskId) {
  return `data/patch-sandbox/${taskId}/diff.patch`;
}

function patchSnapshotRelativePath(taskId) {
  return `data/patch-snapshots/${taskId}/manifest.json`;
}

function rollbackRelativePath(taskId) {
  return `data/rollbacks/${taskId}/manifest.json`;
}

function taskCompanyReportRelativePath(taskId) {
  return `data/task-reports/${taskId}.md`;
}

function supportBundleRelativePath(fileName) {
  return `data/support-bundles/${fileName}`;
}

function evidencePathForTask(taskId) {
  return join(EVIDENCE_DIR, `${taskId}.json`);
}

function proposalPathForTask(taskId) {
  return join(PROPOSAL_DIR, `${taskId}.json`);
}

function verificationPathForTask(taskId) {
  return join(VERIFICATION_DIR, `${taskId}.json`);
}

function patchRunPathForTask(taskId) {
  return join(PATCH_RUN_DIR, `${taskId}.json`);
}

function patchApplyPathForTask(taskId) {
  return join(PATCH_APPLY_DIR, taskId, "manifest.json");
}

function patchSandboxPathForTask(taskId) {
  return join(PATCH_SANDBOX_DIR, taskId, "summary.md");
}

function patchSandboxManifestPathForTask(taskId) {
  return join(PATCH_SANDBOX_DIR, taskId, "manifest.json");
}

function patchSnapshotPathForTask(taskId) {
  return join(PATCH_SNAPSHOT_DIR, taskId, "manifest.json");
}

function rollbackPathForTask(taskId) {
  return join(ROLLBACK_DIR, taskId, "manifest.json");
}

function taskCompanyReportPathForTask(taskId) {
  return join(TASK_REPORT_DIR, `${taskId}.md`);
}

function readEvidencePack(taskId) {
  return readJson(evidencePathForTask(taskId));
}

function readProposalPack(taskId) {
  return readJson(proposalPathForTask(taskId));
}

function readVerificationPack(taskId) {
  return readJson(verificationPathForTask(taskId));
}

function readPatchRunPack(taskId) {
  return readJson(patchRunPathForTask(taskId));
}

function readPatchApplyPack(taskId) {
  return readJson(patchApplyPathForTask(taskId));
}

function readRollbackPack(taskId) {
  return readJson(rollbackPathForTask(taskId));
}

function readTaskCompanyReport(taskId) {
  if (!taskId || !existsSync(taskCompanyReportPathForTask(taskId))) return null;
  return {
    taskId,
    reportPath: taskCompanyReportRelativePath(taskId),
    markdown: readFileSync(taskCompanyReportPathForTask(taskId), "utf8")
  };
}

function readArtifactPacks(directory, dateKey) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => readJson(join(directory, fileName)))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b?.[dateKey] || b?.capturedAt || 0) - Date.parse(a?.[dateKey] || a?.capturedAt || 0));
}

function readEvidencePacks(limit = 80) {
  return readArtifactPacks(EVIDENCE_DIR, "capturedAt").slice(0, limit);
}

function readProposalPacks(limit = 80) {
  return readArtifactPacks(PROPOSAL_DIR, "createdAt").slice(0, limit);
}

function readVerificationPacks(limit = 80) {
  return readArtifactPacks(VERIFICATION_DIR, "completedAt").slice(0, limit);
}

function readPatchRunPacks(limit = 80) {
  return readArtifactPacks(PATCH_RUN_DIR, "completedAt").slice(0, limit);
}

function readPatchApplyPacks(limit = 80) {
  if (!existsSync(PATCH_APPLY_DIR)) return [];

  return readdirSync(PATCH_APPLY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJson(join(PATCH_APPLY_DIR, entry.name, "manifest.json")))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b?.completedAt || 0) - Date.parse(a?.completedAt || 0))
    .slice(0, limit);
}

function readTaskCompanyReports(limit = 80) {
  if (!existsSync(TASK_REPORT_DIR)) return [];

  return readdirSync(TASK_REPORT_DIR)
    .filter((fileName) => fileName.endsWith(".md"))
    .map((fileName) => {
      const taskId = fileName.replace(/\.md$/, "");
      const filePath = taskCompanyReportPathForTask(taskId);
      const stat = statSync(filePath);
      return {
        taskId,
        reportPath: taskCompanyReportRelativePath(taskId),
        generatedAt: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => Date.parse(b.generatedAt || 0) - Date.parse(a.generatedAt || 0))
    .slice(0, limit);
}

function changedFilesFromEvidence(evidence) {
  const output = evidence?.commands?.find((result) => result.command === "git diff --name-only")?.output || "";
  const diffFiles = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const scopedCandidates = Array.isArray(evidence?.patchCandidates)
    ? evidence.patchCandidates.map((line) => String(line || "").trim()).filter(Boolean)
    : [];
  const draftFiles = Array.isArray(evidence?.patchDrafts)
    ? evidence.patchDrafts.map((draft) => String(draft?.file || "").trim()).filter(Boolean)
    : [];
  return scopedCandidates.length
    ? [...new Set(scopedCandidates)]
    : draftFiles.length
      ? [...new Set(draftFiles)]
      : [...new Set(diffFiles)];
}

function statusLinesFromEvidence(evidence) {
  const output = evidence?.commands?.find((result) => result.command === "git status --short")?.output || "";
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

function diffStatFromEvidence(evidence) {
  return evidence?.commands?.find((result) => result.command === "git diff --stat")?.output || "";
}

function buildPatchProposal(task, evidence) {
  const aiPatchFiles = Array.isArray(evidence?.aiPatch?.files) ? evidence.aiPatch.files : [];
  const changedFiles = aiPatchFiles.length ? aiPatchFiles : changedFilesFromEvidence(evidence);
  const statusLines = statusLinesFromEvidence(evidence);
  const verification = evidence?.recommendedVerification || [];
  const hasChanges = changedFiles.length > 0 || statusLines.length > 0;
  const risk = task.risk === "high" ? "high" : hasChanges ? "medium" : "low";
  const draftCount = Array.isArray(evidence?.patchDrafts) ? evidence.patchDrafts.length : 0;

  const observations = [];
  if (evidence?.aiContext?.sentFiles?.length) {
    observations.push(`AI 上下文最小化：发送 ${evidence.aiContext.sentFiles.length} 个任务相关文件片段，不上传整个项目`);
  }
  if (evidence?.aiPlan?.summary) {
    observations.push(`AI 修改方案：${evidence.aiPlan.summary}`);
  }
  if (evidence?.aiPatch?.files?.length) {
    observations.push(`AI Patch Generator v1 已生成沙盒候选：${evidence.aiPatch.files.join(", ")}`);
  }
  observations.push(
    hasChanges
      ? `发现 ${changedFiles.length || statusLines.length} 个本地变更信号`
      : "没有发现本地差异信号"
  );
  if (verification.length) {
    observations.push(`可用验证脚本：${verification.slice(0, 4).join(", ")}`);
  } else {
    observations.push("没有检测到明显的验证脚本");
  }
  if (draftCount) {
    observations.push(`${draftCount} 个沙盒补丁草稿已准备好进入差异预览`);
  }
  if (evidence?.patchSynthesis?.targetFile) {
    observations.push(`Patch synthesis v1 已生成目标草稿：${evidence.patchSynthesis.targetFile}`);
  }
  if (task.risk === "high") {
    observations.push("写入、部署、交易、重启或外部副作用前仍必须经过人工闸门");
  }

  const recommendedSteps = hasChanges
    ? [
        "检查变更文件，把本次任务改动和无关工作区噪音分开",
        "为选中的项目和任务创建最小补丁",
        verification.length
          ? `运行允许的验证脚本：${verification.slice(0, 2).join(", ")}`
          : "完成前先补充或运行最小可用验证",
        "把证据输出和变更文件摘要附到任务轨迹"
      ]
    : [
        "要求更具体的目标，或创建新的实现任务",
        "生成补丁前先确定最小文件范围",
        "出现代码变更后再次运行证据采集"
      ];

  const gatedActions = [
    "文件写入",
    "依赖安装",
    "部署或重启",
    "交易、钱包或资金动作",
    "联网生产操作"
  ];

  return {
    id: makeId("proposal"),
    taskId: task.id,
    workerId: task.workerId,
    projectId: task.projectId,
    projectName: task.projectName,
    title: `补丁方案：${task.projectName || task.title}`,
    risk,
    createdAt: new Date().toISOString(),
    evidencePath: evidenceRelativePath(task.id),
    proposalPath: proposalRelativePath(task.id),
    summary: hasChanges
      ? "编程猿现在可以从证据采集进入人工复核的补丁方案。"
      : "编程猿已经拿到证据，但暂时没有本地差异；下一步应澄清目标或创建新的实现任务。",
    observations,
    changedFiles: changedFiles.slice(0, 12),
    diffStat: diffStatFromEvidence(evidence).slice(0, 3000),
    patchSynthesis: evidence?.patchSynthesis || null,
    aiPlan: evidence?.aiPlan || null,
    aiPatch: evidence?.aiPatch
      ? {
          status: evidence.aiPatch.status,
          provider: evidence.aiPatch.provider,
          model: evidence.aiPatch.model,
          summary: evidence.aiPatch.summary,
          files: evidence.aiPatch.files || [],
          unifiedDiffReady: Boolean(evidence.aiPatch.unifiedDiffReady),
          retryCount: evidence.aiPatch.retryCount || 0,
          contextSentFiles: evidence.aiPatch.contextSentFiles || [],
          blockers: evidence.aiPatch.blockers || []
        }
      : null,
    recommendedSteps,
    recommendedVerification: verification.slice(0, 6),
    gatedActions,
    note: "这只是方案产物，不会修改文件，也不会执行项目脚本。"
  };
}

async function enrichPatchProposalWithLocalJudge(task, evidence, proposal) {
  const judgeReview = await requestLocalJudgeReview({ task, evidence, proposal });
  const status = judgeReview.ok ? "ready" : judgeReview.skipped ? "skipped" : "failed";

  return {
    ...proposal,
    localJudgeReviewStatus: status,
    localJudgeReview: {
      provider: judgeReview.provider,
      model: judgeReview.model,
      ok: judgeReview.ok,
      skipped: judgeReview.skipped,
      error: judgeReview.error || "",
      review: judgeReview.review || null,
      note: judgeReview.ok
        ? "本地模型审查只作为 Judge猿 的旁路意见，不会自动修改项目文件。"
        : "本地模型未接入或审查失败，系统继续使用规则审查与人工闸门。"
    }
  };
}

function captureTaskEvidence(task, project) {
  const cwd = project?.path || WORKSPACE_ROOT;
  const packages = project?.packages || [];
  const scripts = scriptNames(packages);
  const safeCommands = [
    ["git", ["status", "--short"]],
    ["git", ["diff", "--stat"]],
    ["git", ["diff", "--name-only"]]
  ];
  const commandResults = safeCommands.map(([command, args]) => runCapture(command, args, cwd));
  const verificationScripts = scripts.filter((script) => /test|check|lint|type|verify|qa/i.test(script));
  const now = new Date().toISOString();
  const summary = {
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.projectId,
    projectName: task.projectName,
    workerId: task.workerId,
    capturedAt: now,
    readOnly: true,
    commands: commandResults,
    packageScripts: scripts,
    patchCandidates: Array.isArray(task.patchCandidates) ? task.patchCandidates.slice(0, 6) : [],
    patchDrafts: Array.isArray(task.patchDrafts)
      ? task.patchDrafts.map((draft) => ({
          file: draft.file,
          bytes: draft.bytes
        })).slice(0, 6)
      : [],
    patchSynthesis: task.patchSynthesis || null,
    recommendedVerification: verificationScripts.slice(0, 6),
    note: "证据采集器只采集只读信号，没有执行部署、交易、重启、安装或写入命令。"
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidenceFile = join(EVIDENCE_DIR, `${task.id}.json`);
  writeFileSync(evidenceFile, JSON.stringify(summary, null, 2), "utf8");

  const candidateFiles = Array.isArray(task.patchCandidates)
    ? task.patchCandidates.map((candidate) => String(candidate || "").trim()).filter(Boolean)
    : [];
  const diffChangedFiles = commandResults.find((result) => result.command === "git diff --name-only")?.output
    .split("\n")
    .filter(Boolean)
    .slice(0, 8) || [];
  const changedFiles = candidateFiles.length ? candidateFiles.slice(0, 8) : diffChangedFiles;

  return {
    summary,
    changedFiles,
    evidencePath: evidenceRelativePath(task.id),
    commandCount: commandResults.length,
    verificationScripts
  };
}

function scriptIsVerification(scriptName) {
  return /(?:^|:)(test|check|lint|typecheck|type|verify|qa)(?::|$)/i.test(scriptName);
}

function scriptIsSafeToRun(command = "") {
  const text = String(command).toLowerCase();
  return !/(deploy|restart|shutdown|reboot|ssh|scp|rsync|curl|wget|nc |netcat|rm\s+-rf|sudo|chmod\s+777|chown|wallet|private[_-]?key|trade|trader|buy|sell|funds|settle|settlement|transfer|withdraw|npm\s+install|pnpm\s+install|yarn\s+install|bun\s+install|git\s+push|gh\s+release|prisma\s+migrate|drizzle-kit\s+migrate|wrangler\s+deploy|vercel\s+deploy|netlify\s+deploy|docker\s+push|kubectl|terraform\s+apply)/i.test(text);
}

function findVerificationScript(project, requestedScript = "") {
  const packages = project?.packages || [];
  const candidates = [];

  for (const pkg of packages) {
    for (const [scriptName, command] of Object.entries(pkg.scripts || {})) {
      if (!scriptIsVerification(scriptName)) continue;
      candidates.push({
        scriptName,
        command: String(command || ""),
        packagePath: pkg.path || "package.json",
        cwd: join(project.path, dirname(pkg.path || "package.json"))
      });
    }
  }

  const requested = requestedScript.trim();
  const selected = requested
    ? candidates.find((candidate) => candidate.scriptName === requested)
    : candidates[0];

  if (!selected) {
    return {
      ok: false,
      error: requested ? `Verification script not found or not allowed: ${requested}` : "No safe verification script found"
    };
  }

  if (!scriptIsSafeToRun(selected.command)) {
    return {
      ok: false,
      error: `Verification script is blocked by safety policy: ${selected.scriptName}`
    };
  }

  return { ok: true, ...selected };
}

function captureVerificationEvidence(task, project, requestedScript = "") {
  const selected = findVerificationScript(project, requestedScript);
  const now = new Date().toISOString();

  if (!selected.ok) {
    return {
      ok: false,
      status: "blocked",
      summary: {
        taskId: task.id,
        projectId: task.projectId,
        projectName: task.projectName,
        workerId: task.workerId,
        status: "blocked",
        startedAt: now,
        completedAt: now,
        result: {
          ok: false,
          command: "",
          output: selected.error
        },
        note: "Verification did not run because no safe allowlisted script was available."
      }
    };
  }

  const startedAt = new Date().toISOString();
  const args = ["run", "--if-present", selected.scriptName];
  const result = runCapture("npm", args, selected.cwd, 20000);
  const completedAt = new Date().toISOString();
  const summary = {
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.projectId,
    projectName: task.projectName,
    workerId: task.workerId,
    startedAt,
    completedAt,
    packagePath: selected.packagePath,
    script: selected.scriptName,
    scriptCommand: selected.command,
    command: result.command,
    safetyPolicy: "Only allowlisted verification scripts run; deploy/restart/network/trading/wallet/migration commands are blocked.",
    result,
    note: result.ok
      ? "Verification completed and was attached as evidence."
      : "Verification ran but did not pass. Keep autonomy human-gated until this is resolved."
  };

  mkdirSync(VERIFICATION_DIR, { recursive: true });
  writeFileSync(verificationPathForTask(task.id), JSON.stringify(summary, null, 2), "utf8");

  return {
    ok: result.ok,
    status: result.ok ? "passed" : "failed",
    verificationPath: verificationRelativePath(task.id),
    summary
  };
}

function captureFirstOrderVerificationEvidence(task, project, firstOrder) {
  const startedAt = new Date().toISOString();
  const commands = [
    runCapture("git", ["--version"], project.path),
    runCapture("node", ["--version"], project.path),
    runCapture("npm", ["--version"], project.path)
  ];
  const targetGuard = assertPathInsideProjectRoot(project.path, firstOrder?.targetFile || "README.md");
  const completedAt = new Date().toISOString();
  const ok = commands.every((result) => result.ok) && targetGuard.ok;
  const output = [
    ...commands.map((result) => `${result.command}: ${result.ok ? "ok" : "failed"}${result.output ? `\n${result.output}` : ""}`),
    `project-root-guard: ${targetGuard.ok ? "ok" : "blocked"} ${targetGuard.relativePath || firstOrder?.targetFile || ""}`
  ].join("\n\n");
  const summary = {
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.projectId,
    projectName: task.projectName,
    workerId: task.workerId,
    startedAt,
    completedAt,
    packagePath: "",
    script: "coding-yuan-first-order-self-check",
    scriptCommand: "git --version && node --version && npm --version && project-root-guard",
    command: "first-order-safe-self-check",
    safetyPolicy: "The first-order verification only checks local tools and project-root guard; it does not deploy, install, restart, or write project files.",
    result: {
      ok,
      command: "first-order-safe-self-check",
      output
    },
    targetFile: firstOrder?.targetFile || "",
    note: ok
      ? "First-order verification completed and was attached as evidence."
      : "First-order verification failed. Keep the task human-gated until the runtime or project-root issue is resolved."
  };

  mkdirSync(VERIFICATION_DIR, { recursive: true });
  writeFileSync(verificationPathForTask(task.id), JSON.stringify(summary, null, 2), "utf8");

  return {
    ok,
    status: ok ? "passed" : "failed",
    verificationPath: verificationRelativePath(task.id),
    summary
  };
}

function patchCandidateFiles(project, proposal, evidence) {
  const rawFiles = proposal?.changedFiles?.length
    ? proposal.changedFiles
    : changedFilesFromEvidence(evidence);
  const outOfScope = [];
  const scoped = [];
  const folderPrefix = project?.folder ? `${project.folder}/` : "";

  for (const filePath of rawFiles) {
    const value = String(filePath || "").replaceAll("\\", "/").trim();
    if (!value) continue;

    if (folderPrefix && value.startsWith(folderPrefix)) {
      scoped.push(value.slice(folderPrefix.length));
      continue;
    }

    if (project?.path && existsSync(join(project.path, value))) {
      scoped.push(value);
      continue;
    }

    if (value.includes("/")) {
      outOfScope.push(value);
      continue;
    }

    scoped.push(value);
  }

  return {
    scoped: [...new Set(scoped)],
    outOfScope: [...new Set(outOfScope)]
  };
}

function buildPatchRunPreview(task, proposal, preflight) {
  const files = preflight.allowedFiles.length ? preflight.allowedFiles : ["<no allowed file>"];
  const drafts = Array.isArray(task.patchDrafts) && task.patchDrafts.length
    ? task.patchDrafts.map((draft) => `- ${draft.file} (${draft.bytes} bytes proposed)`)
    : ["- No patch draft supplied; sandbox will contain policy artifacts only."];
  return [
    `# Controlled Patch Preview: ${task.title}`,
    "",
    `Task: ${task.id}`,
    `Project: ${task.projectName || task.projectId}`,
    `Mode: ${preflight.mode}`,
    `Status: ${preflight.status}`,
    "",
    "## Candidate Files",
    ...files.map((file) => `- ${file}`),
    "",
    "## Draft Package",
    ...drafts,
    "",
    "## Proposal Summary",
    proposal?.summary || "No proposal summary captured.",
    "",
    "## Safety Boundary",
    "- This runner does not deploy, restart, install dependencies, or perform networked production operations.",
    "- This phase writes patch-run evidence, rollback snapshots, and optional sandbox artifacts only.",
    "- Project code application remains gated behind allowlists, rollback, tests, and human approval."
  ].join("\n");
}

function capturePatchRunEvidence(task, project, options = {}) {
  const evidence = readEvidencePack(task.id);
  const proposal = readProposalPack(task.id);
  const verification = readVerificationPack(task.id);
  const humanGate = buildHumanGateSummary(task);
  const candidates = patchCandidateFiles(project, proposal, evidence);
  const startedAt = new Date().toISOString();
  const env = options.env || process.env;
  const preflight = classifyPatchRunPreflight({
    task,
    proposal,
    verification,
    humanGate,
    changedFiles: candidates.scoped,
    env
  });

  if (candidates.outOfScope.length) {
    preflight.ok = false;
    preflight.status = "blocked";
    preflight.blockers.push({
      id: "out_of_scope_files",
      title: "Changed files are outside the selected project",
      detail: candidates.outOfScope.slice(0, 5).join(", ")
    });
  }

  let rollbackSnapshot = {
    ok: false,
    manifestPath: "",
    files: [],
    blockers: []
  };

  if (preflight.ok) {
    rollbackSnapshot = createRollbackSnapshot({
      taskId: task.id,
      projectPath: project.path,
      files: preflight.allowedFiles,
      snapshotRoot: PATCH_SNAPSHOT_DIR
    });

    if (!rollbackSnapshot.ok) {
      preflight.ok = false;
      preflight.status = "blocked";
      preflight.blockers.push(...rollbackSnapshot.blockers);
    }
  }

  const preview = buildPatchRunPreview(task, proposal, preflight);
  let sandboxPath = "";
  let sandboxPackage = {
    ok: true,
    manifestPath: "",
    diffPath: "",
    summaryPath: "",
    files: [],
    blockers: [],
    diffPreview: ""
  };
  if (preflight.ok && preflight.mode === "sandbox") {
    sandboxPackage = createSandboxPatchPackage({
      taskId: task.id,
      projectPath: project.path,
      allowedFiles: preflight.allowedFiles,
      patchDrafts: task.patchDrafts || [],
      sandboxRoot: PATCH_SANDBOX_DIR,
      summaryMarkdown: preview
    });

    if (!sandboxPackage.ok) {
      preflight.ok = false;
      preflight.status = "blocked";
      preflight.blockers.push(...sandboxPackage.blockers);
    } else {
      sandboxPath = sandboxPackage.summaryPath || patchSandboxRelativePath(task.id);
    }
  }

  const completedAt = new Date().toISOString();
  const status = preflight.ok
    ? preflight.mode === "sandbox"
      ? "sandbox_written"
      : "dry_run"
    : "blocked";
  const summary = {
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.projectId,
    projectName: task.projectName,
    workerId: task.workerId,
    startedAt,
    completedAt,
    status,
    mode: preflight.mode,
    patchRunPath: patchRunRelativePath(task.id),
    sandboxPath,
    sandboxManifestPath: sandboxPackage.manifestPath || (preflight.mode === "sandbox" && preflight.ok ? patchSandboxManifestRelativePath(task.id) : ""),
    diffPath: sandboxPackage.diffPath || "",
    sandboxFiles: sandboxPackage.files || [],
    diffPreview: sandboxPackage.diffPreview || "",
    draftsAppliedToSandbox: (sandboxPackage.files || []).filter((file) => file.changed).length,
    rollbackSnapshotPath: rollbackSnapshot.manifestPath || (preflight.ok ? patchSnapshotRelativePath(task.id) : ""),
    rollbackFiles: rollbackSnapshot.files || [],
    allowedFiles: preflight.allowedFiles,
    blockedFiles: preflight.blockedFiles,
    outOfScopeFiles: candidates.outOfScope,
    blockers: preflight.blockers,
    projectRootGuard: summarizeProjectRootGuard(preflight.blockers),
    preview,
    note: status === "blocked"
      ? "补丁执行器没有写入项目代码，因为一个或多个安全闸门未通过。"
      : status === "sandbox_written"
        ? "补丁执行器只写入沙盒补丁产物，没有修改项目代码。"
        : "补丁执行器完成了干跑证据检查，没有修改项目代码。"
  };

  mkdirSync(PATCH_RUN_DIR, { recursive: true });
  writeFileSync(patchRunPathForTask(task.id), JSON.stringify(summary, null, 2), "utf8");

  return {
    ok: status !== "blocked",
    status,
    patchRunPath: patchRunRelativePath(task.id),
    summary
  };
}

function captureApplyProposalEvidence(task, project, body = {}, options = {}) {
  const patchRun = readPatchRunPack(task.id);
  const verification = readVerificationPack(task.id);
  const humanGate = buildHumanGateSummary(task);
  const sandboxManifest = readJson(patchSandboxManifestPathForTask(task.id));
  const rollbackManifest = readJson(patchSnapshotPathForTask(task.id));
  const applyGate = evaluateApplyGateV1({
    patchRun,
    verification,
    humanGate,
    projectPath: project.path,
    sandboxManifest,
    rollbackManifest
  });
  const startedAt = new Date().toISOString();
  const env = body.localWriteEnabled
    ? { ...(options.env || process.env), CODEX_OFFICE_ENABLE_APPLY_RUNNER: "true" }
    : options.env || process.env;

  let applyRun = {
    ok: false,
    status: "blocked",
    summary: {
      taskId: task.id,
      startedAt,
      completedAt: startedAt,
      status: "blocked",
      requiredConfirmation: `APPLY ${task.id}`,
      applyRunnerEnabled: env.CODEX_OFFICE_ENABLE_APPLY_RUNNER === "true",
      localWriteSwitchEnabled: Boolean(body.localWriteEnabled),
      sandboxManifestPath: "",
      rollbackSnapshotPath: "",
      applyPath: patchApplyRelativePath(task.id),
      applyReportPath: patchApplyRelativePath(task.id),
      appliedFiles: [],
      candidateFiles: [],
      blockers: applyGate.blockers.length
        ? applyGate.blockers
        : [
            {
              id: "patch_run_missing",
              title: "缺少补丁运行证据",
              detail: "检查写入闸门前，必须先生成成功的沙盒补丁包。"
            }
          ],
      applyGate,
      projectRootGuard: summarizeProjectRootGuard(applyGate.blockers),
      rollbackAvailable: Boolean(rollbackManifest?.ok),
      rollbackOption: {
        available: Boolean(rollbackManifest?.ok),
        rollbackSnapshotPath: patchSnapshotRelativePath(task.id),
        note: rollbackManifest?.ok
          ? "No project writes happened; rollback snapshot remains available for operator review."
          : "Rollback is unavailable until a valid snapshot exists."
      },
      applyReport: {
        status: "blocked",
        generatedAt: startedAt,
        appliedFiles: 0,
        rollbackAvailable: Boolean(rollbackManifest?.ok)
      },
      note: "写入执行器没有写入项目代码，因为缺少补丁运行证据。"
    }
  };

  if (applyGate.canApply && patchRun?.status === "sandbox_written" && patchRun?.sandboxManifestPath) {
    applyRun = applySandboxPatchPackage({
      taskId: task.id,
      projectPath: project.path,
      sandboxRoot: PATCH_SANDBOX_DIR,
      snapshotRoot: PATCH_SNAPSHOT_DIR,
      applyRoot: PATCH_APPLY_DIR,
      confirmation: String(body.confirmation || ""),
      env
    });
    applyRun.summary.applyGate = applyGate;
    applyRun.summary.localWriteSwitchEnabled = Boolean(body.localWriteEnabled);
    applyRun.summary.projectRootGuard = summarizeProjectRootGuard([
      ...(applyRun.summary.blockers || []),
      ...applyGate.blockers
    ]);
  } else if (patchRun) {
    applyRun.summary.blockers = applyGate.blockers.length
      ? applyGate.blockers
      : [
          {
            id: "patch_run_not_sandbox",
            title: "补丁运行不是沙盒包",
            detail: "写入闸门需要带清单和回滚快照的成功沙盒补丁包。"
          }
        ];
    applyRun.summary.applyGate = applyGate;
    applyRun.summary.projectRootGuard = summarizeProjectRootGuard(applyRun.summary.blockers);
    applyRun.summary.note = "写入执行器没有写入项目代码，因为 Apply Gate v1 尚未全部满足。";
  }

  mkdirSync(dirname(patchApplyPathForTask(task.id)), { recursive: true });
  writeFileSync(patchApplyPathForTask(task.id), JSON.stringify(applyRun.summary, null, 2), "utf8");

  return {
    ok: applyRun.ok,
    status: applyRun.status,
    applyPath: patchApplyRelativePath(task.id),
    summary: {
      ...applyRun.summary,
      applyPath: patchApplyRelativePath(task.id)
    }
  };
}

function elapsedSeconds(startedAt, endedAt) {
  const elapsedMs = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Number((elapsedMs / 1000).toFixed(3)) : 0;
}

function recordAiWorkerRunLogSafely(payload) {
  void recordAiWorkerRunLog(payload).catch(() => {});
}

function recordEvidenceRunLog(task, project, evidence, completed, startedAt, completedAt) {
  recordAiWorkerRunLogSafely({
    run_id_external: `codex-office:evidence:${task.id}`,
    input: {
      workflow: "task_evidence_capture",
      task_id: task.id,
      title: task.title,
      project_id_external: task.projectId,
      project_name: task.projectName,
      worker_id: task.workerId,
      worker_name: task.workerName,
      risk: task.risk
    },
    output: {
      evidence_path: evidence.evidencePath,
      changed_files: evidence.changedFiles,
      command_results: evidence.summary.commands,
      recommended_verification: evidence.verificationScripts.slice(0, 6),
      completed_status: completed.status
    },
    model: "codex-office-evidence-runner",
    provider: "local",
    tools_used: evidence.summary.commands.map((result) => result.command),
    cost: 0,
    latency: elapsedSeconds(startedAt, completedAt),
    status: "completed",
    metadata: {
      source: "codex_office_adapter",
      source_system: "codex-office",
      workflow_name: "task_evidence_capture",
      task_type: "task_evidence_capture",
      environment: process.env.CODEX_OFFICE_ENV || process.env.NODE_ENV || "development",
      task_id: task.id,
      project_id_external: task.projectId,
      project_folder: project?.folder || "",
      worker_id: task.workerId,
      worker_name: task.workerName,
      risk: task.risk || "low",
      read_only: true,
      token_cost_known: false,
      evidence_path: evidence.evidencePath,
      command_count: evidence.commandCount,
      changed_file_count: evidence.changedFiles.length
    }
  });
}

function recordProposalRunLog(task, evidence, proposal) {
  recordAiWorkerRunLogSafely({
    run_id_external: `codex-office:proposal:${task.id}`,
    input: {
      workflow: "patch_plan_generation",
      task_id: task.id,
      title: task.title,
      evidence_path: evidenceRelativePath(task.id),
      changed_files: changedFilesFromEvidence(evidence).slice(0, 12)
    },
    output: proposal,
    model: "codex-office-patch-planner",
    provider: "local",
    tools_used: ["buildPatchProposal"],
    cost: 0,
    latency: 0,
    status: "completed",
    metadata: {
      source: "codex_office_adapter",
      source_system: "codex-office",
      workflow_name: "patch_plan_generation",
      task_type: "patch_plan_generation",
      environment: process.env.CODEX_OFFICE_ENV || process.env.NODE_ENV || "development",
      task_id: task.id,
      project_id_external: task.projectId,
      worker_id: task.workerId,
      worker_name: task.workerName,
      risk: proposal.risk || task.risk || "low",
      read_only: true,
      advisory_only: true,
      token_cost_known: false,
      evidence_path: proposal.evidencePath,
      proposal_path: proposal.proposalPath,
      changed_file_count: proposal.changedFiles.length
    }
  });
}

function recordVerificationRunLog(task, verification) {
  if (!verification?.summary) return;

  recordAiWorkerRunLogSafely({
    run_id_external: `codex-office:verification:${task.id}:${verification.summary.script || "none"}`,
    input: {
      workflow: "approved_verification",
      task_id: task.id,
      title: task.title,
      project_id_external: task.projectId,
      script: verification.summary.script,
      script_command: verification.summary.scriptCommand
    },
    output: {
      verification_path: verification.verificationPath,
      status: verification.status,
      command: verification.summary.command,
      output: verification.summary.result?.output
    },
    model: "codex-office-verification-runner",
    provider: "local",
    tools_used: verification.summary.command ? [verification.summary.command] : [],
    cost: 0,
    latency: elapsedSeconds(verification.summary.startedAt, verification.summary.completedAt),
    status: verification.ok ? "completed" : "failed",
    metadata: {
      source: "codex_office_adapter",
      source_system: "codex-office",
      workflow_name: "approved_verification",
      task_type: "approved_verification",
      environment: process.env.CODEX_OFFICE_ENV || process.env.NODE_ENV || "development",
      task_id: task.id,
      project_id_external: task.projectId,
      worker_id: task.workerId,
      worker_name: task.workerName,
      script: verification.summary.script || "",
      package_path: verification.summary.packagePath || "",
      token_cost_known: false,
      verification_path: verification.verificationPath || ""
    }
  });
}

function recordHumanGateRunLog(task, decision) {
  if (!task?.id || !decision?.approvalId) return;

  recordAiWorkerRunLogSafely({
    run_id_external: `codex-office:human-gate:${task.id}:${decision.status}`,
    input: {
      workflow: "human_gate_decision",
      task_id: task.id,
      title: task.title,
      project_id_external: task.projectId,
      approval_id: decision.approvalId,
      requested_status: decision.status
    },
    output: {
      approval_id: decision.approvalId,
      status: decision.status,
      note: decision.note,
      decided_at: decision.createdAt,
      evidence: task.evidence || [],
      proposal: task.proposal || "",
      verification: task.verification || ""
    },
    model: "codex-office-human-gate",
    provider: "local",
    tools_used: ["approval_decision_log"],
    cost: 0,
    latency: 0,
    status: decision.status === "approved" || decision.status === "reviewed" ? "completed" : "failed",
    metadata: {
      source: "codex_office_adapter",
      source_system: "codex-office",
      workflow_name: "human_gate_decision",
      task_type: "human_gate_decision",
      environment: process.env.CODEX_OFFICE_ENV || process.env.NODE_ENV || "development",
      task_id: task.id,
      project_id_external: task.projectId,
      worker_id: task.workerId,
      worker_name: task.workerName,
      approval_id: decision.approvalId,
      gate_status: decision.status,
      token_cost_known: false
    }
  });
}

function recordPatchRunLog(task, patchRun) {
  if (!patchRun?.summary) return;

  recordAiWorkerRunLogSafely({
    run_id_external: `codex-office:patch-run:${task.id}:${patchRun.summary.status}`,
    input: {
      workflow: "controlled_patch_runner",
      task_id: task.id,
      title: task.title,
      project_id_external: task.projectId,
      mode: patchRun.summary.mode
    },
    output: {
      patch_run_path: patchRun.patchRunPath,
      status: patchRun.summary.status,
      allowed_files: patchRun.summary.allowedFiles,
      blockers: patchRun.summary.blockers,
      sandbox_path: patchRun.summary.sandboxPath,
      sandbox_manifest_path: patchRun.summary.sandboxManifestPath,
      diff_path: patchRun.summary.diffPath,
      sandbox_files: patchRun.summary.sandboxFiles,
      drafts_applied_to_sandbox: patchRun.summary.draftsAppliedToSandbox,
      rollback_snapshot_path: patchRun.summary.rollbackSnapshotPath,
      rollback_files: patchRun.summary.rollbackFiles,
      note: patchRun.summary.note
    },
    model: "codex-office-controlled-patch-runner",
    provider: "local",
    tools_used: ["patch_runner_preflight", "patch_run_artifact"],
    cost: 0,
    latency: elapsedSeconds(patchRun.summary.startedAt, patchRun.summary.completedAt),
    status: patchRun.ok ? "completed" : "failed",
    metadata: {
      source: "codex_office_adapter",
      source_system: "codex-office",
      workflow_name: "controlled_patch_runner",
      task_type: "controlled_patch_runner",
      environment: process.env.CODEX_OFFICE_ENV || process.env.NODE_ENV || "development",
      task_id: task.id,
      project_id_external: task.projectId,
      worker_id: task.workerId,
      worker_name: task.workerName,
      patch_status: patchRun.summary.status,
      patch_mode: patchRun.summary.mode,
      token_cost_known: false,
      patch_run_path: patchRun.patchRunPath,
      diff_path: patchRun.summary.diffPath || "",
      sandbox_manifest_path: patchRun.summary.sandboxManifestPath || ""
    }
  });
}

function recordApplyRunLog(task, applyRun) {
  if (!applyRun?.summary) return;

  recordAiWorkerRunLogSafely({
    run_id_external: `codex-office:apply-gate:${task.id}:${applyRun.summary.status}`,
    input: {
      workflow: "apply_proposal_gate",
      task_id: task.id,
      title: task.title,
      project_id_external: task.projectId,
      requested_apply: applyRun.summary.status === "applied"
    },
    output: {
      apply_path: applyRun.applyPath,
      status: applyRun.summary.status,
      required_confirmation: applyRun.summary.requiredConfirmation,
      apply_runner_enabled: applyRun.summary.applyRunnerEnabled,
      blockers: applyRun.summary.blockers,
      applied_files: applyRun.summary.appliedFiles,
      candidate_files: applyRun.summary.candidateFiles,
      sandbox_manifest_path: applyRun.summary.sandboxManifestPath,
      rollback_snapshot_path: applyRun.summary.rollbackSnapshotPath,
      note: applyRun.summary.note
    },
    model: "codex-office-apply-gate",
    provider: "local",
    tools_used: ["apply_gate_preflight", "rollback_hash_check", "sandbox_manifest_check"],
    cost: 0,
    latency: elapsedSeconds(applyRun.summary.startedAt, applyRun.summary.completedAt),
    status: applyRun.ok ? "completed" : "failed",
    metadata: {
      source: "codex_office_adapter",
      source_system: "codex-office",
      workflow_name: "apply_proposal_gate",
      task_type: "apply_proposal_gate",
      environment: process.env.CODEX_OFFICE_ENV || process.env.NODE_ENV || "development",
      task_id: task.id,
      project_id_external: task.projectId,
      worker_id: task.workerId,
      worker_name: task.workerName,
      apply_status: applyRun.summary.status,
      apply_runner_enabled: applyRun.summary.applyRunnerEnabled,
      token_cost_known: false,
      apply_path: applyRun.applyPath
    }
  });
}

function normalizeGateStatus(status) {
  if (status === "approved" || status === "reviewed") return "approved";
  if (status === "changes_requested" || status === "rework") return "changes_requested";
  if (status === "held") return "held";
  return "reviewed";
}

function latestDecisionForApproval(approvalId) {
  return latestApprovalDecisions(readApprovalDecisionLog()).get(approvalId) || null;
}

function buildHumanGateSummary(task) {
  if (!task?.id) return null;
  const approvalId = closeLoopApprovalId(task.id);
  const decision = latestDecisionForApproval(approvalId);
  return {
    approvalId,
    status: decision?.status || task.result?.humanGateStatus || "pending",
    label: gateStatusLabel(decision?.status || task.result?.humanGateStatus || "pending"),
    note: decision?.note || task.result?.humanGateNote || "",
    decidedAt: decision?.updatedAt || decision?.createdAt || task.result?.humanGateAt || null
  };
}

async function handleCreateTask(request, response) {
  const body = await readRequestJson(request);
  const projects = discoverProjects();
  const selection = authorizedProjectSelection(projects, body.projectId);
  if (!selection.ok) {
    sendProjectSelectionBlocked(response, selection);
    return;
  }
  body.projectId = selection.project.id;
  const task = createTaskFromBody(body, projects);

  if (!task) {
    sendError(response, 400, "Task title is required");
    return;
  }

  appendJsonLine(TASK_LOG_FILE, task);
  appendWorkerEvent({
    workerId: task.workerId,
    workerName: task.workerName,
    projectId: task.projectId,
    type: `task_${task.status}`,
    title: `${task.status === "blocked" ? "已阻断" : "排队中"}：${task.title}`,
    detail: task.projectName,
    risk: task.risk,
    evidence: task.evidence
  });
  appendPatchSynthesisEvent(task);
  sendJson(response, { ok: true, task });
}

async function handleListLocalProjects(_request, response) {
  const projects = discoverProjects();
  sendJson(response, {
    ok: true,
    localProjects: buildLocalProjectsSnapshot(projects)
  });
}

async function handleNativeFolderPicker(request, response) {
  await readRequestJson(request);
  if (
    !hostAllowsNativeFolderPicker(request.headers.host || "") ||
    request.headers["x-codex-office-local"] !== "native-folder-picker"
  ) {
    sendJson(response, {
      ok: false,
      status: "blocked",
      error: "Native folder picker is only available from localhost."
    }, 403);
    return;
  }

  const result = openMacNativeFolderPicker();
  if (!result.ok) {
    sendJson(response, {
      ok: false,
      status: result.status,
      error: result.error || "Folder picker was cancelled."
    }, result.status === "unsupported" ? 501 : 409);
    return;
  }

  sendJson(response, result);
}

async function handleSaveLocalProject(request, response) {
  const body = await readRequestJson(request);
  const result = upsertLocalProjectRecord(LOCAL_PROJECTS_FILE, {
    path: body.path,
    name: body.name,
    securityScopedBookmark: body.securityScopedBookmark,
    authorizationSource: body.authorizationSource,
    selected: body.selected !== false
  });

  if (!result.ok) {
    sendJson(response, {
      ok: false,
      status: result.status,
      blocker: result.blocker,
      error: result.blocker?.title || "Project root could not be saved"
    }, 400);
    return;
  }

  appendWorkerEvent({
    workerId: "ops-yuan",
    workerName: eventWorkerName("ops-yuan"),
    projectId: result.project.id,
    type: "local_project_selected",
    title: `本地项目已选择：${result.project.name}`,
    detail: result.project.path,
    risk: "low",
    evidence: ["data/local-projects.json"]
  });

  const projects = discoverProjects();
  sendJson(response, {
    ok: true,
    status: result.status,
    project: projects.find((project) => project.id === result.project.id) || result.project,
    localProjects: buildLocalProjectsSnapshot(projects)
  });
}

async function handleSelectLocalProject(request, response) {
  const body = await readRequestJson(request);
  if (body.path) {
    const result = upsertLocalProjectRecord(LOCAL_PROJECTS_FILE, {
      path: body.path,
      name: body.name,
      securityScopedBookmark: body.securityScopedBookmark,
      authorizationSource: body.authorizationSource,
      selected: true
    });
    if (!result.ok) {
      sendJson(response, {
        ok: false,
        status: result.status,
        blocker: result.blocker,
        error: result.blocker?.title || "Project root could not be selected"
      }, 400);
      return;
    }

    appendWorkerEvent({
      workerId: "ops-yuan",
      workerName: eventWorkerName("ops-yuan"),
      projectId: result.project.id,
      type: "local_project_selected",
      title: `本地项目已切换：${result.project.name}`,
      detail: result.project.path,
      risk: "low",
      evidence: ["data/local-projects.json"]
    });

    const projects = discoverProjects();
    sendJson(response, {
      ok: true,
      status: "selected",
      project: projects.find((project) => project.id === result.project.id) || result.project,
      localProjects: buildLocalProjectsSnapshot(projects)
    });
    return;
  }

  const result = selectLocalProjectRecord(LOCAL_PROJECTS_FILE, String(body.projectId || body.id || ""));
  if (!result.ok) {
    sendJson(response, {
      ok: false,
      status: result.status,
      blocker: result.blocker,
      error: result.blocker?.title || "Project root could not be selected"
    }, 404);
    return;
  }

  appendWorkerEvent({
    workerId: "ops-yuan",
    workerName: eventWorkerName("ops-yuan"),
    projectId: result.project.id,
    type: "local_project_selected",
    title: `本地项目已切换：${result.project.name}`,
    detail: result.project.path,
    risk: "low",
    evidence: ["data/local-projects.json"]
  });

  const projects = discoverProjects();
  sendJson(response, {
    ok: true,
    status: result.status,
    project: projects.find((project) => project.id === result.project.id) || result.project,
    localProjects: buildLocalProjectsSnapshot(projects)
  });
}

async function handleRunTask(request, response, taskId) {
  await readRequestJson(request);
  const projects = discoverProjects();
  const tasks = readTaskLog();
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    sendError(response, 404, "Task not found");
    return;
  }

  if (task.status === "running") {
    sendError(response, 409, "Task is already running");
    return;
  }

  const selection = authorizedProjectSelection(projects, task.projectId);
  if (!selection.ok) {
    sendProjectSelectionBlocked(response, selection);
    return;
  }
  const project = selection.project;
  const startedAt = new Date().toISOString();
  appendTaskUpdate(task, { status: "running", startedAt, updatedAt: startedAt });

  const evidence = captureTaskEvidence(task, project);
  const completedAt = new Date().toISOString();
  let completed = appendTaskUpdate(task, {
    status: "completed",
    startedAt,
    completedAt,
    updatedAt: completedAt,
    evidence: [evidence.evidencePath, ...evidence.changedFiles].slice(0, 10),
    result: {
      changedFiles: evidence.changedFiles.length,
      commandCount: evidence.commandCount,
      verificationScripts: evidence.verificationScripts.slice(0, 6)
    }
  });

  appendWorkerEvent({
    workerId: task.workerId,
    workerName: task.workerName,
    projectId: task.projectId,
    type: "task_evidence",
    title: `证据已采集：${task.title}`,
    detail: `${task.projectName || "任务"} · ${evidence.commandCount} 项只读检查`,
    risk: task.risk || "low",
    evidence: [evidence.evidencePath, ...evidence.changedFiles].slice(0, 10)
  });
  recordEvidenceRunLog(task, project, evidence, completed, startedAt, completedAt);

  sendJson(response, { ok: true, task: completed, evidence: evidence.summary });
}

async function handleRunCodingLoop(request, response, projectId) {
  const body = await readRequestJson(request);
  const projects = discoverProjects();
  const selection = authorizedProjectSelection(projects, projectId);

  if (!selection.ok) {
    sendProjectSelectionBlocked(response, selection);
    return;
  }

  const project = selection.project;
  const mode = normalizeCodingLoopMode(body.mode);
  const demoProfile = codingLoopDemoProfile(project, body);
  const firstOrder = body.safeFirstOrder ? safeFirstOrderPatchDraft(project) : null;

  if (firstOrder && !firstOrder.ok) {
    sendJson(response, {
      ok: false,
      status: "blocked",
      error: "Safe demo task could not prepare a project-root guarded README draft.",
      blockers: firstOrder.blockers || []
    }, 409);
    return;
  }

  const task = createTaskFromBody(
    {
      projectId: project.id,
      workerId: "coding-yuan",
      title: body.title || (body.safeFirstOrder ? FIRST_ORDER_TITLE : `Coding猿 close-loop: inspect ${project.name}, capture evidence, and draft review plan`),
      status: "queued",
      risk: body.safeFirstOrder ? "low" : project.risk?.requiresApproval ? "high" : "medium",
      priority: "high",
      source: `mission_${mode}`,
      disablePatchSynthesis: Boolean(firstOrder),
      patchCandidates: firstOrder?.patchCandidates || body.patchCandidates || demoProfile.patchCandidates,
      patchDrafts: firstOrder?.patchDrafts || demoProfile.patchDrafts
    },
    projects
  );

  if (!task) {
    sendError(response, 400, "Task title is required");
    return;
  }

  appendJsonLine(TASK_LOG_FILE, task);
  appendWorkerEvent({
    ...missionEventContext(task, mode),
    workerId: task.workerId,
    workerName: task.workerName,
    projectId: task.projectId,
    type: "task_queued",
    title: `Task queued: ${task.title}`,
    detail: `${task.projectName} · ${codingLoopModeLabel(mode)}`,
    risk: task.risk,
    evidence: []
  });
  appendPatchSynthesisEvent(task);
  await demoPlaybackPause();

  const startedAt = new Date().toISOString();
  appendTaskUpdate(task, { status: "running", startedAt, updatedAt: startedAt });
  await demoPlaybackPause();

  const evidence = captureTaskEvidence(task, project);
  const completedAt = new Date().toISOString();
  const completed = appendTaskUpdate(task, {
    status: "completed",
    startedAt,
    completedAt,
    updatedAt: completedAt,
    evidence: [evidence.evidencePath, ...evidence.changedFiles].slice(0, 10),
    result: {
      changedFiles: evidence.changedFiles.length,
      commandCount: evidence.commandCount,
      verificationScripts: evidence.verificationScripts.slice(0, 6)
    }
  });

  appendWorkerEvent({
    ...missionEventContext(task, mode),
    workerId: task.workerId,
    workerName: task.workerName,
    projectId: task.projectId,
    type: "task_evidence",
    title: `Codingape collected evidence: ${task.title}`,
    detail: `${task.projectName} · ${evidence.commandCount} read-only checks`,
    risk: task.risk,
    evidence: [evidence.evidencePath, ...evidence.changedFiles].slice(0, 10)
  });
  recordEvidenceRunLog(task, project, evidence, completed, startedAt, completedAt);
  await demoPlaybackPause();

  if (!firstOrder && mode !== "review_only") {
    const aiResult = await maybeGenerateAiPatchForTask(completed, project, evidence);
    completed = aiResult.task;
    if (aiResult.blockers?.length) {
      appendProjectRootGuardBlockEvent(completed, project, summarizeProjectRootGuard(aiResult.blockers), [evidence.evidencePath]);
    }
    await demoPlaybackPause();
  }

  if (mode === "review_only") {
    const reported = attachTaskCompanyReport(completed);
    sendJson(response, {
      ok: true,
      mode,
      task: reported.task,
      evidence: evidence.summary,
      proposal: null,
      verification: null,
      patchRun: null,
      applyRun: null,
      taskReport: reported.report,
      launch: buildSnapshot().launch
    });
    return;
  }

  const proposal = await enrichPatchProposalWithLocalJudge(
    completed,
    evidence.summary,
    buildPatchProposal(completed, evidence.summary)
  );
  mkdirSync(PROPOSAL_DIR, { recursive: true });
  writeFileSync(proposalPathForTask(task.id), JSON.stringify(proposal, null, 2), "utf8");

  let finalTask = appendTaskUpdate(completed, {
    proposal: proposal.proposalPath,
    evidence: [...new Set([...(completed.evidence || []), proposal.evidencePath, proposal.proposalPath])].slice(0, 10)
  });

  appendWorkerEvent({
    ...missionEventContext(task, mode),
    workerId: "judge-yuan",
    workerName: eventWorkerName("judge-yuan"),
    projectId: task.projectId,
    type: "judge_review",
    title: `Judgeape review ready: ${task.title}`,
    detail: `${task.projectName} · ${gateRiskLabel(proposal.risk)} patch plan · local model ${proposal.localJudgeReviewStatus === "ready" ? "reviewed" : "not connected"}`,
    risk: proposal.risk,
    evidence: [proposal.proposalPath, proposal.evidencePath]
  });
  recordProposalRunLog(finalTask, evidence.summary, proposal);
  await demoPlaybackPause();

  if (mode === "proposal") {
    const reported = attachTaskCompanyReport(finalTask);
    sendJson(response, {
      ok: true,
      mode,
      task: reported.task,
      evidence: evidence.summary,
      proposal,
      verification: null,
      patchRun: null,
      applyRun: null,
      taskReport: reported.report,
      launch: buildSnapshot().launch
    });
    return;
  }

  let patchRun = null;
  let applyRun = null;
  const verification = body.safeFirstOrder
    ? captureFirstOrderVerificationEvidence(finalTask, project, firstOrder)
    : captureVerificationEvidence(finalTask, project);
  if (verification.status === "blocked") {
    appendWorkerEvent({
      ...missionEventContext(task, mode),
      workerId: "judge-yuan",
      workerName: eventWorkerName("judge-yuan"),
      projectId: task.projectId,
      type: "verification_blocked",
      title: `验证已被闸门拦住：${task.title}`,
      detail: verification.summary.result.output,
      risk: "high",
      evidence: [proposal.proposalPath, proposal.evidencePath]
    });
    await demoPlaybackPause();
  } else {
    finalTask = appendTaskUpdate(finalTask, {
      verification: verification.verificationPath,
      evidence: [...new Set([...(finalTask.evidence || []), verification.verificationPath])].slice(0, 10),
      result: {
        ...(finalTask.result || {}),
        verificationStatus: verification.status,
        verificationScript: verification.summary.script
      }
    });

    appendWorkerEvent({
      ...missionEventContext(task, mode),
      workerId: verification.ok ? task.workerId : "judge-yuan",
      workerName: verification.ok ? task.workerName : eventWorkerName("judge-yuan"),
      projectId: task.projectId,
      type: verification.ok ? "verification_passed" : "verification_failed",
      title: `${verification.ok ? "Verification passed" : "Verification failed"}: ${task.title}`,
      detail: `${task.projectName} · ${verification.summary.script}`,
      risk: verification.ok ? "low" : "medium",
      evidence: [verification.verificationPath, proposal.proposalPath, proposal.evidencePath]
    });
    recordVerificationRunLog(finalTask, verification);
    await demoPlaybackPause();
  }

  if (mode === "verify") {
    const reported = attachTaskCompanyReport(finalTask);
    sendJson(response, {
      ok: true,
      mode,
      task: reported.task,
      evidence: evidence.summary,
      proposal,
      verification: verification.summary,
      patchRun: null,
      applyRun: null,
      taskReport: reported.report,
      launch: buildSnapshot().launch
    });
    return;
  }

  if ((demoProfile.autoCloseLoop || body.safeFirstOrder) && verification.ok) {
    const gateAt = new Date().toISOString();
    const decision = {
      id: makeId("approval_decision"),
      approvalId: closeLoopApprovalId(task.id),
      status: "approved",
      note: body.safeFirstOrder
        ? "First-order approval prepares sandbox diff and rollback only; project apply still requires exact local confirmation."
        : "Operator demo approval covers sandbox patch artifacts only; direct project apply remains blocked.",
      createdAt: gateAt,
      updatedAt: gateAt
    };
    appendJsonLine(APPROVAL_LOG_FILE, decision);
    finalTask = appendTaskUpdate(finalTask, {
      result: {
        ...(finalTask.result || {}),
        humanGateStatus: "approved",
        humanGateLabel: gateStatusLabel("approved"),
        humanGateNote: decision.note,
        humanGateAt: gateAt
      }
    });

    appendWorkerEvent({
      ...missionEventContext(task, mode),
      workerId: "judge-yuan",
      workerName: eventWorkerName("judge-yuan"),
      projectId: task.projectId,
      type: "human_gate_approved",
      title: `${body.safeFirstOrder ? "First-task Human Gate ready" : "Judge approved sandbox preflight"}: ${task.title}`,
      detail: decision.note,
      risk: "low",
      evidence: [...new Set([...(finalTask.evidence || []), finalTask.proposal, finalTask.verification].filter(Boolean))].slice(0, 6)
    });
    recordHumanGateRunLog(finalTask, decision);
    await demoPlaybackPause();

    patchRun = capturePatchRunEvidence(finalTask, project, {
      env: sandboxPatchRunnerEnv(process.env)
    });
    finalTask = appendTaskUpdate(finalTask, {
      patchRun: patchRun.patchRunPath,
      evidence: [...new Set([...(finalTask.evidence || []), patchRun.patchRunPath])].slice(0, 10),
      result: {
        ...(finalTask.result || {}),
        patchRunStatus: patchRun.status,
        patchRunMode: patchRun.summary.mode,
        patchRunPath: patchRun.patchRunPath
      }
    });

    appendWorkerEvent({
      ...missionEventContext(task, mode),
      workerId: patchRun.ok ? "coding-yuan" : "judge-yuan",
      workerName: eventWorkerName(patchRun.ok ? "coding-yuan" : "judge-yuan"),
      projectId: task.projectId,
      type: patchRun.ok ? "patch_run_ready" : "patch_run_blocked",
      title: `${patchRun.ok ? "Sandbox patch package generated" : "Sandbox patch blocked"}: ${task.title}`,
      detail: patchRun.summary.blockers?.[0]?.title || patchRun.summary.note,
      risk: patchRun.ok ? "low" : "high",
      evidence: [patchRun.patchRunPath, finalTask.proposal, finalTask.verification].filter(Boolean)
    });
    appendProjectRootGuardBlockEvent(finalTask, project, patchRun.summary.projectRootGuard, [
      patchRun.patchRunPath,
      finalTask.proposal,
      finalTask.verification
    ]);
    recordPatchRunLog(finalTask, patchRun);
    await demoPlaybackPause();

    applyRun = captureApplyProposalEvidence(finalTask, project, {}, {
      env: sandboxApplyGateEnv(process.env)
    });
    finalTask = appendTaskUpdate(finalTask, {
      applyRun: applyRun.applyPath,
      evidence: [...new Set([...(finalTask.evidence || []), applyRun.applyPath])].slice(0, 10),
      result: {
        ...(finalTask.result || {}),
        applyStatus: applyRun.status,
        applyPath: applyRun.applyPath
      }
    });

    appendWorkerEvent({
      ...missionEventContext(task, mode),
      workerId: "ops-yuan",
      workerName: eventWorkerName("ops-yuan"),
      projectId: task.projectId,
      type: "apply_gate_pending",
      title: `Opsape completed Apply Gate check: ${task.title}`,
      detail: applyRun.summary.blockers?.[0]?.title || applyRun.summary.note,
      risk: applyRun.ok ? "low" : "high",
      evidence: [applyRun.applyPath, finalTask.patchRun, finalTask.proposal, finalTask.verification].filter(Boolean)
    });
    appendProjectRootGuardBlockEvent(finalTask, project, applyRun.summary.projectRootGuard, [
      applyRun.applyPath,
      finalTask.patchRun,
      finalTask.proposal,
      finalTask.verification
    ]);
    recordApplyRunLog(finalTask, applyRun);
    await demoPlaybackPause();
  }

  const reported = attachTaskCompanyReport(finalTask);
  sendJson(response, {
    ok: true,
    mode,
    task: reported.task,
    evidence: evidence.summary,
    proposal,
    verification: verification.summary,
    patchRun: patchRun?.summary || null,
    applyRun: applyRun?.summary || null,
    safeFirstOrder: firstOrder
      ? {
          title: FIRST_ORDER_TITLE,
          targetFile: firstOrder.targetFile,
          targetExisted: firstOrder.targetExisted
        }
      : null,
    taskReport: reported.report,
    launch: buildSnapshot().launch
  });
}

async function handleGetEvidence(_request, response, taskId) {
  const evidence = readEvidencePack(taskId);
  if (!evidence) {
    sendError(response, 404, "Evidence pack not found");
    return;
  }

  const task = readTaskLog().find((candidate) => candidate.id === taskId) || null;
  const proposal = readProposalPack(taskId);
  const verification = readVerificationPack(taskId);
  const patchRun = readPatchRunPack(taskId);
  const applyRun = readPatchApplyPack(taskId);
  const rollback = readRollbackPack(taskId);
  const taskReport = readTaskCompanyReport(taskId);
  sendJson(response, { ok: true, evidence, proposal, verification, patchRun, applyRun, rollback, taskReport, task, humanGate: buildHumanGateSummary(task) });
}

async function handleGetTaskCompanyReport(_request, response, taskId) {
  const task = readTaskLog().find((candidate) => candidate.id === taskId) || null;
  if (!task) {
    sendError(response, 404, "Task not found");
    return;
  }
  const taskReport = readTaskCompanyReport(taskId) || writeTaskCompanyReport(task);
  sendJson(response, {
    ok: true,
    taskReport
  });
}

async function handleRunVerification(request, response, taskId) {
  const body = await readRequestJson(request);
  const projects = discoverProjects();
  const tasks = readTaskLog();
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    sendError(response, 404, "Task not found");
    return;
  }

  const evidence = readEvidencePack(taskId);
  if (!evidence) {
    sendError(response, 404, "Run evidence before verification");
    return;
  }

  const selection = authorizedProjectSelection(projects, task.projectId);
  if (!selection.ok) {
    sendProjectSelectionBlocked(response, selection);
    return;
  }
  const project = selection.project;

  const verification = captureVerificationEvidence(task, project, String(body.script || ""));
  if (verification.status === "blocked") {
    appendWorkerEvent({
      workerId: "judge-yuan",
      workerName: eventWorkerName("judge-yuan"),
      projectId: task.projectId,
      type: "verification_blocked",
      title: `Verification blocked: ${task.title}`,
      detail: verification.summary.result.output,
      risk: "high",
      evidence: [evidenceRelativePath(task.id)]
    });
    sendError(response, 409, verification.summary.result.output);
    return;
  }

  const updated = appendTaskUpdate(task, {
    verification: verification.verificationPath,
    evidence: [...new Set([...(task.evidence || []), evidenceRelativePath(task.id), verification.verificationPath])].slice(0, 10),
    result: {
      ...(task.result || {}),
      verificationStatus: verification.status,
      verificationScript: verification.summary.script
    }
  });

  appendWorkerEvent({
    workerId: verification.ok ? task.workerId : "judge-yuan",
    workerName: verification.ok ? task.workerName : eventWorkerName("judge-yuan"),
    projectId: task.projectId,
    type: verification.ok ? "verification_passed" : "verification_failed",
    title: `${verification.ok ? "Verification passed" : "Verification failed"}: ${task.title}`,
    detail: `${task.projectName || "Worker task"} · ${verification.summary.script}`,
    risk: verification.ok ? "low" : "medium",
    evidence: [verification.verificationPath, evidenceRelativePath(task.id)]
  });
  recordVerificationRunLog(updated, verification);

  sendJson(response, {
    ok: true,
    task: updated,
    evidence,
    verification: verification.summary,
    status: verification.status
  });
}

async function handleDraftProposal(request, response, taskId) {
  await readRequestJson(request);
  const projects = discoverProjects();
  const tasks = readTaskLog();
  const task = tasks.find((candidate) => candidate.id === taskId);
  const evidence = readEvidencePack(taskId);

  if (!task) {
    sendError(response, 404, "Task not found");
    return;
  }

  if (!evidence) {
    sendError(response, 404, "Run evidence before drafting a patch plan");
    return;
  }

  const selection = authorizedProjectSelection(projects, task.projectId);
  if (!selection.ok) {
    sendProjectSelectionBlocked(response, selection);
    return;
  }

  const proposal = await enrichPatchProposalWithLocalJudge(
    task,
    evidence,
    buildPatchProposal(task, evidence)
  );
  mkdirSync(PROPOSAL_DIR, { recursive: true });
  writeFileSync(proposalPathForTask(taskId), JSON.stringify(proposal, null, 2), "utf8");

  const updated = appendTaskUpdate(task, {
    proposal: proposal.proposalPath,
    evidence: [...new Set([...(task.evidence || []), proposal.evidencePath, proposal.proposalPath])].slice(0, 10)
  });

  appendWorkerEvent({
    workerId: task.workerId,
    workerName: task.workerName,
    projectId: task.projectId,
    type: "patch_plan",
    title: `Patch plan drafted: ${task.title}`,
    detail: `${task.projectName || "Worker task"} · ${proposal.risk} risk`,
    risk: proposal.risk,
    evidence: [proposal.proposalPath, proposal.evidencePath]
  });
  recordProposalRunLog(task, evidence, proposal);

  sendJson(response, { ok: true, task: updated, proposal });
}

async function handleTaskHumanGate(request, response, taskId) {
  const body = await readRequestJson(request);
  const projects = discoverProjects();
  const tasks = readTaskLog();
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    sendError(response, 404, "Task not found");
    return;
  }

  if (!task.proposal) {
    sendError(response, 409, "Draft a proposal before requesting human gate approval");
    return;
  }

  const selection = authorizedProjectSelection(projects, task.projectId);
  if (!selection.ok) {
    sendProjectSelectionBlocked(response, selection);
    return;
  }

  const status = normalizeGateStatus(body.status);
  const now = new Date().toISOString();
  const decision = {
    id: makeId("approval_decision"),
    approvalId: closeLoopApprovalId(task.id),
    status,
    note: String(body.note || (status === "approved" ? "Human approved supervised close-loop evidence" : "Human requested rework")).slice(0, 240),
    createdAt: now,
    updatedAt: now
  };

  appendJsonLine(APPROVAL_LOG_FILE, decision);
  const updated = appendTaskUpdate(task, {
    result: {
      ...(task.result || {}),
      humanGateStatus: status,
      humanGateLabel: gateStatusLabel(status),
      humanGateNote: decision.note,
      humanGateAt: now
    }
  });

  appendWorkerEvent({
    workerId: status === "approved" ? task.workerId : "judge-yuan",
    workerName: status === "approved" ? task.workerName : eventWorkerName("judge-yuan"),
    projectId: task.projectId,
    type: status === "approved" ? "human_gate_approved" : "human_gate_rework",
    title: `${gateStatusLabel(status)}: ${task.title}`,
    detail: decision.note,
    risk: status === "approved" ? "low" : "medium",
    evidence: [...new Set([...(task.evidence || []), task.proposal, task.verification].filter(Boolean))].slice(0, 5)
  });
  recordHumanGateRunLog(updated, decision);

  sendJson(response, {
    ok: true,
    task: updated,
    decision,
    humanGate: buildHumanGateSummary(updated),
    launch: buildSnapshot().launch
  });
}

async function handleRunPatch(request, response, taskId) {
  await readRequestJson(request);
  const projects = discoverProjects();
  const tasks = readTaskLog();
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    sendError(response, 404, "Task not found");
    return;
  }

  const selection = authorizedProjectSelection(projects, task.projectId);
  if (!selection.ok) {
    sendProjectSelectionBlocked(response, selection);
    return;
  }
  const project = selection.project;

  const patchRun = capturePatchRunEvidence(task, project);
  const updated = appendTaskUpdate(task, {
    patchRun: patchRun.patchRunPath,
    evidence: [...new Set([...(task.evidence || []), patchRun.patchRunPath])].slice(0, 10),
    result: {
      ...(task.result || {}),
      patchRunStatus: patchRun.status,
      patchRunMode: patchRun.summary.mode,
      patchRunPath: patchRun.patchRunPath
    }
  });

  appendWorkerEvent({
    workerId: patchRun.ok ? task.workerId : "judge-yuan",
    workerName: patchRun.ok ? task.workerName : eventWorkerName("judge-yuan"),
    projectId: task.projectId,
    type: patchRun.ok ? "patch_run_ready" : "patch_run_blocked",
    title: `${patchRun.ok ? "补丁执行器就绪" : "补丁执行器已阻断"}：${task.title}`,
    detail: patchRun.summary.blockers?.[0]?.title || patchRun.summary.note,
    risk: patchRun.ok ? "low" : "high",
    evidence: [patchRun.patchRunPath, task.proposal, task.verification].filter(Boolean)
  });
  appendProjectRootGuardBlockEvent(updated, project, patchRun.summary.projectRootGuard, [
    patchRun.patchRunPath,
    task.proposal,
    task.verification
  ]);
  recordPatchRunLog(updated, patchRun);

  sendJson(response, {
    ok: true,
    task: updated,
    patchRun: patchRun.summary,
    status: patchRun.status,
    launch: buildSnapshot().launch
  });
}

async function handleApplyGate(request, response, taskId) {
  const body = await readRequestJson(request);
  const projects = discoverProjects();
  const tasks = readTaskLog();
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    sendError(response, 404, "Task not found");
    return;
  }

  const selection = authorizedProjectSelection(projects, task.projectId);
  if (!selection.ok) {
    sendProjectSelectionBlocked(response, selection);
    return;
  }

  const applyRun = captureApplyProposalEvidence(task, selection.project, body);
  const updated = appendTaskUpdate(task, {
    applyRun: applyRun.applyPath,
    evidence: [...new Set([...(task.evidence || []), applyRun.applyPath])].slice(0, 10),
    result: {
      ...(task.result || {}),
      applyStatus: applyRun.status,
      applyPath: applyRun.applyPath
    }
  });

  appendWorkerEvent({
    workerId: applyRun.ok ? task.workerId : "judge-yuan",
    workerName: applyRun.ok ? task.workerName : eventWorkerName("judge-yuan"),
    projectId: task.projectId,
    type: applyRun.ok ? "apply_proposal_applied" : "apply_gate_pending",
    title: `${applyRun.ok ? "Proposal applied" : "Apply Gate checked"}: ${task.title}`,
    detail: applyRun.summary.blockers?.[0]?.title || applyRun.summary.note,
    risk: applyRun.ok ? "low" : "high",
    evidence: [applyRun.applyPath, task.patchRun, task.proposal, task.verification].filter(Boolean)
  });
  appendProjectRootGuardBlockEvent(updated, selection.project, applyRun.summary.projectRootGuard, [
    applyRun.applyPath,
    task.patchRun,
    task.proposal,
    task.verification
  ]);
  recordApplyRunLog(updated, applyRun);
  const reported = attachTaskCompanyReport(updated);

  sendJson(response, {
    ok: true,
    task: reported.task,
    applyRun: applyRun.summary,
    taskReport: reported.report,
    status: applyRun.status,
    launch: buildSnapshot().launch
  });
}

async function handleRollbackTask(request, response, taskId) {
  await readRequestJson(request);
  const projects = discoverProjects();
  const tasks = readTaskLog();
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    sendError(response, 404, "Task not found");
    return;
  }

  const selection = authorizedProjectSelection(projects, task.projectId);
  if (!selection.ok) {
    sendProjectSelectionBlocked(response, selection);
    return;
  }

  const rollback = restoreRollbackSnapshot({
    taskId: task.id,
    projectPath: selection.project.path,
    snapshotRoot: PATCH_SNAPSHOT_DIR,
    rollbackRoot: ROLLBACK_DIR
  });
  const updated = appendTaskUpdate(task, {
    rollbackRun: rollback.summary.rollbackReportPath,
    evidence: [...new Set([...(task.evidence || []), rollback.summary.rollbackReportPath])].slice(0, 10),
    result: {
      ...(task.result || {}),
      rollbackStatus: rollback.status,
      rollbackReportPath: rollback.summary.rollbackReportPath
    }
  });

  appendWorkerEvent({
    workerId: "ops-yuan",
    workerName: eventWorkerName("ops-yuan"),
    projectId: task.projectId,
    type: rollback.ok ? "rollback_restored" : "rollback_blocked",
    title: `${rollback.ok ? "Rolled back" : "Rollback blocked"}: ${task.title}`,
    detail: rollback.summary.blockers?.[0]?.title || rollback.summary.note,
    risk: rollback.ok ? "low" : "high",
    evidence: [rollback.summary.rollbackReportPath, rollback.summary.snapshotManifestPath].filter(Boolean)
  });
  appendProjectRootGuardBlockEvent(updated, selection.project, rollback.summary.projectRootGuard, [
    rollback.summary.rollbackReportPath,
    rollback.summary.snapshotManifestPath
  ]);
  const reported = attachTaskCompanyReport(updated);

  sendJson(response, {
    ok: rollback.ok,
    task: reported.task,
    rollback: rollback.summary,
    taskReport: reported.report,
    status: rollback.status,
    launch: buildSnapshot().launch
  });
}

async function handleCreateEvent(request, response) {
  const body = await readRequestJson(request);
  const title = String(body.title || "").trim().slice(0, 180);
  if (!title) {
    sendError(response, 400, "Event title is required");
    return;
  }

  const worker = workerById(body.workerId || "coding-yuan");
  const event = {
    workerId: worker.id,
    workerName: worker.name,
    projectId: body.projectId || "",
    type: body.type || "operator_event",
    title,
    detail: body.detail || "Operator event",
    risk: ["low", "medium", "high"].includes(body.risk) ? body.risk : "low",
    evidence: Array.isArray(body.evidence) ? body.evidence.slice(0, 8) : []
  };

  appendWorkerEvent(event);
  sendJson(response, { ok: true, event });
}

async function handleApprovalDecision(request, response, approvalId) {
  const body = await readRequestJson(request);
  const status = normalizeGateStatus(body.status);
  const now = new Date().toISOString();
  const decision = {
    id: makeId("approval_decision"),
    approvalId,
    status,
    note: String(body.note || "").slice(0, 240),
    createdAt: now,
    updatedAt: now
  };

  appendJsonLine(APPROVAL_LOG_FILE, decision);
  const taskId = taskIdFromCloseLoopApprovalId(approvalId);
  let task = null;
  if (taskId) {
    task = readTaskLog().find((candidate) => candidate.id === taskId) || null;
    if (task) {
      task = appendTaskUpdate(task, {
        result: {
          ...(task.result || {}),
          humanGateStatus: status,
          humanGateLabel: gateStatusLabel(status),
          humanGateNote: decision.note,
          humanGateAt: now
        }
      });
      recordHumanGateRunLog(task, decision);
    }
  }

  appendWorkerEvent({
    workerId: status === "approved" && task ? task.workerId : body.workerId || "judge-yuan",
    workerName: status === "approved" && task ? task.workerName : body.workerName || eventWorkerName(body.workerId || "judge-yuan"),
    projectId: body.projectId || "",
    type: "approval_decision",
    title: `${gateStatusLabel(status)}: ${approvalId}`,
    detail: decision.note || "Human gate updated",
    risk: status === "approved" ? "low" : status === "held" ? "high" : "medium"
  });
  sendJson(response, { ok: true, decision, task, launch: buildSnapshot().launch });
}

const ENTRY_ROUTES = new Set(["/", "/beta", "/beta/", "/demo", "/demo/", "/office", "/office/"]);

function appModeFromEntryPath(pathname = "/") {
  const clean = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (clean === "/beta") return "public_beta";
  if (clean === "/demo") return "public_demo";
  if (clean === "/office") return "local_office";
  return "public_home";
}

function stripHtmlRegion(html, name) {
  return html.replace(new RegExp(`\\s*<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`, "g"), "");
}

function entryHtmlForPath(pathname = "/") {
  const mode = appModeFromEntryPath(pathname);
  let html = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8")
    .replace("<html lang=\"zh-CN\">", `<html lang="zh-CN" data-app-mode="${mode}">`)
    .replace("<body>", `<body data-app-mode="${mode}">`);

  if (mode === "public_home") {
    html = stripHtmlRegion(html, "beta-page");
    html = stripHtmlRegion(html, "demo-banner");
    html = stripHtmlRegion(html, "app-shell");
  } else if (mode === "public_beta") {
    html = stripHtmlRegion(html, "public-home");
    html = stripHtmlRegion(html, "demo-banner");
    html = stripHtmlRegion(html, "app-shell");
  } else if (mode === "public_demo") {
    html = stripHtmlRegion(html, "public-home");
    html = stripHtmlRegion(html, "beta-page");
  } else {
    html = stripHtmlRegion(html, "public-home");
    html = stripHtmlRegion(html, "beta-page");
    html = stripHtmlRegion(html, "demo-banner");
  }

  return html;
}

function serveEntryHtml(request, response, pathname) {
  const html = entryHtmlForPath(pathname);
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(html);
}

function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  if (ENTRY_ROUTES.has(url.pathname)) {
    serveEntryHtml(request, response, url.pathname);
    return;
  }

  const requestedPath = decodeURIComponent(url.pathname);
  const safePath = resolve(PUBLIC_DIR, `.${requestedPath}`);

  if (!safePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (!existsSync(safePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(safePath)] || "application/octet-stream"
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(safePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");

    if (url.pathname === "/api/status" && request.method === "GET") {
      sendJson(response, buildSnapshot());
      return;
    }

    if (url.pathname === "/api/local-judge/status" && request.method === "GET") {
      sendJson(response, await testLocalJudgeConnection());
      return;
    }

    if (url.pathname === "/api/model-provider/settings" && request.method === "GET") {
      await handleGetModelProviderSettings(request, response);
      return;
    }

    if (url.pathname === "/api/model-provider/settings" && request.method === "POST") {
      await handleSaveModelProviderSettings(request, response);
      return;
    }

    if (url.pathname === "/api/model-provider/test" && request.method === "POST") {
      await handleTestModelProvider(request, response);
      return;
    }

    if (url.pathname === "/api/readiness-dossier" && request.method === "GET") {
      await handleReadinessDossier(request, response);
      return;
    }

    if (url.pathname === "/api/operational-readiness" && request.method === "GET") {
      await handleOperationalReadiness(request, response);
      return;
    }

    if (url.pathname === "/api/beta-ops" && request.method === "GET") {
      await handleBetaOps(request, response);
      return;
    }

    if (url.pathname === "/api/aiwc/health-check" && request.method === "GET") {
      await handleAiwcHealthCheck(request, response);
      return;
    }

    if (url.pathname === "/api/pilot/feedback" && request.method === "POST") {
      await handlePilotFeedback(request, response);
      return;
    }

    if (url.pathname === "/api/pilot/metrics" && request.method === "GET") {
      await handlePilotMetrics(request, response);
      return;
    }

    if (url.pathname === "/api/support-bundle" && request.method === "POST") {
      await handleSupportBundle(request, response);
      return;
    }

    if (url.pathname === "/api/support-bundle/open-directory" && request.method === "POST") {
      await handleOpenSupportBundleDirectory(request, response);
      return;
    }

    if (url.pathname === "/api/local-projects" && request.method === "GET") {
      await handleListLocalProjects(request, response);
      return;
    }

    if (url.pathname === "/api/native/folder-picker" && request.method === "POST") {
      await handleNativeFolderPicker(request, response);
      return;
    }

    if (url.pathname === "/api/local-projects" && request.method === "POST") {
      await handleSaveLocalProject(request, response);
      return;
    }

    if (url.pathname === "/api/local-projects/select" && request.method === "POST") {
      await handleSelectLocalProject(request, response);
      return;
    }

    if (url.pathname === "/api/tasks" && request.method === "POST") {
      await handleCreateTask(request, response);
      return;
    }

    const taskRunMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
    if (taskRunMatch && request.method === "POST") {
      await handleRunTask(request, response, decodeURIComponent(taskRunMatch[1]));
      return;
    }

    const projectCodingLoopMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/coding-loop$/);
    if (projectCodingLoopMatch && request.method === "POST") {
      await handleRunCodingLoop(request, response, decodeURIComponent(projectCodingLoopMatch[1]));
      return;
    }

    const projectContextPreviewMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/ai-context-preview$/);
    if (projectContextPreviewMatch && request.method === "POST") {
      await handleAiContextPreview(request, response, decodeURIComponent(projectContextPreviewMatch[1]));
      return;
    }

    const taskEvidenceMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/evidence$/);
    if (taskEvidenceMatch && request.method === "GET") {
      await handleGetEvidence(request, response, decodeURIComponent(taskEvidenceMatch[1]));
      return;
    }

    const taskCompanyReportMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/company-report$/);
    if (taskCompanyReportMatch && request.method === "GET") {
      await handleGetTaskCompanyReport(request, response, decodeURIComponent(taskCompanyReportMatch[1]));
      return;
    }

    const taskVerificationMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/verification$/);
    if (taskVerificationMatch && request.method === "POST") {
      await handleRunVerification(request, response, decodeURIComponent(taskVerificationMatch[1]));
      return;
    }

    const taskHumanGateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/human-gate$/);
    if (taskHumanGateMatch && request.method === "POST") {
      await handleTaskHumanGate(request, response, decodeURIComponent(taskHumanGateMatch[1]));
      return;
    }

    const taskPatchRunMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/patch-run$/);
    if (taskPatchRunMatch && request.method === "POST") {
      await handleRunPatch(request, response, decodeURIComponent(taskPatchRunMatch[1]));
      return;
    }

    const taskApplyGateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/apply-gate$/);
    if (taskApplyGateMatch && request.method === "POST") {
      await handleApplyGate(request, response, decodeURIComponent(taskApplyGateMatch[1]));
      return;
    }

    const taskRollbackMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/rollback$/);
    if (taskRollbackMatch && request.method === "POST") {
      await handleRollbackTask(request, response, decodeURIComponent(taskRollbackMatch[1]));
      return;
    }

    const taskProposalMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/proposal$/);
    if (taskProposalMatch && request.method === "POST") {
      await handleDraftProposal(request, response, decodeURIComponent(taskProposalMatch[1]));
      return;
    }

    if (url.pathname === "/api/worker-events" && request.method === "POST") {
      await handleCreateEvent(request, response);
      return;
    }

    const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
    if (approvalMatch && request.method === "POST") {
      await handleApprovalDecision(request, response, decodeURIComponent(approvalMatch[1]));
      return;
    }

    if (url.pathname === "/events" && request.method === "GET") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive"
      });

      STATUS_STREAM_CLIENTS.add(response);
      writeStatusEvent(response);
      const timer = setInterval(() => {
        try {
          writeStatusEvent(response);
        } catch {
          STATUS_STREAM_CLIENTS.delete(response);
          clearInterval(timer);
        }
      }, 7000);
      request.on("close", () => {
        STATUS_STREAM_CLIENTS.delete(response);
        clearInterval(timer);
      });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendError(response, 405, "Method not allowed");
      return;
    }

    serveStatic(request, response);
  } catch (error) {
    sendError(response, 500, error.message || "Internal server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Codex Office running at http://${HOST}:${PORT}`);
  console.log(`Watching ${WORKSPACE_ROOT}`);
});
