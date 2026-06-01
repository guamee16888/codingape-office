import { migrate, openDatabase } from "./db.mjs";
import { summarizeProjectEvalCoverage } from "./eval-coverage.mjs";

function priorityForGap(gap) {
  const highRisk = Number(gap.high_risk_run_count || 0);
  const highSeverity = Number(gap.high_severity_count || 0);
  const regressions = Number(gap.regression_count || 0);

  if (regressions > 0) return "critical";
  if (highRisk > 0 || highSeverity > 0) return "critical";
  if (gap.status === "missing_eval_coverage") return "high";
  if (gap.status === "eval_created_not_replayed") return "medium";
  return "low";
}

function blockerType(status) {
  return {
    missing_eval_coverage: "missing_eval_coverage",
    eval_created_not_replayed: "unreplayed_eval_coverage",
    covered_with_regressions: "eval_replay_regression",
  }[status] || "coverage_review";
}

function whyForGap(gap) {
  if (gap.status === "covered_with_regressions") {
    return "Known failure taxonomy has replay evidence, but the latest replay still shows regressions. Do not increase autonomy until the regression is fixed.";
  }

  if (gap.status === "missing_eval_coverage") {
    return "Known failure taxonomy has occurred in real runs but has not been converted into an eval case. This weakens prompt promotion and autonomy-readiness evidence.";
  }

  if (gap.status === "eval_created_not_replayed") {
    return "Eval cases exist for this failure taxonomy, but they have not been replayed. The system cannot prove the candidate prompt, workflow, or model route handles it.";
  }

  return "Review this taxonomy coverage before increasing autonomy.";
}

function representativeFailures(db, projectId, taxonomyCode, limit) {
  return db.prepare(
    `SELECT
       f.id AS failure_case_id,
       f.category,
       f.taxonomy_code,
       f.severity,
       f.description,
       f.suggested_fix,
       f.created_at,
       r.id AS run_id,
       r.agent_id,
       r.run_id_external,
       r.status AS run_status,
       r.cost,
       r.latency,
       j.overall_status,
       j.risk_score,
       j.success_score
     FROM failure_cases f
     JOIN agent_runs r ON r.id = f.agent_run_id
     LEFT JOIN run_judgements j ON j.agent_run_id = r.id
     WHERE r.project_id = ?
       AND COALESCE(f.taxonomy_code, 'unknown_failure') = ?
     ORDER BY
       CASE WHEN j.overall_status = 'high_risk' OR j.risk_score >= 75 THEN 1 ELSE 0 END DESC,
       CASE WHEN f.severity = 'high' THEN 1 ELSE 0 END DESC,
       f.created_at DESC
     LIMIT ?`
  ).all(projectId, taxonomyCode, limit).map((row) => ({
    failure_case_id: row.failure_case_id,
    run_id: row.run_id,
    run_id_external: row.run_id_external,
    agent_id: row.agent_id,
    category: row.category,
    taxonomy_code: row.taxonomy_code,
    severity: row.severity,
    overall_status: row.overall_status || "unknown",
    risk_score: Number(row.risk_score || 0),
    success_score: Number(row.success_score || 0),
    run_status: row.run_status,
    cost: Number(row.cost || 0),
    latency: Number(row.latency || 0),
    description: row.description,
    suggested_fix: row.suggested_fix,
    created_at: row.created_at,
  }));
}

export function buildProjectEvalBacklog(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const coverage = options.evalCoverage || summarizeProjectEvalCoverage(projectId, {
      db,
      skipMigrate: true,
    });
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
    const representativeLimit = Math.max(1, Math.min(Number(options.representativeLimit || 3), 10));
    const gaps = (coverage.priority_gaps || []).slice(0, limit);
    const items = gaps.map((gap, index) => {
      const priority = priorityForGap(gap);
      const representatives = representativeFailures(db, projectId, gap.taxonomy_code, representativeLimit);
      return {
        backlog_item_id: `eval_backlog:${projectId}:${gap.taxonomy_code}:${gap.status}`,
        rank: index + 1,
        priority,
        blocker_type: blockerType(gap.status),
        taxonomy_code: gap.taxonomy_code,
        coverage_status: gap.status,
        autonomy_blocker: ["critical", "high", "medium"].includes(priority),
        prompt_promotion_blocker: ["missing_eval_coverage", "eval_created_not_replayed", "covered_with_regressions"].includes(gap.status),
        failure_count: Number(gap.failure_count || 0),
        high_severity_count: Number(gap.high_severity_count || 0),
        high_risk_run_count: Number(gap.high_risk_run_count || 0),
        eval_case_count: Number(gap.eval_case_count || 0),
        active_eval_case_count: Number(gap.active_eval_case_count || 0),
        replayed_case_count: Number(gap.replayed_case_count || 0),
        regression_count: Number(gap.regression_count || 0),
        latest_failure_at: gap.latest_failure_at || null,
        latest_eval_case_at: gap.latest_eval_case_at || null,
        latest_replay_at: gap.latest_replay_at || null,
        why_it_matters: whyForGap(gap),
        recommended_action: gap.recommended_action,
        next_step: gap.status === "missing_eval_coverage"
          ? "Create eval cases from the representative failures, then replay before promotion."
          : gap.status === "eval_created_not_replayed"
            ? "Run eval replay for existing eval cases and inspect pass/fail/regression results."
            : "Fix the regression, rerun replay, and keep autonomy blocked until it passes.",
        representative_failures: representatives,
      };
    });

    return {
      project_id: projectId,
      backlog_version: "phase1_eval_backlog_v1",
      summary: {
        open_item_count: items.length,
        critical_item_count: items.filter((item) => item.priority === "critical").length,
        high_priority_item_count: items.filter((item) => item.priority === "high").length,
        medium_priority_item_count: items.filter((item) => item.priority === "medium").length,
        missing_eval_count: items.filter((item) => item.blocker_type === "missing_eval_coverage").length,
        needs_replay_count: items.filter((item) => item.blocker_type === "unreplayed_eval_coverage").length,
        regression_count: items.filter((item) => item.blocker_type === "eval_replay_regression").length,
        autonomy_blocker_count: items.filter((item) => item.autonomy_blocker).length,
        prompt_promotion_blocker_count: items.filter((item) => item.prompt_promotion_blocker).length,
      },
      items,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
