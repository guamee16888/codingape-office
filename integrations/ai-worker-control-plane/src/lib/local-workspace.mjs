import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeRun } from "./judge.mjs";
import { getDefaultDbPath, getProjectRoot, migrate, nowIso, openDatabase } from "./db.mjs";
import { createAgent, createProject } from "./projects.mjs";
import { ingestAgentRun } from "./runs.mjs";
import { heuristicJudgeClient } from "./judge.mjs";

export function getDefaultLocalWorkspacePath() {
  return resolve(getProjectRoot(), ".data/local-workspace.json");
}

function readJsonFile(path) {
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function projectExists(db, projectId) {
  return Boolean(projectId && db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId));
}

function agentExists(db, projectId, agentId) {
  return Boolean(agentId && db.prepare("SELECT id FROM agents WHERE id = ? AND project_id = ?").get(agentId, projectId));
}

function runGit(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function captureGitSnapshot(cwd = process.cwd()) {
  const inside = runGit(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!inside) {
    return {
      is_git_repo: false,
      branch: null,
      changed_file_count: 0,
      changed_files: [],
      status_summary: [],
    };
  }

  const branch = runGit(cwd, ["branch", "--show-current"]) || "detached";
  const statusLines = (runGit(cwd, ["status", "--short"]) || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    is_git_repo: true,
    branch,
    changed_file_count: statusLines.length,
    changed_files: statusLines.slice(0, 80).map((line) => line.replace(/^[MADRCU?! ]+\s+/, "")),
    status_summary: statusLines.slice(0, 80),
  };
}

export function loadLocalWorkspace(options = {}) {
  return readJsonFile(options.configPath || getDefaultLocalWorkspacePath());
}

export function bootstrapLocalWorkspace(options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  const configPath = options.configPath || getDefaultLocalWorkspacePath();

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const existing = loadLocalWorkspace({ configPath });
    if (
      existing &&
      projectExists(db, existing.project_id) &&
      agentExists(db, existing.project_id, existing.agent_id)
    ) {
      return { ...existing, reused: true, db_path: options.dbPath || getDefaultDbPath(), config_path: configPath };
    }

    const createdAt = options.createdAt || nowIso();
    const project = createProject(
      {
        name: options.projectName || "Local AI Worker Control Plane",
        org_name: options.orgName || "Local Operator",
        description: options.projectDescription || "Real local agent runs recorded from this workspace.",
      },
      { db, skipMigrate: true, createdAt }
    );
    const agent = createAgent(
      {
        project_id: project.project_id,
        name: options.agentName || "Codex Local Work Agent",
        description: options.agentDescription || "Records local Codex/client work sessions as auditable agent runs.",
        environment: options.environment || "development",
      },
      { db, skipMigrate: true, createdAt }
    );
    const workspace = {
      project_id: project.project_id,
      agent_id: agent.agent_id,
      org_id: project.org_id,
      ingestion_api_key: project.ingestion_api_key,
      ingestion_api_key_prefix: project.ingestion_api_key_prefix,
      created_at: createdAt,
      purpose: "local_real_data_capture",
      note: "This file is local-only and stored under .data/; do not commit ingestion_api_key.",
    };

    if (options.writeConfig !== false) {
      writeJsonFile(configPath, workspace);
    }

    return { ...workspace, reused: false, db_path: options.dbPath || getDefaultDbPath(), config_path: configPath };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function ensureLocalWorkspace(options = {}) {
  return bootstrapLocalWorkspace(options);
}

export async function recordLocalAgentRun(payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const workspace = ensureLocalWorkspace({
      db,
      skipMigrate: true,
      configPath: options.configPath,
      writeConfig: options.writeConfig,
      projectName: options.projectName,
      orgName: options.orgName,
      agentName: options.agentName,
      createdAt: options.createdAt,
    });
    const cwd = options.cwd || process.cwd();
    const git = captureGitSnapshot(cwd);
    const createdAt = options.createdAt || nowIso();
    const runPayload = {
      project_id: workspace.project_id,
      agent_id: workspace.agent_id,
      run_id_external: payload.run_id_external || `local_${createdAt}`,
      input: payload.input || "Manual local agent work session recorded by the local adapter.",
      output: payload.output || "Local work session recorded. Review generated judgement and report for quality, risk, and cost signals.",
      model: payload.model || "codex-client",
      provider: payload.provider || "openai-codex",
      tools_used: payload.tools_used || ["filesystem", "shell", "tests"],
      cost: Number(payload.cost || 0),
      latency: Number(payload.latency || 0),
      status: payload.status || "completed",
      metadata: {
        task_type: payload.task_type || "codex_engineering",
        source: "local_real_data_adapter",
        cwd,
        git,
        token_cost_known: Boolean(payload.cost && Number(payload.cost) > 0),
        cost_note: payload.cost_note || "Codex client token/cost telemetry is not available to this adapter yet.",
        ...payload.metadata,
      },
    };
    const ingested = ingestAgentRun(runPayload, {
      db,
      skipMigrate: true,
      requireExistingScope: true,
      createdAt,
    });
    const judgement = await analyzeRun(ingested.run_id, {
      db,
      skipMigrate: true,
      judgeClient: options.judgeClient || heuristicJudgeClient,
      createdAt,
    });

    return {
      workspace,
      run_id: ingested.run_id,
      judgement_id: judgement.judgement_id,
      run_payload: runPayload,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
