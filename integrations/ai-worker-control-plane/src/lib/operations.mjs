import { listProjectJobEvents } from "./job-events.mjs";
import { listProjectReportDeliveries } from "./report-delivery.mjs";

const FAILURE_STATUSES = new Set(["failed", "exhausted"]);

function normalizeFailureStatus(status) {
  if (!status || status === "open" || status === "unresolved") {
    return null;
  }

  if (!FAILURE_STATUSES.has(status)) {
    throw new Error("status must be failed, exhausted, open, or unresolved");
  }

  return status;
}

export function listProjectOperationalFailures(projectId, options = {}) {
  const status = normalizeFailureStatus(options.status);
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
  const common = {
    db: options.db,
    dbPath: options.dbPath,
    skipMigrate: options.skipMigrate,
    unresolvedOnly: options.unresolvedOnly ?? true,
    limit,
  };

  const deliveryStatuses = status ? [status] : ["failed", "exhausted"];
  const eventStatuses = status ? [status] : ["failed", "exhausted"];

  const deliveries = deliveryStatuses.flatMap((deliveryStatus) =>
    listProjectReportDeliveries(projectId, { ...common, status: deliveryStatus })
  );
  const jobEvents = eventStatuses.flatMap((eventStatus) =>
    listProjectJobEvents(projectId, { ...common, status: eventStatus })
  );

  return {
    project_id: projectId,
    report_deliveries: deliveries.slice(0, limit),
    job_events: jobEvents.slice(0, limit),
    counts: {
      report_deliveries: deliveries.length,
      job_events: jobEvents.length,
      total: deliveries.length + jobEvents.length,
    },
  };
}

