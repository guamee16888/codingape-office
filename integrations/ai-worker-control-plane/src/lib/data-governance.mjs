import { migrate, openDatabase } from "./db.mjs";

const DEFAULT_RETENTION_RULES = [
  {
    asset_type: "agent_runs",
    table_name: "agent_runs",
    label: "Raw agent run traces",
    retention_days: 365,
    archive_after_days: 90,
    action_after_retention: "redact_or_delete_raw_payloads_after_export",
    reason: "Raw inputs and outputs are sensitive, but short-term traceability is required for debugging and report evidence.",
  },
  {
    asset_type: "run_judgements",
    table_name: "run_judgements",
    label: "AI judge outcomes",
    retention_days: 730,
    archive_after_days: 365,
    action_after_retention: "retain_structured_scores_redact_reasoning",
    reason: "Outcome labels and scores compound into reliability intelligence; free-form reasoning may contain sensitive context.",
  },
  {
    asset_type: "failure_cases",
    table_name: "failure_cases",
    label: "Failure cases",
    retention_days: 1095,
    archive_after_days: 365,
    action_after_retention: "retain_taxonomy_redact_descriptions",
    reason: "Failure taxonomy and recurrence patterns are core moat assets.",
  },
  {
    asset_type: "eval_cases",
    table_name: "eval_cases",
    label: "Eval cases",
    retention_days: 1095,
    archive_after_days: 365,
    action_after_retention: "retain_or_redact_inputs_after_customer_review",
    reason: "Eval cases turn failures into long-term regression assets.",
  },
  {
    asset_type: "reports",
    table_name: "reports",
    label: "Reports",
    retention_days: 1095,
    archive_after_days: 365,
    action_after_retention: "retain_report_json_and_hashes",
    reason: "Reports are customer-facing evidence of AI worker oversight.",
  },
  {
    asset_type: "audit_events",
    table_name: "audit_events",
    label: "Audit events",
    retention_days: 2555,
    archive_after_days: 1095,
    action_after_retention: "retain_minimum_audit_metadata",
    reason: "Audit evidence is the enterprise value layer and should outlive raw operational payloads.",
  },
  {
    asset_type: "audit_evidence_items",
    table_name: "audit_evidence_items",
    label: "Audit evidence items",
    retention_days: 2555,
    archive_after_days: 1095,
    action_after_retention: "retain_minimum_audit_metadata",
    reason: "Gate checks, prompt checks, and controllability evidence support future compliance review.",
  },
  {
    asset_type: "incident_reports",
    table_name: "incident_reports",
    label: "Incident reports",
    retention_days: 2555,
    archive_after_days: 1095,
    action_after_retention: "retain_incident_summary_and_related_hashes",
    reason: "Incident memory is central to black-box investigation and enterprise accountability.",
  },
];

function dayDiff(olderIso, nowIso) {
  if (!olderIso) {
    return null;
  }

  const older = new Date(olderIso).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(older) || !Number.isFinite(now)) {
    return null;
  }

  return Math.max(0, Math.floor((now - older) / (24 * 60 * 60 * 1000)));
}

function tableStats(db, tableName, projectId) {
  if (tableName === "run_judgements") {
    return db.prepare(
      `SELECT COUNT(*) AS count, MIN(j.created_at) AS oldest_created_at, MAX(j.created_at) AS newest_created_at
       FROM run_judgements j
       JOIN agent_runs r ON r.id = j.agent_run_id
       WHERE r.project_id = ?`
    ).get(projectId);
  }

  if (tableName === "failure_cases") {
    return db.prepare(
      `SELECT COUNT(*) AS count, MIN(f.created_at) AS oldest_created_at, MAX(f.created_at) AS newest_created_at
       FROM failure_cases f
       JOIN agent_runs r ON r.id = f.agent_run_id
       WHERE r.project_id = ?`
    ).get(projectId);
  }

  if (tableName === "audit_events") {
    return db.prepare(
      `SELECT COUNT(*) AS count, MIN(created_at) AS oldest_created_at, MAX(created_at) AS newest_created_at
       FROM audit_events
       WHERE project_id = ?`
    ).get(projectId);
  }

  return db.prepare(
    `SELECT COUNT(*) AS count, MIN(created_at) AS oldest_created_at, MAX(created_at) AS newest_created_at
     FROM ${tableName}
     WHERE project_id = ?`
  ).get(projectId);
}

function riskLevel({ ageDays, retentionDays, archiveAfterDays, count }) {
  if (!count) return "none";
  if (ageDays !== null && ageDays >= retentionDays) return "retention_due";
  if (ageDays !== null && ageDays >= archiveAfterDays) return "archive_due";
  return "within_policy";
}

export function summarizeProjectDataGovernance(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const asOf = options.asOf || new Date().toISOString();
    const rules = options.rules || DEFAULT_RETENTION_RULES;
    const assets = rules.map((rule) => {
      const stats = tableStats(db, rule.table_name, projectId);
      const count = Number(stats?.count || 0);
      const oldestAgeDays = dayDiff(stats?.oldest_created_at, asOf);
      const newestAgeDays = dayDiff(stats?.newest_created_at, asOf);
      const status = riskLevel({
        ageDays: oldestAgeDays,
        retentionDays: rule.retention_days,
        archiveAfterDays: rule.archive_after_days,
        count,
      });

      return {
        asset_type: rule.asset_type,
        label: rule.label,
        count,
        oldest_created_at: stats?.oldest_created_at || null,
        newest_created_at: stats?.newest_created_at || null,
        oldest_age_days: oldestAgeDays,
        newest_age_days: newestAgeDays,
        retention_days: rule.retention_days,
        archive_after_days: rule.archive_after_days,
        status,
        recommended_action: count ? rule.action_after_retention : "no_data",
        reason: rule.reason,
      };
    });

    return {
      project_id: projectId,
      as_of: asOf,
      policy_version: "phase1_retention_v1",
      mode: "advisory_only",
      summary: {
        asset_count: assets.length,
        total_records: assets.reduce((sum, asset) => sum + asset.count, 0),
        archive_due_count: assets.filter((asset) => asset.status === "archive_due").length,
        retention_due_count: assets.filter((asset) => asset.status === "retention_due").length,
        within_policy_count: assets.filter((asset) => asset.status === "within_policy").length,
      },
      assets,
      guardrails: [
        "Phase 1 does not delete production data automatically.",
        "Raw payload deletion should only happen after export, customer approval, and retention policy review.",
        "Audit events, evidence hashes, failure taxonomy, eval metadata, and incident summaries should outlive raw payloads.",
      ],
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
