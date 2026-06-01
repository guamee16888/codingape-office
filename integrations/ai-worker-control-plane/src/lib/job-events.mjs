import { createId } from "./ids.mjs";
import { fromJson, migrate, nowIso, openDatabase, toJson } from "./db.mjs";

export function parseJobEventRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata: fromJson(row.metadata, {}),
  };
}

export function recordJobEvent(db, {
  projectId = null,
  jobType,
  status,
  targetType = null,
  targetId = null,
  message,
  metadata = {},
  retryCount = 0,
  nextRetryAt = null,
  resolvedAt = null,
  createdAt = nowIso(),
}) {
  const eventId = createId("jobevt");

  db.prepare(
    `INSERT INTO job_events (
      id, project_id, job_type, status, target_type, target_id, message, metadata,
      retry_count, next_retry_at, resolved_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    projectId,
    jobType,
    status,
    targetType,
    targetId,
    message,
    toJson(metadata),
    retryCount,
    nextRetryAt,
    resolvedAt,
    createdAt
  );

  return { job_event_id: eventId };
}

export function listProjectJobEvents(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?"];
    const params = [projectId];

    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }

    if (options.jobType) {
      clauses.push("job_type = ?");
      params.push(options.jobType);
    }

    if (options.targetType) {
      clauses.push("target_type = ?");
      params.push(options.targetType);
    }

    if (options.unresolvedOnly) {
      clauses.push("resolved_at IS NULL");
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM job_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parseJobEventRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
