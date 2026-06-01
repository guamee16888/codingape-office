import { markdownToHtml } from "./report-rendering.mjs";
import { isChineseLocale, labelFor, reportMarkdownForLocale, translateText } from "./i18n.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function shortId(value) {
  const text = String(value || "");
  if (text.length <= 24) return text;
  return `${text.slice(0, 10)}...${text.slice(-8)}`;
}

function statusClass(value) {
  if (["strong", "moderate"].includes(value)) return "good";
  if (["weak", "stale"].includes(value)) return "warn";
  if (["none"].includes(value)) return "danger";
  if (["ready_for_human_review", "approved_candidate"].includes(value)) return "good";
  if (["evidence_incomplete", "closure_evidence_pending", "human_review_requested", "pending_human_review", "more_evidence_requested"].includes(value)) return "warn";
  if (["blocked_by_hard_and_score", "blocked_by_hard", "blocked_by_score", "blocked_by_metric_guardrail", "blocked_not_ready"].includes(value)) return "danger";
  if (["ready_with_monitoring"].includes(value)) return "good";
  if (["limited_autonomy"].includes(value)) return "warn";
  if (["not_ready", "insufficient_data"].includes(value)) return "danger";
  if (["blocked_by_regression"].includes(value)) return "danger";
  if (["needs_review", "insufficient_eval_coverage"].includes(value)) return "warn";
  if (["passed"].includes(value)) return "good";
  if (["approved_with_monitoring"].includes(value)) return "good";
  if (["limited_autonomy"].includes(value)) return "warn";
  if (["blocked"].includes(value)) return "danger";
  if (["remediated", "verified"].includes(value)) return "good";
  if (["investigating", "reopened"].includes(value)) return "warn";
  if (["high_risk", "failed", "failure", "high", "critical"].includes(value)) return "danger";
  if (["partial_failure", "medium"].includes(value)) return "warn";
  if (["success", "sent", "approved", "useful", "low"].includes(value)) return "good";
  return "neutral";
}

function evidenceQualityLabel(score, level, locale) {
  const normalizedLevel = String(level || "none");
  const displayScore = Number.isFinite(Number(score)) ? `${Number(score)}/100` : "-";
  const zh = isChineseLocale(locale);
  const labels = {
    strong: zh ? "强证据" : "Strong",
    moderate: zh ? "中等证据" : "Moderate",
    weak: zh ? "弱证据" : "Weak",
    stale: zh ? "过期证据" : "Stale",
    none: zh ? "无有效证据" : "None",
  };
  return `${displayScore} ${labels[normalizedLevel] || normalizedLevel}`;
}

function inferredEvidenceRecheckSignal(item = {}) {
  if (item.evidence_recheck_signal?.status) return item.evidence_recheck_signal;
  if (!item.has_task) return { status: "missing_evidence_task" };
  if (Number(item.closure_recommended_count || 0) > 0) return { status: "closure_ready" };
  if (item.has_validated_action_evidence && Number(item.validated_action_evidence_quality_score || 0) >= 80) {
    return { status: "strong_evidence_metric_unresolved" };
  }
  if (item.has_validated_action_evidence && Number(item.validated_action_evidence_quality_score || 0) >= 60) {
    return { status: "platform_evidence_metric_unresolved" };
  }
  if (item.has_attached_evidence) return { status: "evidence_quality_insufficient" };
  return { status: "evidence_missing" };
}

function metricCard(label, value, detail, tone = "neutral") {
  return [
    `<section class="metric ${tone}">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(value)}</strong>`,
    detail ? `<small>${escapeHtml(detail)}</small>` : "",
    `</section>`,
  ].join("");
}

function insightCard(insight, locale) {
  return [
    `<article class="insight ${statusClass(insight.severity)}">`,
    `<div class="row">`,
    `<span class="pill ${statusClass(insight.severity)}">${escapeHtml(isChineseLocale(locale) ? labelFor(insight.severity || "low", locale) : String(insight.severity || "low").toUpperCase())}</span>`,
    `<span class="muted">${escapeHtml(labelFor(insight.insight_type, locale))}</span>`,
    `</div>`,
    `<h3>${escapeHtml(translateText(insight.title, locale))}</h3>`,
    `<p>${escapeHtml(translateText(insight.description, locale))}</p>`,
    `<small>${escapeHtml(translateText(insight.recommended_action, locale))}</small>`,
    `</article>`,
  ].join("");
}

function table(headers, rows, emptyLabel = "No records") {
  if (!rows.length) {
    return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  }

  return [
    `<div class="table-wrap"><table>`,
    `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`,
    `<tbody>`,
    rows.join(""),
    `</tbody></table></div>`,
  ].join("");
}

function actionRows(actions = [], locale) {
  return actions.slice(0, 8).map((action) => [
    `<tr>`,
    `<td><span class="pill ${statusClass(action.priority)}">${escapeHtml(isChineseLocale(locale) ? labelFor(action.priority, locale) : String(action.priority || "").toUpperCase())}</span></td>`,
    `<td>${escapeHtml(labelFor(action.type, locale))}</td>`,
    `<td>${escapeHtml(translateText(action.title, locale))}</td>`,
    `<td class="muted">${escapeHtml(translateText(action.reason, locale))}</td>`,
    `</tr>`,
  ].join(""));
}

function runRows(reportJson = {}, locale) {
  return (reportJson.trace_items || []).map((item) => {
    const expensive = (reportJson.top_expensive_runs || []).find((run) => run.run_id === item.run_id);
    return [
      `<tr>`,
      `<td><code>${escapeHtml(item.run_id)}</code></td>`,
      `<td>${escapeHtml(item.agent_id)}</td>`,
      `<td><span class="pill ${statusClass(item.status)}">${escapeHtml(labelFor(item.status, locale))}</span></td>`,
      `<td>${escapeHtml(expensive?.model || "unknown")}</td>`,
      `<td>${money(expensive?.cost || 0)}</td>`,
      `<td>${escapeHtml(expensive?.latency ?? "n/a")}s</td>`,
      `</tr>`,
    ].join("");
  });
}

function suggestionRows(reportJson = {}, locale) {
  const suggestions = [
    ...(reportJson.cost_suggestions || []),
    ...(reportJson.prompt_suggestions || []),
    ...(reportJson.risk_suggestions || []),
    ...(reportJson.eval_suggestions || []),
  ];

  return suggestions.slice(0, 10).map((item) => [
    `<tr>`,
    `<td>${escapeHtml(labelFor(item.type, locale))}</td>`,
    `<td><span class="pill ${statusClass(item.severity)}">${escapeHtml(labelFor(item.severity, locale))}</span></td>`,
    `<td>${escapeHtml(translateText(item.title, locale))}</td>`,
    `<td><span class="pill ${statusClass(item.status)}">${escapeHtml(labelFor(item.status, locale))}</span>${item.learning_rule_effect ? ` <span class="pill ${item.learning_rule_effect === "suppressed" ? "warn" : "good"}">${escapeHtml(labelFor(item.learning_rule_effect, locale))}</span>` : ""}</td>`,
    `</tr>`,
  ].join(""));
}

function feedbackButtons(item, locale) {
  const buttons = isChineseLocale(locale)
    ? [
      ["useful", "有用"],
      ["approve", "批准"],
      ["reject", "拒绝"],
      ["wrong", "错误"],
    ]
    : [
      ["useful", "Useful"],
      ["approve", "Approve"],
      ["reject", "Reject"],
      ["wrong", "Wrong"],
    ];

  return [
    `<form method="post" action="/feedback" class="button-row">`,
    `<input type="hidden" name="target_id" value="${escapeHtml(item.suggestion_id)}">`,
    `<input type="hidden" name="comment" value="operator_console">`,
    buttons.map(([value, label]) => `<button type="submit" name="feedback_type" value="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join(""),
    `</form>`,
  ].join("");
}

function certificationActionButtons(item, locale) {
  const zh = isChineseLocale(locale);
  const evidenceTargetOptions = [
    ["external", zh ? "外部证据" : "External"],
    ["incident_report", zh ? "事故" : "Incident"],
    ["eval_run", zh ? "Eval Run" : "Eval Run"],
    ["recheck", zh ? "复查" : "Recheck"],
    ["report", zh ? "报告" : "Report"],
    ["evidence_pack", zh ? "证据包" : "Evidence Pack"],
  ];
  const optionsByStatus = {
    open: [
      ["in_progress", zh ? "开始处理" : "Start"],
      ["evidence_attached", zh ? "上传证据" : "Attach Evidence"],
      ["dismissed", zh ? "驳回" : "Dismiss"],
    ],
    in_progress: [
      ["evidence_attached", zh ? "上传证据" : "Attach Evidence"],
      ["resolved", zh ? "标记解决" : "Resolve"],
      ["dismissed", zh ? "驳回" : "Dismiss"],
    ],
    evidence_attached: [
      ["resolved", zh ? "标记解决" : "Resolve"],
      ["in_progress", zh ? "继续处理" : "Continue"],
      ["dismissed", zh ? "驳回" : "Dismiss"],
    ],
    resolved: [
      ["reopened", zh ? "重新打开" : "Reopen"],
    ],
    dismissed: [
      ["reopened", zh ? "重新打开" : "Reopen"],
    ],
    reopened: [
      ["in_progress", zh ? "开始处理" : "Start"],
      ["evidence_attached", zh ? "上传证据" : "Attach Evidence"],
      ["resolved", zh ? "标记解决" : "Resolve"],
    ],
  };
  const transitions = optionsByStatus[item.status] || [];

  if (!transitions.length) {
    return `<span class="muted">${escapeHtml(zh ? "当前状态无需操作" : "No action available")}</span>`;
  }

  return [
    `<form method="post" action="/certification-action" class="button-row action-form">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(item.id)}">`,
    `<input class="compact-input" name="note" placeholder="${escapeHtml(zh ? "备注" : "Note")}" value="${escapeHtml(zh ? "本地控制台处理" : "local console update")}">`,
    `<select class="compact-input" name="evidence_target_type" aria-label="${escapeHtml(zh ? "证据类型" : "Evidence type")}">${evidenceTargetOptions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}</select>`,
    `<input class="compact-input" name="evidence_target_id" placeholder="${escapeHtml(zh ? "对象 ID" : "Target ID")}" value="">`,
    `<input class="compact-input" name="evidence_ref" placeholder="${escapeHtml(zh ? "证据链接/编号" : "Evidence ref")}" value="">`,
    transitions.map(([value, label]) => `<button type="submit" name="status" value="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join(""),
    `</form>`,
  ].join("");
}

function reviewQueueRows(reportJson = {}, locale, options = {}) {
  const suggestions = [
    ...(reportJson.cost_suggestions || []),
    ...(reportJson.prompt_suggestions || []),
    ...(reportJson.risk_suggestions || []),
    ...(reportJson.eval_suggestions || []),
  ].filter((item) => !["approved", "rejected", "wrong", "not_useful", "useful"].includes(item.status));

  return suggestions.slice(0, 10).map((item) => {
    const command = `npm run local:feedback -- --target ${item.suggestion_id} --type useful --comment "reviewed"`;
    const actionCell = options.feedbackForms
      ? feedbackButtons(item, locale)
      : `<code>${escapeHtml(command)}</code>`;

    return [
      `<tr>`,
      `<td><code>${escapeHtml(item.suggestion_id)}</code></td>`,
      `<td>${escapeHtml(labelFor(item.type, locale))}</td>`,
      `<td><span class="pill ${statusClass(item.severity)}">${escapeHtml(labelFor(item.severity, locale))}</span></td>`,
      `<td>${escapeHtml(translateText(item.title, locale))}</td>`,
      `<td>${actionCell}</td>`,
      `</tr>`,
    ].join("");
  });
}

function assetList(assets = {}, locale) {
  const items = isChineseLocale(locale) ? [
    ["运行轨迹", assets.agent_run_traces],
    ["结果标签", assets.outcome_labels],
    ["失败案例", assets.failure_cases],
    ["失败分类", assets.failure_taxonomies],
    ["评估用例", assets.eval_cases],
    ["优化建议", assets.optimization_suggestions],
    ["自我进化洞察", assets.learning_insights],
    ["学习规则", assets.learning_rules],
    ["学习规则事件", assets.learning_rule_events],
    ["可靠性评分", assets.reliability_scores],
    ["评分快照", assets.score_snapshots],
    ["策略草案", assets.policy_rules],
    ["策略审核事件", assets.policy_rule_events],
    ["策略审核任务", assets.policy_review_tasks],
    ["策略审核任务事件", assets.policy_review_task_events],
    ["策略审核动作事件", assets.policy_review_work_item_events],
    ["策略审核动作效果", assets.policy_review_work_item_effectiveness],
    ["策略状态候选动作", assets.policy_rule_review_candidates],
    ["候选动作事件", assets.policy_rule_review_candidate_events],
    ["策略 Dry-run", assets.policy_dry_runs],
    ["策略命中证据", assets.policy_dry_run_matches],
    ["Prompt 草案", assets.prompt_versions],
    ["Prompt 发布检查", assets.prompt_promotion_checks],
    ["自主运行门禁", assets.autonomy_gate_checks],
    ["评估运行", assets.eval_runs],
    ["回放结果", assets.replay_results],
    ["模型路由策略", assets.model_route_policies],
    ["事故报告", assets.incident_reports],
    ["事故处理事件", assets.incident_remediation_events],
    ["认证补证任务", assets.certification_evidence_tasks],
    ["补证任务事件", assets.certification_evidence_task_events],
    ["认证推进队列", assets.certification_action_queue],
    ["认证推进事件", assets.certification_action_events],
    ["认证动作效果", assets.certification_action_effectiveness],
    ["审计证据条目", assets.audit_evidence_items],
    ["匿名 Benchmark", assets.anonymized_benchmark_patterns],
    ["审计事件", assets.audit_events],
  ] : [
    ["Run traces", assets.agent_run_traces],
    ["Outcome labels", assets.outcome_labels],
    ["Failure cases", assets.failure_cases],
    ["Failure taxonomies", assets.failure_taxonomies],
    ["Eval cases", assets.eval_cases],
    ["Suggestions", assets.optimization_suggestions],
    ["Learning insights", assets.learning_insights],
    ["Learning rules", assets.learning_rules],
    ["Learning rule events", assets.learning_rule_events],
    ["Policy drafts", assets.policy_rules],
    ["Policy review events", assets.policy_rule_events],
    ["Policy review tasks", assets.policy_review_tasks],
    ["Policy review task events", assets.policy_review_task_events],
    ["Policy work item events", assets.policy_review_work_item_events],
    ["Policy work item effectiveness", assets.policy_review_work_item_effectiveness],
    ["Policy review candidates", assets.policy_rule_review_candidates],
    ["Policy candidate events", assets.policy_rule_review_candidate_events],
    ["Policy dry-runs", assets.policy_dry_runs],
    ["Policy match evidence", assets.policy_dry_run_matches],
    ["Prompt drafts", assets.prompt_versions],
    ["Prompt promotion checks", assets.prompt_promotion_checks],
    ["Autonomy gate checks", assets.autonomy_gate_checks],
    ["Eval runs", assets.eval_runs],
    ["Replay results", assets.replay_results],
    ["Model route policies", assets.model_route_policies],
    ["Incident reports", assets.incident_reports],
    ["Incident remediation events", assets.incident_remediation_events],
    ["Certification evidence tasks", assets.certification_evidence_tasks],
    ["Evidence task events", assets.certification_evidence_task_events],
    ["Certification action queue", assets.certification_action_queue],
    ["Certification action events", assets.certification_action_events],
    ["Certification action effectiveness", assets.certification_action_effectiveness],
    ["Audit evidence items", assets.audit_evidence_items],
    ["Benchmark patterns", assets.anonymized_benchmark_patterns],
    ["Audit events", assets.audit_events],
  ];

  return items.map(([label, value]) => [
    `<div class="asset-row">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(value ?? 0)}</strong>`,
    `</div>`,
  ].join("")).join("");
}

function readinessRows(reportJson = {}, locale) {
  const readiness = reportJson.autonomy_readiness || {};
  return [readiness.project_score, ...(readiness.agent_scores || [])].filter(Boolean).map((score) => [
    `<tr>`,
    `<td>${escapeHtml(labelFor(score.target_type, locale))}</td>`,
    `<td><code>${escapeHtml(score.target_id)}</code></td>`,
    `<td><span class="pill ${statusClass(score.readiness_status)}">${escapeHtml(labelFor(score.readiness_status, locale))}</span></td>`,
    `<td>${escapeHtml(score.autonomy_readiness_score ?? 0)}/100</td>`,
    `<td>${escapeHtml(score.reliability_score ?? 0)}/100</td>`,
    `<td>${escapeHtml(score.risk_exposure_score ?? 0)}/100</td>`,
    `<td>${escapeHtml(score.regression_stability_score ?? 0)}/100</td>`,
    `<td class="muted">${escapeHtml(translateText((score.score_reasons || [])[0] || score.autonomy_decision || "", locale))}</td>`,
    `</tr>`,
  ].join(""));
}

function certificationRoadmapRows(reportJson = {}, locale) {
  const zh = isChineseLocale(locale);
  return (reportJson.autonomy_certification_roadmaps || []).map((roadmap) => [
    `<tr>`,
    `<td><code>${escapeHtml(roadmap.agent_id)}</code></td>`,
    `<td>${escapeHtml(`${roadmap.current_score}/100`)}</td>`,
    `<td>${escapeHtml(`${roadmap.target_autonomy_level} / ${roadmap.target_score}/100`)}</td>`,
    `<td><span class="pill ${statusClass(roadmap.current_gate_status)}">${escapeHtml(zh ? labelFor(roadmap.current_gate_status, locale) : roadmap.current_gate_status)}</span></td>`,
    `<td><span class="pill ${statusClass(roadmap.certification_state?.current_state)}">${escapeHtml(labelFor(roadmap.certification_state?.current_state || "unknown", locale))}</span></td>`,
    `<td>${escapeHtml(zh ? labelFor(roadmap.blocked_by, locale) : roadmap.blocked_by)}</td>`,
    `<td>${escapeHtml(`${roadmap.estimated_score_after_plan}/100`)}</td>`,
    `</tr>`,
  ].join(""));
}

function certificationCurrentBlockerRows(reportJson = {}, locale) {
  return (reportJson.autonomy_certification_roadmaps || [])
    .flatMap((roadmap) => [
      ...(roadmap.hard_blockers || []).map((blocker) => ({ ...blocker, agent_id: roadmap.agent_id, blocker_type: "hard_blocker" })),
      ...(roadmap.score_blockers || []).map((blocker) => ({ ...blocker, agent_id: roadmap.agent_id, blocker_type: "score_blocker" })),
    ])
    .slice(0, 14)
    .map((blocker) => [
      `<tr>`,
      `<td><code>${escapeHtml(blocker.agent_id || "")}</code></td>`,
      `<td><span class="pill ${statusClass(blocker.blocker_type)}">${escapeHtml(labelFor(blocker.blocker_type, locale))}</span></td>`,
      `<td><code>${escapeHtml(blocker.code || "")}</code><br><span class="muted">${escapeHtml(labelFor(blocker.code || "", locale))}</span></td>`,
      `<td><span class="pill ${statusClass(blocker.severity)}">${escapeHtml(labelFor(blocker.severity || "medium", locale))}</span></td>`,
      `<td>${escapeHtml(blocker.current ?? "-")} -> ${escapeHtml(blocker.target ?? "-")}</td>`,
      `<td class="muted">${escapeHtml(blocker.readiness_evidence_status ? labelFor(blocker.readiness_evidence_status, locale) : blocker.metric ? labelFor(blocker.metric, locale) : "")}</td>`,
      `</tr>`,
    ].join(""));
}

function certificationBreakdownRows(reportJson = {}, locale) {
  const roadmaps = reportJson.autonomy_certification_roadmaps || [];
  const roadmap = roadmaps[0] || {};
  const dimensions = roadmap.score_breakdown?.dimensions || {};
  return Object.entries(dimensions).map(([key, value]) => [
    `<tr>`,
    `<td>${escapeHtml(labelFor(key, locale))}</td>`,
    `<td>${escapeHtml(value.score ?? 0)}/100</td>`,
    `<td>${escapeHtml(JSON.stringify(value.current_metrics || {}))}</td>`,
    `<td>${escapeHtml(JSON.stringify(value.target_metrics || {}))}</td>`,
    `<td class="muted">${escapeHtml((value.reasons || []).map((item) => translateText(item, locale)).join(" "))}</td>`,
    `</tr>`,
  ].join(""));
}

function certificationObjectiveRows(reportJson = {}, locale) {
  return (reportJson.autonomy_certification_roadmaps || [])
    .flatMap((roadmap) => roadmap.remediation_objectives || [])
    .slice(0, 10)
    .map((item) => [
      `<tr>`,
      `<td><span class="pill ${statusClass(item.severity)}">${escapeHtml(labelFor(item.severity, locale))}</span></td>`,
      `<td><span class="pill ${statusClass(item.status)}">${escapeHtml(labelFor(item.status || "open", locale))}</span></td>`,
      `<td>${escapeHtml(translateText(item.title || "", locale))}</td>`,
      `<td>${escapeHtml(item.current_value)} -> ${escapeHtml(item.target_value)}</td>`,
      `<td>+${escapeHtml(item.expected_score_delta || 0)}</td>`,
      `<td class="muted">${escapeHtml((item.verification_requirements || []).join(", "))}</td>`,
      `<td><code>${escapeHtml(item.id || "")}</code></td>`,
      `</tr>`,
    ].join(""));
}

function certificationRecheckRows(reportJson = {}, locale) {
  return (reportJson.autonomy_certification_rechecks || []).slice(0, 10).map((item) => {
    const summary = item.recheck_summary || {};
    return [
      `<tr>`,
      `<td><code>${escapeHtml(item.id)}</code></td>`,
      `<td><code>${escapeHtml(item.agent_id)}</code></td>`,
      `<td>${escapeHtml(item.previous_score ?? "none")} -> ${escapeHtml(item.new_score)}/${escapeHtml(item.target_score)}</td>`,
      `<td><span class="pill ${statusClass(item.new_gate_status)}">${escapeHtml(labelFor(item.new_gate_status, locale))}</span></td>`,
      `<td><span class="pill ${statusClass(summary.certification_state?.current_state)}">${escapeHtml(labelFor(summary.certification_state?.current_state || "unknown", locale))}</span></td>`,
      `<td>${escapeHtml(labelFor(item.new_blocked_by, locale))}</td>`,
      `<td><span class="pill ${statusClass(summary.metric_validation_status)}">${escapeHtml(labelFor(summary.metric_validation_status || "unknown", locale))}</span></td>`,
      `<td><span class="pill ${statusClass(summary.evidence_requirement_status)}">${escapeHtml(labelFor(summary.evidence_requirement_status || "unknown", locale))}</span></td>`,
      `<td><span class="pill ${statusClass(summary.run_closure_status)}">${escapeHtml(labelFor(summary.run_closure_status || "unknown", locale))}</span></td>`,
      `<td><span class="pill ${statusClass(summary.certification_evidence_task_status)}">${escapeHtml(labelFor(summary.certification_evidence_task_status || "unknown", locale))}</span></td>`,
      `<td>${escapeHtml(summary.verified_but_unresolved_count || 0)}</td>`,
      `<td>${escapeHtml(summary.incomplete_evidence_review_count || 0)}</td>`,
      `<td>${escapeHtml(summary.certification_evidence_task_summary?.ready_task_count || 0)} / ${escapeHtml(summary.certification_evidence_task_summary?.pending_task_count || 0)}</td>`,
      `<td>${escapeHtml(summary.certification_evidence_task_summary?.closure_recommended_count || 0)}</td>`,
      `<td>${escapeHtml(summary.run_closure_ready_count || 0)} / ${escapeHtml(summary.run_closure_still_blocked_count || 0)}</td>`,
      `</tr>`,
    ].join("");
  });
}

function certificationEvidenceReviewRows(reportJson = {}, locale) {
  return (reportJson.autonomy_certification_rechecks || [])
    .flatMap((recheck) => (recheck.recheck_summary?.verified_objective_validations || []).map((item) => ({ ...item, recheck_id: recheck.id })))
    .slice(0, 10)
    .map((item) => [
      `<tr>`,
      `<td><code>${escapeHtml(item.recheck_id)}</code></td>`,
      `<td>${escapeHtml(translateText(item.objective_title || "", locale))}</td>`,
      `<td><span class="pill ${statusClass(item.objective_status)}">${escapeHtml(labelFor(item.objective_status || "unknown", locale))}</span></td>`,
      `<td><span class="pill ${statusClass(item.validation_status)}">${escapeHtml(labelFor(item.validation_status || "unknown", locale))}</span></td>`,
      `<td class="muted">${escapeHtml([...(item.metric_signal?.matching_hard_blockers || []), ...(item.metric_signal?.matching_score_blockers || [])].slice(0, 4).join(", "))}</td>`,
      `</tr>`,
    ].join(""));
}

function certificationReviewRequestRows(reportJson = {}, locale) {
  return (reportJson.certification_review_requests || []).slice(0, 10).map((item) => [
    `<tr>`,
    `<td><code>${escapeHtml(item.id || "")}</code></td>`,
    `<td><code>${escapeHtml(item.agent_id || "")}</code></td>`,
    `<td><span class="pill ${statusClass(item.request_status)}">${escapeHtml(labelFor(item.request_status || "unknown", locale))}</span></td>`,
    `<td><span class="pill ${statusClass(item.certification_state)}">${escapeHtml(labelFor(item.certification_state || "unknown", locale))}</span></td>`,
    `<td>${escapeHtml(item.current_score ?? 0)}/${escapeHtml(item.target_score ?? 0)}</td>`,
    `<td>${escapeHtml(labelFor(item.reviewer_decision?.decision || "none", locale))}</td>`,
    `<td><code>${escapeHtml(item.audit_evidence_item_id || "")}</code></td>`,
    `</tr>`,
  ].join(""));
}

function certificationEvidenceTaskRows(reportJson = {}, locale) {
  return (reportJson.certification_evidence_tasks || []).slice(0, 12).map((item) => [
    `<tr>`,
    `<td><code>${escapeHtml(item.id || "")}</code></td>`,
    `<td><span class="pill ${statusClass(item.severity)}">${escapeHtml(labelFor(item.severity || "medium", locale))}</span></td>`,
    `<td><span class="pill ${statusClass(item.status)}">${escapeHtml(labelFor(item.status || "open", locale))}</span></td>`,
    `<td>${escapeHtml(labelFor(item.task_type || "unknown", locale))}</td>`,
    `<td>${escapeHtml(translateText(item.title || "", locale))}</td>`,
    `<td class="muted">${escapeHtml((item.required_evidence || []).slice(0, 3).join(", "))}</td>`,
    `<td>${escapeHtml(item.updated_at || item.created_at || "")}</td>`,
    `</tr>`,
  ].join(""));
}

function certificationEvidenceTaskClosureRows(reportJson = {}, locale) {
  return (reportJson.autonomy_certification_rechecks || [])
    .flatMap((recheck) => (recheck.recheck_summary?.certification_evidence_task_summary?.closure_recommended_tasks || [])
      .map((item) => ({ ...item, recheck_id: recheck.id })))
    .slice(0, 10)
    .map((item) => [
      `<tr>`,
      `<td><code>${escapeHtml(item.recheck_id || "")}</code></td>`,
      `<td><code>${escapeHtml(item.id || "")}</code></td>`,
      `<td><span class="pill ${statusClass(item.severity)}">${escapeHtml(labelFor(item.severity || "medium", locale))}</span></td>`,
      `<td><span class="pill ${statusClass(item.status)}">${escapeHtml(labelFor(item.status || "open", locale))}</span></td>`,
      `<td>${escapeHtml(translateText(item.title || "", locale))}</td>`,
      `<td>${escapeHtml(item.criteria_satisfied_count || 0)} / ${escapeHtml(item.criteria_total_count || 0)}</td>`,
      `<td class="muted">${escapeHtml(item.closure_recommendation_reason || "")}</td>`,
      `</tr>`,
    ].join(""));
}

function certificationBlockerTaskCoverageRows(reportJson = {}, locale) {
  return (reportJson.autonomy_certification_rechecks || [])
    .flatMap((recheck) => (recheck.recheck_summary?.certification_evidence_task_summary?.blocker_task_coverage || [])
      .map((item) => ({ ...item, recheck_id: recheck.id })))
    .slice(0, 16)
    .map((item) => {
      const recheckSignal = inferredEvidenceRecheckSignal(item);
      return [
      `<tr>`,
      `<td><code>${escapeHtml(item.recheck_id || "")}</code></td>`,
      `<td><span class="pill ${statusClass(item.blocker_type)}">${escapeHtml(labelFor(item.blocker_type || "unknown", locale))}</span></td>`,
      `<td><code>${escapeHtml(item.code || "")}</code></td>`,
      `<td><span class="pill ${statusClass(item.severity)}">${escapeHtml(labelFor(item.severity || "medium", locale))}</span></td>`,
      `<td>${escapeHtml(item.current ?? "")} -> ${escapeHtml(item.target ?? "")}</td>`,
      `<td>${escapeHtml(item.task_count || 0)}</td>`,
      `<td>${escapeHtml(item.open_task_count || 0)} / ${escapeHtml(item.ready_task_count || 0)} / ${escapeHtml(item.closure_recommended_count || 0)}</td>`,
      `<td><span class="pill ${statusClass(item.has_attached_evidence ? "warn" : "neutral")}">${escapeHtml(item.has_attached_evidence ? (isChineseLocale(locale) ? "有证据但仍阻断" : "Evidence attached, still blocked") : (isChineseLocale(locale) ? "未上传证据" : "No evidence attached"))}</span></td>`,
      `<td><span class="pill ${statusClass(item.validated_action_evidence_quality_level || "none")}">${escapeHtml(evidenceQualityLabel(item.validated_action_evidence_quality_score, item.validated_action_evidence_quality_level, locale))}</span></td>`,
      `<td><span class="pill ${statusClass(recheckSignal.status || "neutral")}">${escapeHtml(labelFor(recheckSignal.status || "unknown", locale))}</span></td>`,
      `<td><span class="pill ${statusClass(item.next_action?.action_type || "neutral")}">${escapeHtml(labelFor(item.next_action?.action_type || "unknown", locale))}</span><br><span class="muted">${escapeHtml(translateText(item.next_action?.reason || "", locale))}</span></td>`,
      `<td class="muted">${escapeHtml((item.tasks || []).map((task) => `${task.id}:${task.status}`).join(", "))}</td>`,
      `</tr>`,
    ].join("");
    });
}

function certificationActionQueueRows(reportJson = {}, locale, options = {}) {
  return (reportJson.certification_action_queue || []).slice(0, 12).map((item) => {
    const recheckSignal = inferredEvidenceRecheckSignal(item.action?.task_coverage || {});
    const learningAdjustment = item.action?.learning_priority_adjustment || item.action?.task_coverage?.learning_priority_adjustment || {};
    const adjustment = Number(learningAdjustment.adjustment || 0);
    return [
    `<tr>`,
    `<td><code title="${escapeHtml(item.id || "")}">${escapeHtml(shortId(item.id))}</code></td>`,
    `<td>${escapeHtml(item.priority ?? "")}</td>`,
    `<td><span class="pill ${statusClass(item.severity)}">${escapeHtml(labelFor(item.severity || "medium", locale))}</span></td>`,
    `<td><span class="pill ${statusClass(item.recommended_action)}">${escapeHtml(labelFor(item.recommended_action || "unknown", locale))}</span></td>`,
    `<td><code>${escapeHtml(item.blocker_code || "")}</code></td>`,
    `<td><code title="${escapeHtml(item.certification_evidence_task_id || "")}">${escapeHtml(shortId(item.certification_evidence_task_id))}</code></td>`,
    `<td><span class="pill ${statusClass(item.status)}">${escapeHtml(labelFor(item.status || "open", locale))}</span></td>`,
    `<td><span class="pill ${statusClass(item.action?.task_coverage?.validated_action_evidence_quality_level || "none")}">${escapeHtml(evidenceQualityLabel(item.action?.task_coverage?.validated_action_evidence_quality_score, item.action?.task_coverage?.validated_action_evidence_quality_level, locale))}</span></td>`,
    `<td><span class="pill ${statusClass(recheckSignal.status || "neutral")}">${escapeHtml(labelFor(recheckSignal.status || "unknown", locale))}</span></td>`,
    `<td><span class="pill ${statusClass(adjustment > 0 ? "good" : adjustment < 0 ? "warn" : "neutral")}">${escapeHtml(`${adjustment >= 0 ? "+" : ""}${adjustment}`)}</span><br><span class="muted">${escapeHtml((learningAdjustment.reasons || []).map((reason) => labelFor(reason.rule_type, locale)).join(", "))}</span></td>`,
    options.certificationActionForms
      ? `<td>${certificationActionButtons(item, locale)}</td>`
      : `<td><code>${escapeHtml(`npm run local:certification-actions -- --action ${item.id} --status in_progress --note "started"` )}</code></td>`,
    `<td class="muted">${escapeHtml(item.reason || "")}</td>`,
    `</tr>`,
    ].join("");
  });
}

function certificationActionEventRows(reportJson = {}, locale) {
  return [...(reportJson.certification_action_events || [])]
    .sort((a, b) => {
      const aMeaningful = a.evidence?.evidence_target_validated ? 1 : 0;
      const bMeaningful = b.evidence?.evidence_target_validated ? 1 : 0;
      if (aMeaningful !== bMeaningful) return bMeaningful - aMeaningful;
      const aSuperseded = a.to_status === "superseded" ? 1 : 0;
      const bSuperseded = b.to_status === "superseded" ? 1 : 0;
      if (aSuperseded !== bSuperseded) return aSuperseded - bSuperseded;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    })
    .slice(0, 12)
    .map((event) => [
    `<tr>`,
    `<td><code title="${escapeHtml(event.id || "")}">${escapeHtml(shortId(event.id))}</code></td>`,
    `<td><code title="${escapeHtml(event.certification_action_id || "")}">${escapeHtml(shortId(event.certification_action_id))}</code></td>`,
    `<td>${escapeHtml(event.created_at || "")}</td>`,
    `<td><span class="pill ${statusClass(event.from_status)}">${escapeHtml(labelFor(event.from_status || "unknown", locale))}</span> -> <span class="pill ${statusClass(event.to_status)}">${escapeHtml(labelFor(event.to_status || "unknown", locale))}</span></td>`,
    `<td>${escapeHtml(labelFor(event.actor_type || "system", locale))}${event.actor_id ? ` / <code>${escapeHtml(event.actor_id)}</code>` : ""}</td>`,
    `<td><span class="pill neutral">${escapeHtml(labelFor(event.evidence?.evidence_target_type || "external", locale))}</span></td>`,
    `<td><code title="${escapeHtml(event.evidence?.evidence_target_id || "")}">${escapeHtml(shortId(event.evidence?.evidence_target_id || ""))}</code></td>`,
    `<td><code title="${escapeHtml(event.evidence?.evidence_ref || "")}">${escapeHtml(shortId(event.evidence?.evidence_ref || ""))}</code></td>`,
    `<td><span class="pill ${statusClass(event.evidence_quality_level || "none")}">${escapeHtml(evidenceQualityLabel(event.evidence_quality_score, event.evidence_quality_level, locale))}</span></td>`,
    `<td class="muted">${escapeHtml(event.note || "")}</td>`,
    `</tr>`,
  ].join(""));
}

function certificationActionEffectivenessRows(reportJson = {}, locale) {
  return (reportJson.certification_action_effectiveness || []).slice(0, 12).map((item) => [
    `<tr>`,
    `<td><code title="${escapeHtml(item.id || "")}">${escapeHtml(shortId(item.id))}</code></td>`,
    `<td><code title="${escapeHtml(item.certification_action_id || "")}">${escapeHtml(shortId(item.certification_action_id))}</code></td>`,
    `<td><code>${escapeHtml(item.blocker_code || "")}</code></td>`,
    `<td><span class="pill ${statusClass(item.recommended_action)}">${escapeHtml(labelFor(item.recommended_action || "unknown", locale))}</span></td>`,
    `<td><span class="pill ${statusClass(item.effectiveness_status)}">${escapeHtml(labelFor(item.effectiveness_status || "unknown", locale))}</span></td>`,
    `<td>${escapeHtml(item.previous_score ?? "-")} -> ${escapeHtml(item.new_score ?? "-")} (${Number(item.score_delta || 0) >= 0 ? "+" : ""}${escapeHtml(item.score_delta || 0)})</td>`,
    `<td><span class="pill ${statusClass(item.blocker_persisted ? "warn" : "good")}">${escapeHtml(item.blocker_persisted ? (isChineseLocale(locale) ? "仍阻断" : "Persisted") : (isChineseLocale(locale) ? "已解除" : "Cleared"))}</span></td>`,
    `<td><span class="pill ${statusClass(item.evidence_quality_level || "none")}">${escapeHtml(evidenceQualityLabel(item.evidence_quality_score, item.evidence_quality_level, locale))}</span></td>`,
    `<td><code title="${escapeHtml(item.evaluation_recheck_id || "")}">${escapeHtml(shortId(item.evaluation_recheck_id))}</code></td>`,
    `</tr>`,
  ].join(""));
}

function ruleSourceLabel(rule, locale) {
  const source = rule.evidence_json?.source || ((rule.pattern_json || {}).target === "certification_action_effectiveness" ? "certification_action_effectiveness" : "feedback");
  if (source === "certification_action_effectiveness") {
    return isChineseLocale(locale) ? "认证效果" : "Certification";
  }
  if (source === "policy_review_work_item_effectiveness" || (rule.pattern_json || {}).target === "policy_review_work_item_effectiveness") {
    return isChineseLocale(locale) ? "策略审核效果" : "Policy work item";
  }
  return isChineseLocale(locale) ? "用户反馈" : "Feedback";
}

function learningRuleInfluenceText(rule, reportJson = {}, locale) {
  const pattern = rule.pattern_json || {};
  const affected = (reportJson.certification_action_queue || []).filter((item) => {
    const reasons = item.action?.learning_priority_adjustment?.reasons || [];
    return reasons.some((reason) => reason.learning_rule_id === rule.id);
  });
  if (affected.length) {
    return `${affected.length} ${isChineseLocale(locale) ? "个动作" : "action(s)"} / ${affected.map((item) => `${item.blocker_code}:${item.priority}`).join(", ")}`;
  }
  if (pattern.target === "certification_action_effectiveness") {
    return isChineseLocale(locale) ? "等待下一轮匹配" : "Awaiting next match";
  }
  if (pattern.target === "policy_review_work_item_effectiveness") {
    return isChineseLocale(locale) ? "调整策略审核动作优先级" : "Policy workbench priority";
  }
  return isChineseLocale(locale) ? "影响建议排序" : "Suggestion calibration";
}

function learningRuleRows(reportJson = {}, locale) {
  return (reportJson.learning_rules || []).slice(0, 10).map((rule) => {
    const pattern = rule.pattern_json || {};
    const effect = rule.rule_type === "suppress_suggestion_pattern"
      ? "suppressed"
      : rule.rule_type === "trust_suggestion_pattern"
        ? "trusted"
        : rule.rule_type;
    const target = pattern.suggestion_type || pattern.recommended_action || pattern.blocker_code || "pattern";
    const evidence = rule.evidence_json || {};
    const evidenceText = evidence.source_effectiveness_count
      ? `${evidence.source_effectiveness_count} / ${labelFor(evidence.latest_effectiveness_status, locale)}`
      : evidence.source_feedback_count
        ? `${evidence.source_feedback_count}`
        : "-";

    return [
      `<tr>`,
      `<td><span class="pill ${effect === "suppressed" ? "warn" : "good"}">${escapeHtml(labelFor(effect, locale))}</span></td>`,
      `<td>${escapeHtml(ruleSourceLabel(rule, locale))}</td>`,
      `<td>${escapeHtml(labelFor(target, locale))}</td>`,
      `<td>${escapeHtml(translateText(pattern.title || pattern.blocker_code || rule.pattern_key, locale))}</td>`,
      `<td>${escapeHtml(Number(rule.confidence || 0).toFixed(2))}</td>`,
      `<td><span class="pill ${statusClass(rule.status)}">${escapeHtml(labelFor(rule.status || "active", locale))}</span></td>`,
      `<td>${escapeHtml(evidenceText)}</td>`,
      `<td>${escapeHtml(learningRuleInfluenceText(rule, reportJson, locale))}</td>`,
      `<td><code>${escapeHtml(rule.id)}</code></td>`,
      `</tr>`,
    ].join("");
  });
}

function policyLearningReviewRows(reportJson = {}, locale) {
  return policyLearningReviewRowsWithOptions(reportJson, locale);
}

function learningRuleStatusButtons(status, locale) {
  const zh = isChineseLocale(locale);
  const transitions = {
    active: [["trusted", zh ? "信任" : "Trust"], ["paused", zh ? "暂停" : "Pause"], ["rejected", zh ? "拒绝" : "Reject"]],
    paused: [["active", zh ? "重新启用" : "Reactivate"], ["rejected", zh ? "拒绝" : "Reject"]],
    trusted: [["paused", zh ? "暂停" : "Pause"], ["rejected", zh ? "拒绝" : "Reject"]],
    rejected: [["active", zh ? "重新启用" : "Reactivate"]],
  };
  return transitions[status] || transitions.active;
}

function policyLearningReviewRowsWithOptions(reportJson = {}, locale, options = {}) {
  return (reportJson.learning_rule_review?.learning_rule_review || []).slice(0, 12).map((rule) => {
    const source = rule.review?.source || "unknown";
    const affectedActions = Number(rule.review?.affected_action_count || 0);
    const affectedPolicyItems = Number(rule.review?.affected_policy_work_item_count || 0);
    const affected = [
      affectedActions ? `${affectedActions} ${isChineseLocale(locale) ? "个认证动作" : "certification action(s)"}` : null,
      affectedPolicyItems ? `${affectedPolicyItems} ${isChineseLocale(locale) ? "个策略审核动作" : "policy work item(s)"}` : null,
    ].filter(Boolean).join(" / ") || "0";
    const nextStatus = rule.status === "active"
      ? (rule.review?.suggested_review_decision === "review_before_trusting" ? "paused" : "trusted")
      : rule.status === "paused"
        ? "active"
        : rule.status === "trusted"
          ? "paused"
          : "active";
    const command = `npm run local:learning-rule-review -- --rule ${rule.id} --status ${nextStatus} --note "reviewed"`;
    const reviewCell = options.learningRuleForms
      ? [
        `<form method="post" action="/console" class="button-row">`,
        `<input type="hidden" name="intent" value="learning_rule_review">`,
        `<input type="hidden" name="learning_rule_id" value="${escapeHtml(rule.id || "")}">`,
        ...learningRuleStatusButtons(rule.status || "active", locale).map(([value, label]) => (
          `<button type="submit" name="status" value="${escapeHtml(value)}">${escapeHtml(label)}</button>`
        )),
        `<input class="compact-input" name="note" value="${escapeHtml(isChineseLocale(locale) ? "已人工审核" : "reviewed")}">`,
        `</form>`,
      ].join("")
      : `<code>${escapeHtml(command)}</code>`;

    return [
      `<tr>`,
      `<td><code title="${escapeHtml(rule.id || "")}">${escapeHtml(shortId(rule.id))}</code></td>`,
      `<td><span class="pill neutral">${escapeHtml(labelFor(source, locale))}</span></td>`,
      `<td><span class="pill ${statusClass(rule.rule_type)}">${escapeHtml(labelFor(rule.rule_type || "unknown", locale))}</span></td>`,
      `<td>${escapeHtml(Number(rule.confidence || 0).toFixed(2))}</td>`,
      `<td><span class="pill ${statusClass(rule.status || "active")}">${escapeHtml(labelFor(rule.status || "active", locale))}</span></td>`,
      `<td>${escapeHtml(affected)}</td>`,
      `<td><span class="pill ${statusClass(rule.review?.suggested_review_decision || "unknown")}">${escapeHtml(labelFor(rule.review?.suggested_review_decision || "unknown", locale))}</span></td>`,
      `<td class="muted">${escapeHtml(rule.review?.safety_boundary || "")}</td>`,
      `<td>${reviewCell}</td>`,
      `</tr>`,
    ].join("");
  });
}

function policyLearningReviewSummaryRows(reportJson = {}, locale) {
  const summary = reportJson.learning_rule_review?.summary || {};
  const zh = isChineseLocale(locale);
  const rows = [
    [zh ? "总学习规则" : "Total rules", summary.total_rules || 0],
    [zh ? "活跃规则" : "Active rules", summary.active_rules || 0],
    [zh ? "用户反馈规则" : "Feedback rules", summary.feedback_rules || 0],
    [zh ? "认证效果规则" : "Certification effectiveness rules", summary.certification_effectiveness_rules || 0],
    [zh ? "策略审核效果规则" : "Policy work item effectiveness rules", summary.policy_work_item_effectiveness_rules || 0],
    [zh ? "影响认证动作" : "Affected certification actions", summary.affected_action_count || 0],
    [zh ? "影响策略审核动作" : "Affected policy work items", summary.affected_policy_work_item_count || 0],
  ];

  return rows.map(([label, value]) => [
    `<tr>`,
    `<td>${escapeHtml(label)}</td>`,
    `<td><strong>${escapeHtml(value)}</strong></td>`,
    `</tr>`,
  ].join(""));
}

function learningRuleEventRows(reportJson = {}, locale) {
  return (reportJson.learning_rule_events || []).slice(0, 12).map((event) => [
    `<tr>`,
    `<td><code title="${escapeHtml(event.id || "")}">${escapeHtml(shortId(event.id))}</code></td>`,
    `<td><code title="${escapeHtml(event.learning_rule_id || "")}">${escapeHtml(shortId(event.learning_rule_id))}</code></td>`,
    `<td>${escapeHtml(event.created_at || "")}</td>`,
    `<td><span class="pill ${statusClass(event.from_status)}">${escapeHtml(labelFor(event.from_status || "unknown", locale))}</span> -> <span class="pill ${statusClass(event.to_status)}">${escapeHtml(labelFor(event.to_status || "unknown", locale))}</span></td>`,
    `<td>${escapeHtml(labelFor(event.actor_type || "system", locale))}${event.actor_id ? ` / <code>${escapeHtml(event.actor_id)}</code>` : ""}</td>`,
    `<td class="muted">${escapeHtml(event.note || "")}</td>`,
    `</tr>`,
  ].join(""));
}

function learningRulePolicyDraftRows(reportJson = {}, locale) {
  return (reportJson.learning_rule_policy_drafts?.results || []).slice(0, 12).map((item) => [
    `<tr>`,
    `<td><code title="${escapeHtml(item.learning_rule_id || "")}">${escapeHtml(shortId(item.learning_rule_id))}</code></td>`,
    `<td>${item.policy_rule_id ? `<code title="${escapeHtml(item.policy_rule_id)}">${escapeHtml(shortId(item.policy_rule_id))}</code>` : "-"}</td>`,
    `<td><span class="pill ${statusClass(item.created ? "good" : "neutral")}">${escapeHtml(item.created ? (isChineseLocale(locale) ? "已生成草案" : "Draft created") : (isChineseLocale(locale) ? "已跳过" : "Skipped"))}</span></td>`,
    `<td class="muted">${escapeHtml(labelFor(item.skipped_reason || "trusted_learning_rule", locale))}</td>`,
    `</tr>`,
  ].join(""));
}

function policyDryRunRows(reportJson = {}, locale) {
  return (reportJson.policy_dry_run_results || []).slice(0, 10).map((result) => {
    const topMatch = result.matches?.[0];
    const evidence = (reportJson.policy_dry_run_evidence || []).find((item) => item.policy_rule_id === result.policy_rule_id);
    const packet = result.review_packet || {};
    const topMatchText = topMatch
      ? `${topMatch.run_id} / ${labelFor(topMatch.overall_status, locale)} / ${topMatch.risk_score}`
      : "none";
    const evidenceText = evidence
      ? `${evidence.policy_dry_run_id} / ${evidence.match_evidence_count}`
      : "-";

    return [
      `<tr>`,
      `<td><code>${escapeHtml(result.policy_rule_id)}</code></td>`,
      `<td>${escapeHtml(translateText(result.name, locale))}</td>`,
      `<td><span class="pill ${statusClass(result.severity)}">${escapeHtml(labelFor(result.severity, locale))}</span></td>`,
      `<td>${escapeHtml(result.enabled ? (isChineseLocale(locale) ? "已启用" : "Enabled") : (isChineseLocale(locale) ? "草案" : "Draft"))}</td>`,
      `<td>${escapeHtml(result.match_count)}</td>`,
      `<td>${escapeHtml(topMatchText)}</td>`,
      `<td><code>${escapeHtml(evidenceText)}</code></td>`,
      `<td><span class="pill ${statusClass(packet.review_readiness || "neutral")}">${escapeHtml(labelFor(packet.review_readiness || "unknown", locale))}</span><br><span class="muted">${escapeHtml(labelFor(packet.recommended_review_status || result.review_status || "draft_review", locale))}</span></td>`,
      `<td class="muted">${escapeHtml(translateText(packet.recommended_next_action || result.recommendation, locale))}</td>`,
      `</tr>`,
    ].join("");
  });
}

function policyReviewPacketRows(reportJson = {}, locale) {
  return (reportJson.policy_dry_run_results || []).slice(0, 10).map((result) => {
    const packet = result.review_packet || {};
    const summary = packet.evidence_summary || {};
    return [
      `<tr>`,
      `<td><code title="${escapeHtml(result.policy_rule_id || "")}">${escapeHtml(shortId(result.policy_rule_id))}</code></td>`,
      `<td><span class="pill ${statusClass(packet.review_readiness || "neutral")}">${escapeHtml(labelFor(packet.review_readiness || "unknown", locale))}</span></td>`,
      `<td><span class="pill ${statusClass(packet.recommended_review_status || "draft_review")}">${escapeHtml(labelFor(packet.recommended_review_status || "draft_review", locale))}</span></td>`,
      `<td>${escapeHtml(summary.match_count ?? 0)} / ${escapeHtml(summary.high_risk_match_count ?? 0)}</td>`,
      `<td><span class="pill ${statusClass(summary.false_positive_risk || "unknown")}">${escapeHtml(labelFor(summary.false_positive_risk || "unknown", locale))}</span></td>`,
      `<td class="muted">${escapeHtml((summary.sample_run_ids || []).join(", ") || "-")}</td>`,
      `</tr>`,
    ].join("");
  });
}

function policyReviewTaskRows(reportJson = {}, locale) {
  return (reportJson.policy_review_tasks || []).slice(0, 12).map((item) => {
    const task = item.task || {};
    return [
      `<tr>`,
      `<td><code title="${escapeHtml(item.id || "")}">${escapeHtml(shortId(item.id))}</code></td>`,
      `<td><code title="${escapeHtml(item.policy_rule_id || "")}">${escapeHtml(shortId(item.policy_rule_id))}</code></td>`,
      `<td>${escapeHtml(item.priority ?? 0)}</td>`,
      `<td><span class="pill ${statusClass(item.review_readiness || "neutral")}">${escapeHtml(labelFor(item.review_readiness || "unknown", locale))}</span></td>`,
      `<td><span class="pill ${statusClass(item.recommended_review_status || "draft_review")}">${escapeHtml(labelFor(item.recommended_review_status || "draft_review", locale))}</span></td>`,
      `<td><span class="pill ${statusClass(item.status || "open")}">${escapeHtml(labelFor(item.status || "open", locale))}</span></td>`,
      `<td class="muted">${escapeHtml((task.sample_run_ids || []).join(", ") || "-")}</td>`,
      `<td class="muted">${escapeHtml(translateText(task.recommended_next_action || "", locale))}</td>`,
      `</tr>`,
    ].join("");
  });
}

function policyReviewTaskEventRows(reportJson = {}, locale) {
  return (reportJson.policy_review_task_events || []).slice(0, 12).map((event) => [
    `<tr>`,
    `<td><code title="${escapeHtml(event.id || "")}">${escapeHtml(shortId(event.id))}</code></td>`,
    `<td><code title="${escapeHtml(event.policy_review_task_id || "")}">${escapeHtml(shortId(event.policy_review_task_id))}</code></td>`,
    `<td>${escapeHtml(event.created_at || "")}</td>`,
    `<td><span class="pill ${statusClass(event.from_status)}">${escapeHtml(labelFor(event.from_status || "unknown", locale))}</span> -> <span class="pill ${statusClass(event.to_status)}">${escapeHtml(labelFor(event.to_status || "unknown", locale))}</span></td>`,
    `<td>${escapeHtml(labelFor(event.actor_type || "system", locale))}${event.actor_id ? ` / <code>${escapeHtml(event.actor_id)}</code>` : ""}</td>`,
    `<td class="muted">${escapeHtml(event.note || "")}</td>`,
    `</tr>`,
  ].join(""));
}

function policyReviewWorkItemEventRows(reportJson = {}, locale) {
  return (reportJson.policy_review_work_item_events || []).slice(0, 12).map((event) => [
    `<tr>`,
    `<td><code title="${escapeHtml(event.id || "")}">${escapeHtml(shortId(event.id))}</code></td>`,
    `<td><code title="${escapeHtml(event.policy_rule_id || "")}">${escapeHtml(shortId(event.policy_rule_id))}</code></td>`,
    `<td><code>${escapeHtml(event.work_item_id || "")}</code></td>`,
    `<td>${escapeHtml(event.created_at || "")}</td>`,
    `<td><span class="pill ${statusClass(event.event_type || "unknown")}">${escapeHtml(labelFor(event.event_type || "unknown", locale))}</span></td>`,
    `<td>${escapeHtml(labelFor(event.actor_type || "system", locale))}${event.actor_id ? ` / <code>${escapeHtml(event.actor_id)}</code>` : ""}</td>`,
    `<td><span class="pill ${statusClass(event.evidence?.mutates_state ? "warn" : "good")}">${escapeHtml(event.evidence?.mutates_state ? (isChineseLocale(locale) ? "会改变状态" : "Mutates state") : (isChineseLocale(locale) ? "只记录证据" : "Evidence only"))}</span></td>`,
    `<td class="muted">${escapeHtml(event.note || "")}</td>`,
    `</tr>`,
  ].join(""));
}

function policyReviewWorkItemEffectivenessRows(reportJson = {}, locale) {
  return (reportJson.policy_review_work_item_effectiveness || []).slice(0, 12).map((item) => [
    `<tr>`,
    `<td><code title="${escapeHtml(item.id || "")}">${escapeHtml(shortId(item.id))}</code></td>`,
    `<td><code title="${escapeHtml(item.policy_rule_id || "")}">${escapeHtml(shortId(item.policy_rule_id))}</code></td>`,
    `<td><code>${escapeHtml(item.work_item_id || "")}</code></td>`,
    `<td><span class="pill ${statusClass(item.effectiveness_status || "unknown")}">${escapeHtml(labelFor(item.effectiveness_status || "unknown", locale))}</span></td>`,
    `<td>${escapeHtml(item.source_readiness_score ?? "-")} -> ${escapeHtml(item.current_readiness_score ?? "-")} (${Number(item.readiness_score_delta || 0) >= 0 ? "+" : ""}${escapeHtml(item.readiness_score_delta || 0)})</td>`,
    `<td><span class="pill ${statusClass(item.blocker_cleared ? "good" : "warn")}">${escapeHtml(item.blocker_cleared ? (isChineseLocale(locale) ? "阻断已解除" : "Blocker cleared") : (isChineseLocale(locale) ? "阻断仍存在" : "Blocker persists"))}</span></td>`,
    `<td><code title="${escapeHtml(item.policy_review_work_item_event_id || "")}">${escapeHtml(shortId(item.policy_review_work_item_event_id))}</code></td>`,
    `</tr>`,
  ].join(""));
}

function policyRuleReviewCandidateRows(reportJson = {}, locale) {
  return (reportJson.policy_rule_review_candidates || []).slice(0, 12).map((candidate) => [
    `<tr>`,
    `<td><code title="${escapeHtml(candidate.id || "")}">${escapeHtml(shortId(candidate.id))}</code></td>`,
    `<td><code title="${escapeHtml(candidate.policy_rule_id || "")}">${escapeHtml(shortId(candidate.policy_rule_id))}</code></td>`,
    `<td><code title="${escapeHtml(candidate.policy_review_task_id || "")}">${escapeHtml(shortId(candidate.policy_review_task_id))}</code></td>`,
    `<td><span class="pill ${statusClass(candidate.from_review_status)}">${escapeHtml(labelFor(candidate.from_review_status || "unknown", locale))}</span> -> <span class="pill ${statusClass(candidate.recommended_review_status)}">${escapeHtml(labelFor(candidate.recommended_review_status || "unknown", locale))}</span></td>`,
    `<td><span class="pill ${statusClass(candidate.status || "pending")}">${escapeHtml(labelFor(candidate.status || "pending", locale))}</span></td>`,
    `<td class="muted">${escapeHtml((candidate.candidate?.sample_run_ids || []).join(", ") || "-")}</td>`,
    `</tr>`,
  ].join(""));
}

function policyRuleReviewCandidateEventRows(reportJson = {}, locale) {
  return (reportJson.policy_rule_review_candidate_events || []).slice(0, 12).map((event) => [
    `<tr>`,
    `<td><code title="${escapeHtml(event.id || "")}">${escapeHtml(shortId(event.id))}</code></td>`,
    `<td><code title="${escapeHtml(event.policy_rule_review_candidate_id || "")}">${escapeHtml(shortId(event.policy_rule_review_candidate_id))}</code></td>`,
    `<td>${escapeHtml(event.created_at || "")}</td>`,
    `<td><span class="pill ${statusClass(event.from_status)}">${escapeHtml(labelFor(event.from_status || "unknown", locale))}</span> -> <span class="pill ${statusClass(event.to_status)}">${escapeHtml(labelFor(event.to_status || "unknown", locale))}</span></td>`,
    `<td>${escapeHtml(labelFor(event.actor_type || "system", locale))}${event.actor_id ? ` / <code>${escapeHtml(event.actor_id)}</code>` : ""}</td>`,
    `<td class="muted">${escapeHtml(event.note || "")}</td>`,
    `</tr>`,
  ].join(""));
}

function policyRuleEventRows(reportJson = {}, locale) {
  return (reportJson.policy_rule_events || []).slice(0, 12).map((event) => [
    `<tr>`,
    `<td><code title="${escapeHtml(event.id || "")}">${escapeHtml(shortId(event.id))}</code></td>`,
    `<td><code title="${escapeHtml(event.policy_rule_id || "")}">${escapeHtml(shortId(event.policy_rule_id))}</code></td>`,
    `<td>${escapeHtml(event.created_at || "")}</td>`,
    `<td><span class="pill ${statusClass(event.from_status)}">${escapeHtml(labelFor(event.from_status || "unknown", locale))}</span> -> <span class="pill ${statusClass(event.to_status)}">${escapeHtml(labelFor(event.to_status || "unknown", locale))}</span></td>`,
    `<td>${escapeHtml(labelFor(event.actor_type || "system", locale))}${event.actor_id ? ` / <code>${escapeHtml(event.actor_id)}</code>` : ""}</td>`,
    `<td class="muted">${escapeHtml(event.note || "")}</td>`,
    `</tr>`,
  ].join(""));
}

function evalReplayRows(reportJson = {}, locale) {
  const gate = reportJson.eval_replay_gate || {};
  if (!gate.has_eval_run) {
    return [];
  }

  return [[
    `<tr>`,
    `<td><code>${escapeHtml(gate.eval_run_id)}</code></td>`,
    `<td><span class="pill ${statusClass(gate.gate_decision)}">${escapeHtml(labelFor(gate.gate_decision, locale))}</span></td>`,
    `<td>${escapeHtml(gate.total_cases ?? 0)}</td>`,
    `<td>${escapeHtml(gate.pass_count ?? 0)}</td>`,
    `<td>${escapeHtml(gate.fail_count ?? 0)}</td>`,
    `<td>${escapeHtml(gate.regression_count ?? 0)}</td>`,
    `<td>${escapeHtml(pct(gate.pass_rate))}</td>`,
    `</tr>`,
  ].join("")];
}

function incidentRows(reportJson = {}, locale) {
  return (reportJson.incident_reports || []).slice(0, 10).map((incident) => [
    `<tr>`,
    `<td><code>${escapeHtml(incident.id)}</code></td>`,
    `<td><span class="pill ${statusClass(incident.severity)}">${escapeHtml(labelFor(incident.severity, locale))}</span></td>`,
    `<td>${escapeHtml(translateText(incident.title, locale))}</td>`,
    `<td>${escapeHtml(labelFor(incident.root_cause_category || "unknown", locale))}</td>`,
    `<td>${escapeHtml((incident.related_run_ids || []).join(", "))}</td>`,
    `<td><span class="pill ${statusClass(incident.remediation_status)}">${escapeHtml(labelFor(incident.remediation_status, locale))}</span></td>`,
    `</tr>`,
  ].join(""));
}

function incidentRemediationRows(reportJson = {}, locale) {
  return (reportJson.incident_remediation_events || []).slice(0, 20).map((event) => [
    `<tr>`,
    `<td><code>${escapeHtml(event.id)}</code></td>`,
    `<td><code>${escapeHtml(event.incident_report_id)}</code></td>`,
    `<td>${escapeHtml(event.created_at)}</td>`,
    `<td><span class="pill ${statusClass(event.from_status)}">${escapeHtml(labelFor(event.from_status, locale))}</span> -> <span class="pill ${statusClass(event.to_status)}">${escapeHtml(labelFor(event.to_status, locale))}</span></td>`,
    `<td>${escapeHtml(event.actor_id ? `${event.actor_type}:${event.actor_id}` : event.actor_type)}</td>`,
    `<td class="muted">${escapeHtml(event.note || "")}</td>`,
    `</tr>`,
  ].join(""));
}

function ingestionHealthRows(reportJson = {}, locale) {
  const health = reportJson.ingestion_health || {};
  const rows = [
    [isChineseLocale(locale) ? "接入事件" : "Ingestion events", health.total_events || 0],
    [isChineseLocale(locale) ? "已接收" : "Accepted", health.accepted_events || 0],
    [isChineseLocale(locale) ? "重复重试" : "Duplicate retries", health.duplicate_events || 0],
    [isChineseLocale(locale) ? "签名覆盖率" : "Signature coverage", pct(health.signature_coverage_rate)],
    [isChineseLocale(locale) ? "重复率" : "Duplicate rate", pct(health.duplicate_rate)],
    [isChineseLocale(locale) ? "最近接入" : "Last ingested", health.last_ingested_at || "-"],
  ];

  return rows.map(([label, value]) => [
    `<tr>`,
    `<td>${escapeHtml(label)}</td>`,
    `<td>${escapeHtml(value)}</td>`,
    `</tr>`,
  ].join(""));
}

function dataProvenanceSourceType(value, locale) {
  if (!isChineseLocale(locale)) {
    return value || "unknown";
  }

  return {
    demo_data_present: "包含示例数据",
    local_workspace: "本地工作区数据",
    webhook_or_api: "Webhook/API 接入数据",
    mixed_or_unknown: "混合或未知来源",
    no_runs: "本周期无运行",
  }[value] || value || "未知";
}

function dataProvenanceTrustLevel(value, locale) {
  if (!isChineseLocale(locale)) {
    return value || "unknown";
  }

  return {
    production_evidence: "生产证据",
    production_with_metadata_gaps: "生产证据但元数据不完整",
    mixed_requires_review: "混合来源，需复核",
    local_development: "本地开发证据",
    sample_only: "仅样例接入",
    untrusted_or_unknown: "来源不足或未知",
    insufficient: "无运行证据",
  }[value] || value || "未知";
}

function readinessEvidenceStatusLabel(value, locale) {
  if (!isChineseLocale(locale)) {
    return value || "unknown";
  }

  return {
    usable_for_customer_readiness: "可用于客户生产 readiness 判断",
    usable_but_source_metadata_should_be_fixed: "可参考，但应补齐来源元数据",
    do_not_use_for_certification_without_source_review: "来源混合，认证前必须复核",
    development_only_not_customer_production: "仅用于本地开发，不代表客户生产",
    onboarding_sample_not_customer_production: "仅用于接入演示，不代表客户生产",
    insufficient_source_evidence: "来源证据不足",
    no_run_evidence: "没有运行证据",
  }[value] || value || "未知";
}

function dataProvenanceNote(value, locale) {
  if (!isChineseLocale(locale)) {
    return value || "No source note available.";
  }

  return {
    "Report includes demo-like runs. Do not treat it as customer production evidence.": "报告包含示例痕迹，不要把它当成客户生产证据。",
    "Report is based on local workspace runs captured by the Codex/local adapter.": "报告基于 Codex/本地适配器捕获的本地工作区运行。",
    "Report includes runs received through authenticated webhook/API ingestion.": "报告包含通过认证 Webhook/API 接入的运行。",
    "Report includes runs with mixed or unknown source metadata.": "报告包含混合或未知来源的运行，需要补齐来源元数据。",
    "No runs were found for this report period.": "本报告周期没有运行记录。",
  }[value] || value || "暂无来源说明。";
}

function countList(items = []) {
  return items.length ? items.map((item) => `${item.name}: ${item.count}`).join(", ") : "none";
}

function dataProvenanceRows(reportJson = {}, locale) {
  const summary = reportJson.data_provenance || {};
  const zh = isChineseLocale(locale);
  const rows = [
    [zh ? "来源类型" : "Source type", dataProvenanceSourceType(summary.source_type, locale)],
    [zh ? "证据可信等级" : "Evidence trust level", dataProvenanceTrustLevel(summary.evidence_trust_level, locale)],
    [zh ? "Readiness 证据状态" : "Readiness evidence status", readinessEvidenceStatusLabel(summary.readiness_evidence_status, locale)],
    [zh ? "本周期运行" : "Runs in period", summary.total_runs || 0],
    [zh ? "生产候选运行" : "Production candidate runs", summary.production_candidate_runs || 0],
    [zh ? "API Key 认证运行" : "API-key authenticated runs", summary.api_key_authenticated_runs || 0],
    [zh ? "签名验证运行" : "Signature-verified runs", summary.signature_verified_runs || 0],
    [zh ? "API Key 认证覆盖率" : "API-key authentication coverage", pct(summary.api_key_authentication_coverage_rate)],
    [zh ? "签名验证覆盖率" : "Signature verification coverage", pct(summary.signature_verification_coverage_rate)],
    [zh ? "认证证据达标" : "Certification evidence ready", summary.certification_evidence_ready ? (zh ? "是" : "yes") : (zh ? "否" : "no")],
    [zh ? "本地适配器运行" : "Local adapter runs", summary.local_adapter_runs || 0],
    [zh ? "控制台样例运行" : "Console sample runs", summary.console_sample_runs || 0],
    [zh ? "示例痕迹运行" : "Demo-like runs", summary.demo_like_runs || 0],
    [zh ? "未知来源运行" : "Unknown-source runs", summary.unknown_source_runs || 0],
    [zh ? "成本/Token 未知运行" : "Runs without known token cost", summary.token_cost_unknown_runs || 0],
    [zh ? "运行元数据来源" : "Run metadata sources", countList(summary.metadata_sources || [])],
    [zh ? "接入审计来源" : "Ingestion audit sources", countList(summary.ingestion_sources || [])],
    [zh ? "可信说明" : "Confidence note", dataProvenanceNote(summary.confidence_note, locale)],
  ];

  return rows.map(([label, value]) => [
    `<tr>`,
    `<td>${escapeHtml(label)}</td>`,
    `<td>${escapeHtml(value)}</td>`,
    `</tr>`,
  ].join(""));
}

function dataGovernanceRows(reportJson = {}, locale) {
  const governance = reportJson.data_governance || {};
  const summary = governance.summary || {};
  const zh = isChineseLocale(locale);
  const rows = [
    [zh ? "策略模式" : "Policy mode", zh && governance.mode === "advisory_only" ? "仅建议，不自动删除" : governance.mode || "unknown"],
    [zh ? "策略版本" : "Policy version", governance.policy_version || "unknown"],
    [zh ? "治理记录总数" : "Governed records", summary.total_records || 0],
    [zh ? "策略内资产" : "Assets within policy", summary.within_policy_count || 0],
    [zh ? "归档复核" : "Archive review due", summary.archive_due_count || 0],
    [zh ? "保留期复核" : "Retention review due", summary.retention_due_count || 0],
    [zh ? "护栏" : "Guardrail", (governance.guardrails || [])[0] || (zh ? "Phase 1 只做建议。" : "Phase 1 is advisory only.")],
  ];

  return rows.map(([label, value]) => [
    `<tr>`,
    `<td>${escapeHtml(label)}</td>`,
    `<td>${escapeHtml(value)}</td>`,
    `</tr>`,
  ].join(""));
}

function evalCoverageRows(reportJson = {}, locale) {
  const coverage = reportJson.eval_coverage || {};
  const summary = coverage.summary || {};
  const zh = isChineseLocale(locale);
  const rows = [
    [zh ? "出现失败的分类" : "Taxonomies with failures", summary.taxonomy_count || 0],
    [zh ? "失败案例" : "Failure cases", summary.failure_count || 0],
    [zh ? "评估用例" : "Eval cases", summary.eval_case_count || 0],
    [zh ? "失败转评估比例" : "Failure-to-eval ratio", pct(summary.failure_to_eval_ratio)],
    [zh ? "回放覆盖率" : "Replay coverage", pct(summary.replay_coverage_rate)],
    [zh ? "缺少评估覆盖" : "Missing eval coverage", summary.missing_eval_taxonomy_count || 0],
    [zh ? "已建未回放" : "Created but not replayed", summary.not_replayed_taxonomy_count || 0],
    [zh ? "存在回归" : "Regressions", summary.regression_taxonomy_count || 0],
  ];

  return rows.map(([label, value]) => [
    `<tr>`,
    `<td>${escapeHtml(label)}</td>`,
    `<td>${escapeHtml(value)}</td>`,
    `</tr>`,
  ].join(""));
}

function evalCoverageGapRows(reportJson = {}, locale) {
  const zh = isChineseLocale(locale);
  return (reportJson.eval_coverage?.priority_gaps || []).slice(0, 8).map((item) => [
    `<tr>`,
    `<td><code>${escapeHtml(item.taxonomy_code)}</code></td>`,
    `<td><span class="pill ${statusClass(item.status)}">${escapeHtml(zh ? labelFor(item.status, locale) : item.status)}</span></td>`,
    `<td>${escapeHtml(item.failure_count || 0)}</td>`,
    `<td>${escapeHtml(item.eval_case_count || 0)}</td>`,
    `<td>${escapeHtml(item.replayed_case_count || 0)}</td>`,
    `<td class="muted">${escapeHtml(translateText(item.recommended_action || "", locale))}</td>`,
    `</tr>`,
  ].join(""));
}

function evalBacklogSummaryRows(reportJson = {}, locale) {
  const zh = isChineseLocale(locale);
  const summary = reportJson.eval_backlog?.summary || {};
  const rows = [
    [zh ? "待处理项" : "Open items", summary.open_item_count || 0],
    [zh ? "关键项" : "Critical items", summary.critical_item_count || 0],
    [zh ? "高优先级" : "High priority", summary.high_priority_item_count || 0],
    [zh ? "需要回放" : "Needs replay", summary.needs_replay_count || 0],
    [zh ? "回放回归" : "Replay regressions", summary.regression_count || 0],
    [zh ? "自主阻断项" : "Autonomy blockers", summary.autonomy_blocker_count || 0],
    [zh ? "Prompt 发布阻断项" : "Prompt blockers", summary.prompt_promotion_blocker_count || 0],
  ];

  return rows.map(([label, value]) => [
    `<tr>`,
    `<td>${escapeHtml(label)}</td>`,
    `<td>${escapeHtml(value)}</td>`,
    `</tr>`,
  ].join(""));
}

function evalBacklogItemRows(reportJson = {}, locale) {
  const zh = isChineseLocale(locale);
  return (reportJson.eval_backlog?.items || []).slice(0, 8).map((item) => {
    const representative = item.representative_failures?.[0];
    return [
      `<tr>`,
      `<td><span class="pill ${statusClass(item.priority)}">${escapeHtml(zh ? labelFor(item.priority, locale) : item.priority)}</span></td>`,
      `<td><code>${escapeHtml(item.taxonomy_code)}</code></td>`,
      `<td>${escapeHtml(zh ? labelFor(item.blocker_type, locale) : item.blocker_type)}</td>`,
      `<td>${escapeHtml(`${item.failure_count || 0} / ${item.eval_case_count || 0} / ${item.replayed_case_count || 0}`)}</td>`,
      `<td>${representative ? `<code>${escapeHtml(representative.run_id)}</code>` : escapeHtml(zh ? "无" : "none")}</td>`,
      `<td class="muted">${escapeHtml(translateText(item.next_step || "", locale))}</td>`,
      `</tr>`,
    ].join("");
  });
}

function autonomyRemediationRows(reportJson = {}, locale) {
  const zh = isChineseLocale(locale);
  const items = (reportJson.autonomy_gate_checks || [])
    .flatMap((check) => check.metadata_json?.remediation_plan?.items || [])
    .slice(0, 10);

  return items.map((item) => [
    `<tr>`,
    `<td><span class="pill ${statusClass(item.severity)}">${escapeHtml(zh ? labelFor(item.severity, locale) : item.severity)}</span></td>`,
    `<td>${escapeHtml(translateText(item.title || "", locale))}</td>`,
    `<td>${escapeHtml(translateText(item.action || "", locale))}</td>`,
    `<td>${escapeHtml((item.verification_evidence || []).join(", "))}</td>`,
    `<td>${item.blocks_unattended_autonomy ? escapeHtml(zh ? "是" : "yes") : escapeHtml(zh ? "否" : "no")}</td>`,
    `</tr>`,
  ].join(""));
}

function evidencePackRows(result = {}, locale) {
  const zh = isChineseLocale(locale);
  const reportId = result.report_id || result.report_json?.report_id || "";
  const exportCommand = "npm run local:evidence -- --redact --out local-output/report-evidence-pack.redacted.json";
  const verifyCommand = "npm run local:verify-evidence -- --file local-output/report-evidence-pack.redacted.json";
  const rows = [
    [zh ? "报告 ID" : "Report ID", reportId],
    [zh ? "脱敏导出" : "Redacted export", exportCommand],
    [zh ? "校验证据包" : "Verify evidence pack", verifyCommand],
    [zh ? "说明" : "Note", zh ? "导出会记录审计事件；脱敏版隐藏敏感文本并保留哈希。" : "Exports write audit events; redacted packs mask sensitive text and preserve hashes."],
  ];

  return rows.map(([label, value]) => [
    `<tr>`,
    `<td>${escapeHtml(label)}</td>`,
    `<td><code>${escapeHtml(value)}</code></td>`,
    `</tr>`,
  ].join(""));
}

function readinessDossierRows(result = {}, locale) {
  const zh = isChineseLocale(locale);
  const exportCommand = "npm run local:readiness-dossier";
  const openPath = "local-output/readiness-dossier.html";
  const rows = [
    [zh ? "报告 ID" : "Report ID", result.report_id || ""],
    [zh ? "导出可信档案" : "Export dossier", exportCommand],
    [zh ? "输出 HTML" : "HTML output", openPath],
    [zh ? "说明" : "Note", zh ? "汇总自主评分、证据包、数据来源、接入健康、事故和数据治理。" : "Summarizes readiness scores, evidence pack, provenance, ingestion health, incidents, and governance."],
  ];

  return rows.map(([label, value]) => [
    `<tr>`,
    `<td>${escapeHtml(label)}</td>`,
    `<td><code>${escapeHtml(value)}</code></td>`,
    `</tr>`,
  ].join(""));
}

function policyGovernanceDossierRows(result = {}, locale) {
  const zh = isChineseLocale(locale);
  const report = result.report_json || {};
  const policyRuleId = report.policy_review_tasks?.[0]?.policy_rule_id
    || report.policy_dry_run_results?.[0]?.policy_rule_id
    || report.policy_dry_run_evidence?.[0]?.policy_rule_id
    || "";
  const exportCommand = policyRuleId
    ? `npm run local:policy-dossier -- --policy ${policyRuleId}`
    : "npm run local:policy-dossier";
  const openPath = "local-output/policy-governance-dossier.html";
  const rows = [
    [zh ? "策略草案 ID" : "Policy rule ID", policyRuleId || (zh ? "暂无" : "none")],
    [zh ? "导出治理证据包" : "Export governance dossier", exportCommand],
    [zh ? "输出 HTML" : "HTML output", openPath],
    [zh ? "说明" : "Note", zh ? "只读汇总策略来源、dry-run 命中、审核任务、候选动作和审计事件；不会启用策略。" : "Read-only source, dry-run, review task, candidate, and audit evidence. It never enables policy enforcement."],
  ];

  return rows.map(([label, value]) => [
    `<tr>`,
    `<td>${escapeHtml(label)}</td>`,
    `<td><code>${escapeHtml(value)}</code></td>`,
    `</tr>`,
  ].join(""));
}

function policyReviewWorkbenchRows(result = {}, locale) {
  const zh = isChineseLocale(locale);
  const report = result.report_json || {};
  const policyRuleId = report.policy_review_tasks?.[0]?.policy_rule_id
    || report.policy_dry_run_results?.[0]?.policy_rule_id
    || report.policy_dry_run_evidence?.[0]?.policy_rule_id
    || "";
  const exportCommand = policyRuleId
    ? `npm run local:policy-workbench -- --policy ${policyRuleId}`
    : "npm run local:policy-workbench";
  const eventCommand = policyRuleId
    ? `npm run local:policy-workbench-event -- --policy ${policyRuleId} --work-item policy_work_dry_run_evidence_exists --event acknowledged --note "reviewed"`
    : "npm run local:policy-workbench-event -- --work-item policy_work_...";
  const openPath = "local-output/policy-review-workbench.html";
  const rows = [
    [zh ? "策略草案 ID" : "Policy rule ID", policyRuleId || (zh ? "暂无" : "none")],
    [zh ? "导出审核工作台" : "Export review workbench", exportCommand],
    [zh ? "记录动作事件" : "Record work item event", eventCommand],
    [zh ? "输出 HTML" : "HTML output", openPath],
    [zh ? "说明" : "Note", zh ? "把晋级缺口翻译成人工审核动作；只读，不启用策略。" : "Turns advancement gaps into human review actions. Read-only; never enables policy."],
  ];

  return rows.map(([label, value]) => [
    `<tr>`,
    `<td>${escapeHtml(label)}</td>`,
    `<td><code>${escapeHtml(value)}</code></td>`,
    `</tr>`,
  ].join(""));
}

export function renderOperatorConsoleHtml(result, options = {}) {
  const locale = options.locale || "en";
  const zh = isChineseLocale(locale);
  const showLocalCommands = Boolean(options.showLocalCommands);
  const feedbackForms = Boolean(options.feedbackForms);
  const certificationActionForms = Boolean(options.certificationActionForms);
  const learningRuleForms = Boolean(options.learningRuleForms);
  const report = result.report_json || {};
  const projectScore = report.autonomy_readiness?.project_score || {};
  const deliveries = result.deliveries || [];
  const insights = report.learning_insights || [];
  const reportBody = markdownToHtml(reportMarkdownForLocale({
    content_markdown: result.report_markdown || "",
    content_json: report,
    project_id: result.project_id,
    period_start: report.period_start,
    period_end: report.period_end,
  }, locale));

  return [
    "<!doctype html>",
    `<html lang="${zh ? "zh-CN" : "en"}">`,
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>${zh ? "AI Worker Control Plane 操作台" : "AI Worker Control Plane Console"}</title>`,
    "<style>",
    ":root{--ink:#17202a;--muted:#61707f;--line:#d8e0e8;--panel:#ffffff;--bg:#f4f7f9;--band:#edf3f5;--teal:#0f6b6e;--green:#1f7a4d;--amber:#9a6400;--red:#af2f2f;--violet:#5b4b8a;}",
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;letter-spacing:0}",
    ".shell{display:grid;grid-template-columns:280px 1fr;min-height:100vh}.side{background:#fff;border-right:1px solid var(--line);padding:22px 18px;position:sticky;top:0;height:100vh;overflow:auto}.main{padding:24px;max-width:1440px;width:100%;margin:0 auto}",
    ".brand{font-size:18px;font-weight:700;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 22px}.nav{display:grid;gap:8px;margin:20px 0}.nav a{color:var(--ink);text-decoration:none;border:1px solid var(--line);background:var(--band);padding:9px 10px;border-radius:8px}.nav a:hover{border-color:var(--teal)}",
    ".panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px}.stack{display:grid;gap:14px}.grid{display:grid;gap:14px}.metrics{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px}.two{grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr)}.three{grid-template-columns:repeat(3,minmax(0,1fr))}.four{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.onboarding-step{border:1px solid var(--line);border-radius:8px;padding:12px;background:#f8fafb}.onboarding-step.done{border-color:#abd6be;background:#edf8f1}",
    ".metric{background:#fff;border:1px solid var(--line);border-left:4px solid var(--teal);border-radius:8px;padding:14px;min-height:96px}.metric span,.muted{color:var(--muted)}.metric strong{display:block;font-size:26px;line-height:1.1;margin:9px 0}.metric small,.insight small{color:var(--muted)}.metric.good{border-left-color:var(--green)}.metric.warn{border-left-color:var(--amber)}.metric.danger{border-left-color:var(--red)}",
    "h1{font-size:24px;margin:0 0 6px}h2{font-size:17px;margin:0 0 12px}h3{font-size:15px;margin:10px 0 6px}.topbar{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:18px}.topbar p{margin:0;color:var(--muted)}",
    ".row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pill{display:inline-flex;align-items:center;border-radius:999px;padding:2px 8px;font-size:12px;border:1px solid var(--line);background:#f8fafb;color:var(--ink)}.pill.good{color:var(--green);border-color:#abd6be;background:#edf8f1}.pill.warn{color:var(--amber);border-color:#e4c47b;background:#fff7e5}.pill.danger{color:var(--red);border-color:#ebb0ad;background:#fff0ef}.pill.neutral{color:var(--muted)}",
    ".insight{border:1px solid var(--line);border-left:4px solid var(--teal);border-radius:8px;padding:13px;background:#fff}.insight.danger{border-left-color:var(--red)}.insight.warn{border-left-color:var(--amber)}.insight.good{border-left-color:var(--green)}.insight p{margin:0 0 8px;color:var(--ink)}",
    ".asset-row{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding:8px 0}.asset-row:last-child{border-bottom:0}.asset-row span{color:var(--muted)}",
    ".table-wrap{overflow:auto;border:1px solid var(--line);border-radius:8px}table{border-collapse:collapse;width:100%;min-width:720px;background:#fff}th,td{text-align:left;padding:10px 11px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);background:#f8fafb;text-transform:uppercase}tr:last-child td{border-bottom:0}code{background:#eef2f6;border:1px solid #d9e2ec;border-radius:4px;padding:1px 4px;font-size:12px}",
    ".button-row{display:flex;gap:6px;flex-wrap:wrap}.button-row button{appearance:none;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:6px;padding:5px 8px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer}.button-row button:hover{border-color:var(--teal);color:var(--teal)}.compact-input{border:1px solid var(--line);border-radius:6px;padding:5px 7px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;min-width:118px;max-width:180px}.action-form{min-width:330px;max-width:430px}.action-form button[value='resolved']{border-color:#abd6be;color:var(--green)}.action-form button[value='dismissed']{border-color:#ebb0ad;color:var(--red)}",
    ".report-preview{max-height:680px;overflow:auto}.report-preview h1{font-size:22px;border-bottom:1px solid var(--line);padding-bottom:12px}.report-preview h2{margin-top:24px;color:#102a43}.report-preview h3{color:var(--teal)}.report-preview ul{margin:8px 0 14px;padding:10px 18px;background:#f8fafb;border:1px solid var(--line);border-radius:8px}.empty{color:var(--muted);margin:0}",
    "@media(max-width:1100px){.shell{grid-template-columns:1fr}.side{position:relative;height:auto}.metrics,.two,.three,.four{grid-template-columns:1fr}.main{padding:16px}.topbar{display:block}}",
    "</style>",
    "</head>",
    "<body>",
    "<div class=\"shell\">",
    "<aside class=\"side\">",
    "<p class=\"brand\">AI Worker Control Plane</p>",
    `<p class=\"sub\">${zh ? "夜间体检与成本优化控制台" : "Nightly health and cost console"}</p>`,
    "<section class=\"panel stack\">",
    `<div><span class=\"muted\">${zh ? "项目" : "Project"}</span><br><code>${escapeHtml(result.project_id)}</code></div>`,
    `<div><span class=\"muted\">Agent</span><br><code>${escapeHtml(result.agent_id)}</code></div>`,
    `<div><span class=\"muted\">${zh ? "报告" : "Report"}</span><br><code>${escapeHtml(result.report_id)}</code></div>`,
    `<div><span class=\"muted\">${zh ? "投递" : "Delivery"}</span><br>${deliveries.map((delivery) => `<span class="pill ${statusClass(delivery.status)}">${escapeHtml(labelFor(delivery.status, locale))} ${escapeHtml(delivery.provider)}</span>`).join(" ")}</div>`,
    "</section>",
    "<nav class=\"nav\">",
    `<a href=\"#overview\">${zh ? "总览" : "Overview"}</a>`,
    `<a href=\"#readiness\">${zh ? "自主运行评分" : "Autonomy Score"}</a>`,
    `<a href=\"#certification-roadmap\">${zh ? "认证路线图" : "Certification Roadmap"}</a>`,
    `<a href=\"#evolution\">${zh ? "自我进化" : "Self-Evolution"}</a>`,
    `<a href=\"#eval-replay\">${zh ? "回放门禁" : "Replay Gate"}</a>`,
    `<a href=\"#learning-rules\">${zh ? "学习规则" : "Learning Rules"}</a>`,
    `<a href=\"#policy-dry-run\">${zh ? "策略草案" : "Policy Drafts"}</a>`,
    `<a href=\"#incidents\">${zh ? "事故报告" : "Incidents"}</a>`,
    `<a href=\"#incident-timeline\">${zh ? "处理时间线" : "Remediation Timeline"}</a>`,
    `<a href=\"#ingestion-health\">${zh ? "接入健康" : "Ingestion Health"}</a>`,
    `<a href=\"#data-provenance\">${zh ? "数据来源" : "Data Provenance"}</a>`,
    `<a href=\"#data-governance\">${zh ? "数据治理" : "Data Governance"}</a>`,
    `<a href=\"#eval-coverage\">${zh ? "Eval 覆盖" : "Eval Coverage"}</a>`,
    `<a href=\"#eval-backlog\">${zh ? "Eval 待办" : "Eval Backlog"}</a>`,
    `<a href=\"#autonomy-remediation\">${zh ? "整改计划" : "Remediation"}</a>`,
    `<a href=\"#evidence-pack\">${zh ? "证据包" : "Evidence Pack"}</a>`,
    `<a href=\"#readiness-dossier\">${zh ? "可信档案" : "Readiness Dossier"}</a>`,
    `<a href=\"#policy-governance-dossier\">${zh ? "策略治理证据包" : "Policy Dossier"}</a>`,
    `<a href=\"#policy-review-workbench\">${zh ? "策略审核工作台" : "Policy Workbench"}</a>`,
    `<a href=\"#runs\">${zh ? "运行记录" : "Runs"}</a>`,
    `<a href=\"#suggestions\">${zh ? "建议" : "Suggestions"}</a>`,
    showLocalCommands ? `<a href=\"#review\">${zh ? "反馈闭环" : "Feedback Loop"}</a>` : "",
    `<a href=\"#report\">${zh ? "报告" : "Report"}</a>`,
    "</nav>",
    "</aside>",
    "<main class=\"main\">",
    "<header class=\"topbar\" id=\"overview\">",
    "<div>",
    `<h1>${zh ? "操作台" : "Operator Console"}</h1>`,
    `<p>${escapeHtml(report.period_start)} ${zh ? "至" : "to"} ${escapeHtml(report.period_end)}</p>`,
    "</div>",
    `<div class="row">${feedbackForms ? `<form method="post" action="/regenerate" class="button-row"><button type="submit">${zh ? "重新生成报告" : "Regenerate Report"}</button></form>` : ""}<span class="pill ${statusClass(report.high_risk_count > 0 ? "high_risk" : "success")}">${escapeHtml(report.high_risk_count || 0)} ${zh ? "个高风险" : "high risk"}</span></div>`,
    "</header>",
    "<section class=\"grid metrics\">",
    metricCard(zh ? "自主准备度" : "Autonomy", `${projectScore.autonomy_readiness_score ?? 0}/100`, translateText(projectScore.autonomy_decision || "", locale), statusClass(projectScore.readiness_status)),
    metricCard(zh ? "运行次数" : "Runs", report.total_runs ?? 0, zh ? `${report.success_count ?? 0} 次成功` : `${report.success_count ?? 0} success`, "neutral"),
    metricCard(zh ? "失败率" : "Failure Rate", pct(report.failure_rate), zh ? `${report.failure_count ?? 0} 次失败或部分失败` : `${report.failure_count ?? 0} failed or partial`, report.failure_rate > 0 ? "warn" : "good"),
    metricCard(zh ? "高风险" : "High Risk", report.high_risk_count ?? 0, zh ? "需要复核" : "needs review", report.high_risk_count > 0 ? "danger" : "good"),
    metricCard(zh ? "总成本" : "Total Cost", money(report.total_cost), zh ? `${money(report.average_cost_per_run)} / 次` : `${money(report.average_cost_per_run)} avg/run`, "neutral"),
    metricCard(zh ? "学习记忆" : "Learning", result.counts?.learning_insights ?? insights.length, zh ? "已存储洞察" : "stored insights", "good"),
    "</section>",
    "<section class=\"panel\" id=\"readiness\" style=\"margin-bottom:14px\">",
    `<h2>${zh ? "这个 Agent 可以无人值守吗？" : "Can This Agent Run Autonomously?"}</h2>`,
    `<p class="muted">${escapeHtml(translateText(projectScore.autonomy_decision || "", locale))}</p>`,
    table(
      zh ? ["对象", "ID", "状态", "自主准备度", "可靠性", "风险控制", "回归稳定性", "主要原因"] : ["Target", "ID", "Status", "Autonomy", "Reliability", "Risk Control", "Regression", "Top Reason"],
      readinessRows(report, locale),
      zh ? "暂无评分" : "No scores"
    ),
    "</section>",
    "<section class=\"panel\" id=\"certification-roadmap\" style=\"margin-bottom:14px\">",
    `<h2>${zh ? "自主运行认证路线图" : "Autonomy Certification Roadmap"}</h2>`,
    table(
      zh ? ["Agent", "当前分", "目标", "Gate", "认证状态", "阻断类型", "完成后预计"] : ["Agent", "Current", "Target", "Gate", "Certification State", "Blocked By", "Estimated After"],
      certificationRoadmapRows(report, locale),
      zh ? "暂无认证路线图" : "No certification roadmap"
    ),
    "<h3>" + (zh ? "当前认证阻断原因" : "Current Certification Blockers") + "</h3>",
    table(
      zh ? ["Agent", "类型", "阻断代码", "严重度", "当前 -> 目标", "证据状态"] : ["Agent", "Type", "Blocker", "Severity", "Current -> Target", "Evidence Status"],
      certificationCurrentBlockerRows(report, locale),
      zh ? "暂无阻断原因" : "No current blockers"
    ),
    "<h3>" + (zh ? "子分数拆解" : "Score Breakdown") + "</h3>",
    table(
      zh ? ["指标", "分数", "当前值", "目标值", "原因"] : ["Metric", "Score", "Current", "Target", "Reason"],
      certificationBreakdownRows(report, locale),
      zh ? "暂无子分数" : "No score breakdown"
    ),
    "<h3>" + (zh ? "量化整改目标" : "Quantified Objectives") + "</h3>",
    table(
      zh ? ["严重度", "状态", "目标", "当前 -> 目标", "预计加分", "验证证据", "Objective ID"] : ["Severity", "Status", "Objective", "Current -> Target", "Delta", "Verification", "Objective ID"],
      certificationObjectiveRows(report, locale),
      zh ? "暂无整改目标" : "No objectives"
    ),
    "<h3>" + (zh ? "复查历史与证据审核" : "Recheck History & Evidence Review") + "</h3>",
    table(
      zh ? ["Recheck", "Agent", "分数", "Gate", "认证状态", "阻断类型", "指标验证", "证据要求", "运行闭环", "补证任务", "未解除验证项", "证据缺口", "补证 Ready/Pending", "建议关闭", "Ready/Blocked"] : ["Recheck", "Agent", "Score", "Gate", "Certification State", "Blocked By", "Metric Validation", "Evidence Requirements", "Run Closure", "Evidence Tasks", "Unresolved Verified", "Evidence Gaps", "Task Ready/Pending", "Closure Suggested", "Ready/Blocked"],
      certificationRecheckRows(report, locale),
      zh ? "暂无复查历史" : "No recheck history"
    ),
    "<h3>" + (zh ? "可提交人工关闭的补证任务" : "Evidence Tasks Suggested For Human Closure") + "</h3>",
    table(
      zh ? ["Recheck", "Task", "严重度", "状态", "任务", "满足条件", "原因"] : ["Recheck", "Task", "Severity", "Status", "Task", "Criteria Met", "Reason"],
      certificationEvidenceTaskClosureRows(report, locale),
      zh ? "暂无可提交关闭的补证任务" : "No evidence tasks suggested for closure"
    ),
    "<h3>" + (zh ? "认证阻断作战地图" : "Certification Blocker Task Map") + "</h3>",
    table(
      zh ? ["Recheck", "阻断类型", "Blocker", "严重度", "当前 -> 目标", "任务数", "Open/Ready/建议关闭", "证据状态", "证据质量", "复查信号", "下一步", "任务"] : ["Recheck", "Blocker Type", "Blocker", "Severity", "Current -> Target", "Tasks", "Open/Ready/Closure", "Evidence State", "Evidence Quality", "Recheck Signal", "Next Action", "Tasks"],
      certificationBlockerTaskCoverageRows(report, locale),
      zh ? "暂无阻断任务映射" : "No blocker task coverage"
    ),
    "<h3>" + (zh ? "认证推进队列" : "Certification Action Queue") + "</h3>",
    table(
      zh ? ["Action", "优先级", "严重度", "推荐动作", "Blocker", "Task", "状态", "证据质量", "复查信号", "学习调权", certificationActionForms ? "操作" : "本地命令", "原因"] : ["Action", "Priority", "Severity", "Recommended Action", "Blocker", "Task", "Status", "Evidence Quality", "Recheck Signal", "Learning Adjustment", certificationActionForms ? "Actions" : "Local Command", "Reason"],
      certificationActionQueueRows(report, locale, { certificationActionForms }),
      zh ? "暂无认证推进动作" : "No certification actions"
    ),
    "<h3>" + (zh ? "认证推进事件时间线" : "Certification Action Event Timeline") + "</h3>",
    table(
      zh ? ["Event", "Action", "时间", "状态变化", "操作者", "证据类型", "对象 ID", "证据引用", "证据质量", "备注"] : ["Event", "Action", "Time", "Transition", "Actor", "Evidence Type", "Target ID", "Evidence Ref", "Evidence Quality", "Note"],
      certificationActionEventRows(report, locale),
      zh ? "暂无认证推进事件" : "No certification action events"
    ),
    "<h3>" + (zh ? "认证动作效果追踪" : "Certification Action Effectiveness") + "</h3>",
    table(
      zh ? ["Effect", "Action", "Blocker", "动作", "效果", "分数变化", "Blocker", "证据质量", "评估 Recheck"] : ["Effect", "Action", "Blocker", "Action", "Effect", "Score Change", "Blocker", "Evidence Quality", "Evaluation Recheck"],
      certificationActionEffectivenessRows(report, locale),
      zh ? "暂无认证动作效果记录" : "No certification action effectiveness records"
    ),
    "<h3>" + (zh ? "Verified 但指标未解除" : "Verified But Metrics Still Blocked") + "</h3>",
    table(
      zh ? ["Recheck", "目标", "目标状态", "指标验证", "仍命中的 blocker"] : ["Recheck", "Objective", "Objective Status", "Metric Validation", "Still Matching Blockers"],
      certificationEvidenceReviewRows(report, locale),
      zh ? "暂无指标冲突" : "No metric conflicts"
    ),
    "<h3>" + (zh ? "人工认证审核申请" : "Human Certification Review Requests") + "</h3>",
    table(
      zh ? ["Request", "Agent", "申请状态", "认证状态", "分数", "审核决定", "审计证据"] : ["Request", "Agent", "Request Status", "Certification State", "Score", "Reviewer Decision", "Audit Evidence"],
      certificationReviewRequestRows(report, locale),
      zh ? "暂无审核申请" : "No review requests"
    ),
    "<h3>" + (zh ? "补证任务队列" : "Evidence Task Queue") + "</h3>",
    table(
      zh ? ["Task", "严重度", "状态", "类型", "任务", "所需证据", "更新时间"] : ["Task", "Severity", "Status", "Type", "Task", "Required Evidence", "Updated"],
      certificationEvidenceTaskRows(report, locale),
      zh ? "暂无补证任务" : "No evidence tasks"
    ),
    "</section>",
    "<section class=\"grid two\">",
    "<div class=\"panel\">",
    `<h2>${zh ? "明日行动计划" : "Tomorrow Action Plan"}</h2>`,
    table(zh ? ["优先级", "类型", "行动", "原因"] : ["Priority", "Type", "Action", "Reason"], actionRows(report.next_actions || [], locale), zh ? "暂无行动" : "No actions"),
    "</div>",
    "<div class=\"panel\">",
    `<h2>${zh ? "可持续积累的数据资产" : "Compounding Assets"}</h2>`,
    assetList(report.learning_assets || {}, locale),
    "</div>",
    "</section>",
    "<section class=\"panel\" id=\"eval-replay\" style=\"margin-top:14px\">",
    `<h2>${zh ? "Eval 回放门禁" : "Eval Replay Gate"}</h2>`,
    table(
      zh ? ["Eval Run", "门禁结论", "用例数", "通过", "失败", "回归", "通过率"] : ["Eval Run", "Gate", "Cases", "Passed", "Failed", "Regressions", "Pass Rate"],
      evalReplayRows(report, locale),
      zh ? "尚未执行 eval replay" : "No eval replay has run"
    ),
    "</section>",
    "<section class=\"panel\" id=\"evolution\" style=\"margin-top:14px\">",
    `<h2>${zh ? "自我进化记忆" : "Self-Evolution Memory"}</h2>`,
    `<div class="grid three">${insights.length ? insights.map((insight) => insightCard(insight, locale)).join("") : `<p class=\"empty\">${zh ? "暂无自我进化洞察" : "No learning insights"}</p>`}</div>`,
    "</section>",
    "<section class=\"panel\" id=\"learning-rules\" style=\"margin-top:14px\">",
    `<h2>${zh ? "学习规则审核" : "Learning Rule Review"}</h2>`,
    "<h3>" + (zh ? "策略学习审核总览" : "Policy Learning Review Summary") + "</h3>",
    table(
      zh ? ["项目", "数量"] : ["Item", "Count"],
      policyLearningReviewSummaryRows(report, locale),
      zh ? "暂无策略学习审核汇总" : "No policy learning review summary"
    ),
    "<h3>" + (zh ? "策略学习审核" : "Policy Learning Review") + "</h3>",
    table(
      zh
        ? ["规则", "来源", "规则类型", "置信度", "状态", "影响范围", "建议审核", "安全边界", learningRuleForms ? "人工审核" : "本地审核命令"]
        : ["Rule", "Source", "Rule Type", "Confidence", "Status", "Influence", "Review Advice", "Safety Boundary", learningRuleForms ? "Human Review" : "Local Review Command"],
      policyLearningReviewRowsWithOptions(report, locale, { learningRuleForms }),
      zh ? "暂无策略学习审核记录" : "No policy learning review records"
    ),
    "<h3>" + (zh ? "学习规则列表" : "Learning Rules") + "</h3>",
    table(
      zh ? ["效果", "来源", "目标", "模式", "置信度", "状态", "证据", "影响", "规则 ID"] : ["Effect", "Source", "Target", "Pattern", "Confidence", "Status", "Evidence", "Influence", "Rule ID"],
      learningRuleRows(report, locale),
      zh ? "暂无学习规则" : "No learning rules"
    ),
    "<h3>" + (zh ? "学习规则事件" : "Learning Rule Events") + "</h3>",
    table(
      zh ? ["Event", "Rule", "时间", "状态变化", "操作者", "备注"] : ["Event", "Rule", "Time", "Transition", "Actor", "Note"],
      learningRuleEventRows(report, locale),
      zh ? "暂无学习规则事件" : "No learning rule events"
    ),
    "<h3>" + (zh ? "学习规则生成策略草案" : "Learning Rule Policy Drafts") + "</h3>",
    table(
      zh ? ["学习规则", "策略草案", "状态", "原因"] : ["Learning Rule", "Policy Draft", "State", "Reason"],
      learningRulePolicyDraftRows(report, locale),
      zh ? "暂无学习规则生成的策略草案" : "No policy drafts created from learning rules"
    ),
    "</section>",
    "<section class=\"panel\" id=\"policy-dry-run\" style=\"margin-top:14px\">",
    `<h2>${zh ? "策略草案 Dry-run" : "Policy Draft Dry Run"}</h2>`,
    table(
      zh ? ["策略 ID", "名称", "严重度", "状态", "命中数", "最高命中", "证据批次 / 条数", "审核建议", "建议"] : ["Policy ID", "Name", "Severity", "State", "Matches", "Top Match", "Evidence / Count", "Review", "Recommendation"],
      policyDryRunRows(report, locale),
      zh ? "暂无策略草案 dry-run 结果" : "No policy dry-run results"
    ),
    "<h3>" + (zh ? "策略草案审核证据包" : "Policy Draft Review Packets") + "</h3>",
    table(
      zh ? ["策略", "审核准备度", "建议状态", "命中 / 高风险", "误伤风险", "样本运行"] : ["Policy", "Readiness", "Recommended State", "Matches / High Risk", "False Positive Risk", "Sample Runs"],
      policyReviewPacketRows(report, locale),
      zh ? "暂无策略草案审核证据包" : "No policy review packets"
    ),
    "<h3>" + (zh ? "策略草案审核任务" : "Policy Draft Review Tasks") + "</h3>",
    table(
      zh ? ["任务", "策略", "优先级", "准备度", "建议状态", "状态", "样本运行", "下一步"] : ["Task", "Policy", "Priority", "Readiness", "Recommended State", "Status", "Sample Runs", "Next Step"],
      policyReviewTaskRows(report, locale),
      zh ? "暂无策略草案审核任务" : "No policy review tasks"
    ),
    "<h3>" + (zh ? "策略草案审核任务事件" : "Policy Review Task Events") + "</h3>",
    table(
      zh ? ["事件", "任务", "时间", "状态变化", "操作者", "备注"] : ["Event", "Task", "Time", "Transition", "Actor", "Note"],
      policyReviewTaskEventRows(report, locale),
      zh ? "暂无策略草案审核任务事件" : "No policy review task events"
    ),
    "<h3>" + (zh ? "策略审核动作事件" : "Policy Review Work Item Events") + "</h3>",
    table(
      zh ? ["事件", "策略", "动作项", "时间", "事件类型", "操作者", "安全边界", "备注"] : ["Event", "Policy", "Work Item", "Time", "Event Type", "Actor", "Safety", "Note"],
      policyReviewWorkItemEventRows(report, locale),
      zh ? "暂无策略审核动作事件" : "No policy review work item events"
    ),
    "<h3>" + (zh ? "策略审核动作效果" : "Policy Review Work Item Effectiveness") + "</h3>",
    table(
      zh ? ["效果", "策略", "动作项", "结果", "准备度变化", "阻断状态", "来源事件"] : ["Effectiveness", "Policy", "Work Item", "Result", "Readiness Delta", "Blocker", "Source Event"],
      policyReviewWorkItemEffectivenessRows(report, locale),
      zh ? "暂无策略审核动作效果" : "No policy review work item effectiveness"
    ),
    "<h3>" + (zh ? "策略状态候选动作" : "Policy Rule Review Candidates") + "</h3>",
    table(
      zh ? ["候选动作", "策略", "来源任务", "建议状态变化", "状态", "样本运行"] : ["Candidate", "Policy", "Source Task", "Recommended Change", "Status", "Sample Runs"],
      policyRuleReviewCandidateRows(report, locale),
      zh ? "暂无策略状态候选动作" : "No policy review candidates"
    ),
    "<h3>" + (zh ? "策略候选动作事件" : "Policy Review Candidate Events") + "</h3>",
    table(
      zh ? ["事件", "候选动作", "时间", "状态变化", "操作者", "备注"] : ["Event", "Candidate", "Time", "Transition", "Actor", "Note"],
      policyRuleReviewCandidateEventRows(report, locale),
      zh ? "暂无策略候选动作事件" : "No policy review candidate events"
    ),
    "<h3>" + (zh ? "策略草案审核事件" : "Policy Draft Review Events") + "</h3>",
    table(
      zh ? ["事件", "策略", "时间", "状态变化", "操作者", "备注"] : ["Event", "Policy", "Time", "Transition", "Actor", "Note"],
      policyRuleEventRows(report, locale),
      zh ? "暂无策略草案审核事件" : "No policy review events"
    ),
    "</section>",
    "<section class=\"panel\" id=\"incidents\" style=\"margin-top:14px\">",
    `<h2>${zh ? "事故报告" : "Incident Reports"}</h2>`,
    table(
      zh ? ["事故 ID", "严重度", "标题", "根因", "关联运行", "修复状态"] : ["Incident ID", "Severity", "Title", "Root Cause", "Related Runs", "Remediation"],
      incidentRows(report, locale),
      zh ? "暂无事故报告" : "No incident reports"
    ),
    "</section>",
    "<section class=\"panel\" id=\"incident-timeline\" style=\"margin-top:14px\">",
    `<h2>${zh ? "事故处理时间线" : "Incident Remediation Timeline"}</h2>`,
    table(
      zh ? ["事件 ID", "事故 ID", "时间", "状态变化", "操作者", "备注"] : ["Event ID", "Incident ID", "Time", "Transition", "Actor", "Note"],
      incidentRemediationRows(report, locale),
      zh ? "暂无事故处理历史" : "No incident remediation history"
    ),
    "</section>",
    "<section class=\"panel\" id=\"ingestion-health\" style=\"margin-top:14px\">",
    `<h2>${zh ? "接入健康" : "Ingestion Health"}</h2>`,
    table(
      zh ? ["指标", "值"] : ["Metric", "Value"],
      ingestionHealthRows(report, locale),
      zh ? "暂无接入健康数据" : "No ingestion health data"
    ),
    "</section>",
    "<section class=\"panel\" id=\"data-provenance\" style=\"margin-top:14px\">",
    `<h2>${zh ? "数据来源" : "Data Provenance"}</h2>`,
    table(
      zh ? ["指标", "值"] : ["Metric", "Value"],
      dataProvenanceRows(report, locale),
      zh ? "暂无数据来源信息" : "No data provenance information"
    ),
    "</section>",
    "<section class=\"panel\" id=\"data-governance\" style=\"margin-top:14px\">",
    `<h2>${zh ? "数据治理" : "Data Governance"}</h2>`,
    table(
      zh ? ["指标", "值"] : ["Metric", "Value"],
      dataGovernanceRows(report, locale),
      zh ? "暂无数据治理信息" : "No data governance information"
    ),
    "</section>",
    "<section class=\"panel\" id=\"eval-coverage\" style=\"margin-top:14px\">",
    `<h2>${zh ? "Eval 覆盖地图" : "Eval Coverage Map"}</h2>`,
    table(
      zh ? ["指标", "值"] : ["Metric", "Value"],
      evalCoverageRows(report, locale),
      zh ? "暂无 Eval 覆盖信息" : "No eval coverage information"
    ),
    "<h3>" + (zh ? "优先缺口" : "Priority Gaps") + "</h3>",
    table(
      zh ? ["分类", "状态", "失败", "Eval", "已回放", "建议"] : ["Taxonomy", "Status", "Failures", "Evals", "Replayed", "Recommendation"],
      evalCoverageGapRows(report, locale),
      zh ? "暂无优先缺口" : "No priority gaps"
    ),
    "</section>",
    "<section class=\"panel\" id=\"eval-backlog\" style=\"margin-top:14px\">",
    `<h2>${zh ? "Eval Backlog" : "Eval Backlog"}</h2>`,
    table(
      zh ? ["指标", "值"] : ["Metric", "Value"],
      evalBacklogSummaryRows(report, locale),
      zh ? "暂无 Eval 待办" : "No eval backlog"
    ),
    "<h3>" + (zh ? "阻断项" : "Blocking Items") + "</h3>",
    table(
      zh ? ["优先级", "分类", "阻断类型", "失败/Eval/回放", "代表运行", "下一步"] : ["Priority", "Taxonomy", "Blocker", "Failures/Evals/Replayed", "Representative Run", "Next Step"],
      evalBacklogItemRows(report, locale),
      zh ? "暂无阻断项" : "No blocking items"
    ),
    "</section>",
    "<section class=\"panel\" id=\"autonomy-remediation\" style=\"margin-top:14px\">",
    `<h2>${zh ? "自主运行整改计划" : "Autonomy Remediation Plan"}</h2>`,
    table(
      zh ? ["严重度", "标题", "动作", "验证证据", "阻断无人值守"] : ["Severity", "Title", "Action", "Verification Evidence", "Blocks Unattended"],
      autonomyRemediationRows(report, locale),
      zh ? "暂无整改项" : "No remediation items"
    ),
    "</section>",
    "<section class=\"panel\" id=\"evidence-pack\" style=\"margin-top:14px\">",
    `<h2>${zh ? "证据包" : "Evidence Pack"}</h2>`,
    table(
      zh ? ["项目", "值"] : ["Item", "Value"],
      evidencePackRows(result, locale),
      zh ? "暂无证据包命令" : "No evidence pack commands"
    ),
    "</section>",
    "<section class=\"panel\" id=\"readiness-dossier\" style=\"margin-top:14px\">",
    `<h2>${zh ? "可信档案" : "Readiness Dossier"}</h2>`,
    table(
      zh ? ["项目", "值"] : ["Item", "Value"],
      readinessDossierRows(result, locale),
      zh ? "暂无可信档案命令" : "No readiness dossier commands"
    ),
    "</section>",
    "<section class=\"panel\" id=\"policy-governance-dossier\" style=\"margin-top:14px\">",
    `<h2>${zh ? "策略治理证据包" : "Policy Governance Dossier"}</h2>`,
    table(
      zh ? ["项目", "值"] : ["Item", "Value"],
      policyGovernanceDossierRows(result, locale),
      zh ? "暂无策略治理证据包命令" : "No policy governance dossier commands"
    ),
    "</section>",
    "<section class=\"panel\" id=\"policy-review-workbench\" style=\"margin-top:14px\">",
    `<h2>${zh ? "策略审核工作台" : "Policy Review Workbench"}</h2>`,
    table(
      zh ? ["项目", "值"] : ["Item", "Value"],
      policyReviewWorkbenchRows(result, locale),
      zh ? "暂无策略审核工作台命令" : "No policy review workbench commands"
    ),
    "</section>",
    "<section class=\"panel\" id=\"runs\" style=\"margin-top:14px\">",
    `<h2>${zh ? "Agent 运行记录" : "Agent Runs"}</h2>`,
    table(zh ? ["运行", "Agent", "状态", "模型", "成本", "延迟"] : ["Run", "Agent", "Status", "Model", "Cost", "Latency"], runRows(report, locale), zh ? "暂无运行记录" : "No runs"),
    "</section>",
    "<section class=\"panel\" id=\"suggestions\" style=\"margin-top:14px\">",
    `<h2>${zh ? "优化建议" : "Suggestions"}</h2>`,
    table(zh ? ["类型", "严重度", "标题", "状态"] : ["Type", "Severity", "Title", "Status"], suggestionRows(report, locale), zh ? "暂无建议" : "No suggestions"),
    "</section>",
    showLocalCommands ? [
      "<section class=\"panel\" id=\"review\" style=\"margin-top:14px\">",
      `<h2>${zh ? "反馈闭环" : "Feedback Loop"}</h2>`,
      table(
        zh
          ? ["建议 ID", "类型", "严重度", "建议", feedbackForms ? "操作" : "本地反馈命令"]
          : ["Suggestion ID", "Type", "Severity", "Suggestion", feedbackForms ? "Actions" : "Local Feedback Command"],
        reviewQueueRows(report, locale, { feedbackForms }),
        zh ? "暂无待反馈建议" : "No suggestions waiting for feedback"
      ),
      "</section>",
    ].join("") : "",
    "<section class=\"panel report-preview\" id=\"report\" style=\"margin-top:14px\">",
    reportBody,
    "</section>",
    "</main>",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}
