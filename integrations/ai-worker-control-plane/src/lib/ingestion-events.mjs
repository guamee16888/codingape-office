import { fromJson, migrate, openDatabase } from "./db.mjs";

function parseIngestionEventRow(row) {
  return row ? {
    id: row.id,
    project_id: row.project_id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    created_at: row.created_at,
    metadata: fromJson(row.metadata, {}),
  } : null;
}

export function listProjectIngestionEvents(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = [
      "project_id = ?",
      "action IN ('agent_run.ingested', 'agent_run.duplicate_ignored')",
    ];
    const params = [projectId];

    if (options.action) {
      clauses.push("action = ?");
      params.push(options.action);
    }

    if (options.targetId) {
      clauses.push("target_id = ?");
      params.push(options.targetId);
    }

    if (options.signatureVerified !== undefined) {
      clauses.push("json_extract(metadata, '$.signature_verified') = ?");
      params.push(options.signatureVerified ? 1 : 0);
    }

    if (options.deduplicated !== undefined) {
      clauses.push("json_extract(metadata, '$.deduplicated') = ?");
      params.push(options.deduplicated ? 1 : 0);
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    params.push(limit);

    return db.prepare(
      `SELECT id, project_id, action, target_type, target_id, metadata, created_at
       FROM audit_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parseIngestionEventRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function summarizeProjectIngestionHealth(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = [
      "project_id = ?",
      "action IN ('agent_run.ingested', 'agent_run.duplicate_ignored')",
    ];
    const params = [projectId];

    if (options.from) {
      clauses.push("created_at >= ?");
      params.push(options.from);
    }

    if (options.to) {
      clauses.push("created_at < ?");
      params.push(options.to);
    }

    const where = clauses.join(" AND ");
    const summary = db.prepare(
      `SELECT
         COUNT(*) AS total_events,
         SUM(CASE WHEN action = 'agent_run.ingested' THEN 1 ELSE 0 END) AS accepted_events,
         SUM(CASE WHEN action = 'agent_run.duplicate_ignored' THEN 1 ELSE 0 END) AS duplicate_events,
         SUM(CASE WHEN COALESCE(json_extract(metadata, '$.signature_verified'), 0) = 1 THEN 1 ELSE 0 END) AS signed_events,
         SUM(CASE WHEN COALESCE(json_extract(metadata, '$.signature_verified'), 0) = 0 THEN 1 ELSE 0 END) AS unsigned_events,
         SUM(CASE WHEN json_extract(metadata, '$.signature_required') = 1 THEN 1 ELSE 0 END) AS signature_required_events,
         MAX(created_at) AS last_ingested_at
       FROM audit_events
       WHERE ${where}`
    ).get(...params);

    const keyRows = db.prepare(
      `SELECT
         COALESCE(json_extract(metadata, '$.api_key_id'), 'unknown') AS api_key_id,
         COUNT(*) AS event_count,
         SUM(CASE WHEN action = 'agent_run.duplicate_ignored' THEN 1 ELSE 0 END) AS duplicate_count,
         SUM(CASE WHEN COALESCE(json_extract(metadata, '$.signature_verified'), 0) = 1 THEN 1 ELSE 0 END) AS signed_count
       FROM audit_events
       WHERE ${where}
       GROUP BY COALESCE(json_extract(metadata, '$.api_key_id'), 'unknown')
       ORDER BY event_count DESC, api_key_id ASC
       LIMIT 10`
    ).all(...params).map((row) => ({
      api_key_id: row.api_key_id,
      event_count: Number(row.event_count || 0),
      duplicate_count: Number(row.duplicate_count || 0),
      signed_count: Number(row.signed_count || 0),
    }));

    const totalEvents = Number(summary.total_events || 0);
    const duplicateEvents = Number(summary.duplicate_events || 0);
    const signedEvents = Number(summary.signed_events || 0);
    const acceptedEvents = Number(summary.accepted_events || 0);

    return {
      project_id: projectId,
      period_start: options.from || null,
      period_end: options.to || null,
      total_events: totalEvents,
      accepted_events: acceptedEvents,
      duplicate_events: duplicateEvents,
      signed_events: signedEvents,
      unsigned_events: Number(summary.unsigned_events || 0),
      signature_required_events: Number(summary.signature_required_events || 0),
      signature_coverage_rate: Number((totalEvents ? signedEvents / totalEvents : 0).toFixed(6)),
      duplicate_rate: Number((totalEvents ? duplicateEvents / totalEvents : 0).toFixed(6)),
      last_ingested_at: summary.last_ingested_at || null,
      api_keys: keyRows,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
