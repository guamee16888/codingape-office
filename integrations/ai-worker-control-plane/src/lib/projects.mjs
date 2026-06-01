import { createId } from "./ids.mjs";
import { migrate, nowIso, openDatabase, toJson } from "./db.mjs";
import { validateAgentPayload, validateProjectPayload } from "./validation.mjs";
import { createIngestionApiKey } from "./api-keys.mjs";

function ensureOrganization(db, { orgId, orgName, createdAt }) {
  const id = orgId || createId("org");
  const name = orgName || "Default Organization";

  db.prepare(
    `INSERT OR IGNORE INTO organizations (id, name, owner_user_id, plan, created_at)
     VALUES (?, ?, NULL, ?, ?)`
  ).run(id, name, "free", createdAt);

  return id;
}

export function createProject(payload, options = {}) {
  const normalized = validateProjectPayload(payload);
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const createdAt = options.createdAt || nowIso();
    const orgId = ensureOrganization(db, {
      orgId: normalized.org_id,
      orgName: normalized.org_name,
      createdAt,
    });
    const projectId = createId("project");

    db.prepare(
      `INSERT INTO projects (id, org_id, name, description, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(projectId, orgId, normalized.name, normalized.description, createdAt);

    const apiKey = createIngestionApiKey(db, {
      orgId,
      projectId,
      name: "Default ingestion key",
      createdAt,
    });

    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      orgId,
      projectId,
      "system",
      null,
      "project.created",
      "project",
      projectId,
      toJson({ api_key_id: apiKey.api_key_id }),
      createdAt
    );

    return {
      project_id: projectId,
      org_id: orgId,
      ingestion_api_key: apiKey.api_key,
      ingestion_api_key_id: apiKey.api_key_id,
      ingestion_api_key_prefix: apiKey.api_key_prefix,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function createAgent(payload, options = {}) {
  const normalized = validateAgentPayload(payload);
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(normalized.project_id);
    if (!project) {
      throw new Error(`Project not found: ${normalized.project_id}`);
    }

    const agentId = createId("agent");
    const createdAt = options.createdAt || nowIso();

    db.prepare(
      `INSERT INTO agents (id, project_id, name, description, environment, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(agentId, normalized.project_id, normalized.name, normalized.description, normalized.environment, createdAt);

    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      project.org_id,
      normalized.project_id,
      "system",
      null,
      "agent.created",
      "agent",
      agentId,
      toJson({ environment: normalized.environment }),
      createdAt
    );

    return { agent_id: agentId, project_id: normalized.project_id };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

