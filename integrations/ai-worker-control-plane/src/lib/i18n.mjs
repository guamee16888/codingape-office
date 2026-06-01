export function isChineseLocale(locale) {
  return String(locale || "").toLowerCase().startsWith("zh");
}

export function money(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

export function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function signedNumber(value, digits = 0) {
  const number = Number(value || 0);
  const fixed = number.toFixed(digits);
  return number > 0 ? `+${fixed}` : fixed;
}

const VALUE_LABELS_ZH = {
  success: "成功",
  completed: "已完成",
  errored: "出错",
  timeout: "超时",
  cancelled: "已取消",
  running: "运行中",
  active: "启用中",
  paused: "已暂停",
  trusted: "已信任",
  rejected_rule: "已拒绝",
  partial_failure: "部分失败",
  failure: "失败",
  failed: "失败",
  high_risk: "高风险",
  unknown: "未知",
  unanalyzed: "未分析",
  sent: "已发送",
  open: "待处理",
  evidence_attached: "已附证据",
  investigating: "调查中",
  remediated: "已修复",
  verified: "已验证",
  dismissed: "已忽略",
  reopened: "已重开",
  superseded: "已被替代",
  approved: "已批准",
  accepted: "已接受",
  rejected: "已拒绝",
  pause: "暂停",
  trust: "信任",
  reject_rule: "拒绝规则",
  reactivate: "重新启用",
  useful: "有用",
  not_useful: "无用",
  wrong: "错误",
  pending: "待处理",
  suppressed: "已抑制",
  trusted: "已信任",
  draft_review: "草案待审",
  reviewed: "已复核",
  approved_for_dry_run: "已批准 Dry-run",
  ready_to_enable_later: "可进入后续启用评审",
  in_review: "审核中",
  needs_more_evidence: "需要更多证据",
  needs_more_data: "需要更多数据",
  high_priority_review: "高优先级复核",
  sample_review_required: "需要样本复核",
  low: "低",
  medium: "中",
  high: "高",
  critical: "关键",
  cost: "成本优化",
  prompt: "Prompt 改进",
  tool: "工具改进",
  eval: "评估用例",
  risk: "风险治理",
  human_review: "人工复核",
  policy_review: "策略复核",
  cost_optimization: "成本优化",
  prompt_improvement: "Prompt 改进",
  tool_improvement: "工具改进",
  eval_case: "评估用例",
  incident_report: "事故报告",
  recurring_failure: "重复失败",
  judge_calibration: "Judge 校准",
  trusted_pattern: "可信模式",
  cost_learning: "成本学习",
  prompt_learning: "Prompt 学习",
  governance_learning: "治理学习",
  eval_learning: "评估学习",
  missing_eval_coverage: "缺少评估覆盖",
  unreplayed_eval_coverage: "评估未回放",
  eval_replay_regression: "评估回放回归",
  quality_guardrail: "质量护栏",
  learning_rule_memory: "学习规则记忆",
  policy_dry_run: "策略 Dry-run",
  ready_with_monitoring: "可在监控下自主运行",
  limited_autonomy: "仅限受控自主",
  not_ready: "暂不适合无人值守",
  insufficient_data: "数据不足",
  project: "项目",
  agent: "Agent",
  suppress_suggestion_pattern: "抑制建议模式",
  trust_suggestion_pattern: "信任建议模式",
  boost_certification_action_pattern: "提升认证动作模式",
  monitor_certification_action_pattern: "观察认证动作模式",
  require_stronger_certification_evidence: "要求更强认证证据",
  flag_certification_action_no_metric_lift: "标记无指标提升动作",
  suppress_certification_action_pattern: "抑制认证动作模式",
  boost_policy_work_item_pattern: "提升策略审核动作模式",
  monitor_policy_work_item_pattern: "观察策略审核动作模式",
  deprioritize_policy_work_item_pattern: "降低策略审核动作优先级",
  suppress_policy_work_item_pattern: "抑制策略审核动作模式",
  feedback: "用户反馈",
  certification_action_effectiveness: "认证动作效果",
  policy_review_work_item_effectiveness: "策略审核动作效果",
  keep_active_with_monitoring: "保持启用并监控",
  review_before_trusting: "信任前需要人工复核",
  learning_priority_adjustment: "学习调权",
  tool_error: "工具错误",
  hallucination: "幻觉/事实错误",
  missing_context: "上下文缺失",
  prompt_weakness: "Prompt 弱点",
  user_input_ambiguous: "用户输入不明确",
  policy_risk: "策略风险",
  cost_anomaly: "成本异常",
  latency_issue: "延迟问题",
  permission_risk: "权限风险",
  unsafe_output: "不安全输出",
  tool_empty_result_hallucination: "工具空结果后幻觉",
  tool_runtime_error: "工具运行错误",
  retrieval_context_missing: "检索/上下文缺失",
  date_boundary_error: "日期边界错误",
  prompt_injection_detected: "Prompt Injection",
  unsafe_tool_call: "高风险工具调用",
  cost_overrun_loop: "成本失控循环",
  permission_escalation_attempt: "权限升级尝试",
  workflow_state_drift: "工作流状态漂移",
  human_intent_misread: "人工意图误读",
  policy_conflict: "策略冲突",
  sensitive_data_exposure: "敏感数据暴露",
  unknown_failure: "未知失败",
  passed: "已通过",
  needs_review: "需要复核",
  blocked_by_regression: "因回归被阻断",
  insufficient_eval_coverage: "评估覆盖不足",
  not_run: "未回放",
  pass: "通过",
  regression: "回归",
  blocked_missing_replay: "缺少回放被阻断",
  blocked_missing_eval_coverage: "缺少评估覆盖被阻断",
  blocked_unreplayed_eval_coverage: "评估未回放被阻断",
  blocked_eval_coverage_regressions: "评估覆盖存在回归被阻断",
  promotion_ready: "可进入人工发布审批",
  promotion_blocked: "发布检查阻断",
  promotion_needs_review: "发布检查需复核",
  approved_with_monitoring: "可在监控下自主运行",
  limited_autonomy: "受限自主",
  blocked: "已阻断",
  eligible_for_recheck: "可重新评估",
  blocked_by_hard_and_score: "硬阻断 + 评分阻断",
  blocked_by_hard: "硬阻断",
  blocked_by_score: "评分阻断",
  blocked_by_metric_guardrail: "指标护栏阻断",
  evidence_incomplete: "认证证据不完整",
  closure_evidence_pending: "闭环证据待证明",
  ready_for_human_review: "可提交人工认证审核",
  human_review_requested: "已提交人工审核",
  approved_candidate: "批准候选",
  rejected_for_more_evidence: "需补充证据",
  pending_human_review: "等待人工认证审核",
  blocked_not_ready: "未达申请条件",
  more_evidence_requested: "需补充证据",
  rejected: "已拒绝",
  approve_candidate: "批准为候选",
  request_more_evidence: "要求补充证据",
  hard_blocker_clearance: "清理硬阻断",
  score_blocker_improvement: "提升评分阻断",
  objective_evidence: "补齐整改目标证据",
  evidence_requirement_review: "证据要求复核",
  metric_guardrail_resolution: "解除指标护栏冲突",
  clean_run_window: "生成干净运行窗口",
  hard_blockers: "硬阻断",
  hard_blocker: "硬阻断",
  score_blockers: "评分阻断",
  score_blocker: "评分阻断",
  both: "硬阻断 + 评分阻断",
  none: "无",
  L0: "L0 只观察",
  L1: "L1 人工草稿",
  L2: "L2 监督执行",
  L3: "L3 受限自主",
  L4: "L4 高级自主候选",
  reliability_score: "可靠性",
  eval_confidence_score: "Eval 置信度",
  risk_control_score: "风险控制",
  human_review_dependency_score: "人工复核依赖",
  incident_score: "事故状态",
  cost_stability_score: "成本稳定性",
  sample_only_evidence_not_certifiable: "样例证据不可认证",
  local_development_evidence_not_certifiable: "本地开发证据不可认证",
  mixed_source_evidence_requires_review: "混合来源证据需复核",
  unknown_source_evidence_not_certifiable: "未知来源证据不可认证",
  insufficient_source_evidence: "来源证据不足",
  data_provenance_not_certifiable: "数据来源不可认证",
  certification_production_run_count_minimum_failed: "生产候选运行数不足",
  certification_api_key_authentication_coverage_failed: "API Key 认证覆盖不足",
  certification_signature_verification_coverage_failed: "签名验证覆盖不足",
  certification_no_console_sample_runs_failed: "认证窗口包含样例运行",
  production_run_count_minimum: "生产运行数量最低要求",
  api_key_authentication_coverage: "API Key 认证覆盖率",
  signature_verification_coverage: "签名验证覆盖率",
  no_console_sample_runs: "无控制台样例运行",
  usable_for_customer_readiness: "可用于客户生产 readiness 判断",
  usable_but_source_metadata_should_be_fixed: "可参考但需补齐来源元数据",
  do_not_use_for_certification_without_source_review: "来源混合，认证前必须复核",
  development_only_not_customer_production: "仅本地开发，非客户生产",
  onboarding_sample_not_customer_production: "仅接入演示，非客户生产",
  insufficient_source_evidence: "来源证据不足",
  no_run_evidence: "没有运行证据",
  verified_objectives_still_blocked: "已验证但指标仍阻断",
  no_verified_metric_conflicts: "无已验证指标冲突",
  verified_but_metric_unresolved: "已验证但指标未解除",
  verified_and_metric_cleared: "已验证且指标已解除",
  evidence_requirements_incomplete: "证据要求未满足",
  evidence_requirements_satisfied: "证据要求已满足",
  run_metrics_support_closure: "运行数据支持完成",
  run_metrics_still_blocked: "运行数据仍阻断",
  run_metrics_not_enough_evidence: "运行证据不足",
  evidence_tasks_pending: "补证任务待完成",
  evidence_tasks_ready: "补证任务已就绪",
  no_evidence_tasks: "暂无补证任务",
  generate_evidence_task: "生成补证任务",
  submit_for_human_closure: "提交人工关闭",
  rework_remediation: "重新修复",
  strengthen_evidence: "补强证据",
  attach_evidence: "上传证据",
  missing_evidence_task: "缺少补证任务",
  evidence_missing: "缺少证据",
  evidence_quality_insufficient: "证据质量不足",
  platform_evidence_metric_unresolved: "平台证据已验证但指标未解除",
  strong_evidence_metric_unresolved: "强证据但指标未解除",
  blocker_cleared: "阻断已解除",
  score_improved_blocker_persisted: "分数改善但阻断仍在",
  regressed_after_action: "动作后回退",
  evidence_not_credible: "证据不可信",
  strong_evidence_no_metric_improvement: "强证据但指标无改善",
  no_measurable_improvement: "无可测改善",
  closure_ready: "可验证完成",
  still_blocked: "仍阻断",
  insufficient_run_evidence: "运行证据不足",
  not_metric_closable: "不可用指标关闭",
  requirements_incomplete: "证据要求未满足",
  requirements_satisfied: "证据要求已满足",
  evidence_attached_but_unverified: "已附证据但未验证",
  attached_but_unverified: "已附证据但未验证",
  missing: "缺失",
  expired: "已过期",
  mismatched_objective: "目标不匹配",
  satisfied: "已满足",
};

const EXACT_TEXT_ZH = new Map([
  ["Review high-risk agent run", "复核高风险 Agent 运行"],
  ["Review cost optimization opportunity.", "复核成本优化机会。"],
  ["Review prompt or tool improvement.", "复核 Prompt 或工具改进建议。"],
  ["Convert failure evidence into a regression asset.", "把失败证据沉淀为回归测试资产。"],
  ["Add fallback behavior for failed or incomplete runs", "为失败或未完成的运行增加兜底逻辑"],
  ["Tighten prompt instructions for ambiguous or missing context", "收紧缺失上下文/歧义输入的 Prompt 说明"],
  ["Add redaction and review guardrail", "增加脱敏与人工复核护栏"],
  ["Gate privileged tool calls behind policy", "为高权限工具调用增加策略门禁"],
  ["Require approval for privileged tool calls", "高权限工具调用必须经过批准"],
  ["Prevents unintended business-impacting actions.", "避免非预期的业务影响动作。"],
  ["Review model choice and prompt size for expensive runs", "复核高成本运行的模型选择与 Prompt 长度"],
  ["Create eval case from this run", "将这次运行沉淀为评估用例"],
  ["Turn this run into a regression eval candidate", "将这次运行转为回归评估候选"],
  ["No impact estimate", "暂无影响预估"],
  ["High-risk run needs review", "高风险运行需要人工复核"],
  ["A potentially dangerous or privileged tool was used.", "使用了潜在高风险或高权限工具。"],
  ["Cost pattern worth tracking", "值得跟踪的成本模式"],
  ["Approved prompt drafts are accumulating", "已批准的 Prompt 草案正在积累"],
  ["Policy drafts are waiting for review", "策略草案等待复核"],
  ["Eval backlog should cover recurring failures", "评估用例待办应覆盖重复失败"],
  ["Wrong suggestions must suppress future actionability", "错误建议必须降低后续可执行性"],
  ["Feedback has become learning rules", "反馈已经沉淀为学习规则"],
  ["Use these rules to suppress repeated bad advice and prioritize advice operators have validated.", "用这些规则抑制重复的坏建议，并优先展示操作员已验证的建议。"],
  ["Review policy draft dry-run impact.", "复核策略草案 dry-run 影响面。"],
  ["Can run autonomously with monitoring and audit logging.", "可以在监控和审计记录下自主运行。"],
  ["Can run only in limited autonomy with human-review gates.", "只能在有限自主模式下运行，并保留人工复核门禁。"],
  ["Not enough run evidence to approve autonomous operation.", "运行证据不足，不能批准自主运行。"],
  ["Should not run unattended yet.", "当前不建议无人值守运行。"],
  ["Review the matched runs before enabling this policy as a human-review gate.", "启用为人工复核门禁前，先复核命中的历史运行。"],
  ["Monitor enforced policy performance and false positives.", "持续监控已启用策略的表现和误报。"],
  ["Keep wrong suggestions out of next actions and use them as judge-calibration examples.", "不要把错误建议放入下一步行动，并把它们作为 Judge 校准样本。"],
  ["Keep surfacing similar suggestions, but continue requiring human approval before production changes.", "继续暴露类似建议，但任何生产变更仍需人工批准。"],
  ["Lower confidence for similar suggestions until the judge prompt or classifier evidence is improved.", "在 Judge Prompt 或分类证据改进前，降低类似建议的置信度。"],
  ["Track whether accepted routing, caching, batching, or prompt-compression changes reduce future report cost.", "跟踪已采纳的路由、缓存、批处理或 Prompt 压缩是否降低后续报告成本。"],
  ["Use replay/eval coverage before promoting any prompt draft to production.", "任何 Prompt 草案上线前，先用回放/评估覆盖验证。"],
  ["Review disabled policy drafts and decide which should become enforceable human-review gates later.", "复核已禁用的策略草案，决定哪些未来应成为可执行的人工复核门禁。"],
  ["Prioritize replay coverage for recurring failure categories before prompt or tool changes.", "在改 Prompt 或工具前，优先为重复失败类别补齐回放覆盖。"],
  ["Promote representative runs into eval coverage and review the related prompt, tool fallback, or policy draft.", "把代表性运行纳入评估覆盖，并复核相关 Prompt、工具兜底或策略草案。"],
  ["Create eval cases from the representative failures, then replay before promotion.", "从代表性失败创建评估用例，然后在发布前回放。"],
  ["Run eval replay for existing eval cases and inspect pass/fail/regression results.", "对现有评估用例执行回放，并检查通过、失败和回归结果。"],
  ["Fix the regression, rerun replay, and keep autonomy blocked until it passes.", "先修复回归并重新回放；通过前继续阻断自主运行。"],
  ["Raise autonomy readiness score", "提高自主运行准备度评分"],
  ["Generate reliability score evidence", "生成可靠性评分证据"],
  ["Run baseline eval replay", "执行基线 Eval 回放"],
  ["Review failed eval cases", "复核失败的 Eval 用例"],
  ["Create missing eval coverage", "补齐缺失的 Eval 覆盖"],
  ["Replay existing eval coverage", "回放现有 Eval 覆盖"],
  ["Fix replay regressions", "修复回放回归"],
  ["Review policy dry-run matches", "复核策略 Dry-run 命中"],
  ["Review autonomy blocker", "复核自主运行阻断项"],
  ["Replace non-production evidence with production run traces", "用生产运行轨迹替换非生产证据"],
  ["Collect certifiable production run evidence", "采集可认证的生产运行证据"],
  ["Collect authenticated webhook/API runs from the real customer Agent before using the score for autonomy certification.", "在使用该评分进行自主运行认证前，先采集真实客户 Agent 的认证 Webhook/API 运行。"],
  ["Ingest authenticated webhook/API runs from the real customer Agent and regenerate the report before using the gate for production autonomy certification.", "接入真实客户 Agent 的认证 Webhook/API 运行并重新生成报告，然后再把门禁用于生产自主运行认证。"],
  ["Run a nightly health report or scoring job so this agent has persisted reliability evidence.", "运行夜间体检报告或评分任务，为该 Agent 生成持久化可靠性证据。"],
  ["Reduce high-risk runs, lower human-review dependency, improve reliability, and rerun the nightly report to produce a new score.", "减少高风险运行、降低人工复核依赖、提升可靠性，并重新生成夜间报告以得到新评分。"],
  ["Run replay for current eval cases before expanding autonomy.", "扩大自主权限前，先对当前 Eval 用例执行回放。"],
  ["Review this blocker and attach evidence before increasing autonomy.", "提高自主级别前，先复核该阻断项并附上证据。"],
]);

const TEXT_PATTERNS_ZH = [
  [/^Risk score (\d+), status (.+)$/u, (_match, score, status) => `风险分 ${score}，状态 ${labelFor(status, "zh-CN")}`],
  [/^Recurring (.+) pattern$/u, (_match, category) => `重复${labelFor(category, "zh-CN")}模式`],
  [/^(.+) repeated (\d+) times across (\d+) runs in the recent window\.$/u, (_match, category, cases, runs) => `${labelFor(category, "zh-CN")}在最近窗口内重复 ${cases} 次，涉及 ${runs} 次运行。`],
  [/^Calibrate (.+) suggestions$/u, (_match, type) => `校准${labelFor(type, "zh-CN")}建议`],
  [/^(\d+) (.+) suggestions were rejected, marked not useful, or marked wrong\.$/u, (_match, count, type) => `${count} 条${labelFor(type, "zh-CN")}建议被拒绝、标记无用或标记错误。`],
  [/^Trusted (.+) suggestion pattern$/u, (_match, type) => `可信${labelFor(type, "zh-CN")}建议模式`],
  [/^(\d+) (.+) suggestions were approved or marked useful\.$/u, (_match, count, type) => `${count} 条${labelFor(type, "zh-CN")}建议被批准或标记有用。`],
  [/^Current actionable cost suggestions imply about \$(.+) in estimated 30-day savings\.$/u, (_match, amount) => `当前可执行成本建议预计 30 天可节省约 $${amount}。`],
  [/^(\d+) approved prompt draft versions exist for this project\.$/u, (_match, count) => `该项目已有 ${count} 个已批准的 Prompt 草案版本。`],
  [/^(\d+) disabled policy-rule drafts exist for this project\.$/u, (_match, count) => `该项目已有 ${count} 条未启用的策略规则草案。`],
  [/^(\d+) draft eval cases exist while recurring failures are still present\.$/u, (_match, count) => `当前仍有重复失败，同时已有 ${count} 个草案评估用例。`],
  [/^(\d+) suggestions have been marked wrong\.$/u, (_match, count) => `${count} 条建议已被标记为错误。`],
  [/^(\d+) suppression rules and (\d+) trust rules are active for this project\.$/u, (_match, suppress, trust) => `该项目已有 ${suppress} 条抑制规则和 ${trust} 条信任规则处于启用状态。`],
  [/^Review policy draft: (.+)$/u, (_match, name) => `复核策略草案：${translateText(name, "zh-CN")}`],
  [/^High-risk agent run: (.+)$/u, (_match, root) => `高风险 Agent 运行：${labelFor(root, "zh-CN")}`],
  [/^Recurring failure pattern: (.+)$/u, (_match, root) => `重复失败模式：${labelFor(root, "zh-CN")}`],
  [/^(\d+) historical runs would match this disabled policy draft\.$/u, (_match, count) => `${count} 次历史运行会命中这条未启用的策略草案。`],
  [/^No stored runs were available for this scoring period\.$/u, () => "本评分周期没有可用运行记录。"],
  [/^(\d+) high-risk runs were detected in the period\.$/u, (_match, count) => `本周期检测到 ${count} 次高风险运行。`],
  [/^(\d+) runs require human review\.$/u, (_match, count) => `${count} 次运行需要人工复核。`],
  [/^(\d+) failed or partially failed runs reduce reliability\.$/u, (_match, count) => `${count} 次失败或部分失败运行拉低可靠性。`],
  [/^Regression coverage is still thin relative to observed failures\.$/u, () => "相对已观察失败，回归测试覆盖仍然不足。"],
  [/^Latest eval replay has (\d+) regression results\.$/u, (_match, count) => `最近一次 eval 回放出现 ${count} 个回归结果。`],
  [/^Latest eval replay has (\d+) failed cases that need review\.$/u, (_match, count) => `最近一次 eval 回放有 ${count} 个失败用例需要复核。`],
  [/^Cost efficiency is below the autonomy threshold\.$/u, () => "成本效率低于自主运行阈值。"],
  [/^A disabled policy draft matched high-risk historical runs and needs review before autonomy increases\.$/u, () => "有未启用策略草案命中过高风险历史运行，提高自主级别前必须复核。"],
  [/^No major failure, risk, human-review, or cost blocker was detected in the scoring period\.$/u, () => "本评分周期未发现主要失败、风险、人工复核或成本阻塞项。"],
  [/^The run needs follow-up based on status, risk, cost, or latency signals\.$/u, () => "这次运行需要根据状态、风险、成本或延迟信号继续跟进。"],
  [/^The run appears successful based on available telemetry\.$/u, () => "根据现有遥测信号，这次运行看起来成功。"],
  [/^No obvious failure, risk, or cost anomaly detected by the local fallback judge\.$/u, () => "本地 fallback judge 未检测到明显失败、风险或成本异常。"],
  [/^Output contains an error or failure marker\.$/u, () => "输出中包含错误或失败标记。"],
];

export function labelFor(value, locale) {
  if (!isChineseLocale(locale)) {
    return String(value ?? "");
  }

  return VALUE_LABELS_ZH[String(value ?? "")] || String(value ?? "");
}

export function translateText(value, locale) {
  const text = String(value ?? "");
  if (!isChineseLocale(locale) || !text) {
    return text;
  }

  if (EXACT_TEXT_ZH.has(text)) {
    return EXACT_TEXT_ZH.get(text);
  }

  for (const [pattern, replacement] of TEXT_PATTERNS_ZH) {
    const match = text.match(pattern);
    if (match) {
      return replacement(...match);
    }
  }

  return text;
}

function listLines(items, fallback = "- 暂无") {
  if (!items.length) {
    return fallback;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatCostGroupZh(item) {
  return `${item.name}: 总成本 ${money(item.total_cost)}，运行 ${item.run_count} 次，平均 ${money(item.average_cost)}，平均延迟 ${item.average_latency}s`;
}

function trendLineZh(label, current, previous, delta, options = {}) {
  if (options.rate) {
    return `${label}: ${percent(current)}，昨日 ${percent(previous)}（${signedNumber(delta * 100, 1)} 个百分点）`;
  }

  if (options.money) {
    return `${label}: ${money(current)}，昨日 ${money(previous)}（${signedNumber(delta, 4)}）`;
  }

  return `${label}: ${current}，昨日 ${previous}（${signedNumber(delta)}）`;
}

function nextActionLineZh(action) {
  const target = action.suggestion_id
    ? ` [run: ${action.run_id}, suggestion: ${action.suggestion_id}]`
    : ` [run: ${action.run_id}]`;
  return `${labelFor(action.priority, "zh-CN")}优先级 - ${translateText(action.title, "zh-CN")}：${translateText(action.reason, "zh-CN")}${target}`;
}

function actionLineZh(action, runId) {
  return `${translateText(action.title, "zh-CN")}（${labelFor(action.severity, "zh-CN")}，${labelFor(action.type, "zh-CN")}，状态=${labelFor(action.status, "zh-CN")}）- ${translateText(action.expected_impact || "No impact estimate", "zh-CN")} [run: ${runId}, suggestion: ${action.suggestion_id}]`;
}

function assetSummaryLinesZh(summary = {}) {
  return [
    `Agent 运行轨迹: ${summary.agent_run_traces ?? 0}`,
    `结果标签: ${summary.outcome_labels ?? 0}`,
    `失败案例: ${summary.failure_cases ?? 0}`,
    `失败分类 Taxonomy: ${summary.failure_taxonomies ?? 0}`,
    `成本事件: ${summary.cost_events ?? 0}`,
    `评估用例: ${summary.eval_cases ?? 0}`,
    `优化建议: ${summary.optimization_suggestions ?? 0}`,
    `用户反馈标签: ${summary.user_feedback_labels ?? 0}`,
    `自我进化洞察: ${summary.learning_insights ?? 0}`,
    `学习规则: ${summary.learning_rules ?? 0}`,
    `可靠性评分: ${summary.reliability_scores ?? 0}`,
    `评分快照: ${summary.score_snapshots ?? 0}`,
    `策略规则: ${summary.policy_rules ?? 0}`,
    `策略审核事件: ${summary.policy_rule_events ?? 0}`,
    `策略审核任务: ${summary.policy_review_tasks ?? 0}`,
    `策略审核任务事件: ${summary.policy_review_task_events ?? 0}`,
    `策略审核动作事件: ${summary.policy_review_work_item_events ?? 0}`,
    `策略审核动作效果: ${summary.policy_review_work_item_effectiveness ?? 0}`,
    `策略状态候选动作: ${summary.policy_rule_review_candidates ?? 0}`,
    `策略候选动作事件: ${summary.policy_rule_review_candidate_events ?? 0}`,
    `策略 Dry-run 证据批次: ${summary.policy_dry_runs ?? 0}`,
    `策略 Dry-run 命中证据: ${summary.policy_dry_run_matches ?? 0}`,
    `评估运行: ${summary.eval_runs ?? 0}`,
    `回放结果: ${summary.replay_results ?? 0}`,
    `模型路由策略: ${summary.model_route_policies ?? 0}`,
    `Prompt 发布检查: ${summary.prompt_promotion_checks ?? 0}`,
    `自主运行门禁检查: ${summary.autonomy_gate_checks ?? 0}`,
    `自主运行认证路线图: ${summary.autonomy_certification_roadmaps ?? 0}`,
    `整改目标: ${summary.remediation_objectives ?? 0}`,
    `整改目标事件: ${summary.remediation_objective_events ?? 0}`,
    `目标指标验证: ${summary.objective_metric_validations ?? 0}`,
    `运行闭环评估: ${summary.objective_run_closure_assessments ?? 0}`,
    `自主运行复查: ${summary.autonomy_gate_rechecks ?? 0}`,
    `事故报告: ${summary.incident_reports ?? 0}`,
    `事故处理事件: ${summary.incident_remediation_events ?? 0}`,
    `审计证据条目: ${summary.audit_evidence_items ?? 0}`,
    `匿名 Benchmark 模式: ${summary.anonymized_benchmark_patterns ?? 0}`,
    `Prompt 版本: ${summary.prompt_versions ?? 0}`,
    `已生成报告: ${summary.reports ?? 0}`,
    `审计事件: ${summary.audit_events ?? 0}`,
  ];
}

function feedbackSummaryLinesZh(summary = {}) {
  const feedback = summary.feedback_by_type?.length
    ? summary.feedback_by_type.map((item) => `${labelFor(item.name, "zh-CN")}: ${item.count}`).join("，")
    : "暂无";
  const suggestions = summary.suggestions_by_status?.length
    ? summary.suggestions_by_status.map((item) => `${labelFor(item.name, "zh-CN")}: ${item.count}`).join("，")
    : "暂无";

  return [
    `按类型统计的反馈标签: ${feedback}`,
    `按状态统计的建议: ${suggestions}`,
  ];
}

function recurringPatternLineZh(pattern) {
  return `${labelFor(pattern.category, "zh-CN")}: ${pattern.case_count} 个案例，覆盖 ${pattern.run_count} 次运行和 ${pattern.agent_count} 个 Agent，严重度=${(pattern.severities || []).map((item) => labelFor(item, "zh-CN")).join("/")}，最后出现=${pattern.last_seen_at}`;
}

function learningInsightLineZh(insight) {
  return `${labelFor(insight.severity, "zh-CN")} - ${translateText(insight.title, "zh-CN")}：${translateText(insight.recommended_action, "zh-CN")} [insight: ${insight.id}]`;
}

function learningRuleLineZh(rule) {
  const pattern = rule.pattern_json || {};
  const effect = rule.rule_type === "suppress_suggestion_pattern"
    ? "已抑制"
    : rule.rule_type === "trust_suggestion_pattern"
      ? "已信任"
      : labelFor(rule.rule_type, "zh-CN");
  const target = pattern.suggestion_type || pattern.recommended_action || pattern.blocker_code || "suggestion";
  return `${effect} - ${labelFor(target, "zh-CN")}「${translateText(pattern.title || pattern.blocker_code || rule.pattern_key, "zh-CN")}」，置信度 ${Number(rule.confidence || 0).toFixed(2)} [rule: ${rule.id}]`;
}

function learningRuleReviewLineZh(rule) {
  const source = labelFor(rule.review?.source || "unknown", "zh-CN");
  const affected = Number(rule.review?.affected_action_count || 0) + Number(rule.review?.affected_policy_work_item_count || 0);
  const nextStatus = rule.status === "active"
    ? (rule.review?.suggested_review_decision === "review_before_trusting" ? "paused" : "trusted")
    : rule.status === "paused"
      ? "active"
      : rule.status === "trusted"
        ? "paused"
        : "active";
  return `${labelFor(rule.rule_type, "zh-CN")}: 来源=${source}，建议=${labelFor(rule.review?.suggested_review_decision || "unknown", "zh-CN")}，影响=${affected}，置信度=${Number(rule.confidence || 0).toFixed(2)}，审核命令=npm run local:learning-rule-review -- --rule ${rule.id} --status ${nextStatus} --note "reviewed" [rule: ${rule.id}]`;
}

function learningRuleReviewSummaryLinesZh(review = {}) {
  const summary = review.summary || {};
  return [
    `总学习规则: ${summary.total_rules ?? 0}`,
    `用户反馈规则: ${summary.feedback_rules ?? 0}`,
    `认证效果规则: ${summary.certification_effectiveness_rules ?? 0}`,
    `策略审核效果规则: ${summary.policy_work_item_effectiveness_rules ?? 0}`,
    `影响认证动作: ${summary.affected_action_count ?? 0}`,
    `影响策略审核动作: ${summary.affected_policy_work_item_count ?? 0}`,
  ];
}

function policyDryRunLineZh(result) {
  const topMatch = result.matches?.[0];
  const state = result.enabled ? "已启用策略" : "未启用草案";
  const matchText = topMatch
    ? `最高命中=${topMatch.run_id}，风险=${topMatch.risk_score}`
    : "暂无命中";
  const packet = result.review_packet || {};
  const reviewText = packet.review_readiness
    ? `审核准备度=${labelFor(packet.review_readiness, "zh-CN")}，建议状态=${labelFor(packet.recommended_review_status, "zh-CN")}`
    : "审核准备度=未知";

  return `${translateText(result.name, "zh-CN")}: ${result.match_count} 次历史运行会命中这条${state}；${matchText}；${reviewText} [policy: ${result.policy_rule_id}]`;
}

function policyReviewPacketLineZh(result) {
  const packet = result.review_packet || {};
  const summary = packet.evidence_summary || {};
  return `${translateText(result.name, "zh-CN")}: 准备度=${labelFor(packet.review_readiness || "unknown", "zh-CN")}，建议=${labelFor(packet.recommended_review_status || "draft_review", "zh-CN")}，样本=${(summary.sample_run_ids || []).join(", ") || "无"}，误伤风险=${labelFor(summary.false_positive_risk || "unknown", "zh-CN")} [policy: ${result.policy_rule_id}]`;
}

function policyDryRunEvidenceLineZh(evidence) {
  return `${translateText(evidence.name, "zh-CN")}: 已保存 ${evidence.match_evidence_count} 条命中证据，其中 ${evidence.high_risk_match_count} 条高风险 [dry-run: ${evidence.policy_dry_run_id}, policy: ${evidence.policy_rule_id}]`;
}

function policyReviewWorkItemEventLineZh(event) {
  return `${event.work_item_id}: ${labelFor(event.event_type || "unknown", "zh-CN")}，操作者=${labelFor(event.actor_type || "system", "zh-CN")}${event.actor_id ? `/${event.actor_id}` : ""}，安全边界=${event.evidence?.mutates_state ? "可能改变状态" : "只记录证据"} [event: ${event.id}, policy: ${event.policy_rule_id}]`;
}

function policyReviewWorkItemEffectivenessLineZh(item) {
  return `${item.work_item_id}: ${labelFor(item.effectiveness_status || "unknown", "zh-CN")}，准备度 ${item.source_readiness_score} -> ${item.current_readiness_score}（${item.readiness_score_delta >= 0 ? "+" : ""}${item.readiness_score_delta}），阻断=${item.blocker_cleared ? "已解除" : "仍存在"} [effectiveness: ${item.id}, event: ${item.policy_review_work_item_event_id}]`;
}

function scoreSummaryLineZh(score) {
  return `${labelFor(score.target_type, "zh-CN")}:${score.target_id} 自主准备度=${score.autonomy_readiness_score}/100，可靠性=${score.reliability_score}/100，风险控制=${score.risk_exposure_score}/100，状态=${labelFor(score.readiness_status, "zh-CN")} [score: ${score.id}]`;
}

function evalReplayGateLinesZh(gate) {
  if (!gate?.has_eval_run) {
    return ["尚未执行 eval replay。"];
  }

  return [
    `最近一次回放：${gate.eval_run_id}`,
    `门禁结论：${labelFor(gate.gate_decision, "zh-CN")}`,
    `用例数：${gate.total_cases}`,
    `通过：${gate.pass_count}`,
    `失败：${gate.fail_count}`,
    `回归：${gate.regression_count}`,
    `通过率：${percent(gate.pass_rate)}`,
  ];
}

function promptPromotionCheckLineZh(item) {
  const metadata = item.metadata_json || {};
  const coverageGate = metadata.eval_coverage_gate?.decision
    ? `，覆盖门禁=${labelFor(metadata.eval_coverage_gate.decision, "zh-CN")}`
    : "";
  const summary = metadata.eval_coverage?.summary;
  const coverageSummary = summary
    ? `，覆盖缺口：缺评估=${summary.missing_eval_taxonomy_count || 0}，未回放=${summary.not_replayed_taxonomy_count || 0}，回归=${summary.regression_taxonomy_count || 0}`
    : "";
  return `${translateText(metadata.prompt_name || item.target_id, "zh-CN")}: ${labelFor(metadata.promotion_decision, "zh-CN")} -> ${labelFor(metadata.resulting_status, "zh-CN")}${coverageGate}${coverageSummary} [evidence: ${item.id}, prompt: ${item.target_id}]`;
}

function autonomyGateCheckLineZh(item) {
  const metadata = item.metadata_json || {};
  const blockers = metadata.blockers?.length ? `，阻断原因=${metadata.blockers.length}` : "";
  const remediation = metadata.remediation_plan?.summary
    ? `，整改项=${metadata.remediation_plan.summary.open_item_count || 0}，阻断整改=${metadata.remediation_plan.summary.blocking_item_count || 0}`
    : "";
  const summary = metadata.eval_coverage?.summary;
  const coverage = summary
    ? `，覆盖缺口：缺评估=${summary.missing_eval_taxonomy_count || 0}，未回放=${summary.not_replayed_taxonomy_count || 0}，回归=${summary.regression_taxonomy_count || 0}`
    : "";
  return `${item.target_id}: ${labelFor(metadata.gate_decision, "zh-CN")}，允许自主=${metadata.autonomy_allowed ? "是" : "否"}${blockers}${remediation}${coverage} [evidence: ${item.id}]`;
}

function autonomyRemediationLineZh(item) {
  const evidence = (item.verification_evidence || []).join("，") || "新的门禁证据";
  return `${labelFor(item.severity, "zh-CN")} - ${translateText(item.title || "", "zh-CN")}：${translateText(item.action || "", "zh-CN")}。验证证据：${evidence} [${item.remediation_id}]`;
}

function certificationRoadmapLineZh(roadmap) {
  return `${roadmap.agent_id}: 当前 ${roadmap.current_score ?? 0}/100，目标 ${labelFor(roadmap.target_autonomy_level, "zh-CN")} ${roadmap.target_score ?? 60}/100，门禁=${labelFor(roadmap.current_gate_status, "zh-CN")}，阻断类型=${labelFor(roadmap.blocked_by, "zh-CN")}，完成后预计=${roadmap.estimated_score_after_plan ?? roadmap.current_score ?? 0}/100，复查命令=${roadmap.recheck_command || "npm run local:autonomy-gate"} [roadmap: ${roadmap.roadmap_id || "pending"}]`;
}

function certificationBreakdownLineZh(roadmap) {
  const dimensions = roadmap.score_breakdown?.dimensions || {};
  const weights = roadmap.score_breakdown?.weights || {};
  return Object.entries(dimensions).map(([key, item]) => {
    const reason = (item.reasons || []).map((text) => translateText(text, "zh-CN")).join(" ");
    return `${labelFor(key, "zh-CN")}=${item.score ?? 0}/100，权重=${weights[key] ?? 0}，${reason}`;
  });
}

function certificationObjectiveLineZh(item) {
  const requirements = (item.verification_requirements || []).join("，") || "新的门禁证据";
  const criteria = (item.success_criteria || []).join("，") || "通过下一次 Autonomy Gate";
  return `${labelFor(item.severity, "zh-CN")} - ${translateText(item.title || "", "zh-CN")}：${item.current_value} -> ${item.target_value}，预计 +${item.expected_score_delta || 0} 分。验证证据：${requirements}。成功标准：${criteria} [objective: ${item.id || "pending"}]`;
}

function incidentReportLineZh(item) {
  const runs = (item.related_run_ids || []).join("，");
  return `${translateText(item.title, "zh-CN")}（${labelFor(item.severity, "zh-CN")}，状态=${labelFor(item.remediation_status, "zh-CN")}，根因=${labelFor(item.root_cause_category, "zh-CN")}）[incident: ${item.id}, runs: ${runs}]`;
}

function incidentRemediationEventLineZh(item) {
  const actor = item.actor_id ? `${item.actor_type}:${item.actor_id}` : item.actor_type;
  const note = item.note ? `，备注=${item.note}` : "";
  return `${item.incident_report_id}: ${labelFor(item.from_status, "zh-CN")} -> ${labelFor(item.to_status, "zh-CN")}，操作者=${actor}${note} [event: ${item.id}]`;
}

function ingestionHealthLinesZh(health = {}) {
  return [
    `接入事件：${health.total_events ?? 0}`,
    `已接收：${health.accepted_events ?? 0}`,
    `重复重试：${health.duplicate_events ?? 0}`,
    `签名覆盖率：${percent(health.signature_coverage_rate)}`,
    `重复率：${percent(health.duplicate_rate)}`,
    `最近接入：${health.last_ingested_at || "暂无"}`,
  ];
}

function dataProvenanceSourceTypeZh(value) {
  return {
    demo_data_present: "包含示例数据",
    local_workspace: "本地工作区数据",
    webhook_or_api: "Webhook/API 接入数据",
    mixed_or_unknown: "混合或未知来源",
    no_runs: "本周期无运行",
  }[value] || value || "未知";
}

function dataProvenanceTrustLevelZh(value) {
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

function readinessEvidenceStatusZh(value) {
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

function dataProvenanceNoteZh(value) {
  return {
    "Report includes demo-like runs. Do not treat it as customer production evidence.": "报告包含示例痕迹，不要把它当成客户生产证据。",
    "Report is based on local workspace runs captured by the Codex/local adapter.": "报告基于 Codex/本地适配器捕获的本地工作区运行。",
    "Report includes runs received through authenticated webhook/API ingestion.": "报告包含通过认证 Webhook/API 接入的运行。",
    "Report includes runs with mixed or unknown source metadata.": "报告包含混合或未知来源的运行，需要补齐来源元数据。",
    "No runs were found for this report period.": "本报告周期没有运行记录。",
  }[value] || value || "暂无来源说明。";
}

function countListZh(items = []) {
  return items.length ? items.map((item) => `${item.name}: ${item.count}`).join("，") : "无";
}

function dataProvenanceLinesZh(summary = {}) {
  return [
    `来源类型：${dataProvenanceSourceTypeZh(summary.source_type)}`,
    `证据可信等级：${dataProvenanceTrustLevelZh(summary.evidence_trust_level)}`,
    `Readiness 证据状态：${readinessEvidenceStatusZh(summary.readiness_evidence_status)}`,
    `本周期运行：${summary.total_runs ?? 0}`,
    `生产候选运行：${summary.production_candidate_runs ?? 0}`,
    `API Key 认证运行：${summary.api_key_authenticated_runs ?? 0}`,
    `签名验证运行：${summary.signature_verified_runs ?? 0}`,
    `API Key 认证覆盖率：${percent(summary.api_key_authentication_coverage_rate)}`,
    `签名验证覆盖率：${percent(summary.signature_verification_coverage_rate)}`,
    `认证证据达标：${summary.certification_evidence_ready ? "是" : "否"}`,
    `本地适配器运行：${summary.local_adapter_runs ?? 0}`,
    `控制台样例运行：${summary.console_sample_runs ?? 0}`,
    `示例痕迹运行：${summary.demo_like_runs ?? 0}`,
    `未知来源运行：${summary.unknown_source_runs ?? 0}`,
    `成本/Token 未知运行：${summary.token_cost_unknown_runs ?? 0}`,
    `运行元数据来源：${countListZh(summary.metadata_sources || [])}`,
    `接入审计来源：${countListZh(summary.ingestion_sources || [])}`,
    `可信说明：${dataProvenanceNoteZh(summary.confidence_note)}`,
  ];
}

function dataGovernanceLinesZh(governance = {}) {
  const summary = governance.summary || {};
  return [
    `策略模式：${governance.mode === "advisory_only" ? "仅建议，不自动删除" : governance.mode || "未知"}`,
    `策略版本：${governance.policy_version || "未知"}`,
    `治理记录总数：${summary.total_records ?? 0}`,
    `仍在策略内的资产：${summary.within_policy_count ?? 0}`,
    `需要归档复核的资产：${summary.archive_due_count ?? 0}`,
    `需要保留期复核的资产：${summary.retention_due_count ?? 0}`,
    `护栏：${(governance.guardrails || [])[0] || "Phase 1 只做建议，不自动删除。"}`,
  ];
}

function evalCoverageLinesZh(coverage = {}) {
  const summary = coverage.summary || {};
  return [
    `出现失败的分类数：${summary.taxonomy_count ?? 0}`,
    `失败案例数：${summary.failure_count ?? 0}`,
    `评估用例数：${summary.eval_case_count ?? 0}`,
    `失败转评估比例：${percent(summary.failure_to_eval_ratio)}`,
    `回放覆盖率：${percent(summary.replay_coverage_rate)}`,
    `缺少评估覆盖的分类：${summary.missing_eval_taxonomy_count ?? 0}`,
    `已建评估但未回放的分类：${summary.not_replayed_taxonomy_count ?? 0}`,
    `存在回归的分类：${summary.regression_taxonomy_count ?? 0}`,
  ];
}

function evalBacklogLinesZh(backlog = {}) {
  const summary = backlog.summary || {};
  return [
    `待处理 Eval Backlog：${summary.open_item_count ?? 0}`,
    `关键项：${summary.critical_item_count ?? 0}`,
    `缺少评估覆盖：${summary.missing_eval_count ?? 0}`,
    `需要回放：${summary.needs_replay_count ?? 0}`,
    `回放回归：${summary.regression_count ?? 0}`,
    `自主运行阻断项：${summary.autonomy_blocker_count ?? 0}`,
    `Prompt 发布阻断项：${summary.prompt_promotion_blocker_count ?? 0}`,
  ];
}

function evalBacklogItemLineZh(item) {
  return `${labelFor(item.priority, "zh-CN")} - ${labelFor(item.taxonomy_code, "zh-CN")}：${labelFor(item.blocker_type, "zh-CN")}，失败=${item.failure_count || 0}，Eval=${item.eval_case_count || 0}，已回放=${item.replayed_case_count || 0}，回归=${item.regression_count || 0}。下一步：${translateText(item.next_step || "", "zh-CN")} [${item.backlog_item_id}]`;
}

export function renderChineseReportMarkdown(report) {
  const json = report.content_json || report.report_json || report.json || {};
  const projectId = json.project_id || report.project_id || "unknown";
  const previous = json.previous_day_comparison || {};
  const costOpportunity = json.cost_opportunity || {};
  const learningAssets = json.learning_assets || {};
  const readiness = json.autonomy_readiness || {};
  const projectScore = readiness.project_score || {};
  const traceItems = json.trace_items || [];
  const topRisky = traceItems.filter((item) => item.status === "high_risk").slice(0, 10);

  return [
    "# AI Agent 夜间体检报告",
    "",
    `项目：${projectId}`,
    `周期：${json.period_start || report.period_start || ""} 至 ${json.period_end || report.period_end || ""}`,
    "",
    "## 执行摘要",
    "",
    `- 运行总数：${json.total_runs ?? 0}`,
    `- 成功：${json.success_count ?? 0}`,
    `- 失败或部分失败：${json.failure_count ?? 0}`,
    `- 高风险：${json.high_risk_count ?? 0}`,
    `- 总成本：${money(json.total_cost)}`,
    "",
    "## 这个 Agent 可以无人值守吗？",
    "",
    `- 结论：${translateText(projectScore.autonomy_decision || "Not enough run evidence to approve autonomous operation.", "zh-CN")}`,
    `- 自主运行准备度：${projectScore.autonomy_readiness_score ?? 0}/100`,
    `- 可靠性：${projectScore.reliability_score ?? 0}/100`,
    `- 成本效率：${projectScore.cost_efficiency_score ?? 0}/100`,
    `- 风险暴露控制：${projectScore.risk_exposure_score ?? 0}/100`,
    `- 回归稳定性：${projectScore.regression_stability_score ?? 0}/100`,
    `- 人工复核独立性：${projectScore.human_review_dependency_score ?? 0}/100`,
    `- 状态：${labelFor(projectScore.readiness_status || "insufficient_data", "zh-CN")}`,
    "",
    "### 评分原因",
    "",
    listLines((projectScore.score_reasons || []).map((reason) => translateText(reason, "zh-CN"))),
    "",
    "### Agent 评分",
    "",
    listLines((readiness.agent_scores || []).map(scoreSummaryLineZh)),
    "",
    "## Eval 回放门禁",
    "",
    listLines(evalReplayGateLinesZh(json.eval_replay_gate || {})),
    "",
    "## Prompt 发布检查",
    "",
    listLines((json.prompt_promotion_checks || []).map(promptPromotionCheckLineZh)),
    "",
    "## 自主运行门禁检查",
    "",
    listLines((json.autonomy_gate_checks || []).map(autonomyGateCheckLineZh)),
    "",
    "## 自主运行整改计划",
    "",
    listLines((json.autonomy_gate_checks || []).flatMap((check) => check.metadata_json?.remediation_plan?.items || []).map(autonomyRemediationLineZh)),
    "",
    "## 自主运行认证路线图",
    "",
    listLines((json.autonomy_certification_roadmaps || []).map(certificationRoadmapLineZh)),
    "",
    "### 认证评分拆解",
    "",
    listLines((json.autonomy_certification_roadmaps || []).flatMap(certificationBreakdownLineZh)),
    "",
    "### 量化整改目标",
    "",
    listLines((json.autonomy_certification_roadmaps || []).flatMap((roadmap) => roadmap.remediation_objectives || []).map(certificationObjectiveLineZh)),
    "",
    "## 事故报告",
    "",
    listLines((json.incident_reports || []).map(incidentReportLineZh)),
    "",
    "## 事故处理时间线",
    "",
    listLines((json.incident_remediation_events || []).map(incidentRemediationEventLineZh)),
    "",
    "## 接入健康",
    "",
    listLines(ingestionHealthLinesZh(json.ingestion_health || {})),
    "",
    "## 数据来源",
    "",
    listLines(dataProvenanceLinesZh(json.data_provenance || {})),
    "",
    "## 数据治理",
    "",
    listLines(dataGovernanceLinesZh(json.data_governance || {})),
    "",
    "## Eval 覆盖地图",
    "",
    listLines(evalCoverageLinesZh(json.eval_coverage || {})),
    "",
    "## Eval Backlog",
    "",
    listLines(evalBacklogLinesZh(json.eval_backlog || {})),
    "",
    "### Eval Backlog 项目",
    "",
    listLines((json.eval_backlog?.items || []).map(evalBacklogItemLineZh)),
    "",
    "## 与昨日对比",
    "",
    previous.has_previous_data
      ? listLines([
        trendLineZh("运行总数", previous.current?.total_runs, previous.previous?.total_runs, previous.delta?.total_runs),
        trendLineZh("成功率", previous.current?.success_rate, previous.previous?.success_rate, previous.delta?.success_rate, { rate: true }),
        trendLineZh("失败率", previous.current?.failure_rate, previous.previous?.failure_rate, previous.delta?.failure_rate, { rate: true }),
        trendLineZh("高风险率", previous.current?.high_risk_rate, previous.previous?.high_risk_rate, previous.delta?.high_risk_rate, { rate: true }),
        trendLineZh("总成本", previous.current?.total_cost, previous.previous?.total_cost, previous.delta?.total_cost, { money: true }),
      ])
      : `- ${previous.previous_date || "昨日"} 没有找到可对比的运行记录。`,
    "",
    "## 明日行动计划",
    "",
    listLines((json.next_actions || []).map(nextActionLineZh)),
    "",
    "## 可持续积累的数据资产",
    "",
    listLines(assetSummaryLinesZh(learningAssets)),
    "",
    "### 反馈记忆",
    "",
    listLines(feedbackSummaryLinesZh(learningAssets)),
    "",
    "### 重复失败模式（7 天）",
    "",
    listLines((json.recurring_failure_patterns || []).map(recurringPatternLineZh)),
    "",
    "## 自我进化记忆",
    "",
    listLines((json.learning_insights || []).map(learningInsightLineZh)),
    "",
    "### 反馈沉淀的学习规则",
    "",
    listLines((json.learning_rules || []).map(learningRuleLineZh)),
    "",
    "### 策略学习审核",
    "",
    listLines(learningRuleReviewSummaryLinesZh(json.learning_rule_review || {})),
    "",
    listLines((json.learning_rule_review?.learning_rule_review || []).map(learningRuleReviewLineZh)),
    "",
    "## 策略草案 Dry-run",
    "",
    `- 草案规则数：${json.policy_dry_run_summary?.draft_rule_count ?? 0}`,
    `- 有命中的规则数：${json.policy_dry_run_summary?.rules_with_matches ?? 0}`,
    `- 命中的历史运行数：${json.policy_dry_run_summary?.matched_run_count ?? 0}`,
    `- 命中的高风险运行数：${json.policy_dry_run_summary?.high_risk_matched_run_count ?? 0}`,
    "",
    listLines((json.policy_dry_run_results || []).map(policyDryRunLineZh)),
    "",
    "### 策略草案审核证据包",
    "",
    listLines((json.policy_dry_run_results || []).map(policyReviewPacketLineZh)),
    "",
    "### 策略 Dry-run 证据",
    "",
    listLines((json.policy_dry_run_evidence || []).map(policyDryRunEvidenceLineZh)),
    "",
    "### 策略审核动作事件",
    "",
    listLines((json.policy_review_work_item_events || []).map(policyReviewWorkItemEventLineZh)),
    "",
    "### 策略审核动作效果",
    "",
    listLines((json.policy_review_work_item_effectiveness || []).map(policyReviewWorkItemEffectivenessLineZh)),
    "",
    "## Top 失败类别",
    "",
    listLines((json.top_failure_categories || []).map((item) => `${labelFor(item.name, "zh-CN")}: ${item.count}`)),
    "",
    "## Top 细粒度失败分类",
    "",
    listLines((json.top_failure_taxonomies || []).map((item) => `${labelFor(item.name, "zh-CN")}: ${item.count}，置信度=${item.average_confidence}`)),
    "",
    "## Top 风险输出",
    "",
    listLines(topRisky.map((item) => `${item.run_id}: ${(item.evidence || []).map((evidence) => translateText(evidence, "zh-CN")).join("；") || "高风险运行需要人工复核"}`)),
    "",
    "## 成本摘要",
    "",
    `- 总成本：${money(json.total_cost)}`,
    `- 平均每次运行成本：${money(json.average_cost_per_run)}`,
    `- 按当前速率预估 30 天成本：${money(json.projected_30_day_cost)}`,
    "",
    "### 按模型统计成本",
    "",
    listLines((json.cost_by_model || []).map(formatCostGroupZh)),
    "",
    "### 按 Agent 统计成本",
    "",
    listLines((json.cost_by_agent || []).map(formatCostGroupZh)),
    "",
    "### 按任务类型统计成本",
    "",
    listLines((json.cost_by_task_type || []).map(formatCostGroupZh)),
    "",
    "### Top 高成本运行",
    "",
    listLines((json.top_expensive_runs || []).map((run) => `${run.run_id}: ${money(run.cost)}，model=${run.model}，agent=${run.agent_id}，task=${run.task_type}，latency=${run.latency}s，status=${labelFor(run.status, "zh-CN")}`)),
    "",
    "### 成本优化机会",
    "",
    `- 影响运行数：${costOpportunity.affected_run_count ?? 0}`,
    `- 影响的日成本：${money(costOpportunity.affected_cost)}`,
    `- 预估每日节省：${money(costOpportunity.estimated_daily_savings)}`,
    `- 预估 30 天节省：${money(costOpportunity.estimated_monthly_savings)}`,
    "- 假设：Phase 1 保守估算，可复核的成本优化按受影响日成本节省 20% 计算。",
    "",
    "## 成本优化建议",
    "",
    listLines((json.cost_suggestions || []).slice(0, 10).map((action) => actionLineZh(action, action.run_id))),
    "",
    "## Prompt 与工具改进建议",
    "",
    listLines((json.prompt_suggestions || []).slice(0, 10).map((action) => actionLineZh(action, action.run_id))),
    "",
    "## 风险治理建议",
    "",
    listLines((json.risk_suggestions || []).slice(0, 10).map((action) => actionLineZh(action, action.run_id))),
    "",
    "## 建议生成的评估用例",
    "",
    listLines((json.eval_suggestions || []).slice(0, 10).map((action) => `${translateText(action.title, "zh-CN")} [source run: ${action.run_id}]`)),
    "",
    "## 需要人工复核",
    "",
    listLines((json.human_review_required || []).map((runId) => `${runId}: 需要复核风险、权限或输出边界`)),
    "",
    "## 建议质量信号",
    "",
    "### 按严重度",
    "",
    listLines((json.suggestion_severity_counts || []).map((item) => `${labelFor(item.name, "zh-CN")}: ${item.count}`)),
    "",
    "### 按状态",
    "",
    listLines((json.suggestion_status_counts || []).map((item) => `${labelFor(item.name, "zh-CN")}: ${item.count}`)),
    "",
    "## 可追溯性",
    "",
    listLines(traceItems.map((item) => `${item.run_id}: judgement=${item.judgement_id || "missing"}，agent=${item.agent_id}，status=${labelFor(item.status, "zh-CN")}`)),
    "",
    "## 证据说明",
    "",
    "以上所有内容都来自本周期已存储的 agent_runs 和 run_judgements，可回溯到原始运行日志。",
  ].join("\n");
}

export function reportMarkdownForLocale(report, locale) {
  if (isChineseLocale(locale) && (report.content_json || report.report_json || report.json)) {
    return renderChineseReportMarkdown(report);
  }

  return report.content_markdown || report.markdown || "";
}
