import { createId } from "./ids.mjs";
import { fromJson, migrate, openDatabase, toJson } from "./db.mjs";

function limitValue(value, fallback = 50) {
  return Math.max(1, Math.min(Number(value || fallback), 200));
}

function parseLearningInsightRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    evidence_json: fromJson(row.evidence_json, {}),
  };
}

function countRowsBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] || "unknown";
    counts.set(value, (counts.get(value) || 0) + Number(row.count || 0));
  }
  return counts;
}

function pushInsight(insights, values) {
  insights.push({
    id: createId("learning"),
    project_id: values.project_id,
    report_id: values.report_id,
    insight_type: values.insight_type,
    severity: values.severity || "low",
    title: values.title,
    description: values.description,
    evidence_json: values.evidence_json || {},
    recommended_action: values.recommended_action,
    status: values.status || "open",
    created_at: values.created_at,
  });
}

export function buildLearningInsights(db, {
  projectId,
  reportId,
  periodStart,
  periodEnd,
  recurringFailurePatterns = [],
  costOpportunity = {},
  createdAt,
}) {
  const insights = [];
  const suggestionRows = db.prepare(
    `SELECT type, status, COUNT(*) AS count
     FROM optimization_suggestions
     WHERE project_id = ?
     GROUP BY type, status`
  ).all(projectId);
  const promptDraftCount = Number(db.prepare(
    `SELECT COUNT(*) AS count
     FROM prompt_versions
     WHERE project_id = ? AND status = 'approved_draft'`
  ).get(projectId)?.count || 0);
  const policyDraftCount = Number(db.prepare(
    `SELECT COUNT(*) AS count
     FROM policy_rules
     WHERE project_id = ? AND enabled = 0`
  ).get(projectId)?.count || 0);
  const suppressRuleCount = Number(db.prepare(
    `SELECT COUNT(*) AS count
     FROM learning_rules
     WHERE project_id = ? AND status = 'active' AND rule_type = 'suppress_suggestion_pattern'`
  ).get(projectId)?.count || 0);
  const trustRuleCount = Number(db.prepare(
    `SELECT COUNT(*) AS count
     FROM learning_rules
     WHERE project_id = ? AND status = 'active' AND rule_type = 'trust_suggestion_pattern'`
  ).get(projectId)?.count || 0);
  const evalDraftCount = Number(db.prepare(
    `SELECT COUNT(*) AS count
     FROM eval_cases
     WHERE project_id = ? AND status = 'draft'`
  ).get(projectId)?.count || 0);

  for (const pattern of recurringFailurePatterns.slice(0, 5)) {
    const severity = pattern.severities?.includes("high") || Number(pattern.case_count || 0) >= 3
      ? "high"
      : "medium";
    pushInsight(insights, {
      project_id: projectId,
      report_id: reportId,
      insight_type: "recurring_failure",
      severity,
      title: `Recurring ${pattern.category} pattern`,
      description: `${pattern.category} repeated ${pattern.case_count} times across ${pattern.run_count} runs in the recent window.`,
      evidence_json: {
        period_start: periodStart,
        period_end: periodEnd,
        pattern,
      },
      recommended_action: "Promote representative runs into eval coverage and review the related prompt, tool fallback, or policy draft.",
      created_at: createdAt,
    });
  }

  const byStatus = countRowsBy(suggestionRows, "status");
  for (const type of Array.from(new Set(suggestionRows.map((row) => row.type))).sort()) {
    const rowsForType = suggestionRows.filter((row) => row.type === type);
    const approvedOrUseful = rowsForType
      .filter((row) => ["approved", "useful"].includes(row.status))
      .reduce((sum, row) => sum + Number(row.count || 0), 0);
    const rejectedOrWrong = rowsForType
      .filter((row) => ["rejected", "wrong", "not_useful"].includes(row.status))
      .reduce((sum, row) => sum + Number(row.count || 0), 0);

    if (rejectedOrWrong > 0) {
      pushInsight(insights, {
        project_id: projectId,
        report_id: reportId,
        insight_type: "judge_calibration",
        severity: rejectedOrWrong >= 3 ? "high" : "medium",
        title: `Calibrate ${type} suggestions`,
        description: `${rejectedOrWrong} ${type} suggestions were rejected, marked not useful, or marked wrong.`,
        evidence_json: {
          period_start: periodStart,
          period_end: periodEnd,
          suggestion_type: type,
          rejected_or_wrong_count: rejectedOrWrong,
          status_counts: rowsForType.map((row) => ({ status: row.status, count: Number(row.count || 0) })),
        },
        recommended_action: "Lower confidence for similar suggestions until the judge prompt or classifier evidence is improved.",
        created_at: createdAt,
      });
    }

    if (approvedOrUseful > 0) {
      pushInsight(insights, {
        project_id: projectId,
        report_id: reportId,
        insight_type: "trusted_pattern",
        severity: "low",
        title: `Trusted ${type} suggestion pattern`,
        description: `${approvedOrUseful} ${type} suggestions were approved or marked useful.`,
        evidence_json: {
          period_start: periodStart,
          period_end: periodEnd,
          suggestion_type: type,
          approved_or_useful_count: approvedOrUseful,
          status_counts: rowsForType.map((row) => ({ status: row.status, count: Number(row.count || 0) })),
        },
        recommended_action: "Keep surfacing similar suggestions, but continue requiring human approval before production changes.",
        created_at: createdAt,
      });
    }
  }

  if (Number(costOpportunity.estimated_monthly_savings || 0) > 0) {
    pushInsight(insights, {
      project_id: projectId,
      report_id: reportId,
      insight_type: "cost_learning",
      severity: Number(costOpportunity.estimated_monthly_savings || 0) >= 10 ? "medium" : "low",
      title: "Cost pattern worth tracking",
      description: `Current actionable cost suggestions imply about $${Number(costOpportunity.estimated_monthly_savings || 0).toFixed(4)} in estimated 30-day savings.`,
      evidence_json: {
        period_start: periodStart,
        period_end: periodEnd,
        cost_opportunity: costOpportunity,
      },
      recommended_action: "Track whether accepted routing, caching, batching, or prompt-compression changes reduce future report cost.",
      created_at: createdAt,
    });
  }

  if (promptDraftCount > 0) {
    pushInsight(insights, {
      project_id: projectId,
      report_id: reportId,
      insight_type: "prompt_learning",
      severity: "low",
      title: "Approved prompt drafts are accumulating",
      description: `${promptDraftCount} approved prompt draft versions exist for this project.`,
      evidence_json: {
        prompt_draft_count: promptDraftCount,
      },
      recommended_action: "Use replay/eval coverage before promoting any prompt draft to production.",
      created_at: createdAt,
    });
  }

  if (policyDraftCount > 0) {
    pushInsight(insights, {
      project_id: projectId,
      report_id: reportId,
      insight_type: "governance_learning",
      severity: "medium",
      title: "Policy drafts are waiting for review",
      description: `${policyDraftCount} disabled policy-rule drafts exist for this project.`,
      evidence_json: {
        policy_draft_count: policyDraftCount,
      },
      recommended_action: "Review disabled policy drafts and decide which should become enforceable human-review gates later.",
      created_at: createdAt,
    });
  }

  if (suppressRuleCount > 0 || trustRuleCount > 0) {
    pushInsight(insights, {
      project_id: projectId,
      report_id: reportId,
      insight_type: "learning_rule_memory",
      severity: suppressRuleCount > 0 ? "medium" : "low",
      title: "Feedback has become learning rules",
      description: `${suppressRuleCount} suppression rules and ${trustRuleCount} trust rules are active for this project.`,
      evidence_json: {
        suppress_rule_count: suppressRuleCount,
        trust_rule_count: trustRuleCount,
      },
      recommended_action: "Use these rules to suppress repeated bad advice and prioritize advice operators have validated.",
      created_at: createdAt,
    });
  }

  if (evalDraftCount > 0 && recurringFailurePatterns.length > 0) {
    pushInsight(insights, {
      project_id: projectId,
      report_id: reportId,
      insight_type: "eval_learning",
      severity: "medium",
      title: "Eval backlog should cover recurring failures",
      description: `${evalDraftCount} draft eval cases exist while recurring failures are still present.`,
      evidence_json: {
        eval_draft_count: evalDraftCount,
        recurring_failure_categories: recurringFailurePatterns.map((pattern) => pattern.category),
      },
      recommended_action: "Prioritize replay coverage for recurring failure categories before prompt or tool changes.",
      created_at: createdAt,
    });
  }

  if (Number(byStatus.get("wrong") || 0) > 0) {
    pushInsight(insights, {
      project_id: projectId,
      report_id: reportId,
      insight_type: "quality_guardrail",
      severity: "high",
      title: "Wrong suggestions must suppress future actionability",
      description: `${Number(byStatus.get("wrong") || 0)} suggestions have been marked wrong.`,
      evidence_json: {
        wrong_count: Number(byStatus.get("wrong") || 0),
      },
      recommended_action: "Keep wrong suggestions out of next actions and use them as judge-calibration examples.",
      created_at: createdAt,
    });
  }

  return insights.slice(0, 20);
}

export function persistLearningInsights(db, insights) {
  for (const insight of insights) {
    db.prepare(
      `INSERT INTO learning_insights (
        id, project_id, report_id, insight_type, severity, title, description,
        evidence_json, recommended_action, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      insight.id,
      insight.project_id,
      insight.report_id,
      insight.insight_type,
      insight.severity,
      insight.title,
      insight.description,
      toJson(insight.evidence_json),
      insight.recommended_action,
      insight.status,
      insight.created_at
    );
  }

  return insights;
}

export function listProjectLearningInsights(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?"];
    const params = [projectId];

    if (options.reportId) {
      clauses.push("report_id = ?");
      params.push(options.reportId);
    }

    if (options.insightType) {
      clauses.push("insight_type = ?");
      params.push(options.insightType);
    }

    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }

    const limit = limitValue(options.limit);
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM learning_insights
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parseLearningInsightRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
