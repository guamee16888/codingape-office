import { analyzeRun } from "./judge.mjs";
import { migrate, openDatabase } from "./db.mjs";
import { dayRange, generateNightlyReport } from "./reports.mjs";
import { deliverReport } from "./report-delivery.mjs";
import { recordJobEvent } from "./job-events.mjs";
import { deliveryTargetsForProject } from "./report-subscriptions.mjs";
import { computeNextRetryAt } from "./retry-policy.mjs";

export function listProjectIdsForNightly(dateString, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const { start, end } = dayRange(dateString);
    return db.prepare(
      `SELECT DISTINCT project_id
       FROM agent_runs
       WHERE created_at >= ? AND created_at < ?
       ORDER BY project_id ASC`
    ).all(start, end).map((row) => row.project_id);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listUnanalyzedRunIds(projectId, dateString, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const { start, end } = dayRange(dateString);
    return db.prepare(
      `SELECT r.id
       FROM agent_runs r
       LEFT JOIN run_judgements j ON j.agent_run_id = r.id
       WHERE r.project_id = ? AND r.created_at >= ? AND r.created_at < ? AND j.id IS NULL
       ORDER BY r.created_at ASC`
    ).all(projectId, start, end).map((row) => row.id);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export async function runNightlyHealthCheck(projectId, dateString, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const runIds = listUnanalyzedRunIds(projectId, dateString, { db, skipMigrate: true });
    const analyzedRunIds = [];
    const failedRunAnalyses = [];

    for (const runId of runIds) {
      try {
        await analyzeRun(runId, {
          db,
          skipMigrate: true,
          judgeClient: options.judgeClient,
          createdAt: options.createdAt,
        });
        analyzedRunIds.push(runId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown analysis error";
        failedRunAnalyses.push({ run_id: runId, error: message });
        recordJobEvent(db, {
          projectId,
          jobType: "nightly_health",
          status: "failed",
          targetType: "agent_run",
          targetId: runId,
          message,
          metadata: { date: dateString },
          nextRetryAt: computeNextRetryAt(1, options.createdAt),
          createdAt: options.createdAt,
        });
      }
    }

    const report = generateNightlyReport(projectId, dateString, {
      db,
      skipMigrate: true,
      createdAt: options.createdAt,
      targetAutonomyLevel: options.targetAutonomyLevel,
    });
    const deliveries = [];

    const deliveryTargets = Array.isArray(options.deliverTo)
      ? options.deliverTo
      : deliveryTargetsForProject(projectId, { db, skipMigrate: true });

    for (const deliveryTarget of deliveryTargets) {
      const delivery = await deliverReport(report.report_id, deliveryTarget, {
        db,
        skipMigrate: true,
        provider: options.deliveryProvider,
        createdAt: options.createdAt,
        attemptedAt: options.createdAt,
        deliveredAt: options.createdAt,
        failedAt: options.createdAt,
      });
      deliveries.push(delivery);
    }

    recordJobEvent(db, {
      projectId,
      jobType: "nightly_health",
      status: failedRunAnalyses.length > 0 ? "partial_success" : "success",
      targetType: "report",
      targetId: report.report_id,
      message: "Nightly health report generated",
      metadata: {
        date: dateString,
        analyzed_count: analyzedRunIds.length,
        failed_analysis_count: failedRunAnalyses.length,
        delivery_count: deliveries.length,
        target_autonomy_level: report.json?.autonomy_certification_roadmaps?.[0]?.target_autonomy_level || options.targetAutonomyLevel || "L2",
      },
      createdAt: options.createdAt,
    });

    return {
      project_id: projectId,
      date: dateString,
      analyzed_run_ids: analyzedRunIds,
      analyzed_count: analyzedRunIds.length,
      failed_run_analyses: failedRunAnalyses,
      failed_analysis_count: failedRunAnalyses.length,
      report_id: report.report_id,
      markdown: report.markdown,
      json: report.json,
      deliveries,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export async function runNightlyHealthChecksForDate(dateString, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const projectIds = options.projectIds || listProjectIdsForNightly(dateString, { db, skipMigrate: true });
    const results = [];

    for (const projectId of projectIds) {
      results.push(await runNightlyHealthCheck(projectId, dateString, {
        db,
        skipMigrate: true,
        judgeClient: options.judgeClient,
        deliveryProvider: options.deliveryProvider,
        deliverTo: options.deliverToByProject?.[projectId] ?? options.deliverTo,
        createdAt: options.createdAt,
        targetAutonomyLevel: options.targetAutonomyLevel,
      }));
    }

    return {
      date: dateString,
      project_count: projectIds.length,
      results,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
