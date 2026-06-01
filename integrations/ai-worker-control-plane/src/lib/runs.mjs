import { createId } from "./ids.mjs";
import { migrate, nowIso, openDatabase, parseRunRow, toJson } from "./db.mjs";
import { validateRunPayload } from "./validation.mjs";

const DEFAULT_ORG_ID = "org_default";

function valueToStoredText(value) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value ?? null);
}

function ingestionAuditMetadata(normalized, options = {}, extra = {}) {
  return {
    run_id_external: normalized.run_id_external,
    api_key_id: options.authContext?.api_key_id || null,
    signature_verified: Boolean(options.authContext?.signature?.verified),
    signature_required: Boolean(options.authContext?.signature?.required),
    signature_age_seconds: options.authContext?.signature?.age_seconds ?? null,
    ingestion_source: options.authContext?.source || "api",
    ...extra,
  };
}

export function ensureIngestionScope(db, projectId, agentId) {
  const createdAt = nowIso();

  db.prepare(
    `INSERT OR IGNORE INTO organizations (id, name, owner_user_id, plan, created_at)
     VALUES (?, ?, NULL, ?, ?)`
  ).run(DEFAULT_ORG_ID, "Default Organization", "free", createdAt);

  db.prepare(
    `INSERT OR IGNORE INTO projects (id, org_id, name, description, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(projectId, DEFAULT_ORG_ID, projectId, "Auto-created from first run ingestion", createdAt);

  db.prepare(
    `INSERT OR IGNORE INTO agents (id, project_id, name, description, environment, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(agentId, projectId, agentId, "Auto-created from first run ingestion", "production", createdAt);

  return DEFAULT_ORG_ID;
}

export function requireIngestionScope(db, projectId, agentId) {
  const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const agent = db.prepare("SELECT id FROM agents WHERE id = ? AND project_id = ?").get(agentId, projectId);
  if (!agent) {
    throw new Error(`Agent not found for project: ${agentId}`);
  }

  return project.org_id;
}

export function ingestAgentRun(payload, options = {}) {
  const normalized = validateRunPayload(payload);
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const orgId = options.requireExistingScope
      ? requireIngestionScope(db, normalized.project_id, normalized.agent_id)
      : ensureIngestionScope(db, normalized.project_id, normalized.agent_id);
    const runId = createId("run");
    const createdAt = options.createdAt || nowIso();
    const existing = normalized.run_id_external
      ? db.prepare(
        `SELECT id, org_id
         FROM agent_runs
         WHERE project_id = ? AND agent_id = ? AND run_id_external = ?
         LIMIT 1`
      ).get(normalized.project_id, normalized.agent_id, normalized.run_id_external)
      : null;

    if (existing) {
      db.prepare(
        `INSERT INTO audit_events (
          id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        createId("audit"),
        existing.org_id,
        normalized.project_id,
        "system",
        null,
        "agent_run.duplicate_ignored",
        "agent_run",
        existing.id,
        toJson(ingestionAuditMetadata(normalized, options, { deduplicated: true })),
        createdAt
      );

      return { run_id: existing.id, org_id: existing.org_id, deduplicated: true };
    }

    db.prepare(
      `INSERT INTO agent_runs (
        id, agent_id, project_id, org_id, run_id_external, input, output, model,
        provider, tools_used, cost, latency, status, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      runId,
      normalized.agent_id,
      normalized.project_id,
      orgId,
      normalized.run_id_external,
      valueToStoredText(normalized.input),
      valueToStoredText(normalized.output),
      normalized.model,
      normalized.provider,
      toJson(normalized.tools_used),
      normalized.cost,
      normalized.latency,
      normalized.status,
      toJson(normalized.metadata),
      createdAt
    );

    if (normalized.cost > 0 || normalized.metadata.prompt_tokens || normalized.metadata.completion_tokens) {
      const promptTokens = normalized.metadata.prompt_tokens ?? null;
      const completionTokens = normalized.metadata.completion_tokens ?? null;
      const totalTokens = normalized.metadata.total_tokens ?? (
        Number.isFinite(promptTokens) && Number.isFinite(completionTokens) ? promptTokens + completionTokens : null
      );

      db.prepare(
        `INSERT INTO cost_events (
          id, agent_run_id, model, prompt_tokens, completion_tokens, total_tokens, cost, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(createId("cost"), runId, normalized.model, promptTokens, completionTokens, totalTokens, normalized.cost, createdAt);
    }

    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      orgId,
      normalized.project_id,
      "system",
      null,
      "agent_run.ingested",
      "agent_run",
      runId,
      toJson(ingestionAuditMetadata(normalized, options, { deduplicated: false })),
      createdAt
    );

    return { run_id: runId, org_id: orgId, deduplicated: false };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function getAgentRun(runId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const row = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId);
    return parseRunRow(row);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
