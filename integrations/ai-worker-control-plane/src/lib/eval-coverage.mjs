import { migrate, openDatabase } from "./db.mjs";

function coverageStatus(item) {
  const failureCount = Number(item.failure_count || 0);
  const evalCaseCount = Number(item.eval_case_count || 0);
  const replayedCaseCount = Number(item.replayed_case_count || 0);
  const regressionCount = Number(item.regression_count || 0);

  if (!failureCount) return "no_failures_seen";
  if (!evalCaseCount) return "missing_eval_coverage";
  if (!replayedCaseCount) return "eval_created_not_replayed";
  if (regressionCount > 0) return "covered_with_regressions";
  return "covered";
}

function actionForStatus(status) {
  return {
    no_failures_seen: "No action required until failures appear.",
    missing_eval_coverage: "Create eval cases from representative failures before changing prompts, tools, or model routes.",
    eval_created_not_replayed: "Run eval replay with candidate outputs before promoting changes.",
    covered_with_regressions: "Block promotion and fix regressions before increasing autonomy.",
    covered: "Maintain replay coverage and monitor recurrence.",
  }[status] || "Review coverage manually.";
}

export function summarizeProjectEvalCoverage(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const failureRows = db.prepare(
      `SELECT
         COALESCE(f.taxonomy_code, 'unknown_failure') AS taxonomy_code,
         COUNT(*) AS failure_count,
         SUM(CASE WHEN f.severity = 'high' THEN 1 ELSE 0 END) AS high_severity_count,
         SUM(CASE WHEN j.overall_status = 'high_risk' OR j.risk_score >= 75 THEN 1 ELSE 0 END) AS high_risk_run_count,
         MAX(f.created_at) AS latest_failure_at
       FROM failure_cases f
       JOIN agent_runs r ON r.id = f.agent_run_id
       LEFT JOIN run_judgements j ON j.agent_run_id = r.id
       WHERE r.project_id = ?
       GROUP BY COALESCE(f.taxonomy_code, 'unknown_failure')`
    ).all(projectId);

    const evalRows = db.prepare(
      `SELECT
         COALESCE(f.taxonomy_code, 'unknown_failure') AS taxonomy_code,
         COUNT(e.id) AS eval_case_count,
         SUM(CASE WHEN e.status = 'active' THEN 1 ELSE 0 END) AS active_eval_case_count,
         MAX(e.created_at) AS latest_eval_case_at
       FROM eval_cases e
       LEFT JOIN failure_cases f ON f.id = e.source_failure_case_id
       WHERE e.project_id = ?
       GROUP BY COALESCE(f.taxonomy_code, 'unknown_failure')`
    ).all(projectId);

    const replayRows = db.prepare(
      `SELECT
         COALESCE(f.taxonomy_code, 'unknown_failure') AS taxonomy_code,
         COUNT(DISTINCT rr.eval_case_id) AS replayed_case_count,
         SUM(CASE WHEN rr.status = 'pass' THEN 1 ELSE 0 END) AS pass_count,
         SUM(CASE WHEN rr.status = 'fail' THEN 1 ELSE 0 END) AS fail_count,
         SUM(CASE WHEN rr.status = 'regression' THEN 1 ELSE 0 END) AS regression_count,
         MAX(rr.created_at) AS latest_replay_at
       FROM replay_results rr
       JOIN eval_cases e ON e.id = rr.eval_case_id
       LEFT JOIN failure_cases f ON f.id = e.source_failure_case_id
       WHERE e.project_id = ?
       GROUP BY COALESCE(f.taxonomy_code, 'unknown_failure')`
    ).all(projectId);

    const byTaxonomy = new Map();
    for (const row of failureRows) {
      byTaxonomy.set(row.taxonomy_code, {
        taxonomy_code: row.taxonomy_code,
        failure_count: Number(row.failure_count || 0),
        high_severity_count: Number(row.high_severity_count || 0),
        high_risk_run_count: Number(row.high_risk_run_count || 0),
        latest_failure_at: row.latest_failure_at || null,
        eval_case_count: 0,
        active_eval_case_count: 0,
        latest_eval_case_at: null,
        replayed_case_count: 0,
        pass_count: 0,
        fail_count: 0,
        regression_count: 0,
        latest_replay_at: null,
      });
    }

    for (const row of evalRows) {
      const item = byTaxonomy.get(row.taxonomy_code) || {
        taxonomy_code: row.taxonomy_code,
        failure_count: 0,
        high_severity_count: 0,
        high_risk_run_count: 0,
        latest_failure_at: null,
        replayed_case_count: 0,
        pass_count: 0,
        fail_count: 0,
        regression_count: 0,
        latest_replay_at: null,
      };
      item.eval_case_count = Number(row.eval_case_count || 0);
      item.active_eval_case_count = Number(row.active_eval_case_count || 0);
      item.latest_eval_case_at = row.latest_eval_case_at || null;
      byTaxonomy.set(row.taxonomy_code, item);
    }

    for (const row of replayRows) {
      const item = byTaxonomy.get(row.taxonomy_code) || {
        taxonomy_code: row.taxonomy_code,
        failure_count: 0,
        high_severity_count: 0,
        high_risk_run_count: 0,
        latest_failure_at: null,
        eval_case_count: 0,
        active_eval_case_count: 0,
        latest_eval_case_at: null,
      };
      item.replayed_case_count = Number(row.replayed_case_count || 0);
      item.pass_count = Number(row.pass_count || 0);
      item.fail_count = Number(row.fail_count || 0);
      item.regression_count = Number(row.regression_count || 0);
      item.latest_replay_at = row.latest_replay_at || null;
      byTaxonomy.set(row.taxonomy_code, item);
    }

    const taxonomy_coverage = Array.from(byTaxonomy.values()).map((item) => {
      const status = coverageStatus(item);
      return {
        ...item,
        coverage_rate: Number((item.failure_count ? item.eval_case_count / item.failure_count : 0).toFixed(6)),
        replay_coverage_rate: Number((item.eval_case_count ? item.replayed_case_count / item.eval_case_count : 0).toFixed(6)),
        status,
        recommended_action: actionForStatus(status),
      };
    }).sort((a, b) => (
      b.high_risk_run_count - a.high_risk_run_count ||
      b.failure_count - a.failure_count ||
      a.taxonomy_code.localeCompare(b.taxonomy_code)
    ));

    const failureCount = taxonomy_coverage.reduce((sum, item) => sum + item.failure_count, 0);
    const evalCaseCount = taxonomy_coverage.reduce((sum, item) => sum + item.eval_case_count, 0);
    const replayedCaseCount = taxonomy_coverage.reduce((sum, item) => sum + item.replayed_case_count, 0);
    const missing = taxonomy_coverage.filter((item) => item.status === "missing_eval_coverage");
    const notReplayed = taxonomy_coverage.filter((item) => item.status === "eval_created_not_replayed");
    const regressions = taxonomy_coverage.filter((item) => item.status === "covered_with_regressions");

    return {
      project_id: projectId,
      coverage_version: "phase1_eval_coverage_v1",
      summary: {
        taxonomy_count: taxonomy_coverage.length,
        failure_count: failureCount,
        eval_case_count: evalCaseCount,
        replayed_case_count: replayedCaseCount,
        taxonomy_coverage_rate: Number((taxonomy_coverage.length ? taxonomy_coverage.filter((item) => item.eval_case_count > 0).length / taxonomy_coverage.length : 0).toFixed(6)),
        failure_to_eval_ratio: Number((failureCount ? evalCaseCount / failureCount : 0).toFixed(6)),
        replay_coverage_rate: Number((evalCaseCount ? replayedCaseCount / evalCaseCount : 0).toFixed(6)),
        missing_eval_taxonomy_count: missing.length,
        not_replayed_taxonomy_count: notReplayed.length,
        regression_taxonomy_count: regressions.length,
      },
      taxonomy_coverage,
      priority_gaps: [...regressions, ...missing, ...notReplayed].slice(0, 10),
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
