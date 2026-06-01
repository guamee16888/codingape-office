import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createId } from "./ids.mjs";
import { migrate, nowIso, openDatabase } from "./db.mjs";
import { validateApiKeyPayload } from "./validation.mjs";

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function generateIngestionApiKey() {
  return `aiwc_live_${randomBytes(32).toString("base64url")}`;
}

export function hashApiKey(apiKey) {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

export function keyPrefix(apiKey) {
  return apiKey.slice(0, 18);
}

export function createIngestionApiKey(db, { orgId, projectId, name = "Default ingestion key", createdAt = nowIso() }) {
  const apiKey = generateIngestionApiKey();
  const keyId = createId("key");

  db.prepare(
    `INSERT INTO ingestion_api_keys (
      id, org_id, project_id, name, key_hash, key_prefix, last_used_at, revoked_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
  ).run(keyId, orgId, projectId, name, hashApiKey(apiKey), keyPrefix(apiKey), createdAt);

  return {
    api_key_id: keyId,
    api_key: apiKey,
    api_key_prefix: keyPrefix(apiKey),
  };
}

function parseApiKeyRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    name: row.name,
    key_prefix: row.key_prefix,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    status: row.revoked_at ? "revoked" : "active",
  };
}

export function createProjectIngestionApiKey(projectId, payload = {}, options = {}) {
  const normalized = validateApiKeyPayload(payload);
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const createdAt = options.createdAt || nowIso();
    const created = createIngestionApiKey(db, {
      orgId: project.org_id,
      projectId,
      name: normalized.name,
      createdAt,
    });

    return {
      ...created,
      name: normalized.name,
      created_at: createdAt,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectIngestionApiKeys(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    return db.prepare(
      `SELECT id, org_id, project_id, name, key_prefix, last_used_at, revoked_at, created_at
       FROM ingestion_api_keys
       WHERE project_id = ?
       ORDER BY created_at DESC`
    ).all(projectId).map(parseApiKeyRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function getIngestionApiKeyRecord(apiKeyId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const row = db.prepare(
      `SELECT id, org_id, project_id, name, key_prefix, last_used_at, revoked_at, created_at
       FROM ingestion_api_keys
       WHERE id = ?`
    ).get(apiKeyId);
    return parseApiKeyRow(row);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function revokeIngestionApiKey(apiKeyId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const existing = getIngestionApiKeyRecord(apiKeyId, { db, skipMigrate: true });
    if (!existing) {
      throw new Error(`Ingestion API key not found: ${apiKeyId}`);
    }

    const revokedAt = options.revokedAt || nowIso();
    db.prepare("UPDATE ingestion_api_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(revokedAt, apiKeyId);

    return getIngestionApiKeyRecord(apiKeyId, { db, skipMigrate: true });
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

function safeHashEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authenticateIngestionApiKey(projectId, apiKey, options = {}) {
  if (!apiKey) {
    throw new AuthError("Missing ingestion API key", 401);
  }

  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const hash = hashApiKey(apiKey);
    const row = db.prepare(
      `SELECT id, org_id, project_id, key_hash, revoked_at
       FROM ingestion_api_keys
       WHERE project_id = ? AND key_prefix = ?`
    ).get(projectId, keyPrefix(apiKey));

    if (!row || row.revoked_at || !safeHashEquals(row.key_hash, hash)) {
      throw new AuthError("Invalid ingestion API key", 401);
    }

    const usedAt = options.usedAt || nowIso();
    db.prepare("UPDATE ingestion_api_keys SET last_used_at = ? WHERE id = ?").run(usedAt, row.id);

    return {
      api_key_id: row.id,
      org_id: row.org_id,
      project_id: row.project_id,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function readApiKeyFromHeaders(headers) {
  const authorization = headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return headers.get("x-api-key")?.trim() || null;
}

function safeStringEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function signWebhookPayload(apiKey, body, timestamp) {
  return `sha256=${createHmac("sha256", apiKey)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex")}`;
}

function parseWebhookTimestamp(value) {
  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function verifyWebhookSignature({ apiKey, body, headers, now = Date.now(), toleranceSeconds = 300, required = false }) {
  const signature = headers.get("x-aiwc-signature")?.trim() || "";
  const timestamp = headers.get("x-aiwc-timestamp")?.trim() || "";

  if (!signature && !timestamp) {
    if (required) {
      throw new AuthError("Missing webhook signature", 401);
    }

    return {
      verified: false,
      required: false,
      reason: "not_provided",
    };
  }

  if (!signature || !timestamp) {
    throw new AuthError("Incomplete webhook signature", 401);
  }

  const timestampMs = parseWebhookTimestamp(timestamp);
  if (!timestampMs) {
    throw new AuthError("Invalid webhook timestamp", 401);
  }

  const ageSeconds = Math.abs(Number(now) - timestampMs) / 1000;
  if (ageSeconds > toleranceSeconds) {
    throw new AuthError("Webhook signature timestamp outside tolerance", 401);
  }

  const expected = signWebhookPayload(apiKey, body, timestamp);
  if (!safeStringEquals(signature, expected)) {
    throw new AuthError("Invalid webhook signature", 401);
  }

  return {
    verified: true,
    required: Boolean(required),
    timestamp,
    age_seconds: Number(ageSeconds.toFixed(3)),
  };
}
