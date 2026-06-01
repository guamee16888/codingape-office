import { analyzeRun } from "./judge.mjs";
import { fromJson, migrate, nowIso, openDatabase, toJson } from "./db.mjs";
import { retryReportDelivery, listRetryableReportDeliveries } from "./report-delivery.mjs";
import { DEFAULT_MAX_RETRIES, computeNextRetryAt } from "./retry-policy.mjs";

function parseJobEventRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata: fromJson(row.metadata, {}),
  };
}

export function listRetryableAnalysisJobEvents(options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const now = options.now || nowIso();
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));

    return db.prepare(
      `SELECT * FROM job_events
       WHERE job_type = 'nightly_health'
         AND status = 'failed'
         AND target_type = 'agent_run'
         AND resolved_at IS NULL
         AND retry_count < ?
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?`
    ).all(maxRetries, now, limit).map(parseJobEventRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export async function retryAnalysisJobEvent(eventId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const event = db.prepare("SELECT * FROM job_events WHERE id = ?").get(eventId);
    if (!event) {
      throw new Error(`Job event not found: ${eventId}`);
    }

    if (event.status !== "failed" && !options.force) {
      return parseJobEventRow(event);
    }

    const attemptedAt = options.attemptedAt || nowIso();
    const retryCount = Number(event.retry_count || 0) + 1;

    try {
      await analyzeRun(event.target_id, {
        db,
        skipMigrate: true,
        judgeClient: options.judgeClient,
        createdAt: attemptedAt,
      });

      db.prepare(
        `UPDATE job_events
         SET status = ?, retry_count = ?, next_retry_at = NULL, resolved_at = ?, metadata = ?
         WHERE id = ?`
      ).run(
        "resolved",
        retryCount,
        attemptedAt,
        toJson({ ...fromJson(event.metadata, {}), resolved_by_retry: true }),
        eventId
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown retry error";
      const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
      const exhausted = retryCount >= maxRetries;
      const nextRetryAt = exhausted ? null : (options.nextRetryAt || computeNextRetryAt(retryCount + 1, attemptedAt));

      db.prepare(
        `UPDATE job_events
         SET status = ?, message = ?, retry_count = ?, next_retry_at = ?, resolved_at = ?
         WHERE id = ?`
      ).run(
        exhausted ? "exhausted" : "failed",
        message,
        retryCount,
        nextRetryAt,
        exhausted ? attemptedAt : null,
        eventId
      );
    }

    return parseJobEventRow(db.prepare("SELECT * FROM job_events WHERE id = ?").get(eventId));
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export async function runRetryQueue(options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const now = options.now || nowIso();
    const analysisEvents = listRetryableAnalysisJobEvents({
      db,
      skipMigrate: true,
      now,
      maxRetries: options.maxRetries,
      limit: options.limit,
    });
    const deliveries = listRetryableReportDeliveries({
      db,
      skipMigrate: true,
      now,
      maxRetries: options.maxRetries,
      limit: options.limit,
    });

    const retriedAnalysisEvents = [];
    for (const event of analysisEvents) {
      retriedAnalysisEvents.push(await retryAnalysisJobEvent(event.id, {
        db,
        skipMigrate: true,
        judgeClient: options.judgeClient,
        attemptedAt: options.attemptedAt || now,
        maxRetries: options.maxRetries,
        nextRetryAt: options.nextRetryAt,
      }));
    }

    const retriedDeliveries = [];
    for (const delivery of deliveries) {
      retriedDeliveries.push(await retryReportDelivery(delivery.id, {
        db,
        skipMigrate: true,
        provider: options.deliveryProvider,
        attemptedAt: options.attemptedAt || now,
        deliveredAt: options.deliveredAt || now,
        failedAt: options.failedAt || now,
        maxRetries: options.maxRetries,
        nextRetryAt: options.nextRetryAt,
      }));
    }

    return {
      retried_analysis_count: retriedAnalysisEvents.length,
      retried_delivery_count: retriedDeliveries.length,
      analysis_events: retriedAnalysisEvents,
      deliveries: retriedDeliveries,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

