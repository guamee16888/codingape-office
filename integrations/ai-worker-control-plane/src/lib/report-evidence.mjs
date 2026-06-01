import { createHash } from "node:crypto";
import { createId } from "./ids.mjs";
import { fromJson, migrate, nowIso, openDatabase, toJson } from "./db.mjs";
import { getRunTrace } from "./assets.mjs";
import { getReport } from "./reports.mjs";

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function hashValue(value) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function verifyEvidencePackIntegrity(pack) {
  const expected = pack?.integrity?.evidence_pack_hash || null;
  if (!expected) {
    return {
      valid: false,
      expected_hash: null,
      actual_hash: null,
      reason: "missing_evidence_pack_hash",
    };
  }

  const hashInput = {
    ...pack,
    integrity: {
      ...(pack.integrity || {}),
    },
  };
  delete hashInput.integrity.evidence_pack_hash;
  const actual = hashValue(hashInput);

  return {
    valid: actual === expected,
    expected_hash: expected,
    actual_hash: actual,
    reason: actual === expected ? "ok" : "hash_mismatch",
  };
}

const REDACTED = "[REDACTED]";

function redactText(value) {
  if (value === null || value === undefined) {
    return value;
  }

  return REDACTED;
}

function redactMetadata(metadata = {}) {
  return {
    metadata_hash: hashValue(metadata),
    preserved_keys: Object.keys(metadata).sort(),
    source: metadata.source || null,
    task_type: metadata.task_type || metadata.taskType || null,
    token_cost_known: metadata.token_cost_known ?? null,
    redacted: true,
  };
}

function redactRunTrace(trace) {
  const run = trace.run || {};
  const judgement = trace.judgement || null;

  return {
    ...trace,
    run: {
      ...run,
      input_hash: hashValue(run.input || ""),
      output_hash: hashValue(run.output || ""),
      input: redactText(run.input),
      output: redactText(run.output),
      metadata: redactMetadata(run.metadata || {}),
    },
    judgement: judgement ? {
      ...judgement,
      reasoning_summary_hash: hashValue(judgement.reasoning_summary || ""),
      evidence_hash: hashValue(judgement.evidence || []),
      raw_json_hash: hashValue(judgement.raw_json || {}),
      reasoning_summary: redactText(judgement.reasoning_summary),
      evidence: [],
      recommended_actions: [],
      raw_json: {},
    } : null,
    failure_cases: (trace.failure_cases || []).map((item) => ({
      ...item,
      description_hash: hashValue(item.description || ""),
      suggested_fix_hash: hashValue(item.suggested_fix || ""),
      taxonomy_evidence_hash: hashValue(item.taxonomy_evidence_json || []),
      description: redactText(item.description),
      suggested_fix: redactText(item.suggested_fix),
      taxonomy_evidence_json: [],
    })),
    suggestions: (trace.suggestions || []).map((item) => ({
      ...item,
      title_hash: hashValue(item.title || ""),
      description_hash: hashValue(item.description || ""),
      expected_impact_hash: hashValue(item.expected_impact || ""),
      title: redactText(item.title),
      description: redactText(item.description),
      expected_impact: redactText(item.expected_impact),
    })),
    eval_cases: (trace.eval_cases || []).map((item) => ({
      ...item,
      input_hash: hashValue(item.input || ""),
      expected_behavior_hash: hashValue(item.expected_behavior || ""),
      input: redactText(item.input),
      expected_behavior: redactText(item.expected_behavior),
    })),
  };
}

function redactAuditEvent(event) {
  const metadata = event.metadata || {};
  return {
    ...event,
    metadata: {
      metadata_hash: hashValue(metadata),
      api_key_id: metadata.api_key_id || null,
      signature_verified: metadata.signature_verified ?? null,
      signature_required: metadata.signature_required ?? null,
      deduplicated: metadata.deduplicated ?? null,
      ingestion_source: metadata.ingestion_source || null,
      redacted: true,
    },
  };
}

function parseAuditEventRow(row) {
  return row ? {
    ...row,
    metadata: fromJson(row.metadata, {}),
  } : null;
}

function listAuditChain(db, projectId, report, runIds, limit = 200) {
  const ids = Array.from(new Set([
    report.id,
    ...(runIds || []),
    ...((report.content_json?.source_judgement_ids || [])),
    ...((report.content_json?.incident_reports || []).map((item) => item.id)),
    ...((report.content_json?.policy_dry_run_evidence || []).map((item) => item.policy_dry_run_id)),
    ...((report.content_json?.reliability_score_evidence || []).flatMap((item) => [item.score_id, item.snapshot_id])),
  ].filter(Boolean)));

  const clauses = ["project_id = ?"];
  const params = [projectId];

  if (ids.length) {
    clauses.push(`target_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }

  params.push(Math.max(1, Math.min(Number(limit || 200), 500)));

  return db.prepare(
    `SELECT id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
     FROM audit_events
     WHERE ${clauses.join(" AND ")}
     ORDER BY created_at ASC
     LIMIT ?`
  ).all(...params).map(parseAuditEventRow);
}

function reportSummary(reportJson = {}) {
  return {
    total_runs: reportJson.total_runs || 0,
    success_count: reportJson.success_count || 0,
    failure_count: reportJson.failure_count || 0,
    high_risk_count: reportJson.high_risk_count || 0,
    total_cost: reportJson.total_cost || 0,
    autonomy_readiness_score: reportJson.autonomy_readiness?.project_score?.autonomy_readiness_score ?? null,
    readiness_status: reportJson.autonomy_readiness?.project_score?.readiness_status || null,
    source_run_count: (reportJson.source_run_ids || []).length,
    source_judgement_count: (reportJson.source_judgement_ids || []).length,
    incident_count: (reportJson.incident_reports || []).length,
    evidence_item_count: (reportJson.policy_dry_run_evidence || []).length + (reportJson.reliability_score_evidence || []).length,
  };
}

export function buildReportEvidencePack(reportId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const report = getReport(reportId, { db, skipMigrate: true });
    if (!report) {
      return null;
    }

    const reportJson = report.content_json || {};
    const sourceRunIds = reportJson.source_run_ids || [];
    const redacted = Boolean(options.redact);
    const sourceRunsRaw = sourceRunIds.map((runId) => getRunTrace(runId, { db, skipMigrate: true })).filter(Boolean);
    const sourceRuns = redacted ? sourceRunsRaw.map(redactRunTrace) : sourceRunsRaw;
    const auditChainRaw = listAuditChain(db, report.project_id, report, sourceRunIds, options.auditLimit);
    const auditChain = redacted ? auditChainRaw.map(redactAuditEvent) : auditChainRaw;
    const packWithoutHash = {
      evidence_version: "2026-05-22.v1",
      redaction: {
        mode: redacted ? "redacted" : "full",
        sensitive_fields_redacted: redacted ? [
          "agent_runs.input",
          "agent_runs.output",
          "agent_runs.metadata",
          "run_judgements.reasoning_summary",
          "run_judgements.evidence",
          "run_judgements.recommended_actions",
          "run_judgements.raw_json",
          "failure_cases.description",
          "failure_cases.suggested_fix",
          "failure_cases.taxonomy_evidence_json",
          "optimization_suggestions.title",
          "optimization_suggestions.description",
          "optimization_suggestions.expected_impact",
          "eval_cases.input",
          "eval_cases.expected_behavior",
          "audit_events.metadata",
        ] : [],
      },
      report: {
        id: report.id,
        project_id: report.project_id,
        report_type: report.report_type,
        period_start: report.period_start,
        period_end: report.period_end,
        created_at: report.created_at,
      },
      summary: reportSummary(reportJson),
      data_provenance: reportJson.data_provenance || {},
      ingestion_health: reportJson.ingestion_health || {},
      autonomy_readiness: reportJson.autonomy_readiness || {},
      source_runs: sourceRuns,
      derived_evidence: {
        trace_items: reportJson.trace_items || [],
        source_judgement_ids: reportJson.source_judgement_ids || [],
        reliability_score_evidence: reportJson.reliability_score_evidence || [],
        eval_replay_gate: reportJson.eval_replay_gate || {},
        prompt_promotion_checks: reportJson.prompt_promotion_checks || [],
        autonomy_gate_checks: reportJson.autonomy_gate_checks || [],
        policy_dry_run_summary: reportJson.policy_dry_run_summary || {},
        policy_dry_run_evidence: reportJson.policy_dry_run_evidence || [],
        incident_reports: reportJson.incident_reports || [],
        incident_remediation_events: reportJson.incident_remediation_events || [],
        learning_rules: reportJson.learning_rules || [],
      },
      audit_chain: auditChain,
      integrity: {
        source_run_ids_hash: hashValue(sourceRunIds),
        source_judgement_ids_hash: hashValue(reportJson.source_judgement_ids || []),
        report_markdown_hash: hashValue(report.content_markdown || ""),
      },
    };

    return {
      ...packWithoutHash,
      integrity: {
        ...packWithoutHash.integrity,
        evidence_pack_hash: hashValue(packWithoutHash),
      },
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function recordReportEvidencePackExport(reportId, pack, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const report = getReport(reportId, { db, skipMigrate: true });
    if (!report) {
      return null;
    }

    const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(report.project_id);
    const auditId = createId("audit");
    const createdAt = options.createdAt || nowIso();
    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      auditId,
      project?.org_id || null,
      report.project_id,
      options.actorType || "system",
      options.actorId || null,
      "report.evidence_pack_exported",
      "report",
      report.id,
      toJson({
        redaction_mode: pack?.redaction?.mode || "unknown",
        evidence_pack_hash: pack?.integrity?.evidence_pack_hash || null,
        source_run_count: pack?.summary?.source_run_count || 0,
        export_surface: options.exportSurface || "api",
      }),
      createdAt
    );

    return { audit_event_id: auditId };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
