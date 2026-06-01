import { createId } from "./ids.mjs";
import { fromJson, migrate, nowIso, openDatabase, toJson } from "./db.mjs";

const SEVERITY_RANK = {
  high: 0,
  medium: 1,
  low: 2,
};

const REMEDIATION_STATUSES = new Set([
  "open",
  "investigating",
  "remediated",
  "verified",
  "dismissed",
  "reopened",
]);

const ALLOWED_REMEDIATION_TRANSITIONS = new Map([
  ["open", new Set(["investigating", "remediated", "dismissed"])],
  ["investigating", new Set(["open", "remediated", "dismissed"])],
  ["remediated", new Set(["verified", "reopened", "investigating"])],
  ["verified", new Set(["reopened"])],
  ["dismissed", new Set(["reopened"])],
  ["reopened", new Set(["investigating", "remediated", "dismissed"])],
]);

function parseIncidentRow(row) {
  return row ? {
    ...row,
    related_run_ids: fromJson(row.related_run_ids, []),
  } : null;
}

function parseRemediationEventRow(row) {
  return row ? {
    ...row,
    evidence_json: fromJson(row.evidence_json, {}),
  } : null;
}

function severityRank(value) {
  return SEVERITY_RANK[value] ?? 3;
}

function assertValidRemediationTransition(fromStatus, toStatus) {
  if (!REMEDIATION_STATUSES.has(toStatus)) {
    throw new Error(`Invalid incident remediation status: ${toStatus}`);
  }

  if (fromStatus === toStatus) {
    throw new Error(`Incident is already in remediation status: ${toStatus}`);
  }

  const allowed = ALLOWED_REMEDIATION_TRANSITIONS.get(fromStatus);
  if (!allowed?.has(toStatus)) {
    throw new Error(`Invalid incident remediation transition: ${fromStatus} -> ${toStatus}`);
  }
}

function incidentSeverity({ riskScore = 0, failureCases = [] }) {
  if (Number(riskScore || 0) >= 75) {
    return "high";
  }

  if (failureCases.some((item) => item.severity === "high")) {
    return "high";
  }

  return "medium";
}

function failureCasesForRun(db, runId) {
  return db.prepare(
    `SELECT
       f.id,
       f.category,
       f.taxonomy_code,
       f.taxonomy_confidence,
       f.taxonomy_evidence_json,
       f.severity,
       f.description,
       f.suggested_fix,
       t.name AS taxonomy_name
     FROM failure_cases f
     LEFT JOIN failure_taxonomies t ON t.code = f.taxonomy_code
     WHERE f.agent_run_id = ?
     ORDER BY
       CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
       f.taxonomy_confidence DESC,
       f.created_at ASC`
  ).all(runId).map((row) => ({
    ...row,
    taxonomy_evidence_json: fromJson(row.taxonomy_evidence_json, []),
  }));
}

function rootCauseFrom({ failureCases = [], failureCategories = [] }) {
  const topFailure = failureCases[0];
  if (topFailure?.taxonomy_code) {
    return topFailure.taxonomy_code;
  }

  if (topFailure?.category) {
    return topFailure.category;
  }

  return failureCategories[0] || "unknown_failure";
}

function sortedRunIds(runIds) {
  return Array.from(new Set(runIds.filter(Boolean))).sort();
}

function insertIncidentIfMissing(db, incident) {
  const relatedRunIds = sortedRunIds(incident.related_run_ids || []);
  const relatedRunIdsJson = toJson(relatedRunIds);

  const existing = db.prepare(
    `SELECT *
     FROM incident_reports
     WHERE project_id = ?
       AND COALESCE(agent_id, '') = COALESCE(?, '')
       AND COALESCE(root_cause_category, '') = COALESCE(?, '')
       AND related_run_ids = ?
     LIMIT 1`
  ).get(
    incident.project_id,
    incident.agent_id || null,
    incident.root_cause_category || null,
    relatedRunIdsJson
  );

  if (existing) {
    return { ...parseIncidentRow(existing), was_created: false };
  }

  const incidentId = createId("incident");
  db.prepare(
    `INSERT INTO incident_reports (
      id, project_id, agent_id, severity, title, summary, related_run_ids,
      root_cause_category, remediation_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    incidentId,
    incident.project_id,
    incident.agent_id || null,
    incident.severity,
    incident.title,
    incident.summary,
    relatedRunIdsJson,
    incident.root_cause_category || null,
    incident.remediation_status || "open",
    incident.created_at
  );

  if (incident.org_id) {
    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      incident.org_id,
      incident.project_id,
      "system",
      null,
      "incident_report.created",
      "incident_report",
      incidentId,
      toJson({
        agent_id: incident.agent_id || null,
        severity: incident.severity,
        root_cause_category: incident.root_cause_category || null,
        related_run_ids: relatedRunIds,
        source: incident.source || "phase1_incident_generator",
      }),
      incident.created_at
    );
  }

  return {
    id: incidentId,
    project_id: incident.project_id,
    agent_id: incident.agent_id || null,
    severity: incident.severity,
    title: incident.title,
    summary: incident.summary,
    related_run_ids: relatedRunIds,
    root_cause_category: incident.root_cause_category || null,
    remediation_status: incident.remediation_status || "open",
    created_at: incident.created_at,
    was_created: true,
  };
}

function highRiskRunIncidents(db, projectId, periodStart, periodEnd, createdAt) {
  const rows = db.prepare(
    `SELECT
       r.id AS run_id,
       r.agent_id,
       r.org_id,
       j.id AS judgement_id,
       j.overall_status,
       j.risk_score,
       j.reasoning_summary,
       j.failure_categories,
       j.needs_human_review
     FROM agent_runs r
     JOIN run_judgements j ON j.agent_run_id = r.id
     WHERE r.project_id = ?
       AND r.created_at >= ?
       AND r.created_at < ?
       AND (j.overall_status = 'high_risk' OR j.risk_score >= 75)
     ORDER BY j.risk_score DESC, r.created_at ASC
     LIMIT 10`
  ).all(projectId, periodStart, periodEnd);

  return rows.map((row) => {
    const failureCases = failureCasesForRun(db, row.run_id);
    const failureCategories = fromJson(row.failure_categories, []);
    const rootCause = rootCauseFrom({ failureCases, failureCategories });
    const titleRoot = failureCases[0]?.taxonomy_name || rootCause;

    return {
      project_id: projectId,
      org_id: row.org_id,
      agent_id: row.agent_id,
      severity: incidentSeverity({ riskScore: row.risk_score, failureCases }),
      title: `High-risk agent run: ${titleRoot}`,
      summary: `Run ${row.run_id} reached risk score ${row.risk_score} with status ${row.overall_status}. ${row.reasoning_summary || "Review the run trace, judgement evidence, and suggested controls."}`,
      related_run_ids: [row.run_id],
      root_cause_category: rootCause,
      remediation_status: "open",
      created_at: createdAt,
      source: "high_risk_run",
    };
  });
}

function recurringFailureIncidents(db, projectId, periodEnd, createdAt, lookbackDays = 7) {
  const end = new Date(periodEnd);
  const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(
    `SELECT
       r.id AS run_id,
       r.agent_id,
       r.org_id,
       r.created_at,
       f.category,
       f.taxonomy_code,
       f.taxonomy_confidence,
       f.severity
     FROM failure_cases f
     JOIN agent_runs r ON r.id = f.agent_run_id
     WHERE r.project_id = ?
       AND r.created_at >= ?
       AND r.created_at < ?
     ORDER BY r.created_at ASC`
  ).all(projectId, start, periodEnd);

  const groups = new Map();
  for (const row of rows) {
    const rootCause = row.taxonomy_code || row.category || "unknown_failure";
    const key = `${row.agent_id || "project"}:${rootCause}`;
    const existing = groups.get(key) || {
      project_id: projectId,
      org_id: row.org_id,
      agent_id: row.agent_id,
      root_cause_category: rootCause,
      related_run_ids: new Set(),
      case_count: 0,
      severities: new Set(),
      first_seen_at: row.created_at,
      last_seen_at: row.created_at,
    };

    existing.case_count += 1;
    existing.related_run_ids.add(row.run_id);
    existing.severities.add(row.severity);
    existing.first_seen_at = existing.first_seen_at < row.created_at ? existing.first_seen_at : row.created_at;
    existing.last_seen_at = existing.last_seen_at > row.created_at ? existing.last_seen_at : row.created_at;
    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .filter((group) => group.related_run_ids.size >= 2)
    .sort((a, b) => b.case_count - a.case_count || a.root_cause_category.localeCompare(b.root_cause_category))
    .slice(0, 5)
    .map((group) => ({
      project_id: projectId,
      org_id: group.org_id,
      agent_id: group.agent_id,
      severity: Array.from(group.severities).sort((a, b) => severityRank(a) - severityRank(b))[0] || "medium",
      title: `Recurring failure pattern: ${group.root_cause_category}`,
      summary: `${group.case_count} failure cases across ${group.related_run_ids.size} runs in the last ${lookbackDays} days. First seen ${group.first_seen_at}; last seen ${group.last_seen_at}.`,
      related_run_ids: Array.from(group.related_run_ids),
      root_cause_category: group.root_cause_category,
      remediation_status: "open",
      created_at: createdAt,
      source: "recurring_failure_pattern",
    }));
}

export function generateIncidentReportsForPeriod(projectId, periodStart, periodEnd, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const project = db.prepare("SELECT id, org_id FROM projects WHERE id = ?").get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const createdAt = options.createdAt || nowIso();
    const candidates = [
      ...highRiskRunIncidents(db, projectId, periodStart, periodEnd, createdAt),
      ...recurringFailureIncidents(db, projectId, periodEnd, createdAt),
    ];

    return candidates
      .map((candidate) => insertIncidentIfMissing(db, {
        ...candidate,
        org_id: candidate.org_id || project.org_id,
      }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.created_at.localeCompare(a.created_at))
      .slice(0, 10);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectIncidentReports(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?"];
    const params = [projectId];

    if (options.agentId) {
      clauses.push("agent_id = ?");
      params.push(options.agentId);
    }

    if (options.severity) {
      clauses.push("severity = ?");
      params.push(options.severity);
    }

    if (options.remediationStatus) {
      clauses.push("remediation_status = ?");
      params.push(options.remediationStatus);
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM incident_reports
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parseIncidentRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function getIncidentReport(incidentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const row = db.prepare("SELECT * FROM incident_reports WHERE id = ?").get(incidentId);
    return parseIncidentRow(row);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function updateIncidentRemediation(incidentId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const row = db.prepare(
      `SELECT i.*, p.org_id
       FROM incident_reports i
       JOIN projects p ON p.id = i.project_id
       WHERE i.id = ?`
    ).get(incidentId);

    if (!row) {
      throw new Error(`Incident report not found: ${incidentId}`);
    }

    const incident = parseIncidentRow(row);
    const toStatus = String(payload.remediation_status || payload.to_status || "").trim();
    assertValidRemediationTransition(incident.remediation_status, toStatus);

    const createdAt = options.createdAt || nowIso();
    const actorType = String(payload.actor_type || options.actorType || "user");
    const actorId = payload.actor_id || options.actorId || null;
    const note = payload.note ? String(payload.note) : null;
    const evidence = payload.evidence_json || payload.evidence || {};
    const eventId = createId("incident_event");

    db.exec("BEGIN");
    try {
      db.prepare("UPDATE incident_reports SET remediation_status = ? WHERE id = ?")
        .run(toStatus, incidentId);

      db.prepare(
        `INSERT INTO incident_remediation_events (
          id, incident_report_id, project_id, actor_type, actor_id,
          from_status, to_status, note, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        incidentId,
        incident.project_id,
        actorType,
        actorId,
        incident.remediation_status,
        toStatus,
        note,
        toJson(evidence),
        createdAt
      );

      db.prepare(
        `INSERT INTO audit_events (
          id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        createId("audit"),
        row.org_id,
        incident.project_id,
        actorType,
        actorId,
        "incident_report.remediation_status_updated",
        "incident_report",
        incidentId,
        toJson({
          from_status: incident.remediation_status,
          to_status: toStatus,
          note,
          evidence,
          incident_remediation_event_id: eventId,
        }),
        createdAt
      );

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      incident: getIncidentReport(incidentId, { db, skipMigrate: true }),
      remediation_event: parseRemediationEventRow(db.prepare(
        "SELECT * FROM incident_remediation_events WHERE id = ?"
      ).get(eventId)),
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listIncidentRemediationEvents(incidentId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));
    return db.prepare(
      `SELECT *
       FROM incident_remediation_events
       WHERE incident_report_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(incidentId, limit).map(parseRemediationEventRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectIncidentRemediationEvents(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const hasIncidentFilter = Array.isArray(options.incidentIds);
    const incidentIds = hasIncidentFilter
      ? options.incidentIds.filter(Boolean)
      : [];
    if (hasIncidentFilter && !incidentIds.length) {
      return [];
    }
    const clauses = ["project_id = ?"];
    const params = [projectId];

    if (incidentIds.length) {
      clauses.push(`incident_report_id IN (${incidentIds.map(() => "?").join(", ")})`);
      params.push(...incidentIds);
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 100), 200));
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM incident_remediation_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parseRemediationEventRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
