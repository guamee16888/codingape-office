import { summarizeLifeEvents, taxonomyForLifeEvent } from "./life-events.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function statusClass(value) {
  if (["good", "stable", "ready", "clean", "verified", "completed", "resolved", "improved", "low", "active"].includes(value)) return "good";
  if (["warn", "watch", "medium", "review", "limited", "pending", "proposed", "in_progress", "evidence_attached", "reopened", "awaiting_followup_trace", "needs_more_data", "elevated"].includes(value)) return "warn";
  if (["danger", "critical", "blocked", "high", "incident", "dismissed", "ineffective", "over_limit"].includes(value)) return "danger";
  return "neutral";
}

function metricCard(metric) {
  return [
    `<section class="metric ${statusClass(metric.tone)}">`,
    `<span>${escapeHtml(metric.label)}</span>`,
    `<strong>${escapeHtml(metric.value)}</strong>`,
    `<small>${escapeHtml(metric.detail)}</small>`,
    `</section>`,
  ].join("");
}

function cockpitDialCard(item) {
  return [
    `<div class="cockpit-dial ${statusClass(item.tone)} ${item.weight === "primary" ? "primary" : ""}">`,
    `<span>${escapeHtml(item.label)}</span>`,
    `<strong>${escapeHtml(item.value)}</strong>`,
    `<small>${escapeHtml(item.detail)}</small>`,
    `</div>`,
  ].join("");
}

function renderControlCockpit(cockpit = {}) {
  const sleepDebt = cockpit.sleep_debt || {};
  const sleepPercent = clampScore(sleepDebt.percent || 0, 0, 100);
  return [
    `<section class="control-cockpit" id="core-cockpit">`,
    `<div class="cockpit-head">`,
    `<div>`,
    `<p class="eyebrow">Aircraft-grade self-control instruments</p>`,
    `<h2>${escapeHtml(cockpit.title || "Core Cockpit")}</h2>`,
    `<p class="muted">${escapeHtml(cockpit.headline || "")}</p>`,
    `</div>`,
    `${pill("AI JUDGE: HARD MODE", "danger")}`,
    `</div>`,
    `<div class="cockpit-grid">${(cockpit.dials || []).map(cockpitDialCard).join("")}</div>`,
    `<div class="sleep-debt-warning ${statusClass(sleepDebt.tone)}">`,
    `<div class="sleep-debt-copy">`,
    `<span>${escapeHtml(sleepDebt.label || "SLEEP DEBT")}</span>`,
    `<strong>${escapeHtml(sleepDebt.value || "-")}</strong>`,
    `<small>${escapeHtml(sleepDebt.detail || "")}</small>`,
    `</div>`,
    `<div class="sleep-bar" aria-label="${escapeHtml(`${sleepDebt.label || "sleep debt"} ${sleepDebt.value || ""}`)}"><i style="width:${sleepPercent}%"></i></div>`,
    `</div>`,
    `<div class="cockpit-equation"><code>${escapeHtml(cockpit.equation || "")}</code><span>${escapeHtml(cockpit.relation || "")}</span></div>`,
    `</section>`,
  ].join("");
}

function interventionActionForms(item, focus, hour) {
  return [
    `<form class="intervention-form" method="post" action="/life-console">`,
    `<input type="hidden" name="intent" value="action_event">`,
    `<input type="hidden" name="return_to" value="intervention-layer">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<input type="hidden" name="hour" value="${escapeHtml(hour ?? "")}">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(item.action_id)}">`,
    `<input type="hidden" name="blocker" value="${escapeHtml(item.blocker)}">`,
    `<input type="hidden" name="from_status" value="${escapeHtml(item.status || "pending")}">`,
    `<input type="hidden" name="to_status" value="in_progress">`,
    `<input type="hidden" name="evidence_ref" value="${escapeHtml(item.evidence_ref)}">`,
    `<input type="hidden" name="note" value="${escapeHtml(`${item.title}: ${item.instruction}`)}">`,
    `<button type="submit">${escapeHtml(item.button || "执行")}</button>`,
    `</form>`,
    `<form class="intervention-evidence-form" method="post" action="/life-console">`,
    `<input type="hidden" name="intent" value="action_event">`,
    `<input type="hidden" name="return_to" value="intervention-layer">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<input type="hidden" name="hour" value="${escapeHtml(hour ?? "")}">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(item.action_id)}">`,
    `<input type="hidden" name="blocker" value="${escapeHtml(item.blocker)}">`,
    `<input type="hidden" name="from_status" value="${escapeHtml(item.status || "pending")}">`,
    `<input type="hidden" name="to_status" value="evidence_attached">`,
    `<input name="evidence_ref" maxlength="180" value="${escapeHtml(item.latest_evidence_ref || item.proof || "")}" placeholder="${escapeHtml(item.proof || "evidence://")}">`,
    `<input name="note" maxlength="180" value="${escapeHtml(item.latest_note || "")}" placeholder="执行证据备注">`,
    `<button type="submit">提交干预证据</button>`,
    `</form>`,
  ].join("");
}

function interventionActionCard(item, focus, hour) {
  return [
    `<article class="intervention-card ${statusClass(item.tone)}">`,
    `<div class="intervention-card-head">`,
    `<div>`,
    `<span>${escapeHtml(item.priority)} / ${escapeHtml(item.code)}</span>`,
    `<strong>${escapeHtml(item.title)}</strong>`,
    `</div>`,
    `${pill(item.status || "pending", item.status || "pending")}`,
    `</div>`,
    `<p>${escapeHtml(item.instruction)}</p>`,
    `<div class="intervention-meta">`,
    `<span>Proof <code>${escapeHtml(item.proof)}</code></span>`,
    `<span>Cost <code>${escapeHtml(item.cost)}</code></span>`,
    item.latest_event_at ? `<span>Latest <code>${escapeHtml(eventTimeLabel(item.latest_event_at))}</code></span>` : "",
    `</div>`,
    interventionActionForms(item, focus, hour),
    `</article>`,
  ].join("");
}

function renderInterventionLayer(layer = {}, focus = {}, hour = "") {
  return [
    `<section class="intervention-layer ${statusClass(layer.tone)}" id="intervention-layer">`,
    `<div class="intervention-head">`,
    `<div>`,
    `<p class="eyebrow">Immediate Intervention / 即时干预层</p>`,
    `<h2>${escapeHtml(layer.mode || "WATCH MODE")}</h2>`,
    `<p class="muted">${escapeHtml(layer.headline || "")}</p>`,
    `</div>`,
    `${pill(`${layer.active_count || 0} active / ${layer.evidence_count || 0} proof`, layer.evidence_count ? "good" : layer.tone || "neutral")}`,
    `</div>`,
    `<div class="intervention-command">`,
    `<div><span>Risk</span><strong>${escapeHtml(layer.risk_score ?? "-")}</strong></div>`,
    `<div><span>Readiness</span><strong>${escapeHtml(layer.readiness_score ?? "-")}</strong></div>`,
    `<div><span>Cooldown</span><strong>${escapeHtml(layer.countdown_label || "-")}</strong></div>`,
    `<div><span>Blocked Until</span><strong>${escapeHtml(eventTimeLabel(layer.block_until))}</strong></div>`,
    `</div>`,
    `<div class="cost-contract">${escapeHtml(layer.cost_contract || "")}</div>`,
    `<div class="intervention-actions">${(layer.actions || []).map((item) => interventionActionCard(item, focus, hour)).join("")}</div>`,
    `</section>`,
  ].join("");
}

function deviceAnchorForm(item, focus, hour) {
  return [
    `<form class="anchor-form" method="post" action="/life-console">`,
    `<input type="hidden" name="intent" value="action_event">`,
    `<input type="hidden" name="return_to" value="device-anchor">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<input type="hidden" name="hour" value="${escapeHtml(hour ?? "")}">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(item.action_id)}">`,
    `<input type="hidden" name="blocker" value="${escapeHtml(`anchor_${item.code}`)}">`,
    `<input type="hidden" name="from_status" value="${escapeHtml(item.status || "pending")}">`,
    `<input type="hidden" name="to_status" value="evidence_attached">`,
    `<input name="evidence_ref" maxlength="180" value="${escapeHtml(item.latest_evidence_ref || item.proof)}">`,
    `<input name="note" maxlength="180" value="${escapeHtml(item.latest_note || "")}" placeholder="锚点证据备注">`,
    `<button type="submit">锁定锚点</button>`,
    `</form>`,
  ].join("");
}

function deviceAnchorRows(layer = {}, focus = {}, hour = "") {
  return (layer.anchors || []).map((item) => [
    `<tr>`,
    `<td>${pill(item.label, item.tone)}</td>`,
    `<td><code>${escapeHtml(item.layer)}</code></td>`,
    `<td>${pill(`${item.effective_coverage}/100`, item.verified ? "good" : item.tone)}</td>`,
    `<td>${pill(item.status, item.status)}</td>`,
    `<td class="muted">${escapeHtml(item.requirement)}<br>Bypass: ${escapeHtml(item.bypass)}</td>`,
    `<td><code>${escapeHtml(item.latest_evidence_ref || item.proof)}</code></td>`,
    `<td>${deviceAnchorForm(item, focus, hour)}</td>`,
    `</tr>`,
  ].join(""));
}

function renderDeviceAnchorLayer(layer = {}, focus = {}, hour = "") {
  return [
    `<section class="device-anchor-layer ${statusClass(layer.tone)}" id="device-anchor">`,
    `<div class="anchor-head">`,
    `<div>`,
    `<p class="eyebrow">Anti-cheat Anchors / 防作弊锚点</p>`,
    `<h2>${escapeHtml(layer.title || "Device Anchor")}</h2>`,
    `<p class="muted">${escapeHtml(layer.summary || "")}</p>`,
    `</div>`,
    `${pill(`${layer.status || "ANCHOR WEAK"} / ${layer.verified_count || 0}/${layer.total_count || 0}`, layer.tone || "neutral")}`,
    `</div>`,
    `<div class="anchor-score">`,
    `<span>Coverage</span>`,
    `<strong>${escapeHtml(layer.coverage_score ?? "-")}/100</strong>`,
    `<div class="anchor-bar"><i style="width:${clampScore(layer.coverage_score || 0, 0, 100)}%"></i></div>`,
    `</div>`,
    table(
      ["锚点", "层级", "覆盖", "状态", "要求 / 绕过面", "证据", "操作"],
      deviceAnchorRows(layer, focus, hour),
      "暂无防作弊锚点"
    ),
    `</section>`,
  ].join("");
}

function clampScore(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function table(headers, rows, emptyLabel = "暂无数据") {
  if (!rows.length) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;

  return [
    `<div class="table-wrap"><table>`,
    `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`,
    `<tbody>`,
    rows.join(""),
    `</tbody></table></div>`,
  ].join("");
}

function pill(label, tone = "neutral") {
  return `<span class="pill ${statusClass(tone)}">${escapeHtml(label)}</span>`;
}

const FOCUS_CONFIG = {
  short_video: {
    id: "short_video",
    label: "戒短视频",
    title: "LifeOps Control Plane",
    subtitle: "人生运行状态控制台 / 短视频失控风控样机",
    primaryRiskLabel: "短视频复发风险",
    primaryRiskValue: "88%",
    primaryRiskDetail: "23:00 后进入红区",
    gateQuestion: "今晚 23:00 后，能否让手机自由留在手边？",
    gateDecision: "Blocked - 仅允许白名单与充电坞模式",
    triggerName: "睡前低能量刷屏回路",
    rootCause: "晚间疲劳 + 没有预承诺 + 算法连续奖励",
    activeProtocol: "22:30 手机停泊协议",
  },
  dopamine: {
    id: "dopamine",
    label: "多巴胺总控",
    title: "LifeOps Control Plane",
    subtitle: "人生运行状态控制台 / 多巴胺成瘾风控样机",
    primaryRiskLabel: "多巴胺过载风险",
    primaryRiskValue: "76%",
    primaryRiskDetail: "短视频、游戏、熬夜叠加",
    gateQuestion: "今晚能否开放所有高刺激入口？",
    gateDecision: "Limited - 只开放低风险窗口",
    triggerName: "奖励寻求连锁反应",
    rootCause: "压力释放需求被高刺激入口劫持",
    activeProtocol: "高刺激入口分级放行",
  },
  impulse: {
    id: "impulse",
    label: "色情冲动",
    title: "LifeOps Control Plane",
    subtitle: "人生运行状态控制台 / 色情冲动风控样机",
    primaryRiskLabel: "色情冲动风险",
    primaryRiskValue: "72%",
    primaryRiskDetail: "独处 + 熬夜时升高",
    gateQuestion: "今晚是否可以无防护独处上网？",
    gateDecision: "Blocked - 需要环境切换与延迟协议",
    triggerName: "独处熬夜冲动回路",
    rootCause: "孤独感 + 睡眠债 + 即时安慰路径",
    activeProtocol: "10 分钟延迟与离屏协议",
  },
};

function focusConfig(focus) {
  return FOCUS_CONFIG[focus] || FOCUS_CONFIG.short_video;
}

function durationLabel(hours) {
  if (hours === null || hours === undefined) return "7d+";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

function attentionReadinessScore(summary, riskScore = summary.risk_score) {
  return clampScore(104 - Number(riskScore || 0) - Number(summary.late_night_count || 0) * 3, 18, 92);
}

function sleepDebtHours(summary) {
  return Number(summary.late_night_count || 0)
    ? Math.min(4.5, 1.2 + Number(summary.late_night_count || 0) * 0.45)
    : 0.8;
}

function sleepDebtLabel(summary) {
  return `${sleepDebtHours(summary).toFixed(1)}h`;
}

function cleanStreakLabel(summary) {
  return summary.clean_days === null ? "7d+" : `${summary.clean_days}d`;
}

function behaviorEvidenceCount(summary) {
  return 148 + Number(summary.total_events || 0);
}

function cleanStreakDetail(summary) {
  if (summary.clean_days === 0 && summary.week_incidents) {
    return "当前连续周期已断；证据资产不会清零";
  }
  return "当前连续周期，独立于累计证据";
}

function parsePercent(value, fallback) {
  const match = String(value || "").match(/[0-9]+(?:\.[0-9]+)?/);
  const parsed = Number(match?.[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildControlCockpit(focus, summary, hasLocalEvents) {
  const riskScore = hasLocalEvents
    ? Number(summary.risk_score || 0)
    : parsePercent(focus.primaryRiskValue, focus.id === "dopamine" ? 76 : focus.id === "impulse" ? 72 : 88);
  const cockpitSummary = hasLocalEvents
    ? summary
    : {
        total_events: 0,
        week_events: 0,
        week_incidents: 0,
        late_night_count: 3,
        clean_days: 7,
        risk_score: riskScore,
      };
  const readinessScore = attentionReadinessScore(cockpitSummary, riskScore);
  const lateNightPenalty = Number(cockpitSummary.late_night_count || 0) * 3;
  const evidenceCount = behaviorEvidenceCount(cockpitSummary);
  const sleepDebt = sleepDebtHours(cockpitSummary);
  const sleepDebtTone = sleepDebt >= 2.4 ? "danger" : sleepDebt >= 1.4 ? "warn" : "good";
  const currentRunBroken = cockpitSummary.clean_days === 0 && Number(cockpitSummary.week_incidents || 0) > 0;
  const survival = currentRunBroken
    ? {
        value: "RUN BROKEN",
        label: "SURVIVAL STATE",
        detail: `${cleanStreakLabel(cockpitSummary)} = 当前连续周期已断，先止血再谈奖励。`,
        tone: "danger",
      }
    : riskScore >= 75 || readinessScore < 35
      ? {
          value: "RED GATE",
          label: "SURVIVAL STATE",
          detail: `${cleanStreakLabel(cockpitSummary)} clean，但当前入口必须降级管制。`,
          tone: "danger",
        }
      : riskScore >= 55 || readinessScore < 55
        ? {
            value: "WATCH",
            label: "SURVIVAL STATE",
            detail: `${cleanStreakLabel(cockpitSummary)} clean，保持观察和预承诺。`,
            tone: "warn",
          }
        : {
            value: "ALIVE",
            label: "SURVIVAL STATE",
            detail: `${cleanStreakLabel(cockpitSummary)} clean，允许低风险窗口。`,
            tone: "good",
          };

  return {
    title: "Core Cockpit / 核心驾驶舱",
    headline: `Risk ${riskScore} 正在压制 Readiness ${readinessScore}`,
    equation: `Readiness = 104 - Risk(${riskScore}) - 深夜惩罚(${lateNightPenalty})`,
    relation: riskScore >= 75
      ? "这不是意志力不足，是高刺激入口已经压低执行功能；先关入口，再谈自律。"
      : "Risk 越高，Readiness 越低；系统优先保护低能量时段的执行功能。",
    dials: [
      {
        label: "RELAPSE RISK",
        value: `${riskScore}%`,
        detail: `${cockpitSummary.week_events || 0} traces / ${cockpitSummary.week_incidents || 0} incidents / 7d`,
        tone: riskScore >= 75 ? "danger" : riskScore >= 55 ? "warn" : "good",
        weight: "primary",
      },
      {
        label: "ATTENTION READINESS",
        value: `${readinessScore}/100`,
        detail: `Risk penalty ${riskScore} + night penalty ${lateNightPenalty}`,
        tone: readinessScore < 50 ? "danger" : readinessScore < 70 ? "warn" : "good",
        weight: "primary",
      },
      survival,
      {
        label: "EVIDENCE ASSET",
        value: `${evidenceCount}`,
        detail: `累计 trace/replay/audit 资产；Streak 断了，证据不归零。`,
        tone: "neutral",
      },
    ],
    sleep_debt: {
      label: "SLEEP DEBT",
      value: `${sleepDebt.toFixed(1)}h`,
      detail: `${cockpitSummary.late_night_count || 0} 次深夜相关 trace；超过 2.4h 自动进入红色预警。`,
      percent: clampScore(Math.round((sleepDebt / 4.5) * 100), 6, 100),
      tone: sleepDebtTone,
    },
  };
}

function latestActionState(actionEvents = [], actionId, focusId) {
  return [...actionEvents]
    .reverse()
    .find((event) => event.focus === focusId && event.action_id === actionId) || null;
}

function addMinutesIso(value, minutes) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function buildInterventionLayer(focus, summary, cockpit, riskDrilldown, actionEvents = [], nowIso) {
  const riskScore = parsePercent(cockpit?.dials?.[0]?.value, Number(summary.risk_score || 0));
  const readinessScore = parsePercent(cockpit?.dials?.[1]?.value, attentionReadinessScore(summary, riskScore));
  const critical = riskScore >= 75 || readinessScore < 40;
  const elevated = riskScore >= 55 || readinessScore < 60;
  const mode = critical ? "LOCKDOWN NOW" : elevated ? "CONTROLLED WINDOW" : "WATCH MODE";
  const tone = critical ? "danger" : elevated ? "warn" : "good";
  const durationMinutes = critical ? (riskScore >= 88 ? 45 : 30) : elevated ? 18 : 8;
  const blockUntil = addMinutesIso(nowIso, durationMinutes);
  const baseEvidence = `intervention:${focus.id}:${riskDrilldown?.label || "current"}`;
  const actions = [
    {
      priority: "P0",
      code: "kill_switch",
      title: "KILL SWITCH",
      action_id: `life_intervention_${focus.id}_kill_switch`,
      blocker: "instant_access_open",
      instruction: "立刻关闭高刺激入口：App 限制、专注模式、浏览器白名单同时开启。",
      proof: "screen://limit-on + focus://enabled",
      cost: "未提交证据则今日娱乐额度清零。",
      tone: "danger",
      button: "启动 Lockdown",
    },
    {
      priority: critical ? "P0" : "P1",
      code: "physical_dock",
      title: "PHONE DOCK",
      action_id: `life_intervention_${focus.id}_physical_dock`,
      blocker: "phone_in_hand",
      instruction: `手机离开手边，放到固定充电点，至少 ${durationMinutes} 分钟不可带回床边或工位。`,
      proof: "photo://phone-dock",
      cost: "失败则明日晨间 30 分钟训练/清扫债。",
      tone: critical ? "danger" : "warn",
      button: "确认停泊",
    },
    {
      priority: "P1",
      code: "cooldown_timer",
      title: "COOLDOWN TIMER",
      action_id: `life_intervention_${focus.id}_cooldown_timer`,
      blocker: "urge_without_delay",
      instruction: `${durationMinutes} 分钟冷却倒计时内不做决策，只允许低刺激替代动作。`,
      proof: "timer://cooldown-complete",
      cost: "中断则重置倒计时，风险窗口继续锁定。",
      tone: elevated ? "warn" : "good",
      button: "开始倒计时",
    },
    {
      priority: critical ? "P1" : "P2",
      code: "accountability_ping",
      title: "ACCOUNTABILITY PING",
      action_id: `life_intervention_${focus.id}_accountability_ping`,
      blocker: "private_failure_loop",
      instruction: "把当前风险状态和执行证据发给问责对象，避免独处状态下私自谈判。",
      proof: "msg://accountability-sent",
      cost: "未发送则日报标记为 accountability gap。",
      tone: critical ? "danger" : "warn",
      button: "记录问责",
    },
  ].map((item) => {
    const latest = latestActionState(actionEvents, item.action_id, focus.id);
    return {
      ...item,
      status: latest?.to_status || "pending",
      latest_event_id: latest?.id || "",
      latest_event_at: latest?.created_at || "",
      latest_evidence_ref: latest?.evidence_ref || "",
      latest_note: latest?.note || "",
      evidence_ref: `${baseEvidence}:${item.code}`,
    };
  });

  const activeCount = actions.filter((item) => ["in_progress", "evidence_attached"].includes(item.status)).length;
  const evidenceCount = actions.filter((item) => item.status === "evidence_attached").length;

  return {
    mode,
    tone,
    headline: critical
      ? "高风险入口已进入红区：先执行阻断，再允许复盘。"
      : elevated
        ? "进入受控窗口：保留工作能力，关闭高刺激入口。"
        : "维持观察：只保留轻量摩擦和证据采样。",
    risk_score: riskScore,
    readiness_score: readinessScore,
    duration_minutes: durationMinutes,
    block_until: blockUntil,
    countdown_label: `${durationMinutes}m HARD COOLDOWN`,
    active_count: activeCount,
    evidence_count: evidenceCount,
    cost_contract: critical
      ? "Cost Contract: 未完成 P0 证据，当日娱乐额度清零，次日补 30 分钟训练/清扫债。"
      : "Cost Contract: 未完成证据，下一次风险窗口自动升级一级。",
    actions,
  };
}

function buildDeviceAnchorLayer(focus, interventionLayer = {}, actionEvents = []) {
  const critical = interventionLayer.tone === "danger";
  const anchors = [
    {
      code: "screen_time",
      label: "SCREEN TIME",
      action_id: `life_anchor_${focus.id}_screen_time`,
      layer: "device",
      coverage: critical ? 86 : 68,
      requirement: "macOS / iOS Screen Time 限制开启，高刺激 App 与站点进入限额。",
      proof: "screen://screen-time-limits",
      bypass: "换浏览器、换小号、临时改限额",
      tone: critical ? "danger" : "warn",
    },
    {
      code: "browser_allowlist",
      label: "BROWSER ALLOWLIST",
      action_id: `life_anchor_${focus.id}_browser_allowlist`,
      layer: "device",
      coverage: critical ? 78 : 62,
      requirement: "浏览器只保留工作白名单，短视频/成人视频/娱乐网站写入阻断列表。",
      proof: "browser://allowlist-on",
      bypass: "无痕窗口、备用浏览器、代理站点",
      tone: "warn",
    },
    {
      code: "router_block",
      label: "ROUTER BLOCK",
      action_id: `life_anchor_${focus.id}_router_block`,
      layer: "network",
      coverage: critical ? 72 : 48,
      requirement: "路由器或 DNS 层阻断高刺激域名，覆盖手机、电脑、平板。",
      proof: "router://blocklist-active",
      bypass: "蜂窝网络、热点、VPN",
      tone: critical ? "danger" : "warn",
    },
    {
      code: "physical_dock_photo",
      label: "DOCK PHOTO",
      action_id: `life_anchor_${focus.id}_dock_photo`,
      layer: "physical",
      coverage: critical ? 66 : 42,
      requirement: "手机停泊照片带时间戳，证明设备离开床边/工位。",
      proof: "photo://phone-dock-timestamp",
      bypass: "拍完拿回、备用机",
      tone: critical ? "danger" : "warn",
    },
    {
      code: "accountability_receipt",
      label: "ACCOUNTABILITY RECEIPT",
      action_id: `life_anchor_${focus.id}_accountability_receipt`,
      layer: "social",
      coverage: critical ? 64 : 38,
      requirement: "问责对象收到风险状态与执行证据，形成外部可见成本。",
      proof: "msg://accountability-receipt",
      bypass: "只发不执行、选择性汇报",
      tone: critical ? "danger" : "warn",
    },
  ].map((item) => {
    const latest = latestActionState(actionEvents, item.action_id, focus.id);
    const status = latest?.to_status || "pending";
    const verified = status === "evidence_attached";
    return {
      ...item,
      status,
      verified,
      latest_event_id: latest?.id || "",
      latest_event_at: latest?.created_at || "",
      latest_evidence_ref: latest?.evidence_ref || "",
      latest_note: latest?.note || "",
      effective_coverage: verified ? item.coverage : Math.max(8, item.coverage - 28),
    };
  });
  const verifiedCount = anchors.filter((item) => item.verified).length;
  const avgCoverage = Math.round(
    anchors.reduce((sum, item) => sum + Number(item.effective_coverage || 0), 0) / Math.max(1, anchors.length)
  );
  const tone = avgCoverage >= 72 ? "good" : avgCoverage >= 48 ? "warn" : "danger";

  return {
    title: "Device Anchor / 防作弊锚点层",
    status: verifiedCount >= 3 ? "ANCHOR VERIFIED" : critical ? "CHEAT SURFACE OPEN" : "ANCHOR WEAK",
    tone,
    verified_count: verifiedCount,
    total_count: anchors.length,
    coverage_score: avgCoverage,
    summary: verifiedCount >= 3
      ? "关键锚点已形成外部证据，作弊成本开始高于冲动收益。"
      : "当前仍主要依赖自报，换设备、换网络、换浏览器都可能绕过控制台。",
    anchors,
  };
}

function topTriggerRows(events = [], limit = 4) {
  const counts = new Map();
  for (const event of events) {
    const key = event.trigger || "other";
    const current = counts.get(key) || { trigger: key, count: 0, incidents: 0, max_intensity: 0 };
    current.count += 1;
    if (["slipped", "bypassed"].includes(event.outcome)) current.incidents += 1;
    current.max_intensity = Math.max(current.max_intensity, Number(event.intensity || 0));
    counts.set(key, current);
  }
  return [...counts.values()]
    .sort((a, b) => b.incidents - a.incidents || b.count - a.count || b.max_intensity - a.max_intensity)
    .slice(0, limit)
    .map((item) => ({
      ...item,
      label: triggerLabel(item.trigger),
      tone: item.incidents ? "danger" : item.count >= 2 ? "warn" : "neutral",
    }));
}

function reviewWindowStats(focus, events = [], actionEvents = [], generatedAt, days) {
  const endTime = new Date(generatedAt).getTime();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;
  const focusedEvents = events
    .filter((event) => event.focus === focus.id)
    .filter((event) => withinWindow(event.occurred_at, startTime, endTime));
  const focusedActions = actionEvents
    .filter((event) => event.focus === focus.id)
    .filter((event) => withinWindow(event.created_at, startTime, endTime));
  const incidents = focusedEvents.filter((event) => ["slipped", "bypassed"].includes(event.outcome));
  const resisted = focusedEvents.filter((event) => event.outcome === "resisted");
  const bypasses = focusedEvents.filter((event) => event.outcome === "bypassed");
  const evidenceAttached = focusedActions.filter((event) => event.to_status === "evidence_attached");
  const interventions = focusedActions.filter((event) => String(event.action_id || "").includes("intervention"));
  const anchors = focusedActions.filter((event) => String(event.action_id || "").includes("life_anchor"));
  const cleanRatio = focusedEvents.length ? Math.round((resisted.length / focusedEvents.length) * 100) : 0;
  const auditGrade = incidents.length === 0 && evidenceAttached.length >= 3
    ? "A"
    : incidents.length <= 1 && evidenceAttached.length >= 1
      ? "B"
      : bypasses.length || incidents.length >= 2
        ? "D"
        : "C";

  return {
    days,
    label: days === 7 ? "7D WEEKLY" : "30D MONTHLY",
    start_at: new Date(startTime).toISOString(),
    end_at: new Date(endTime).toISOString(),
    trace_count: focusedEvents.length,
    incident_count: incidents.length,
    resisted_count: resisted.length,
    bypass_count: bypasses.length,
    action_count: focusedActions.length,
    intervention_count: interventions.length,
    anchor_count: anchors.length,
    evidence_count: evidenceAttached.length,
    clean_ratio: cleanRatio,
    audit_grade: auditGrade,
    tone: auditGrade === "A" || auditGrade === "B" ? "good" : auditGrade === "C" ? "warn" : "danger",
    top_triggers: topTriggerRows(focusedEvents),
  };
}

function buildReviewReport(focus, events = [], actionEvents = [], dailyAuditHistory = [], cockpit = {}, interventionLayer = {}, deviceAnchorLayer = {}, generatedAt) {
  const weekly = reviewWindowStats(focus, events, actionEvents, generatedAt, 7);
  const monthly = reviewWindowStats(focus, events, actionEvents, generatedAt, 30);
  const currentRisk = parsePercent(cockpit?.dials?.[0]?.value, 0);
  const currentReadiness = parsePercent(cockpit?.dials?.[1]?.value, 0);
  const anchorCoverage = Number(deviceAnchorLayer.coverage_score || 0);
  const reviewTone = weekly.tone === "danger" || anchorCoverage < 48 ? "danger" : weekly.tone === "warn" ? "warn" : "good";
  const verdict = reviewTone === "danger"
    ? "系统仍有明显绕过面，下一周期优先补锚点，不急着追求 streak。"
    : reviewTone === "warn"
      ? "控制链开始成型，但证据密度和防作弊覆盖还不足。"
      : "本周期控制链有效，允许小幅放宽低风险窗口。";
  const nextProtocol = reviewTone === "danger"
    ? "下周期协议: P0 锁定 Screen Time + Router Block + Dock Photo，连续 3 天证据后再评估放宽。"
    : reviewTone === "warn"
      ? "下周期协议: 保持硬冷却，补齐 2 个外部锚点，减少自报依赖。"
      : "下周期协议: 保持日报，低风险窗口可用 controlled mode。";

  return {
    title: "LifeOps Review Report / 周月复盘",
    report_id: `lifeops_review_${focus.id}_${isoDayFromValue(generatedAt)}`,
    generated_at: generatedAt,
    tone: reviewTone,
    verdict,
    next_protocol: nextProtocol,
    headline: `Risk ${currentRisk} / Readiness ${currentReadiness} / Anchor ${anchorCoverage}/100`,
    weekly,
    monthly,
    cockpit: {
      risk: currentRisk,
      readiness: currentReadiness,
      survival: cockpit?.dials?.[2]?.value || "-",
      evidence: cockpit?.dials?.[3]?.value || "-",
    },
    intervention: {
      mode: interventionLayer.mode || "-",
      active: interventionLayer.active_count || 0,
      proof: interventionLayer.evidence_count || 0,
      cooldown: interventionLayer.countdown_label || "-",
    },
    anchors: {
      status: deviceAnchorLayer.status || "-",
      coverage: anchorCoverage,
      verified: deviceAnchorLayer.verified_count || 0,
      total: deviceAnchorLayer.total_count || 0,
    },
    daily_reports: dailyAuditHistory.slice(0, 7),
  };
}

function operatorRankName(score) {
  if (score >= 88) return "S-RANK OPERATOR";
  if (score >= 74) return "A-RANK OPERATOR";
  if (score >= 58) return "B-RANK OPERATOR";
  if (score >= 42) return "C-RANK OPERATOR";
  return "RECOVERY CADET";
}

function buildOperatorRank(focus, summary = {}, cockpit = {}, reviewReport = {}, interventionLayer = {}, deviceAnchorLayer = {}) {
  const risk = parsePercent(cockpit?.dials?.[0]?.value, Number(summary.risk_score || 0));
  const readiness = parsePercent(cockpit?.dials?.[1]?.value, attentionReadinessScore(summary, risk));
  const evidenceAsset = parsePercent(cockpit?.dials?.[3]?.value, behaviorEvidenceCount(summary));
  const anchorCoverage = Number(deviceAnchorLayer.coverage_score || 0);
  const weekly = reviewReport.weekly || {};
  const incidentPenalty = Math.min(28, Number(weekly.incident_count || 0) * 12 + Number(weekly.bypass_count || 0) * 10);
  const proofBonus = Math.min(18, Number(weekly.evidence_count || 0) * 4 + Number(interventionLayer.evidence_count || 0) * 3);
  const recoveryScore = clampScore(
    Number(weekly.resisted_count || 0) * 12 + proofBonus + Math.min(18, evidenceAsset / 12) - incidentPenalty,
    0,
    100
  );
  const controlScore = clampScore(Math.round((100 - risk) * 0.42 + readiness * 0.38 + anchorCoverage * 0.2), 0, 100);
  const disciplineScore = clampScore(Math.round(controlScore * 0.42 + recoveryScore * 0.32 + anchorCoverage * 0.26), 0, 100);
  const currentLevel = Math.max(1, Math.floor(disciplineScore / 12) + 1);
  const nextThreshold = Math.min(100, currentLevel * 12);
  const progress = nextThreshold >= 100 ? 100 : clampScore(Math.round((disciplineScore / nextThreshold) * 100), 0, 100);
  const rank = operatorRankName(disciplineScore);
  const tone = disciplineScore >= 74 ? "good" : disciplineScore >= 42 ? "warn" : "danger";
  const identity = disciplineScore >= 74
    ? "你不是靠情绪硬扛的人，而是在操作一套可审计的行为系统。"
    : disciplineScore >= 42
      ? "你仍在恢复期，但身份不是失败者，而是正在补锚点的操作员。"
      : "当前处于恢复学员状态：先停止失血，再积累证据资产。";
  const badges = [
    {
      code: "audit_asset",
      label: "Evidence Banker",
      status: evidenceAsset >= 150 ? "unlocked" : "locked",
      detail: `${evidenceAsset} evidence assets`,
      tone: evidenceAsset >= 150 ? "good" : "warn",
    },
    {
      code: "anchor_builder",
      label: "Anchor Builder",
      status: anchorCoverage >= 60 ? "unlocked" : "locked",
      detail: `${anchorCoverage}/100 anti-cheat coverage`,
      tone: anchorCoverage >= 60 ? "good" : "danger",
    },
    {
      code: "recovery_protocol",
      label: "Recovery Protocol",
      status: recoveryScore >= 35 ? "unlocked" : "locked",
      detail: `${Math.round(recoveryScore)}/100 recovery score`,
      tone: recoveryScore >= 35 ? "good" : "warn",
    },
    {
      code: "hard_mode",
      label: "Hard Mode Operator",
      status: interventionLayer.mode === "LOCKDOWN NOW" ? "active" : "standby",
      detail: interventionLayer.mode || "WATCH MODE",
      tone: interventionLayer.mode === "LOCKDOWN NOW" ? "danger" : "neutral",
    },
  ];

  return {
    title: "Operator Rank / 身份等级",
    rank,
    level: currentLevel,
    score: disciplineScore,
    tone,
    progress,
    next_threshold: nextThreshold,
    identity,
    focus_label: focus.label,
    dimensions: [
      ["Control", controlScore, risk >= 75 ? "danger" : controlScore >= 60 ? "good" : "warn", `Risk ${risk} / Readiness ${readiness}`],
      ["Recovery", Math.round(recoveryScore), recoveryScore >= 50 ? "good" : recoveryScore >= 28 ? "warn" : "danger", `${weekly.resisted_count || 0} resisted / ${weekly.incident_count || 0} incident`],
      ["Anchors", anchorCoverage, anchorCoverage >= 72 ? "good" : anchorCoverage >= 48 ? "warn" : "danger", `${deviceAnchorLayer.verified_count || 0}/${deviceAnchorLayer.total_count || 0} verified`],
      ["Evidence", Math.min(100, Math.round(evidenceAsset / 2)), evidenceAsset >= 150 ? "good" : "warn", `${evidenceAsset} audit assets`],
    ],
    badges,
    next_mission: disciplineScore < 42
      ? "下一任务: 先锁定 2 个防作弊锚点，并提交 1 条干预证据。"
      : disciplineScore < 74
        ? "下一任务: 连续 3 天完成日报 + 至少 2 条 resisted trace。"
        : "下一任务: 保持低风险窗口受控开放，继续提高锚点覆盖。",
  };
}

function missionStatusFromLatest(latest) {
  if (!latest) return "pending";
  return latest.to_status || "pending";
}

function buildMissionChain(focus, operatorRank = {}, deviceAnchorLayer = {}, interventionLayer = {}, actionEvents = []) {
  const recoveryMode = operatorRank.score < 42;
  const baseMissions = recoveryMode
    ? [
        {
          code: "lock_two_anchors",
          title: "Lock 2 Anti-cheat Anchors",
          action_id: `life_mission_${focus.id}_lock_two_anchors`,
          blocker: "mission_anchor_coverage",
          requirement: "至少锁定 2 个防作弊锚点，把自报变成外部证据。",
          evidence_ref: "mission://two-anchors-locked",
          reward: "+12 discipline / unlock Anchor Builder path",
          depends_on: [],
          tone: "danger",
        },
        {
          code: "submit_intervention_proof",
          title: "Submit 1 Intervention Proof",
          action_id: `life_mission_${focus.id}_submit_intervention_proof`,
          blocker: "mission_intervention_proof",
          requirement: "提交 1 条 Kill Switch、Phone Dock 或 Cooldown 的执行证据。",
          evidence_ref: "mission://intervention-proof",
          reward: "+8 recovery / hard-mode proof",
          depends_on: ["lock_two_anchors"],
          tone: "danger",
        },
        {
          code: "record_two_resisted",
          title: "Record 2 Resisted Traces",
          action_id: `life_mission_${focus.id}_record_two_resisted`,
          blocker: "mission_recovery_trace",
          requirement: "记录 2 条 resisted trace，证明系统不只是锁死，也能恢复控制。",
          evidence_ref: "mission://two-resisted-traces",
          reward: "+10 recovery / unlock Recovery Protocol",
          depends_on: ["submit_intervention_proof"],
          tone: "warn",
        },
        {
          code: "generate_review",
          title: "Generate Recovery Review",
          action_id: `life_mission_${focus.id}_generate_review`,
          blocker: "mission_review_report",
          requirement: "导出一次周/月复盘，形成可留存的恢复档案。",
          evidence_ref: "mission://review-exported",
          reward: "+1 level checkpoint",
          depends_on: ["record_two_resisted"],
          tone: "warn",
        },
      ]
    : [
        {
          code: "controlled_window",
          title: "Run Controlled Window",
          action_id: `life_mission_${focus.id}_controlled_window`,
          blocker: "mission_controlled_window",
          requirement: "开放一个低风险窗口，但保留 Screen Time 和日报审计。",
          evidence_ref: "mission://controlled-window",
          reward: "+8 control / low-risk release",
          depends_on: [],
          tone: "warn",
        },
        {
          code: "upgrade_anchor_coverage",
          title: "Upgrade Anchor Coverage",
          action_id: `life_mission_${focus.id}_upgrade_anchor_coverage`,
          blocker: "mission_anchor_upgrade",
          requirement: "把 Anchor Coverage 提高到 72/100 以上。",
          evidence_ref: "mission://anchor-coverage-72",
          reward: "+10 anchor / A-rank path",
          depends_on: ["controlled_window"],
          tone: "warn",
        },
      ];

  const latestByCode = new Map();
  const missions = baseMissions.map((mission) => {
    const latest = latestActionState(actionEvents, mission.action_id, focus.id);
    const status = missionStatusFromLatest(latest);
    const blocked = mission.depends_on.some((code) => {
      const dependency = latestByCode.get(code);
      return dependency && dependency.status !== "evidence_attached";
    });
    const item = {
      ...mission,
      status: blocked && status === "pending" ? "blocked" : status,
      latest_event_id: latest?.id || "",
      latest_event_at: latest?.created_at || "",
      latest_evidence_ref: latest?.evidence_ref || "",
      latest_note: latest?.note || "",
    };
    latestByCode.set(mission.code, item);
    return item;
  });
  const completed = missions.filter((item) => item.status === "evidence_attached").length;
  const active = missions.filter((item) => item.status === "in_progress").length;
  const available = missions.filter((item) => ["pending", "in_progress"].includes(item.status))[0] || missions[0];
  const progress = Math.round((completed / Math.max(1, missions.length)) * 100);
  const tone = completed === missions.length ? "good" : active || completed ? "warn" : "danger";

  return {
    title: "Mission Chain / 晋级任务链",
    status: completed === missions.length ? "CHAIN COMPLETE" : active ? "MISSION ACTIVE" : "AWAITING EXECUTION",
    tone,
    progress,
    completed,
    total: missions.length,
    active_mission: available?.title || "-",
    rank_context: `${operatorRank.rank || "RECOVERY CADET"} / Level ${operatorRank.level || 1}`,
    anchor_context: `${deviceAnchorLayer.verified_count || 0}/${deviceAnchorLayer.total_count || 0} anchors`,
    intervention_context: `${interventionLayer.mode || "WATCH MODE"} / ${interventionLayer.evidence_count || 0} proof`,
    missions,
  };
}

function outcomeLabel(value) {
  return {
    resisted: "扛住",
    slipped: "失控",
    bypassed: "绕过限制",
    clean: "正常",
  }[value] || value;
}

function triggerLabel(value) {
  return {
    late_night: "深夜",
    lonely_after_work: "下班孤独",
    stress: "压力",
    sleep_debt: "睡眠债",
    boredom: "无聊",
    friction_bypass: "绕过限制",
    algorithm_pull: "算法牵引",
    other: "其他",
  }[value] || value;
}

function eventTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "-").slice(0, 16);
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function replayRootCauseForEvent(event, focus) {
  if (event.outcome === "bypassed" || event.trigger === "friction_bypass") {
    return "限制摩擦被主动绕过，说明一级防线不足，需要二级拦截和冷却窗口。";
  }
  if (event.trigger === "late_night" || event.trigger === "algorithm_pull") {
    return focus.id === "impulse"
      ? "深夜独处降低自控余量，即时安慰入口过近，冲动在没有延迟协议时放大。"
      : "深夜低能量叠加算法连续奖励，手机仍在手边，预承诺没有形成实际门禁。";
  }
  if (event.trigger === "lonely_after_work") {
    return "下班后的空虚和低连接感没有被替代动作承接，高刺激入口变成默认安慰路径。";
  }
  if (event.trigger === "sleep_debt") {
    return "睡眠债降低执行功能，冲动强度被放大，原有规则在低能量状态下失效。";
  }
  if (event.trigger === "stress") {
    return "压力释放需求没有进入健康出口，系统把高刺激奖励当成最快降压方式。";
  }
  if (event.trigger === "boredom") {
    return "无聊窗口没有预设替代任务，注意力被最低摩擦的奖励入口接管。";
  }
  return `${focus.label} 相关冲动已经被记录，但触发源证据不足，需要继续补充上下文。`;
}

function replayConfidenceForEvent(event, summary) {
  const base = 0.62;
  const intensityBoost = Number(event.intensity || 0) * 0.045;
  const incidentBoost = ["slipped", "bypassed"].includes(event.outcome) ? 0.08 : 0.02;
  const recurrenceBoost = Math.min(0.1, Number(summary.week_incidents || 0) * 0.025);
  return Math.min(0.94, base + intensityBoost + incidentBoost + recurrenceBoost).toFixed(2);
}

function replayResultTone(event) {
  if (["slipped", "bypassed"].includes(event.outcome)) return "danger";
  if (event.outcome === "resisted") return "good";
  return "neutral";
}

function buildReplayFromRecentEvents(focus, summary) {
  const events = summary.recent_events || [];
  if (!events.length) return null;

  const event = events.find((item) => ["slipped", "bypassed"].includes(item.outcome)) || events[0];
  const taxonomy = taxonomyForLifeEvent(event);
  const matchingTriggerCount = events.filter((item) => item.trigger === event.trigger).length;
  const rootCause = replayRootCauseForEvent(event, focus);
  const trigger = triggerLabel(event.trigger);
  const outcome = outcomeLabel(event.outcome);
  const note = event.note ? `备注: ${event.note}` : "备注缺失，下一次需要补上下文。";
  const gateAction = ["slipped", "bypassed"].includes(event.outcome)
    ? `保持 ${focus.activeProtocol}，先用 3 条成功证据再考虑放宽。`
    : "保持当前门禁，继续收集扛住样本来提高可信度。";

  return {
    title: `${trigger} -> ${outcome}`,
    root_cause: rootCause,
    confidence: replayConfidenceForEvent(event, summary),
    source_event_id: event.id,
    timeline: [
      [eventTimeLabel(event.occurred_at), "触发源命中", `${trigger} / intensity ${event.intensity}/5 / ${note}`, Number(event.intensity || 0) >= 4 ? "danger" : "warn"],
      [eventTimeLabel(event.created_at), "结果标记", `${focus.label} 事件结果: ${outcome}`, replayResultTone(event)],
      ["taxonomy", taxonomy.code, taxonomy.pattern, taxonomy.severity],
      ["recurrence", "重复信号", `最近 ${events.length} 条 trace 中，${trigger} 命中 ${matchingTriggerCount} 次。`, matchingTriggerCount >= 2 ? "warn" : "neutral"],
      ["root cause", "根因归纳", rootCause, "warn"],
      ["next gate", "门禁建议", gateAction, ["slipped", "bypassed"].includes(event.outcome) ? "danger" : "good"],
    ],
  };
}

function gateDecisionForSummary(focus, summary) {
  if (summary.gate_status === "blocked") {
    return `Blocked - ${focus.activeProtocol}`;
  }
  if (summary.gate_status === "limited") {
    return "Limited - 仅开放低风险窗口";
  }
  return "Ready with monitoring - 保持审计";
}

function buildDynamicMetrics(focus, summary) {
  const attentionReadiness = attentionReadinessScore(summary);
  const sleepDebt = sleepDebtLabel(summary);
  return [
    {
      label: focus.primaryRiskLabel,
      value: `${summary.risk_score}%`,
      detail: `压制 Readiness；${summary.week_events} traces / ${summary.week_incidents} incidents / 7d`,
      tone: summary.risk_tone,
    },
    {
      label: "自律 Uptime",
      value: durationLabel(summary.uptime_hours),
      detail: "距离上次失控事件",
      tone: summary.week_incidents ? "warn" : "good",
    },
    {
      label: "注意力 Readiness",
      value: `${attentionReadiness}/100`,
      detail: `104 - Risk(${summary.risk_score}) - 深夜惩罚(${summary.late_night_count * 3})`,
      tone: attentionReadiness < 50 ? "danger" : attentionReadiness < 70 ? "warn" : "good",
    },
    {
      label: "睡眠债",
      value: sleepDebt,
      detail: `${summary.late_night_count} 次深夜相关 trace`,
      tone: summary.late_night_count >= 3 ? "danger" : summary.late_night_count ? "warn" : "good",
    },
    {
      label: "Clean Streak",
      value: cleanStreakLabel(summary),
      detail: cleanStreakDetail(summary),
      tone: summary.week_incidents ? "warn" : "good",
    },
    {
      label: "行为证据",
      value: `${behaviorEvidenceCount(summary)}`,
      detail: `${summary.total_events} local trace；累计资产，和 Streak 独立`,
      tone: "neutral",
    },
  ];
}

function taxonomyWithEvents(baseTaxonomy, events, focus) {
  const byCode = new Map(baseTaxonomy.map((item) => [item.code, { ...item }]));
  for (const event of events.filter((item) => item.focus === focus.id)) {
    const taxonomy = taxonomyForLifeEvent(event);
    const current = byCode.get(taxonomy.code) || { ...taxonomy, count: 0 };
    current.count = Number(current.count || 0) + 1;
    if (taxonomy.severity === "high") current.severity = "high";
    byCode.set(taxonomy.code, current);
  }
  return [...byCode.values()].sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
}

function daysBetween(nowIso, value) {
  const now = new Date(nowIso);
  const date = new Date(value);
  if (Number.isNaN(now.getTime()) || Number.isNaN(date.getTime())) return 0;
  return (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
}

function isWeekend(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function focusedRecentPolicyEvents(events, focus, nowIso) {
  return events
    .filter((event) => event.focus === focus.id)
    .filter((event) => daysBetween(nowIso, event.occurred_at) <= 7)
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
}

function falsePositiveRiskForPolicy(policy, matches) {
  if (!matches.length) return "low";
  const incidents = matches.filter((event) => ["slipped", "bypassed"].includes(event.outcome)).length;
  const resisted = matches.filter((event) => event.outcome === "resisted").length;
  if (policy.id === "secondary_lock" && incidents >= 1) return "low";
  if (policy.id === "phone_dock" && incidents >= 2) return "low";
  if (policy.id === "phone_dock" && incidents === 1) return "medium";
  if (policy.id === "fallback_path" && resisted > incidents) return "medium";
  if (policy.id === "weekend_solitude" && matches.length < 2) return "medium";
  return incidents > 0 ? "low" : "medium";
}

function policyStateForMatches(matches, falsePositiveRisk) {
  if (!matches.length) return "needs_evidence";
  const incidents = matches.filter((event) => ["slipped", "bypassed"].includes(event.outcome)).length;
  if (incidents >= 2 && falsePositiveRisk === "low") return "draft_review";
  if (incidents >= 1) return "dry_run_ready";
  return "needs_evidence";
}

function policySeverityForMatches(matches) {
  if (matches.some((event) => event.outcome === "bypassed" || Number(event.intensity || 0) >= 5)) return "high";
  if (matches.some((event) => event.outcome === "slipped" || Number(event.intensity || 0) >= 4)) return "medium";
  return "low";
}

function lifePolicyCatalog(focus) {
  return [
    {
      id: "phone_dock",
      name: focus.activeProtocol,
      blocker: "late_night_high_risk_window",
      action: focus.id === "impulse"
        ? "深夜独处前启动离屏延迟协议"
        : "22:30 后手机离床 3 米并进入白名单",
      evidence: "连续 3 晚是否执行成功",
      match: (event) => ["late_night", "algorithm_pull"].includes(event.trigger) || event.taxonomy_code === "doom_scroll_late_night_loop",
    },
    {
      id: "secondary_lock",
      name: "高刺激入口二级锁",
      blocker: "friction_bypass_pattern",
      action: "第一次绕过后触发 24 小时冷却",
      evidence: "限制被绕过时是否自动升级",
      match: (event) => event.outcome === "bypassed" || event.trigger === "friction_bypass" || event.taxonomy_code === "friction_bypass_reinstall",
    },
    {
      id: "fallback_path",
      name: "低能量替代路径",
      blocker: "low_energy_no_fallback",
      action: "预设洗澡、散步、纸质书、给朋友发一句话",
      evidence: "至少 5 次替代动作成功记录",
      match: (event) => ["lonely_after_work", "stress", "sleep_debt", "boredom"].includes(event.trigger) && Number(event.intensity || 0) >= 3,
    },
    {
      id: "weekend_solitude",
      name: "周末独处风险协议",
      blocker: "weekend_solitude_window",
      action: "周末夜间必须有外部计划或离屏环境",
      evidence: "周末夜间是否有外部约束或离屏环境",
      match: (event) => isWeekend(event.occurred_at) && ["late_night", "lonely_after_work", "boredom"].includes(event.trigger),
    },
  ];
}

function buildDynamicPolicies(focus, events, summary, nowIso) {
  const recentEvents = focusedRecentPolicyEvents(events, focus, nowIso);
  return lifePolicyCatalog(focus).map((policy) => {
    const matches = recentEvents.filter(policy.match);
    const falsePositiveRisk = falsePositiveRiskForPolicy(policy, matches);
    return {
      id: policy.id,
      name: policy.name,
      state: policyStateForMatches(matches, falsePositiveRisk),
      match_count: matches.length,
      false_positive_risk: falsePositiveRisk,
      action: policy.action,
      blocker: policy.blocker,
      severity: policySeverityForMatches(matches),
      matched_trace_ids: matches.slice(0, 5).map((event) => event.id),
      evidence: policy.evidence,
      recommendation: matches.length
        ? `${matches.length} 条 trace 命中；当前 7 日风险 ${summary.risk_score}%`
        : "暂无命中，继续收集证据",
    };
  });
}

function defaultPolicyRows(focus) {
  return [
    {
      id: "phone_dock",
      name: focus.activeProtocol,
      state: "draft_review",
      match_count: 8,
      false_positive_risk: "low",
      action: "22:30 后手机离床 3 米并进入白名单",
      blocker: "late_night_high_risk_window",
      severity: "high",
      evidence: "连续 3 晚是否停泊成功",
    },
    {
      id: "secondary_lock",
      name: "高刺激入口二级锁",
      state: "dry_run_ready",
      match_count: 5,
      false_positive_risk: "medium",
      action: "第一次绕过后触发 24 小时冷却",
      blocker: "friction_bypass_pattern",
      severity: "high",
      evidence: "限制被绕过时是否自动升级",
    },
    {
      id: "fallback_path",
      name: "低能量替代路径",
      state: "needs_evidence",
      match_count: 7,
      false_positive_risk: "low",
      action: "预设洗澡、散步、纸质书、给朋友发一句话",
      blocker: "low_energy_no_fallback",
      severity: "medium",
      evidence: "至少 5 次替代动作成功记录",
    },
    {
      id: "weekend_solitude",
      name: "周末独处风险协议",
      state: "draft_review",
      match_count: 3,
      false_positive_risk: "medium",
      action: "周末夜间必须有外部计划或离屏环境",
      blocker: "weekend_solitude_window",
      severity: "medium",
      evidence: "周末夜间是否有外部约束或离屏环境",
    },
  ];
}

function buildActionQueueFromPolicies(policies, hasLocalEvents) {
  if (!hasLocalEvents) {
    return policies.map((policy, index) => ({
      action_id: `life_action_${policy.id}`,
      priority: index + 1,
      severity: policy.severity,
      action: policy.id === "fallback_path" ? "建立低能量替代动作库" : policy.action,
      blocker: policy.blocker,
      status: policy.id === "fallback_path" ? "in_progress" : "pending",
      evidence: policy.evidence,
    }));
  }

  const candidates = policies
    .filter((policy) => policy.match_count > 0)
    .filter((policy) => policy.state !== "needs_evidence" || policy.severity !== "low")
    .sort((a, b) => {
      const severityWeight = { high: 3, medium: 2, low: 1 };
      if (severityWeight[b.severity] !== severityWeight[a.severity]) {
        return severityWeight[b.severity] - severityWeight[a.severity];
      }
      return b.match_count - a.match_count;
    });

  const actionRows = candidates.map((policy, index) => ({
    action_id: `life_action_${policy.id}`,
    priority: index + 1,
    severity: policy.severity,
    action: policy.action,
    blocker: policy.blocker,
    status: "pending",
    evidence: `${policy.evidence}；命中 ${policy.match_count} 条 trace`,
  }));

  if (policies.some((policy) => policy.match_count === 0)) {
    actionRows.push({
      action_id: "life_action_policy_coverage_gap",
      priority: actionRows.length + 1,
      severity: "medium",
      action: "补齐未覆盖策略的 replay case",
      blocker: "policy_coverage_gap",
      status: "pending",
      evidence: "所有核心策略都应至少有 1 条历史 trace 或模拟用例",
    });
  }

  return actionRows;
}

function latestActionEventsById(actionEvents = [], focus) {
  const byId = new Map();
  for (const event of actionEvents.filter((item) => item.focus === focus.id)) {
    const existing = byId.get(event.action_id);
    if (!existing || String(event.created_at).localeCompare(String(existing.created_at)) > 0) {
      byId.set(event.action_id, event);
    }
  }
  return byId;
}

function applyActionEventState(actions = [], actionEvents = [], focus) {
  const latestById = latestActionEventsById(actionEvents, focus);
  return actions.map((action) => {
    const latest = latestById.get(action.action_id);
    if (!latest) return action;
    return {
      ...action,
      status: latest.to_status,
      latest_event_id: latest.id,
      latest_event_note: latest.note,
      latest_evidence_ref: latest.evidence_ref,
      latest_event_at: latest.created_at,
    };
  });
}

function eventMatchesBlocker(event, blocker) {
  if (blocker === "late_night_high_risk_window") {
    return ["late_night", "algorithm_pull"].includes(event.trigger) || event.taxonomy_code === "doom_scroll_late_night_loop";
  }
  if (blocker === "friction_bypass_pattern") {
    return event.outcome === "bypassed" || event.trigger === "friction_bypass" || event.taxonomy_code === "friction_bypass_reinstall";
  }
  if (blocker === "low_energy_no_fallback") {
    return ["lonely_after_work", "stress", "sleep_debt", "boredom"].includes(event.trigger);
  }
  if (blocker === "weekend_solitude_window") {
    return isWeekend(event.occurred_at) && ["late_night", "lonely_after_work", "boredom"].includes(event.trigger);
  }
  return true;
}

function scoreTraceSet(events = []) {
  const incidents = events.filter((event) => ["slipped", "bypassed"].includes(event.outcome)).length;
  const resisted = events.filter((event) => event.outcome === "resisted").length;
  const avgIntensity = events.length
    ? events.reduce((sum, event) => sum + Number(event.intensity || 0), 0) / events.length
    : 0;
  return {
    count: events.length,
    incidents,
    resisted,
    avg_intensity: Number(avgIntensity.toFixed(1)),
    risk_points: incidents * 10 + avgIntensity * 5 - resisted * 4,
  };
}

function effectivenessStatus(before, after, afterEvents = []) {
  if (!after.count) return "awaiting_followup_trace";
  if (afterEvents.some((event) => event.outcome === "bypassed")) return "ineffective";
  if (after.incidents === 0 && (before.incidents > 0 || after.resisted > 0)) return "improved";
  if (after.incidents < before.incidents) return "improved";
  if (after.risk_points + 4 < before.risk_points) return "improved";
  if (after.incidents > 0 && after.risk_points >= before.risk_points) return "ineffective";
  return "needs_more_data";
}

function escalationForAction(action, afterEvents = []) {
  const incidentEvents = afterEvents.filter((event) => ["slipped", "bypassed"].includes(event.outcome));
  if (!incidentEvents.length) return null;

  const bypassCount = incidentEvents.filter((event) => event.outcome === "bypassed").length;
  const slippedCount = incidentEvents.filter((event) => event.outcome === "slipped").length;
  const highIntensityCount = incidentEvents.filter((event) => Number(event.intensity || 0) >= 4).length;
  const severe = bypassCount > 0 || incidentEvents.length >= 2 || highIntensityCount >= 2;
  const suffix = String(action.blocker || action.action_id || "risk").replace(/[^a-z0-9_]+/gi, "_");
  const incidentIds = incidentEvents.map((event) => event.id).filter(Boolean);
  const blockerActions = {
    late_night_high_risk_window: severe
      ? "升级到二级锁: 22:20 自动白名单 + 手机离房 + 次日审计"
      : "升级到加强摩擦: 22:20 手机离床 + 桌面白名单 + 10 分钟冷却",
    friction_bypass_pattern: "启用防绕过协议: 二级锁交给外部监督，绕过后 24h 自动收紧",
    low_energy_no_fallback: "升级替代路径: 下班后先执行外部连接或离屏恢复，再开放高刺激入口",
    weekend_solitude_window: "升级周末约束: 夜间必须有外部计划、离屏环境或次日审计",
    policy_coverage_gap: "补齐强策略: 为本窗口创建 replay case、失败样本和硬门禁动作",
  };
  const actionText = bypassCount
    ? blockerActions.friction_bypass_pattern
    : blockerActions[action.blocker] || "升级干预强度: 增加外部监督、物理摩擦和次日审计";
  const level = bypassCount ? "L3 二级锁定" : severe ? "L3 强制升级" : "L2 加强摩擦";

  return {
    action_id: `life_action_escalate_${suffix}`,
    blocker: action.blocker,
    level,
    severity: bypassCount ? "critical" : severe ? "high" : "elevated",
    trigger: bypassCount
      ? "follow-up 出现绕过限制"
      : slippedCount > 1
        ? "follow-up 连续失控"
        : "follow-up 出现失控",
    action: actionText,
    rationale: `${incidentEvents.length} 条 action 后 incident / ${bypassCount} bypassed / ${slippedCount} slipped`,
    evidence_ref: incidentIds.length ? incidentIds.join(", ") : `followup:${action.action_id}`,
  };
}

function traceReplayDetail(event) {
  if (!event) return "等待更多 trace 证据";
  const note = event.note ? ` / ${event.note}` : "";
  return `${outcomeLabel(event.outcome)} / ${triggerLabel(event.trigger)} / intensity ${event.intensity}/5${note}`;
}

function buildEscalationReplay(action, sourceEvent, beforeEvents = [], afterEvents = [], escalation, escalationEvent) {
  if (!escalation) return null;
  const beforeIncident = [...beforeEvents].reverse().find((event) => ["slipped", "bypassed"].includes(event.outcome)) || beforeEvents.at(-1) || null;
  const followupIncident = afterEvents.find((event) => ["slipped", "bypassed"].includes(event.outcome)) || afterEvents.at(0) || null;
  const escalationStarted = Boolean(escalationEvent);

  return {
    title: `${escalation.level} / ${action.blocker}`,
    status: escalationStarted ? escalationEvent.to_status : "pending",
    action_id: escalation.action_id,
    steps: [
      {
        time: beforeIncident?.occurred_at || sourceEvent.created_at,
        stage: "原始失控",
        evidence_ref: beforeIncident?.id || "pre_action_gap",
        detail: beforeIncident ? traceReplayDetail(beforeIncident) : "action 前缺少失控样本，继续补齐 baseline trace",
        tone: beforeIncident ? "danger" : "neutral",
      },
      {
        time: sourceEvent.created_at,
        stage: "干预启动",
        evidence_ref: sourceEvent.id,
        detail: `${action.action} / ${sourceEvent.to_status}${sourceEvent.evidence_ref ? ` / ${sourceEvent.evidence_ref}` : ""}`,
        tone: "warn",
      },
      {
        time: followupIncident?.occurred_at || sourceEvent.created_at,
        stage: "follow-up 失败",
        evidence_ref: followupIncident?.id || escalation.evidence_ref,
        detail: followupIncident ? traceReplayDetail(followupIncident) : escalation.rationale,
        tone: followupIncident?.outcome === "bypassed" ? "danger" : "warn",
      },
      {
        time: escalationEvent?.created_at || sourceEvent.created_at,
        stage: escalationStarted ? "升级动作启动" : "升级建议生成",
        evidence_ref: escalationEvent?.id || escalation.action_id,
        detail: `${escalation.level}: ${escalation.action}`,
        tone: escalationStarted ? "warn" : escalation.severity,
      },
    ],
  };
}

function buildActionEffectiveness(actions = [], actionEvents = [], behaviorEvents = [], focus, nowIso) {
  const latestById = latestActionEventsById(actionEvents, focus);
  const nowTime = new Date(nowIso || Date.now()).getTime();
  const focusedEvents = behaviorEvents
    .filter((event) => event.focus === focus.id)
    .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));

  return actions
    .map((action) => {
      const sourceEvent = latestById.get(action.action_id);
      if (!sourceEvent || ["dismissed"].includes(sourceEvent.to_status)) return null;
      const sourceTime = new Date(sourceEvent.created_at).getTime();
      if (!Number.isFinite(sourceTime)) return null;
      const windowMs = 3 * 24 * 60 * 60 * 1000;
      const dayMs = 24 * 60 * 60 * 1000;
      const windowEnd = sourceTime + windowMs;
      const daysRemaining = Number.isFinite(nowTime)
        ? Math.max(0, Math.min(3, Math.ceil((windowEnd - nowTime) / dayMs)))
        : null;
      const relevant = focusedEvents.filter((event) => eventMatchesBlocker(event, action.blocker));
      const beforeEvents = relevant.filter((event) => {
        const time = new Date(event.occurred_at).getTime();
        return time < sourceTime && time >= sourceTime - windowMs;
      });
      const afterEvents = relevant.filter((event) => {
        const time = new Date(event.occurred_at).getTime();
        return time >= sourceTime && time <= sourceTime + windowMs;
      });
      const before = scoreTraceSet(beforeEvents);
      const after = scoreTraceSet(afterEvents);
      const escalation = escalationForAction(action, afterEvents);
      const escalationEvent = escalation ? latestById.get(escalation.action_id) : null;
      const enrichedEscalation = escalation
        ? {
            ...escalation,
            status: escalationEvent?.to_status || "pending",
            latest_event_id: escalationEvent?.id || "",
            replay: buildEscalationReplay(action, sourceEvent, beforeEvents, afterEvents, escalation, escalationEvent),
          }
        : null;
      return {
        action_id: action.action_id,
        blocker: action.blocker,
        action: action.action,
        source_event_id: sourceEvent.id,
        source_created_at: sourceEvent.created_at,
        source_status: sourceEvent.to_status,
        latest_note: sourceEvent.note || action.latest_event_note || "",
        latest_evidence_ref: sourceEvent.evidence_ref || action.latest_evidence_ref || "",
        window_start: new Date(sourceTime).toISOString(),
        window_end: new Date(windowEnd).toISOString(),
        window_state: Number.isFinite(nowTime) && nowTime > windowEnd ? "closed" : "active",
        days_remaining: daysRemaining,
        followup_trace_count: after.count,
        evaluation_status: effectivenessStatus(before, after, afterEvents),
        before,
        after,
        risk_delta: Number((before.risk_points - after.risk_points).toFixed(1)),
        incident_trace_ids: afterEvents
          .filter((event) => ["slipped", "bypassed"].includes(event.outcome))
          .map((event) => event.id)
          .filter(Boolean),
        escalation: enrichedEscalation,
        evidence_summary: after.count
          ? `${after.count} 条后续 trace / ${after.incidents} incident / ${after.resisted} resisted`
          : "等待 action 后续 trace",
      };
    })
    .filter(Boolean);
}

function buildEscalationActions(actionEffectiveness = []) {
  return actionEffectiveness
    .filter((item) => item.escalation)
    .map((item, index) => ({
      action_id: item.escalation.action_id,
      priority: `E${index + 1}`,
      severity: item.escalation.severity,
      action: item.escalation.action,
      blocker: item.escalation.blocker,
      status: "pending",
      evidence: `升级依据: ${item.escalation.rationale}; evidence ${item.escalation.evidence_ref}`,
    }));
}

function withinWindow(value, startTime, endTime) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= startTime && time <= endTime;
}

function isoDayFromValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function normalizeAuditDay(value) {
  const day = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  return day;
}

function auditGeneratedAtForDay(auditDay, generatedAt) {
  const day = normalizeAuditDay(auditDay);
  if (!day) return generatedAt;
  const base = new Date(generatedAt);
  const baseIso = Number.isNaN(base.getTime()) ? new Date().toISOString() : base.toISOString();
  return `${day}${baseIso.slice(10)}`;
}

function behaviorEventsUpTo(events = [], endIso) {
  const endTime = new Date(endIso).getTime();
  if (!Number.isFinite(endTime)) return events;
  return events.filter((event) => {
    const time = new Date(event.occurred_at).getTime();
    return Number.isFinite(time) && time <= endTime;
  });
}

function actionEventsUpTo(actionEvents = [], endIso) {
  const endTime = new Date(endIso).getTime();
  if (!Number.isFinite(endTime)) return actionEvents;
  return actionEvents.filter((event) => {
    const time = new Date(event.created_at).getTime();
    return Number.isFinite(time) && time <= endTime;
  });
}

function lifeConsoleHref({ focusId, hour, auditDay, format, hash } = {}) {
  const params = new URLSearchParams();
  params.set("focus", focusId || "short_video");
  if (hour !== null && hour !== undefined && hour !== "") params.set("hour", String(hour));
  if (auditDay) params.set("audit_day", auditDay);
  if (format) params.set("format", format);
  return `/life-console?${params.toString()}${hash ? `#${hash}` : ""}`;
}

function buildDailyAudit(focus, events = [], actionEvents = [], actionQueue = [], actionEffectiveness = [], riskHeatmap = {}, generatedAt) {
  const nowTime = new Date(generatedAt).getTime();
  const endTime = Number.isFinite(nowTime) ? nowTime : Date.now();
  const startTime = endTime - 24 * 60 * 60 * 1000;
  const auditDay = isoDayFromValue(generatedAt);
  const focusEvents = events.filter((event) => event.focus === focus.id);
  const dailyEvents = focusEvents.filter((event) => withinWindow(event.occurred_at, startTime, endTime));
  const dailyActionEvents = actionEvents.filter((event) => event.focus === focus.id && withinWindow(event.created_at, startTime, endTime));
  const incidents = dailyEvents.filter((event) => ["slipped", "bypassed"].includes(event.outcome));
  const resisted = dailyEvents.filter((event) => event.outcome === "resisted");
  const inAuditWindow = (item) => {
    const replaySteps = item.escalation?.replay?.steps || [];
    return withinWindow(item.source_created_at, startTime, endTime)
      || replaySteps.some((step) => withinWindow(step.time, startTime, endTime));
  };
  const activeEffectiveness = actionEffectiveness.filter(inAuditWindow);
  const escalations = activeEffectiveness.filter((item) => item.escalation);
  const ineffective = activeEffectiveness.filter((item) => item.evaluation_status === "ineffective");
  const improved = activeEffectiveness.filter((item) => item.evaluation_status === "improved");
  const severityWeight = { critical: 5, high: 4, elevated: 3, medium: 2, low: 1 };
  const openActions = actionQueue
    .filter((item) => ["pending", "in_progress", "evidence_attached", "reopened"].includes(item.status))
    .sort((a, b) => {
      const aEscalation = String(a.action_id || "").includes("_escalate_") ? 1 : 0;
      const bEscalation = String(b.action_id || "").includes("_escalate_") ? 1 : 0;
      if (aEscalation !== bEscalation) return bEscalation - aEscalation;
      return (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0);
    });
  const topWindow = (riskHeatmap.windows || [])[0] || null;
  const auditStatus = escalations.length
    ? "escalated"
    : incidents.length
      ? "blocked"
      : resisted.length || dailyActionEvents.length
        ? "watch"
        : "stable";
  const statusTone = auditStatus === "escalated" || auditStatus === "blocked"
    ? "danger"
    : auditStatus === "watch"
      ? "warn"
      : "good";
  const headline = escalations.length
    ? `${focus.label} 今日出现升级链，先执行最高优先级升级动作。`
    : incidents.length
      ? `${focus.label} 今日仍有 incident，继续保持受控模式。`
      : resisted.length
        ? `${focus.label} 今日有扛住样本，继续收集 follow-up 证据。`
        : `${focus.label} 今日暂无新增 incident，维持低风险观察。`;
  const timeline = [
    {
      time: generatedAt,
      event: "日报生成",
      detail: `${dailyEvents.length} trace / ${dailyActionEvents.length} action event / status ${auditStatus}`,
      evidence_ref: `lifeops-daily:${focus.id}:${eventTimeLabel(generatedAt)}`,
      tone: statusTone,
    },
    topWindow
      ? {
          time: topWindow.label,
          event: "最高风险窗口",
          detail: `${topWindow.risk_score}/100 / ${topWindow.evidence}`,
          evidence_ref: `risk-window:${focus.id}:${topWindow.label}`,
          tone: topWindow.tone,
        }
      : null,
    incidents[0]
      ? {
          time: incidents[0].occurred_at,
          event: "今日 incident",
          detail: traceReplayDetail(incidents[0]),
          evidence_ref: incidents[0].id,
          tone: "danger",
        }
      : resisted[0]
        ? {
            time: resisted[0].occurred_at,
            event: "今日扛住",
            detail: traceReplayDetail(resisted[0]),
            evidence_ref: resisted[0].id,
            tone: "good",
          }
        : null,
    dailyActionEvents[0]
      ? {
          time: dailyActionEvents[0].created_at,
          event: "行动状态",
          detail: `${dailyActionEvents[0].action_id}: ${dailyActionEvents[0].from_status || "none"} -> ${dailyActionEvents[0].to_status}`,
          evidence_ref: dailyActionEvents[0].id,
          tone: dailyActionEvents[0].to_status,
        }
      : null,
    escalations[0]?.escalation
      ? {
          time: escalations[0].escalation.replay?.steps?.at(-1)?.time || generatedAt,
          event: "升级链",
          detail: `${escalations[0].escalation.level}: ${escalations[0].escalation.rationale}`,
          evidence_ref: escalations[0].escalation.evidence_ref,
          tone: escalations[0].escalation.severity,
        }
      : null,
  ].filter(Boolean);

  return {
    report_id: `lifeops_daily_${focus.id}_${auditDay}`,
    generated_at: generatedAt,
    selected_day: auditDay,
    status: auditStatus,
    tone: statusTone,
    headline,
    window_label: `${eventTimeLabel(new Date(startTime).toISOString())} -> ${eventTimeLabel(new Date(endTime).toISOString())}`,
    metrics: [
      ["Trace", dailyEvents.length, dailyEvents.length ? "warn" : "neutral"],
      ["Incident", incidents.length, incidents.length ? "danger" : "good"],
      ["Resisted", resisted.length, resisted.length ? "good" : "neutral"],
      ["Action events", dailyActionEvents.length, dailyActionEvents.length ? "warn" : "neutral"],
      ["Improved", improved.length, improved.length ? "good" : "neutral"],
      ["Escalation", escalations.length, escalations.length ? "danger" : "neutral"],
    ],
    timeline,
    next_actions: openActions.slice(0, 4).map((item) => ({
      action_id: item.action_id,
      status: item.status,
      severity: item.severity,
      action: item.action,
      blocker: item.blocker,
    })),
    summary: {
      incidents: incidents.length,
      resisted: resisted.length,
      open_actions: openActions.length,
      ineffective: ineffective.length,
      escalations: escalations.length,
    },
  };
}

function nextDailyAuditRun(generatedAt, hour = 23, minute = 30) {
  const base = new Date(generatedAt);
  const date = Number.isNaN(base.getTime()) ? new Date() : base;
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= date.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function buildDailyAuditSchedule(focus, generatedAt) {
  return {
    status: "active",
    cadence: "daily",
    time_label: "23:30 local",
    destination: "LifeOps 控制台 / Markdown",
    next_run_at: nextDailyAuditRun(generatedAt),
    prompt: `生成 ${focus.label} 的 LifeOps Daily Audit，包含风险窗口、行动事件、follow-up、升级链和下一步动作。`,
  };
}

function buildAuditRuntime(focus, events = [], actionEvents = [], generatedAt) {
  const boundedEvents = behaviorEventsUpTo(events, generatedAt);
  const boundedActionEvents = actionEventsUpTo(actionEvents, generatedAt);
  const summary = summarizeLifeEvents(boundedEvents, { focus: focus.id, now: generatedAt });
  const hasLocalEvents = summary.total_events > 0;
  const policies = hasLocalEvents
    ? buildDynamicPolicies(focus, boundedEvents, summary, generatedAt)
    : defaultPolicyRows(focus);
  let actionQueue = applyActionEventState(buildActionQueueFromPolicies(policies, hasLocalEvents), boundedActionEvents, focus);
  const actionEffectiveness = buildActionEffectiveness(actionQueue, boundedActionEvents, boundedEvents, focus, generatedAt);
  const escalationActions = buildEscalationActions(actionEffectiveness);
  if (escalationActions.length) {
    actionQueue = applyActionEventState([...actionQueue, ...escalationActions], boundedActionEvents, focus);
  }

  return {
    events: boundedEvents,
    actionEvents: boundedActionEvents,
    policies,
    actionQueue,
    actionEffectiveness,
    riskHeatmap: buildRiskHeatmap(focus, boundedEvents, generatedAt),
  };
}

function buildDailyAuditHistory(focus, events = [], actionEvents = [], generatedAt, options = {}) {
  const days = options.days || 7;
  const nowTime = new Date(generatedAt).getTime();
  const baseTime = Number.isFinite(nowTime) ? nowTime : Date.now();
  const selectedDay = normalizeAuditDay(options.selectedDay) || isoDayFromValue(generatedAt);
  return Array.from({ length: days }, (_, index) => {
    const end = new Date(baseTime - index * 24 * 60 * 60 * 1000).toISOString();
    const day = isoDayFromValue(end);
    const runtime = buildAuditRuntime(focus, events, actionEvents, end);
    const audit = buildDailyAudit(
      focus,
      runtime.events,
      runtime.actionEvents,
      runtime.actionQueue,
      runtime.actionEffectiveness,
      runtime.riskHeatmap,
      end
    );
    return {
      report_id: `lifeops_daily_${focus.id}_${end.slice(0, 10)}`,
      generated_at: end,
      selected: day === selectedDay,
      href: lifeConsoleHref({ focusId: focus.id, hour: options.hour, auditDay: day, hash: "daily-audit" }),
      markdown_href: lifeConsoleHref({ focusId: focus.id, hour: options.hour, auditDay: day, format: "markdown" }),
      status: audit.status,
      tone: audit.tone,
      headline: audit.headline,
      incidents: audit.summary.incidents,
      resisted: audit.summary.resisted,
      escalations: audit.summary.escalations,
      open_actions: audit.summary.open_actions,
    };
  });
}

function metricValue(audit, label) {
  const metric = (audit.metrics || []).find(([metricLabel]) => metricLabel === label);
  return Number(metric?.[1] || 0);
}

function deltaLabel(delta) {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function deltaTone(delta, direction = "down_is_good") {
  if (!delta) return "neutral";
  if (direction === "up_is_good") return delta > 0 ? "good" : "warn";
  return delta > 0 ? "danger" : "good";
}

function statusRank(status) {
  return {
    stable: 0,
    watch: 1,
    blocked: 2,
    escalated: 3,
  }[status] ?? 0;
}

function diffMetricRow(label, current, previous, direction, note) {
  const delta = Number(current || 0) - Number(previous || 0);
  return {
    label,
    current: Number(current || 0),
    previous: Number(previous || 0),
    delta,
    delta_label: deltaLabel(delta),
    tone: deltaTone(delta, direction),
    note,
  };
}

function topRiskWindowShift(currentRuntime = {}, previousRuntime = {}) {
  const current = (currentRuntime.riskHeatmap?.windows || [])[0] || null;
  const previous = (previousRuntime.riskHeatmap?.windows || [])[0] || null;
  const currentScore = Number(current?.risk_score || 0);
  const previousScore = Number(previous?.risk_score || 0);
  const delta = currentScore - previousScore;
  const changed = Boolean(current && previous && current.label !== previous.label);
  return {
    current_label: current?.label || "-",
    current_score: currentScore,
    previous_label: previous?.label || "-",
    previous_score: previousScore,
    delta,
    delta_label: deltaLabel(delta),
    changed,
    tone: changed || delta > 8 ? "warn" : delta < -8 ? "good" : "neutral",
    detail: changed
      ? `风险窗口从 ${previous?.label || "-"} 迁移到 ${current?.label || "-"}`
      : `最高风险窗口保持在 ${current?.label || "-"}`,
  };
}

function buildDailyAuditDiff(focus, currentAudit, currentRuntime, events = [], actionEvents = [], auditGeneratedAt) {
  const currentTime = new Date(auditGeneratedAt).getTime();
  const previousGeneratedAt = Number.isFinite(currentTime)
    ? new Date(currentTime - 24 * 60 * 60 * 1000).toISOString()
    : auditGeneratedAt;
  const previousRuntime = buildAuditRuntime(focus, events, actionEvents, previousGeneratedAt);
  const previousAudit = buildDailyAudit(
    focus,
    previousRuntime.events,
    previousRuntime.actionEvents,
    previousRuntime.actionQueue,
    previousRuntime.actionEffectiveness,
    previousRuntime.riskHeatmap,
    previousGeneratedAt
  );
  const metricRows = [
    diffMetricRow("Incident", currentAudit.summary.incidents, previousAudit.summary.incidents, "down_is_good", "失控样本越少越好"),
    diffMetricRow("Resisted", currentAudit.summary.resisted, previousAudit.summary.resisted, "up_is_good", "扛住样本越多越好"),
    diffMetricRow("Action events", metricValue(currentAudit, "Action events"), metricValue(previousAudit, "Action events"), "up_is_good", "动作证据增加代表闭环更完整"),
    diffMetricRow("Ineffective", currentAudit.summary.ineffective, previousAudit.summary.ineffective, "down_is_good", "无效动作需要升级"),
    diffMetricRow("Escalation", currentAudit.summary.escalations, previousAudit.summary.escalations, "down_is_good", "升级链越少越稳定"),
    diffMetricRow("Open actions", currentAudit.summary.open_actions, previousAudit.summary.open_actions, "down_is_good", "未处理动作越少越好"),
  ];
  const statusDelta = statusRank(currentAudit.status) - statusRank(previousAudit.status);
  const windowShift = topRiskWindowShift(currentRuntime, previousRuntime);
  const incidentDelta = currentAudit.summary.incidents - previousAudit.summary.incidents;
  const escalationDelta = currentAudit.summary.escalations - previousAudit.summary.escalations;
  const resistedDelta = currentAudit.summary.resisted - previousAudit.summary.resisted;
  const verdict = escalationDelta > 0 || incidentDelta > 0 || statusDelta > 0
    ? "worse"
    : incidentDelta < 0 || resistedDelta > 0 || statusDelta < 0
      ? "improved"
      : "stable";
  const tone = verdict === "worse" ? "danger" : verdict === "improved" ? "good" : "neutral";
  const strongestChange = metricRows
    .filter((row) => row.delta !== 0 && ["danger", "warn"].includes(row.tone))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] || null;
  const headline = verdict === "worse"
    ? `${focus.label} 比前一审计日恶化，${strongestChange?.label || "Incident"} ${strongestChange?.delta_label || "+0"}。`
    : verdict === "improved"
      ? `${focus.label} 比前一审计日改善，继续保留当前有效门禁。`
      : `${focus.label} 与前一审计日基本持平，继续收集证据。`;
  const recommendation = verdict === "worse"
    ? "收紧最高风险窗口，优先处理升级动作和未关闭 action。"
    : verdict === "improved"
      ? "保持当前动作 1 个审计周期，不急着放宽，先验证改善是否可重复。"
      : "维持观察模式，补齐缺少证据的窗口和 follow-up trace。";

  return {
    verdict,
    tone,
    headline,
    recommendation,
    current_report_id: currentAudit.report_id,
    previous_report_id: previousAudit.report_id,
    current_day: currentAudit.selected_day,
    previous_day: previousAudit.selected_day,
    status: {
      current: currentAudit.status,
      previous: previousAudit.status,
      delta: statusDelta,
      changed: currentAudit.status !== previousAudit.status,
      tone: statusDelta > 0 ? "danger" : statusDelta < 0 ? "good" : "neutral",
    },
    top_window_shift: windowShift,
    metrics: metricRows,
  };
}

function sanitizePatchId(value) {
  return String(value || "patch").replace(/[^a-z0-9_]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function policyPatch(id, priority, type, tone, target, change, rationale, expectedSignal, evidenceRef, blocker = "policy_coverage_gap") {
  const patchId = `policy_patch_${sanitizePatchId(id)}`;
  return {
    patch_id: patchId,
    action_id: `life_action_${patchId}`,
    priority,
    type,
    tone,
    target,
    blocker,
    change,
    rationale,
    expected_signal: expectedSignal,
    evidence_ref: evidenceRef,
    status: "proposed",
    safety: "advisory_only",
  };
}

function blockerForRiskWindow(label, focus) {
  const hour = normalizeHour(String(label || "").slice(0, 2), null);
  if (hour === null) return "policy_coverage_gap";
  return hourWindowProfile(hour, focus).blocker;
}

function patchTrackingForEvent(patch, sourceEvent, events = [], focus) {
  if (!sourceEvent) return null;
  const sourceTime = new Date(sourceEvent.created_at).getTime();
  if (!Number.isFinite(sourceTime)) return null;
  const windowMs = 3 * 24 * 60 * 60 * 1000;
  const windowEnd = sourceTime + windowMs;
  const relevant = events
    .filter((event) => event.focus === focus.id)
    .filter((event) => eventMatchesBlocker(event, patch.blocker));
  const beforeEvents = relevant.filter((event) => {
    const time = new Date(event.occurred_at).getTime();
    return Number.isFinite(time) && time < sourceTime && time >= sourceTime - windowMs;
  });
  const afterEvents = relevant.filter((event) => {
    const time = new Date(event.occurred_at).getTime();
    return Number.isFinite(time) && time >= sourceTime && time <= windowEnd;
  });
  const before = scoreTraceSet(beforeEvents);
  const after = scoreTraceSet(afterEvents);

  return {
    window_start: new Date(sourceTime).toISOString(),
    window_end: new Date(windowEnd).toISOString(),
    before,
    after,
    followup_trace_count: after.count,
    evaluation_status: effectivenessStatus(before, after, afterEvents),
    evidence_summary: after.count
      ? `${after.count} 条后续 trace / ${after.incidents} incident / ${after.resisted} resisted`
      : "等待 patch 后续 trace",
  };
}

function enrichPolicyPatchQueue(patches = [], actionEvents = [], events = [], focus) {
  const latestById = latestActionEventsById(actionEvents, focus);
  return patches.map((patch) => {
    const latest = latestById.get(patch.action_id);
    const tracking = patchTrackingForEvent(patch, latest, events, focus);
    return {
      ...patch,
      status: latest?.to_status || patch.status,
      latest_event_id: latest?.id || "",
      latest_event_at: latest?.created_at || "",
      latest_event_note: latest?.note || "",
      latest_evidence_ref: latest?.evidence_ref || "",
      tracking,
    };
  });
}

function buildPolicyPatchQueue(focus, audit = {}, diff = {}, runtime = {}) {
  const patches = [];
  const selectedDay = audit.selected_day || isoDayFromValue(audit.generated_at);
  const evidenceRef = `${audit.report_id || `lifeops_daily_${focus.id}_${selectedDay}`} / ${diff.previous_report_id || "previous_audit"}`;
  const topWindow = diff.top_window_shift || {};
  const incidentDelta = (diff.metrics || []).find((item) => item.label === "Incident")?.delta || 0;
  const escalationDelta = (diff.metrics || []).find((item) => item.label === "Escalation")?.delta || 0;
  const openActions = Number(audit.summary?.open_actions || 0);
  const currentTopWindow = topWindow.current_label || (runtime.riskHeatmap?.windows || [])[0]?.label || "highest-risk-window";
  const currentWindowBlocker = blockerForRiskWindow(currentTopWindow, focus);

  if (diff.verdict === "worse") {
    patches.push(policyPatch(
      `${focus.id}_${selectedDay}_tighten_${currentTopWindow}`,
      incidentDelta > 0 || escalationDelta > 0 ? "P0" : "P1",
      "tighten_gate",
      "danger",
      `risk_window:${currentTopWindow}`,
      `${currentTopWindow} 进入受控模式：提前 20 分钟离屏，关闭推荐流，只保留白名单入口。`,
      diff.headline || "审计 Diff 显示风险恶化。",
      "下一审计日 Incident 下降，且该窗口至少产生 1 条 follow-up trace。",
      evidenceRef,
      currentWindowBlocker
    ));
  }

  const escalationAction = (audit.next_actions || []).find((item) => String(item.action_id || "").includes("_escalate_"));
  if (escalationAction) {
    patches.push(policyPatch(
      `${focus.id}_${selectedDay}_escalation_${escalationAction.blocker}`,
      "P0",
      "start_escalation_action",
      "danger",
      escalationAction.blocker,
      escalationAction.action,
      `日报存在升级动作 ${escalationAction.action_id}，需要先处理最高优先级 blocker。`,
      "升级动作进入 in_progress，且 3 天跟踪窗口内无 bypass follow-up。",
      escalationAction.action_id,
      escalationAction.blocker
    ));
  }

  if (openActions >= 3) {
    patches.push(policyPatch(
      `${focus.id}_${selectedDay}_close_open_actions`,
      "P1",
      "close_action_debt",
      "warn",
      "action_queue",
      `冻结新增放宽策略，先清理 ${openActions} 个未关闭 action。`,
      "未处理动作过多会让系统只报警、不闭环。",
      "Open actions 降到 2 以下，且每个 high blocker 有证据引用。",
      evidenceRef,
      "policy_coverage_gap"
    ));
  }

  if (topWindow.changed) {
    patches.push(policyPatch(
      `${focus.id}_${selectedDay}_window_shift_${topWindow.previous_label}_${topWindow.current_label}`,
      "P1",
      "add_replay_case",
      "warn",
      `risk_window:${topWindow.current_label}`,
      `为 ${topWindow.current_label} 新增 replay case，验证风险是否从 ${topWindow.previous_label} 迁移。`,
      topWindow.detail || "最高风险窗口发生迁移。",
      "新增 2 条窗口 trace，区分真实迁移和单日噪声。",
      evidenceRef,
      currentWindowBlocker
    ));
  }

  if (diff.verdict === "improved") {
    patches.push(policyPatch(
      `${focus.id}_${selectedDay}_hold_relaxation`,
      "P2",
      "hold_relaxation",
      "good",
      "release_gate",
      "保持当前门禁 1 个审计周期，不立即放宽高刺激入口。",
      diff.headline || "审计 Diff 显示改善，但样本仍需复验。",
      "连续 2 个审计日维持 improved 或 stable 后再生成放宽草案。",
      evidenceRef,
      "policy_coverage_gap"
    ));
  }

  if (!patches.length) {
    patches.push(policyPatch(
      `${focus.id}_${selectedDay}_collect_evidence`,
      "P2",
      "collect_evidence",
      "neutral",
      "evidence_graph",
      "补齐最高风险窗口的 trace 和 action follow-up，暂不改变门禁强度。",
      diff.headline || "审计 Diff 基本持平。",
      "下一审计日每个高风险窗口至少有 1 条 trace。",
      evidenceRef,
      "policy_coverage_gap"
    ));
  }

  return patches.slice(0, 5);
}

function hourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function hourFromEvent(event) {
  const date = new Date(event.occurred_at);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getHours();
}

function normalizeHour(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return fallback;
  return hour;
}

function heatTone(score) {
  if (score >= 70) return "danger";
  if (score >= 42) return "warn";
  if (score > 0) return "good";
  return "neutral";
}

function emptyHeatBuckets() {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: hourLabel(hour),
    count: 0,
    incidents: 0,
    resisted: 0,
    avg_intensity: 0,
    risk_score: 0,
    tone: "neutral",
  }));
}

function fallbackRiskWindows(focus) {
  const seed = focus.id === "impulse"
    ? [23, 0, 1, 22]
    : focus.id === "dopamine"
      ? [21, 22, 23, 0]
      : [22, 23, 0, 21];
  const buckets = emptyHeatBuckets();
  seed.forEach((hour, index) => {
    const score = 76 - index * 8;
    buckets[hour] = {
      ...buckets[hour],
      count: 1,
      incidents: index < 2 ? 1 : 0,
      avg_intensity: 4 - index * 0.3,
      risk_score: score,
      tone: heatTone(score),
      fallback: true,
    };
  });
  return buckets;
}

function baselineRiskPriors(focus) {
  return fallbackRiskWindows(focus).map((bucket) => bucket.fallback
    ? {
        ...bucket,
        count: 0,
        incidents: 0,
        resisted: 0,
        avg_intensity: 0,
      }
    : bucket);
}

function buildRiskHeatmap(focus, events = [], nowIso) {
  const now = new Date(nowIso);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const buckets = emptyHeatBuckets();
  const focused = events.filter((event) => event.focus === focus.id)
    .filter((event) => new Date(event.occurred_at) >= weekStart);

  if (!focused.length) {
    const fallbackBuckets = fallbackRiskWindows(focus);
    return {
      buckets: fallbackBuckets,
      windows: fallbackBuckets
        .filter((bucket) => bucket.risk_score > 0)
        .sort((a, b) => b.risk_score - a.risk_score)
        .slice(0, 5)
        .map((bucket) => ({
          ...bucket,
          evidence: "baseline risk window",
        })),
    };
  }

  for (const event of focused) {
    const hour = hourFromEvent(event);
    const bucket = buckets[hour];
    bucket.count += 1;
    bucket.incidents += ["slipped", "bypassed"].includes(event.outcome) ? 1 : 0;
    bucket.resisted += event.outcome === "resisted" ? 1 : 0;
    bucket.avg_intensity += Number(event.intensity || 0);
  }

  for (const bucket of buckets) {
    if (!bucket.count) continue;
    bucket.avg_intensity = Number((bucket.avg_intensity / bucket.count).toFixed(1));
    bucket.risk_score = Math.max(
      8,
      Math.min(96, Math.round(bucket.count * 8 + bucket.incidents * 24 + bucket.avg_intensity * 9 - bucket.resisted * 7))
    );
    bucket.tone = heatTone(bucket.risk_score);
  }

  const priors = baselineRiskPriors(focus);
  for (const prior of priors) {
    if (prior.risk_score > 0 && buckets[prior.hour].count === 0) {
      buckets[prior.hour] = prior;
    }
  }

  return {
    buckets,
    windows: buckets
      .filter((bucket) => bucket.risk_score > 0)
      .sort((a, b) => b.risk_score - a.risk_score)
      .slice(0, 5)
      .map((bucket) => ({
        ...bucket,
        evidence: bucket.fallback
          ? "baseline risk prior / no trace yet"
          : `${bucket.count} traces / ${bucket.incidents} incidents / ${bucket.resisted} resisted`,
      })),
  };
}

function hourWindowProfile(hour, focus) {
  if ([22, 23, 0, 1].includes(hour)) {
    return {
      name: "睡前高风险窗口",
      blocker: "late_night_high_risk_window",
      likely_trigger: "late_night",
      root_cause: focus.id === "impulse"
        ? "深夜独处、睡眠债和即时安慰入口叠加，冲动会绕过理性评估。"
        : "深夜低能量叠加算法连续奖励，手机仍在手边，预承诺没有形成实际门禁。",
      recommendation: focus.id === "impulse"
        ? "提前进入离屏环境，启动 10 分钟延迟和物理位置切换。"
        : "22:30 前手机停泊，关闭推荐流，只保留白名单入口。",
    };
  }

  if (hour >= 18 && hour <= 21) {
    return {
      name: "下班低连接窗口",
      blocker: "low_energy_no_fallback",
      likely_trigger: "lonely_after_work",
      root_cause: "工作后的空虚和疲劳没有被替代动作承接，高刺激入口变成默认安慰路径。",
      recommendation: "预设散步、洗澡、纸质书或一句外部连接，把奖励入口从高刺激切到低刺激。",
    };
  }

  if (hour >= 12 && hour <= 16) {
    return {
      name: "午后注意力塌陷窗口",
      blocker: "low_energy_no_fallback",
      likely_trigger: "boredom",
      root_cause: "能量回落和任务阻力同时出现时，系统会寻找最低摩擦的即时奖励。",
      recommendation: "把下一步任务切成 10 分钟可完成动作，并限制高刺激入口到完成后再开放。",
    };
  }

  return {
    name: "未归类风险窗口",
    blocker: "policy_coverage_gap",
    likely_trigger: "other",
    root_cause: `${focus.label} 在这个时间窗已有风险信号，但触发源证据还不够密集。`,
    recommendation: "继续记录上下文，至少补齐 3 条 trace 后再生成强策略。",
  };
}

function drilldownActionId(profile, matchingPolicy) {
  return `life_action_${matchingPolicy?.id || profile.blocker}`;
}

function buildRiskDrilldown(focus, events = [], riskHeatmap = {}, selectedHour, nowIso, policies = []) {
  const windows = riskHeatmap.windows || [];
  const fallbackHour = windows[0]?.hour ?? 23;
  const hour = normalizeHour(selectedHour, fallbackHour);
  const bucket = (riskHeatmap.buckets || [])[hour] || emptyHeatBuckets()[hour];
  const now = new Date(nowIso);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const samples = events
    .filter((event) => event.focus === focus.id)
    .filter((event) => new Date(event.occurred_at) >= weekStart)
    .filter((event) => hourFromEvent(event) === hour)
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))
    .slice(0, 8);
  const profile = hourWindowProfile(hour, focus);
  const matchingPolicy = policies.find((policy) => policy.blocker === profile.blocker);
  const incidents = samples.filter((event) => ["slipped", "bypassed"].includes(event.outcome));
  const resisted = samples.filter((event) => event.outcome === "resisted");
  const mainEvent = incidents[0] || samples[0] || null;
  const taxonomy = mainEvent ? taxonomyForLifeEvent(mainEvent) : null;
  const confidence = Math.min(
    0.94,
    0.54 + Number(bucket.risk_score || 0) / 300 + samples.length * 0.035 + incidents.length * 0.06
  ).toFixed(2);
  const title = `${hourLabel(hour)} ${profile.name}`;
  const action = matchingPolicy?.action || profile.recommendation;
  const actionId = drilldownActionId(profile, matchingPolicy);
  const evidenceSummary = samples.length
    ? `${samples.length} 条 trace / ${incidents.length} incident / ${resisted.length} resisted`
    : bucket.fallback
      ? "baseline risk window / 等待本地 trace 验证"
      : "暂无本地 trace，先作为观测窗口";

  return {
    hour,
    label: hourLabel(hour),
    title,
    mode: samples.length ? "trace" : "baseline",
    tone: bucket.tone,
    risk_score: bucket.risk_score,
    count: bucket.count,
    incidents: bucket.incidents,
    resisted: bucket.resisted,
    avg_intensity: bucket.avg_intensity,
    blocker: profile.blocker,
    action_id: actionId,
    action_status: "pending",
    likely_trigger: profile.likely_trigger,
    root_cause: mainEvent ? replayRootCauseForEvent(mainEvent, focus) : profile.root_cause,
    recommendation: action,
    confidence,
    evidence_summary: evidenceSummary,
    source_event_id: mainEvent?.id || "",
    taxonomy_code: taxonomy?.code || "",
    sample_events: samples,
    replay_steps: [
      [hourLabel(hour), "窗口打开", `${profile.name} / ${profile.likely_trigger} / risk ${bucket.risk_score}/100`, bucket.tone],
      [samples.length ? eventTimeLabel(samples[0].occurred_at) : "baseline", "证据采样", evidenceSummary, samples.length ? "warn" : "neutral"],
      [taxonomy?.code || profile.blocker, "模式归类", taxonomy?.pattern || profile.root_cause, taxonomy?.severity || bucket.tone],
      ["next action", "干预动作", action, bucket.tone === "danger" ? "danger" : "warn"],
    ],
  };
}

export function buildLifeConsoleSnapshot(options = {}) {
  const focus = focusConfig(options.focus);
  const events = Array.isArray(options.events) ? options.events : [];
  const actionEvents = Array.isArray(options.actionEvents) ? options.actionEvents : [];
  const generatedAt = options.now || new Date().toISOString();
  const summary = summarizeLifeEvents(events, { focus: focus.id, now: generatedAt });
  const hasLocalEvents = summary.total_events > 0;
  const gateDecision = hasLocalEvents ? gateDecisionForSummary(focus, summary) : focus.gateDecision;
  const gateTone = hasLocalEvents ? summary.risk_tone : focus.id === "dopamine" ? "warn" : "danger";
  const localIncidentText = hasLocalEvents
    ? `近 7 日 ${summary.week_incidents} 次 incident / ${summary.resisted_count} 次扛住`
    : "近 7 日 4 次风险窗口命中";
  const dynamicReplay = hasLocalEvents ? buildReplayFromRecentEvents(focus, summary) : null;
  const policies = hasLocalEvents
    ? buildDynamicPolicies(focus, events, summary, generatedAt)
    : defaultPolicyRows(focus);
  let actionQueue = applyActionEventState(buildActionQueueFromPolicies(policies, hasLocalEvents), actionEvents, focus);
  const actionEffectiveness = buildActionEffectiveness(actionQueue, actionEvents, events, focus, generatedAt);
  const escalationActions = buildEscalationActions(actionEffectiveness);
  if (escalationActions.length) {
    actionQueue = applyActionEventState([...actionQueue, ...escalationActions], actionEvents, focus);
  }
  const riskHeatmap = buildRiskHeatmap(focus, events, generatedAt);
  const riskDrilldown = buildRiskDrilldown(focus, events, riskHeatmap, options.hour, generatedAt, policies);
  const drilldownAction = actionQueue.find((action) => action.action_id === riskDrilldown.action_id);
  riskDrilldown.action_status = drilldownAction?.status || "pending";
  riskDrilldown.latest_evidence_ref = drilldownAction?.latest_evidence_ref || "";
  riskDrilldown.latest_event_note = drilldownAction?.latest_event_note || "";
  riskDrilldown.action_tracking = actionEffectiveness.find((item) => item.action_id === riskDrilldown.action_id) || null;
  const requestedAuditDay = normalizeAuditDay(options.auditDay);
  const currentAuditDay = isoDayFromValue(generatedAt);
  const selectedAuditDay = requestedAuditDay || currentAuditDay;
  const auditGeneratedAt = requestedAuditDay ? auditGeneratedAtForDay(requestedAuditDay, generatedAt) : generatedAt;
  const auditRuntime = buildAuditRuntime(focus, events, actionEvents, auditGeneratedAt);
  const dailyAudit = buildDailyAudit(
    focus,
    auditRuntime.events,
    auditRuntime.actionEvents,
    auditRuntime.actionQueue,
    auditRuntime.actionEffectiveness,
    auditRuntime.riskHeatmap,
    auditGeneratedAt
  );
  const dailyAuditSchedule = buildDailyAuditSchedule(focus, generatedAt);
  const dailyAuditHistory = buildDailyAuditHistory(focus, events, actionEvents, generatedAt, {
    selectedDay: selectedAuditDay,
    hour: riskDrilldown.hour,
  });
  const dailyAuditDiff = buildDailyAuditDiff(focus, dailyAudit, auditRuntime, events, actionEvents, auditGeneratedAt);
  const dailyAuditPolicyPatches = enrichPolicyPatchQueue(
    buildPolicyPatchQueue(focus, dailyAudit, dailyAuditDiff, auditRuntime),
    actionEvents,
    events,
    focus
  );
  const controlCockpit = buildControlCockpit(focus, summary, hasLocalEvents);
  const interventionLayer = buildInterventionLayer(
    focus,
    summary,
    controlCockpit,
    riskDrilldown,
    actionEvents,
    generatedAt
  );
  const deviceAnchorLayer = buildDeviceAnchorLayer(focus, interventionLayer, actionEvents);
  const reviewReport = buildReviewReport(
    focus,
    events,
    actionEvents,
    dailyAuditHistory,
    controlCockpit,
    interventionLayer,
    deviceAnchorLayer,
    generatedAt
  );
  const operatorRank = buildOperatorRank(focus, summary, controlCockpit, reviewReport, interventionLayer, deviceAnchorLayer);
  const missionChain = buildMissionChain(focus, operatorRank, deviceAnchorLayer, interventionLayer, actionEvents);

  return {
    generated_at: generatedAt,
    profile_id: "human_local_alpha",
    focus,
    summary,
    recorded: Boolean(options.recorded),
    action_recorded: Boolean(options.actionRecorded),
    status: {
      label: gateDecision,
      tone: gateTone,
    },
    control_cockpit: controlCockpit,
    intervention_layer: interventionLayer,
    device_anchor_layer: deviceAnchorLayer,
    review_report: reviewReport,
    operator_rank: operatorRank,
    mission_chain: missionChain,
    metrics: hasLocalEvents ? buildDynamicMetrics(focus, summary) : [
      {
        label: focus.primaryRiskLabel,
        value: focus.primaryRiskValue,
        detail: `${focus.primaryRiskDetail}；压制 Readiness`,
        tone: focus.id === "dopamine" ? "warn" : "danger",
      },
      {
        label: "自律 Uptime",
        value: "19h 42m",
        detail: "距离上次失控事件",
        tone: "good",
      },
      {
        label: "注意力 Readiness",
        value: "41/100",
        detail: "104 - Risk - 深夜惩罚",
        tone: "danger",
      },
      {
        label: "睡眠债",
        value: "2.4h",
        detail: "连续 3 晚晚睡",
        tone: "warn",
      },
      {
        label: "Clean Streak",
        value: "7d",
        detail: "当前连续周期，独立于累计证据",
        tone: "good",
      },
      {
        label: "行为证据",
        value: "148",
        detail: "累计资产，和 Streak 独立",
        tone: "neutral",
      },
    ],
    gate: {
      question: focus.gateQuestion,
      decision: gateDecision,
      autonomy_score: hasLocalEvents ? Math.max(20, 100 - summary.risk_score) : 46,
      reliability_score: hasLocalEvents ? Math.max(35, 76 - summary.week_incidents * 6 + summary.resisted_count * 2) : 62,
      risk_control_score: hasLocalEvents ? Math.max(20, 104 - summary.risk_score - summary.week_incidents * 5) : 38,
      evidence_score: hasLocalEvents ? Math.min(95, 58 + summary.total_events * 4) : 71,
      blockers: [
        {
          code: "late_night_high_risk_window",
          severity: "high",
          current: "23:00-01:10",
          target: "phone_docked_by_22:30",
          evidence: localIncidentText,
        },
        {
          code: "friction_bypass_pattern",
          severity: "medium",
          current: "2 bypasses",
          target: "0 bypasses / 7d",
          evidence: "曾卸载后重装高刺激入口",
        },
        {
          code: "low_energy_no_fallback",
          severity: "high",
          current: "fallback missing",
          target: "precommitted fallback",
          evidence: "疲劳时没有替代动作",
        },
      ],
    },
    replay: dynamicReplay || {
      title: focus.triggerName,
      root_cause: focus.rootCause,
      confidence: "0.82",
      timeline: [
        ["21:42", "能量下降", "下班后疲劳，开始寻找低成本奖励", "warn"],
        ["22:08", "入口打开", `触发 ${focus.label} 相关高刺激入口`, "warn"],
        ["22:31", "回路锁定", "连续奖励导致时间感下降，预期 5 分钟变 38 分钟", "danger"],
        ["23:17", "契约破坏", "睡眠目标被击穿，第二天注意力 readiness 下降", "danger"],
        ["次日 09:10", "复盘完成", "AI Judge 归因为环境防线不足，不是意志力单点失败", "good"],
      ],
    },
    taxonomy: taxonomyWithEvents([
      {
        code: "doom_scroll_late_night_loop",
        count: 6,
        severity: "high",
        pattern: "睡前低能量时进入无限滑动",
        suggested_eval: "23:00 手机在手边的模拟回放",
      },
      {
        code: "lonely_after_work_trigger",
        count: 4,
        severity: "medium",
        pattern: "工作后孤独或空虚触发即时奖励",
        suggested_eval: "独处 30 分钟无外部约束回放",
      },
      {
        code: "friction_bypass_reinstall",
        count: 2,
        severity: "high",
        pattern: "限制工具被卸载或绕过",
        suggested_eval: "限制失效时的二级拦截测试",
      },
      {
        code: "sleep_debt_impulse_amplifier",
        count: 5,
        severity: "medium",
        pattern: "睡眠债放大冲动和拖延",
        suggested_eval: "低睡眠日行动计划回放",
      },
    ], events, focus),
    policies,
    action_queue: actionQueue,
    action_events: actionEvents.filter((event) => event.focus === focus.id).slice(-12).reverse(),
    action_effectiveness: actionEffectiveness,
    risk_heatmap: riskHeatmap,
    risk_drilldown: riskDrilldown,
    daily_audit: dailyAudit,
    daily_audit_selection: {
      selected_day: selectedAuditDay,
      current_day: currentAuditDay,
      generated_at: auditGeneratedAt,
      is_historical: selectedAuditDay !== currentAuditDay,
    },
    daily_audit_schedule: dailyAuditSchedule,
    daily_audit_history: dailyAuditHistory,
    daily_audit_diff: dailyAuditDiff,
    daily_audit_policy_patches: dailyAuditPolicyPatches,
    judge: {
      verdict: "不是普通打卡问题，而是行为系统没有门禁、回放和证据。",
      root_cause: focus.rootCause,
      recommendation: "先把高风险时间窗从自由模式降级为受控模式，再用 7 天证据判断是否放宽。",
      safety_boundary: "系统只提供自愿的自我治理建议，不做医疗诊断，不替代专业帮助，不强制剥夺用户控制权。",
    },
    eval_coverage: [
      ["睡前高风险窗口", "covered", "6 failures", "2 replay cases", "1 passed"],
      ["绕过限制", "partial", "2 failures", "1 replay case", "0 passed"],
      ["周末独处", "gap", "3 failures", "0 replay cases", "0 passed"],
      ["睡眠债", "covered", "5 failures", "1 replay case", "1 passed"],
    ],
    assets: [
      ["行为 trace", 148],
      ["欲望/冲动日志", 37],
      ["失控案例", 11],
      ["失败 taxonomy", 9],
      ["Replay 片段", 9],
      ["干预结果", 16],
      ["学习规则", 5],
      ["审计事件", 42],
    ],
    audit_events: [
      ["audit_001", "trace.ingested", "手机屏幕时间导入", "verified"],
      ["audit_002", "judge.completed", "AI Judge 生成根因", "verified"],
      ["audit_003", "policy.dry_run", `${focus.activeProtocol} 命中 8 个历史窗口`, "completed"],
      ["audit_004", "action.created", "手机停泊协议进入行动队列", "pending"],
      ...summary.recent_events.slice(0, 4).map((event) => [
        event.id,
        "life_trace.ingested",
        `${outcomeLabel(event.outcome)} / ${triggerLabel(event.trigger)} / intensity ${event.intensity}`,
        "verified",
      ]),
    ],
    recent_traces: summary.recent_events,
  };
}

function blockerRows(blockers) {
  return blockers.map((item) => [
    `<tr>`,
    `<td><code>${escapeHtml(item.code)}</code></td>`,
    `<td>${pill(item.severity, item.severity)}</td>`,
    `<td>${escapeHtml(item.current)} -> ${escapeHtml(item.target)}</td>`,
    `<td class="muted">${escapeHtml(item.evidence)}</td>`,
    `</tr>`,
  ].join(""));
}

function replayRows(replay) {
  return replay.timeline.map(([time, event, detail, tone]) => [
    `<tr>`,
    `<td><code>${escapeHtml(time)}</code></td>`,
    `<td>${pill(event, tone)}</td>`,
    `<td>${escapeHtml(detail)}</td>`,
    `</tr>`,
  ].join(""));
}

function taxonomyRows(items) {
  return items.map((item) => [
    `<tr>`,
    `<td><code>${escapeHtml(item.code)}</code></td>`,
    `<td>${escapeHtml(item.count)}</td>`,
    `<td>${pill(item.severity, item.severity)}</td>`,
    `<td>${escapeHtml(item.pattern)}</td>`,
    `<td class="muted">${escapeHtml(item.suggested_eval)}</td>`,
    `</tr>`,
  ].join(""));
}

function policyRows(items) {
  return items.map((item) => [
    `<tr>`,
    `<td>${escapeHtml(item.name)}</td>`,
    `<td>${pill(item.state, item.state === "needs_evidence" ? "warn" : "good")}</td>`,
    `<td>${escapeHtml(item.match_count)}</td>`,
    `<td>${pill(item.false_positive_risk, item.false_positive_risk)}</td>`,
    `<td class="muted">${escapeHtml(item.action)}</td>`,
    `<td class="muted">${escapeHtml(item.recommendation || (item.matched_trace_ids || []).join(", ") || "-")}</td>`,
    `</tr>`,
  ].join(""));
}

function actionTransitions(status) {
  const transitions = {
    pending: [
      ["in_progress", "开始"],
      ["dismissed", "忽略"],
    ],
    in_progress: [
      ["evidence_attached", "上传证据"],
      ["resolved", "解决"],
      ["dismissed", "忽略"],
    ],
    evidence_attached: [
      ["resolved", "解决"],
      ["in_progress", "继续"],
      ["dismissed", "忽略"],
    ],
    resolved: [
      ["reopened", "重开"],
    ],
    dismissed: [
      ["reopened", "重开"],
    ],
    reopened: [
      ["in_progress", "开始"],
      ["evidence_attached", "上传证据"],
      ["resolved", "解决"],
    ],
  };
  return transitions[status] || transitions.pending;
}

function actionControls(item, focus) {
  return [
    `<form class="action-state-form" method="post" action="/life-console">`,
    `<input type="hidden" name="intent" value="action_event">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(item.action_id || "")}">`,
    `<input type="hidden" name="blocker" value="${escapeHtml(item.blocker || "")}">`,
    `<input type="hidden" name="from_status" value="${escapeHtml(item.status || "pending")}">`,
    `<input name="evidence_ref" maxlength="180" placeholder="证据链接/编号">`,
    `<input name="note" maxlength="180" placeholder="备注">`,
    `<span class="button-row">${actionTransitions(item.status || "pending").map(([value, label]) => `<button type="submit" name="to_status" value="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join("")}</span>`,
    `</form>`,
  ].join("");
}

function actionRows(items, focus) {
  return items.map((item) => [
    `<tr>`,
    `<td>${escapeHtml(item.priority)}</td>`,
    `<td>${pill(item.severity, item.severity)}</td>`,
    `<td>${escapeHtml(item.action)}</td>`,
    `<td><code>${escapeHtml(item.blocker)}</code></td>`,
    `<td>${pill(item.status, item.status)}</td>`,
    `<td class="muted">${escapeHtml(item.evidence)}${item.latest_event_note ? `<br>${escapeHtml(item.latest_event_note)}` : ""}${item.latest_evidence_ref ? `<br><code>${escapeHtml(item.latest_evidence_ref)}</code>` : ""}</td>`,
    `<td>${actionControls(item, focus)}</td>`,
    `</tr>`,
  ].join(""));
}

function actionEventRows(items) {
  return items.map((event) => [
    `<tr>`,
    `<td><code>${escapeHtml(event.id)}</code></td>`,
    `<td><code>${escapeHtml(event.action_id)}</code></td>`,
    `<td>${escapeHtml(event.created_at || "")}</td>`,
    `<td>${pill(event.from_status || "none", event.from_status || "neutral")} -> ${pill(event.to_status, event.to_status)}</td>`,
    `<td class="muted">${escapeHtml(event.note || "-")}</td>`,
    `<td><code>${escapeHtml(event.evidence_ref || "-")}</code></td>`,
    `</tr>`,
  ].join(""));
}

function actionEffectivenessRows(items) {
  return items.map((item) => [
    `<tr>`,
    `<td><code>${escapeHtml(item.action_id)}</code></td>`,
    `<td><code>${escapeHtml(item.blocker)}</code></td>`,
    `<td>${pill(item.evaluation_status, item.evaluation_status)}</td>`,
    `<td><code>${escapeHtml(eventTimeLabel(item.window_start))}</code><br><span class="muted">to ${escapeHtml(eventTimeLabel(item.window_end))}</span></td>`,
    `<td>${escapeHtml(item.before.incidents)} / ${escapeHtml(item.before.resisted)} / ${escapeHtml(item.before.avg_intensity)}</td>`,
    `<td>${escapeHtml(item.after.incidents)} / ${escapeHtml(item.after.resisted)} / ${escapeHtml(item.after.avg_intensity)}</td>`,
    `<td>${pill(`${item.risk_delta >= 0 ? "+" : ""}${item.risk_delta}`, item.risk_delta > 0 ? "good" : item.risk_delta < 0 ? "danger" : "neutral")}</td>`,
    `<td class="muted">${escapeHtml(item.evidence_summary)}<br><code>${escapeHtml(item.latest_evidence_ref || item.source_event_id)}</code></td>`,
    `</tr>`,
  ].join(""));
}

function evalCoverageRows(items) {
  return items.map(([trigger, status, failures, cases, passed]) => [
    `<tr>`,
    `<td>${escapeHtml(trigger)}</td>`,
    `<td>${pill(status, status === "gap" ? "danger" : status === "partial" ? "warn" : "good")}</td>`,
    `<td>${escapeHtml(failures)}</td>`,
    `<td>${escapeHtml(cases)}</td>`,
    `<td>${escapeHtml(passed)}</td>`,
    `</tr>`,
  ].join(""));
}

function assetRows(items) {
  return items.map(([label, value]) => [
    `<div class="asset-row">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(value)}</strong>`,
    `</div>`,
  ].join("")).join("");
}

function auditRows(items) {
  return items.map(([id, action, detail, status]) => [
    `<tr>`,
    `<td><code>${escapeHtml(id)}</code></td>`,
    `<td>${escapeHtml(action)}</td>`,
    `<td>${escapeHtml(detail)}</td>`,
    `<td>${pill(status, status)}</td>`,
    `</tr>`,
  ].join(""));
}

function dailyAuditMetricCards(metrics = []) {
  return metrics.map(([label, value, tone]) => [
    `<div class="audit-metric ${statusClass(tone)}">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(value)}</strong>`,
    `</div>`,
  ].join("")).join("");
}

function dailyAuditTimelineRows(items = []) {
  return items.map((item) => [
    `<tr>`,
    `<td><code>${escapeHtml(eventTimeLabel(item.time))}</code></td>`,
    `<td>${pill(item.event, item.tone)}</td>`,
    `<td>${escapeHtml(item.detail)}</td>`,
    `<td><code>${escapeHtml(item.evidence_ref)}</code></td>`,
    `</tr>`,
  ].join(""));
}

function dailyAuditActionRows(items = []) {
  return items.map((item) => [
    `<tr>`,
    `<td><code>${escapeHtml(item.action_id)}</code></td>`,
    `<td>${pill(item.status, item.status)}</td>`,
    `<td>${pill(item.severity, item.severity)}</td>`,
    `<td>${escapeHtml(item.action)}</td>`,
    `<td><code>${escapeHtml(item.blocker)}</code></td>`,
    `</tr>`,
  ].join(""));
}

function dailyAuditHistoryRows(items = []) {
  return items.map((item) => [
    `<tr class="${item.selected ? "selected-row" : ""}">`,
    `<td><a class="text-link ${item.selected ? "active" : ""}" href="${escapeHtml(item.href || "#daily-audit")}"><code>${escapeHtml(item.report_id)}</code></a></td>`,
    `<td><code>${escapeHtml(eventTimeLabel(item.generated_at))}</code></td>`,
    `<td>${pill(item.status, item.tone)}</td>`,
    `<td>${escapeHtml(item.incidents)} / ${escapeHtml(item.resisted)} / ${escapeHtml(item.escalations)}</td>`,
    `<td class="muted">${escapeHtml(item.headline)}</td>`,
    `</tr>`,
  ].join(""));
}

function dailyAuditDiffRows(items = []) {
  return items.map((item) => [
    `<tr>`,
    `<td>${escapeHtml(item.label)}</td>`,
    `<td><strong>${escapeHtml(item.current)}</strong></td>`,
    `<td>${escapeHtml(item.previous)}</td>`,
    `<td>${pill(item.delta_label, item.tone)}</td>`,
    `<td class="muted">${escapeHtml(item.note)}</td>`,
    `</tr>`,
  ].join(""));
}

function patchApplyForm(item, focus, selection = {}, hour = "") {
  if (item.status !== "proposed") {
    const tracking = item.tracking;
    return [
      `<div class="patch-tracking">`,
      `${pill(item.status, item.status)}`,
      item.latest_event_at ? `<code>${escapeHtml(eventTimeLabel(item.latest_event_at))}</code>` : "",
      tracking ? `<span class="muted">${escapeHtml(tracking.evaluation_status)} / ${escapeHtml(tracking.evidence_summary)}</span>` : "",
      `</div>`,
    ].join("");
  }

  return [
    `<form class="patch-apply-form" method="post" action="/life-console">`,
    `<input type="hidden" name="intent" value="action_event">`,
    `<input type="hidden" name="return_to" value="daily-audit">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<input type="hidden" name="hour" value="${escapeHtml(hour)}">`,
    `<input type="hidden" name="audit_day" value="${escapeHtml(selection.selected_day || "")}">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(item.action_id || "")}">`,
    `<input type="hidden" name="blocker" value="${escapeHtml(item.blocker || "")}">`,
    `<input type="hidden" name="from_status" value="pending">`,
    `<input type="hidden" name="to_status" value="in_progress">`,
    `<input type="hidden" name="evidence_ref" value="${escapeHtml(item.evidence_ref || item.patch_id || "")}">`,
    `<input type="hidden" name="note" value="${escapeHtml(`apply policy patch: ${item.type} / ${item.change}`)}">`,
    `<button type="submit">确认执行</button>`,
    `</form>`,
  ].join("");
}

function policyPatchRows(items = [], focus, selection = {}, hour = "") {
  return items.map((item) => [
    `<tr>`,
    `<td>${pill(item.priority, item.tone)}</td>`,
    `<td><code>${escapeHtml(item.patch_id)}</code><br>${pill(item.status, item.status)}</td>`,
    `<td>${escapeHtml(item.type)}</td>`,
    `<td><code>${escapeHtml(item.target)}</code></td>`,
    `<td>${escapeHtml(item.change)}</td>`,
    `<td class="muted">${escapeHtml(item.rationale)}<br><code>${escapeHtml(item.evidence_ref)}</code></td>`,
    `<td class="muted">${escapeHtml(item.expected_signal)}</td>`,
    `<td>${patchApplyForm(item, focus, selection, hour)}</td>`,
    `</tr>`,
  ].join(""));
}

function dailyAuditDiffCards(diff = {}) {
  const status = diff.status || {};
  const windowShift = diff.top_window_shift || {};
  const cards = [
    ["Verdict", diff.verdict || "-", diff.headline || "-", diff.tone || "neutral"],
    ["Status", `${status.previous || "-"} -> ${status.current || "-"}`, status.changed ? "审计状态发生变化" : "审计状态未变化", status.tone || "neutral"],
    ["Top Window", `${windowShift.previous_label || "-"} -> ${windowShift.current_label || "-"}`, `${windowShift.previous_score || 0} -> ${windowShift.current_score || 0} (${windowShift.delta_label || "0"})`, windowShift.tone || "neutral"],
  ];
  return cards.map(([label, value, detail, tone]) => [
    `<div class="audit-diff-card ${statusClass(tone)}">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(value)}</strong>`,
    `<small>${escapeHtml(detail)}</small>`,
    `</div>`,
  ].join("")).join("");
}

function dailyAuditScheduleRows(schedule = {}) {
  return [
    ["状态", pill(schedule.status || "inactive", schedule.status || "neutral")],
    ["频率", escapeHtml(schedule.cadence || "-")],
    ["生成时间", escapeHtml(schedule.time_label || "-")],
    ["下次生成", `<code>${escapeHtml(eventTimeLabel(schedule.next_run_at))}</code>`],
    ["输出", escapeHtml(schedule.destination || "-")],
  ].map(([label, value]) => [
    `<div class="schedule-row">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${value}</strong>`,
    `</div>`,
  ].join("")).join("");
}

function reviewMetricCards(report = {}) {
  const weekly = report.weekly || {};
  const monthly = report.monthly || {};
  const cards = [
    ["Weekly Grade", weekly.audit_grade || "-", `${weekly.incident_count || 0} incident / ${weekly.resisted_count || 0} resisted`, weekly.tone || "neutral"],
    ["Monthly Grade", monthly.audit_grade || "-", `${monthly.incident_count || 0} incident / ${monthly.evidence_count || 0} proof`, monthly.tone || "neutral"],
    ["Anchor Coverage", `${report.anchors?.coverage ?? 0}/100`, `${report.anchors?.verified || 0}/${report.anchors?.total || 0} verified`, report.anchors?.coverage >= 72 ? "good" : report.anchors?.coverage >= 48 ? "warn" : "danger"],
    ["Intervention", report.intervention?.mode || "-", `${report.intervention?.active || 0} active / ${report.intervention?.proof || 0} proof`, report.intervention?.active ? "warn" : "neutral"],
  ];
  return cards.map(([label, value, detail, tone]) => [
    `<div class="review-metric ${statusClass(tone)}">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(value)}</strong>`,
    `<small>${escapeHtml(detail)}</small>`,
    `</div>`,
  ].join("")).join("");
}

function reviewTriggerRows(items = []) {
  return items.map((item) => [
    `<tr>`,
    `<td>${pill(item.label, item.tone)}</td>`,
    `<td>${escapeHtml(item.count)}</td>`,
    `<td>${escapeHtml(item.incidents)}</td>`,
    `<td>${escapeHtml(item.max_intensity)}/5</td>`,
    `</tr>`,
  ].join(""));
}

function reviewDailyRows(items = []) {
  return items.map((item) => [
    `<tr>`,
    `<td><code>${escapeHtml(item.report_id)}</code></td>`,
    `<td>${pill(item.status, item.tone)}</td>`,
    `<td>${escapeHtml(item.incidents)} / ${escapeHtml(item.resisted)} / ${escapeHtml(item.escalations)}</td>`,
    `<td class="muted">${escapeHtml(item.headline)}</td>`,
    `</tr>`,
  ].join(""));
}

function renderReviewReportPanel(report = {}) {
  return [
    `<section class="review-report ${statusClass(report.tone)}" id="review-report">`,
    `<div class="review-head">`,
    `<div>`,
    `<p class="eyebrow">Weekly / Monthly Review</p>`,
    `<h2>${escapeHtml(report.title || "LifeOps Review Report")}</h2>`,
    `<p class="muted">${escapeHtml(report.headline || "")}</p>`,
    `</div>`,
    `${pill(report.report_id || "review", report.tone || "neutral")}`,
    `</div>`,
    `<div class="review-metrics">${reviewMetricCards(report)}</div>`,
    `<div class="review-verdict">`,
    `<strong>${escapeHtml(report.verdict || "")}</strong>`,
    `<span>${escapeHtml(report.next_protocol || "")}</span>`,
    `</div>`,
    `<div class="review-grid">`,
    `<div>`,
    `<h3>7D Trigger Board</h3>`,
    table(["触发源", "Trace", "Incident", "Max"], reviewTriggerRows(report.weekly?.top_triggers || []), "暂无周触发源"),
    `</div>`,
    `<div>`,
    `<h3>Recent Daily Reports</h3>`,
    table(["Report", "状态", "Incident/Resisted/Escalation", "摘要"], reviewDailyRows(report.daily_reports || []), "暂无日报"),
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("");
}

function operatorDimensionCards(items = []) {
  return items.map(([label, value, tone, detail]) => [
    `<div class="rank-dimension ${statusClass(tone)}">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(value)}/100</strong>`,
    `<small>${escapeHtml(detail)}</small>`,
    `</div>`,
  ].join("")).join("");
}

function operatorBadgeCards(items = []) {
  return items.map((item) => [
    `<div class="rank-badge ${statusClass(item.tone)}">`,
    `<span>${escapeHtml(item.status)}</span>`,
    `<strong>${escapeHtml(item.label)}</strong>`,
    `<small>${escapeHtml(item.detail)}</small>`,
    `</div>`,
  ].join("")).join("");
}

function renderOperatorRankPanel(rank = {}) {
  return [
    `<section class="operator-rank ${statusClass(rank.tone)}" id="operator-rank">`,
    `<div class="rank-head">`,
    `<div>`,
    `<p class="eyebrow">Identity System / 长期身份层</p>`,
    `<h2>${escapeHtml(rank.title || "Operator Rank")}</h2>`,
    `<p class="muted">${escapeHtml(rank.identity || "")}</p>`,
    `</div>`,
    `${pill(rank.rank || "RECOVERY CADET", rank.tone || "neutral")}`,
    `</div>`,
    `<div class="rank-hero">`,
    `<div><span>Level</span><strong>${escapeHtml(rank.level || 1)}</strong></div>`,
    `<div><span>Discipline Score</span><strong>${escapeHtml(rank.score ?? 0)}/100</strong></div>`,
    `<div><span>Next Mission</span><strong>${escapeHtml(rank.next_mission || "-")}</strong></div>`,
    `</div>`,
    `<div class="rank-progress"><i style="width:${clampScore(rank.progress || 0, 0, 100)}%"></i></div>`,
    `<div class="rank-grid">${operatorDimensionCards(rank.dimensions || [])}</div>`,
    `<div class="rank-badges">${operatorBadgeCards(rank.badges || [])}</div>`,
    `</section>`,
  ].join("");
}

function missionActionForms(item, focus, hour) {
  if (item.status === "blocked") {
    return `<span class="muted">等待前置任务完成</span>`;
  }
  return [
    `<form class="mission-form" method="post" action="/life-console">`,
    `<input type="hidden" name="intent" value="action_event">`,
    `<input type="hidden" name="return_to" value="mission-chain">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<input type="hidden" name="hour" value="${escapeHtml(hour ?? "")}">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(item.action_id)}">`,
    `<input type="hidden" name="blocker" value="${escapeHtml(item.blocker)}">`,
    `<input type="hidden" name="from_status" value="${escapeHtml(item.status || "pending")}">`,
    `<input type="hidden" name="to_status" value="in_progress">`,
    `<input type="hidden" name="evidence_ref" value="${escapeHtml(item.evidence_ref)}">`,
    `<input type="hidden" name="note" value="${escapeHtml(`mission start: ${item.title}`)}">`,
    `<button type="submit">开始任务</button>`,
    `</form>`,
    `<form class="mission-form" method="post" action="/life-console">`,
    `<input type="hidden" name="intent" value="action_event">`,
    `<input type="hidden" name="return_to" value="mission-chain">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<input type="hidden" name="hour" value="${escapeHtml(hour ?? "")}">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(item.action_id)}">`,
    `<input type="hidden" name="blocker" value="${escapeHtml(item.blocker)}">`,
    `<input type="hidden" name="from_status" value="${escapeHtml(item.status || "pending")}">`,
    `<input type="hidden" name="to_status" value="evidence_attached">`,
    `<input name="evidence_ref" maxlength="180" value="${escapeHtml(item.latest_evidence_ref || item.evidence_ref)}">`,
    `<input name="note" maxlength="180" value="${escapeHtml(item.latest_note || "")}" placeholder="任务完成证据">`,
    `<button type="submit">提交任务证据</button>`,
    `</form>`,
  ].join("");
}

function missionCards(items = [], focus = {}, hour = "") {
  return items.map((item, index) => [
    `<article class="mission-card ${statusClass(item.status === "blocked" ? "neutral" : item.tone)}">`,
    `<div class="mission-card-head">`,
    `<div>`,
    `<span>STEP ${index + 1} / ${escapeHtml(item.code)}</span>`,
    `<strong>${escapeHtml(item.title)}</strong>`,
    `</div>`,
    `${pill(item.status, item.status)}`,
    `</div>`,
    `<p>${escapeHtml(item.requirement)}</p>`,
    `<div class="mission-meta">`,
    `<span>Reward <code>${escapeHtml(item.reward)}</code></span>`,
    `<span>Evidence <code>${escapeHtml(item.latest_evidence_ref || item.evidence_ref)}</code></span>`,
    item.depends_on?.length ? `<span>Depends <code>${escapeHtml(item.depends_on.join(" -> "))}</code></span>` : "",
    `</div>`,
    `<div class="mission-actions">${missionActionForms(item, focus, hour)}</div>`,
    `</article>`,
  ].join("")).join("");
}

function renderMissionChainPanel(chain = {}, focus = {}, hour = "") {
  return [
    `<section class="mission-chain ${statusClass(chain.tone)}" id="mission-chain">`,
    `<div class="mission-head">`,
    `<div>`,
    `<p class="eyebrow">Mission Chain / 可执行晋级路径</p>`,
    `<h2>${escapeHtml(chain.title || "Mission Chain")}</h2>`,
    `<p class="muted">${escapeHtml(chain.rank_context || "")} / ${escapeHtml(chain.anchor_context || "")} / ${escapeHtml(chain.intervention_context || "")}</p>`,
    `</div>`,
    `${pill(`${chain.status || "AWAITING EXECUTION"} ${chain.completed || 0}/${chain.total || 0}`, chain.tone || "neutral")}`,
    `</div>`,
    `<div class="mission-summary">`,
    `<div><span>Active Mission</span><strong>${escapeHtml(chain.active_mission || "-")}</strong></div>`,
    `<div><span>Progress</span><strong>${escapeHtml(chain.progress ?? 0)}%</strong></div>`,
    `<div><span>Completion</span><strong>${escapeHtml(chain.completed || 0)} / ${escapeHtml(chain.total || 0)}</strong></div>`,
    `</div>`,
    `<div class="mission-progress"><i style="width:${clampScore(chain.progress || 0, 0, 100)}%"></i></div>`,
    `<div class="mission-list">${missionCards(chain.missions || [], focus, hour)}</div>`,
    `</section>`,
  ].join("");
}

function markdownCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function markdownTable(headers = [], rows = []) {
  if (!rows.length) return "_暂无数据_";
  return [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
}

export function renderLifeDailyAuditMarkdown(snapshot) {
  const audit = snapshot.daily_audit || {};
  const focus = snapshot.focus || {};
  const diff = snapshot.daily_audit_diff || {};
  const metrics = markdownTable(
    ["Metric", "Value", "Tone"],
    (audit.metrics || []).map(([label, value, tone]) => [label, value, tone])
  );
  const diffMetrics = markdownTable(
    ["Metric", "Current", "Previous", "Delta", "Signal"],
    (diff.metrics || []).map((item) => [
      item.label,
      item.current,
      item.previous,
      item.delta_label,
      item.tone,
    ])
  );
  const policyPatches = markdownTable(
    ["Priority", "Patch", "Status", "Type", "Target", "Change", "Expected Signal"],
    (snapshot.daily_audit_policy_patches || []).map((item) => [
      item.priority,
      item.patch_id,
      item.status,
      item.type,
      item.target,
      item.change,
      item.expected_signal,
    ])
  );
  const timeline = markdownTable(
    ["Time", "Event", "Detail", "Evidence"],
    (audit.timeline || []).map((item) => [
      eventTimeLabel(item.time),
      item.event,
      item.detail,
      item.evidence_ref,
    ])
  );
  const nextActions = markdownTable(
    ["Action", "Status", "Severity", "Blocker", "Instruction"],
    (audit.next_actions || []).map((item) => [
      item.action_id,
      item.status,
      item.severity,
      item.blocker,
      item.action,
    ])
  );
  const history = markdownTable(
    ["Report", "Generated", "Status", "Incident/Resisted/Escalation", "Headline"],
    (snapshot.daily_audit_history || []).map((item) => [
      item.selected ? `${item.report_id} (selected)` : item.report_id,
      eventTimeLabel(item.generated_at),
      item.status,
      `${item.incidents}/${item.resisted}/${item.escalations}`,
      item.headline,
    ])
  );
  const schedule = snapshot.daily_audit_schedule || {};

  return [
    `# LifeOps Daily Audit - ${focus.label || "Focus"}`,
    "",
    `- Profile: ${snapshot.profile_id || "-"}`,
    `- Generated: ${snapshot.generated_at || "-"}`,
    `- Report: ${audit.report_id || "-"}`,
    `- Audit Day: ${audit.selected_day || "-"}`,
    `- Audit Generated: ${audit.generated_at || "-"}`,
    `- Window: ${audit.window_label || "-"}`,
    `- Status: ${audit.status || "-"}`,
    `- Headline: ${audit.headline || "-"}`,
    `- Diff: ${diff.verdict || "-"} / ${diff.headline || "-"}`,
    `- Subscription: ${schedule.status || "-"} / ${schedule.cadence || "-"} / ${schedule.time_label || "-"}`,
    `- Next Run: ${schedule.next_run_at || "-"}`,
    "",
    "## Metrics",
    "",
    metrics,
    "",
    "## Audit Diff",
    "",
    `- Previous Report: ${diff.previous_report_id || "-"}`,
    `- Recommendation: ${diff.recommendation || "-"}`,
    `- Top Window: ${diff.top_window_shift?.previous_label || "-"} -> ${diff.top_window_shift?.current_label || "-"} (${diff.top_window_shift?.delta_label || "0"})`,
    "",
    diffMetrics,
    "",
    "## Policy Patch Queue",
    "",
    policyPatches,
    "",
    "## Audit Timeline",
    "",
    timeline,
    "",
    "## Next Actions",
    "",
    nextActions,
    "",
    "## Audit History",
    "",
    history,
    "",
    "## Safety Boundary",
    "",
    snapshot.judge?.safety_boundary || "系统只提供自愿的自我治理建议，不做医疗诊断，不替代专业帮助。",
    "",
  ].join("\n");
}

export function renderLifeReviewMarkdown(snapshot) {
  const report = snapshot.review_report || {};
  const weekly = report.weekly || {};
  const monthly = report.monthly || {};
  const triggerTable = markdownTable(
    ["Trigger", "Trace", "Incident", "Max Intensity"],
    (weekly.top_triggers || []).map((item) => [item.label, item.count, item.incidents, item.max_intensity])
  );
  const dailyTable = markdownTable(
    ["Report", "Status", "Incident/Resisted/Escalation", "Headline"],
    (report.daily_reports || []).map((item) => [
      item.report_id,
      item.status,
      `${item.incidents}/${item.resisted}/${item.escalations}`,
      item.headline,
    ])
  );

  return [
    `# ${report.title || "LifeOps Review Report"}`,
    "",
    `- Report: ${report.report_id || "-"}`,
    `- Generated: ${report.generated_at || snapshot.generated_at || "-"}`,
    `- Focus: ${snapshot.focus?.label || "-"}`,
    `- Verdict: ${report.verdict || "-"}`,
    `- Next Protocol: ${report.next_protocol || "-"}`,
    "",
    "## Cockpit",
    "",
    `- Risk: ${report.cockpit?.risk ?? "-"}`,
    `- Readiness: ${report.cockpit?.readiness ?? "-"}`,
    `- Survival: ${report.cockpit?.survival || "-"}`,
    `- Evidence Asset: ${report.cockpit?.evidence || "-"}`,
    "",
    "## Weekly",
    "",
    `- Grade: ${weekly.audit_grade || "-"}`,
    `- Trace: ${weekly.trace_count || 0}`,
    `- Incident: ${weekly.incident_count || 0}`,
    `- Resisted: ${weekly.resisted_count || 0}`,
    `- Evidence: ${weekly.evidence_count || 0}`,
    `- Clean Ratio: ${weekly.clean_ratio || 0}%`,
    "",
    triggerTable,
    "",
    "## Monthly",
    "",
    `- Grade: ${monthly.audit_grade || "-"}`,
    `- Trace: ${monthly.trace_count || 0}`,
    `- Incident: ${monthly.incident_count || 0}`,
    `- Interventions: ${monthly.intervention_count || 0}`,
    `- Anchors: ${monthly.anchor_count || 0}`,
    `- Evidence: ${monthly.evidence_count || 0}`,
    "",
    "## Intervention / Anchors",
    "",
    `- Intervention: ${report.intervention?.mode || "-"} / ${report.intervention?.cooldown || "-"}`,
    `- Anchor: ${report.anchors?.status || "-"} / ${report.anchors?.coverage ?? 0}/100 / ${report.anchors?.verified || 0}/${report.anchors?.total || 0}`,
    "",
    "## Recent Daily Reports",
    "",
    dailyTable,
    "",
    "## Safety Boundary",
    "",
    snapshot.judge?.safety_boundary || "系统只提供自愿的自我治理建议，不做医疗诊断，不替代专业帮助。",
    "",
  ].join("\n");
}

function traceRows(items) {
  return items.map((event) => [
    `<tr>`,
    `<td><code>${escapeHtml(String(event.occurred_at || "").replace("T", " ").slice(0, 16))}</code></td>`,
    `<td>${pill(outcomeLabel(event.outcome), event.outcome === "slipped" || event.outcome === "bypassed" ? "danger" : event.outcome === "resisted" ? "good" : "neutral")}</td>`,
    `<td>${escapeHtml(triggerLabel(event.trigger))}</td>`,
    `<td>${escapeHtml(event.intensity)}/5</td>`,
    `<td><code>${escapeHtml(event.taxonomy_code || "")}</code></td>`,
    `<td class="muted">${escapeHtml(event.note || "-")}</td>`,
    `</tr>`,
  ].join(""));
}

function drilldownHref(focus, hour) {
  return `/life-console?focus=${escapeHtml(focus.id)}&amp;hour=${escapeHtml(hour)}#risk-drilldown`;
}

function heatmapCells(heatmap = {}, focus, selectedHour) {
  return (heatmap.buckets || []).map((bucket) => [
    `<a class="heat-cell ${statusClass(bucket.tone)}${bucket.hour === selectedHour ? " selected" : ""}" href="${drilldownHref(focus, bucket.hour)}" title="${escapeHtml(`${bucket.label} / risk ${bucket.risk_score} / ${bucket.count} traces`)}" aria-label="${escapeHtml(`查看 ${bucket.label} 风险窗口`)}">`,
    `<span>${escapeHtml(String(bucket.hour).padStart(2, "0"))}</span>`,
    `<strong>${escapeHtml(bucket.risk_score || "")}</strong>`,
    `</a>`,
  ].join("")).join("");
}

function riskWindowRows(items = [], focus, selectedHour) {
  return items.map((item) => [
    `<tr>`,
    `<td><code>${escapeHtml(item.label)}</code></td>`,
    `<td>${pill(`${item.risk_score}/100`, item.tone)}</td>`,
    `<td>${escapeHtml(item.count)}</td>`,
    `<td>${escapeHtml(item.incidents)}</td>`,
    `<td>${escapeHtml(item.avg_intensity)}</td>`,
    `<td class="muted">${escapeHtml(item.evidence)}</td>`,
    `<td><a class="text-link${item.hour === selectedHour ? " active" : ""}" href="${drilldownHref(focus, item.hour)}">Drilldown</a></td>`,
    `</tr>`,
  ].join(""));
}

function drilldownStatCards(drilldown) {
  return [
    ["风险评分", `${drilldown.risk_score}/100`, drilldown.tone],
    ["Trace", drilldown.count, drilldown.count ? "warn" : "neutral"],
    ["Incident", drilldown.incidents, drilldown.incidents ? "danger" : "good"],
    ["均值强度", drilldown.avg_intensity, drilldown.avg_intensity >= 4 ? "danger" : drilldown.avg_intensity ? "warn" : "neutral"],
  ].map(([label, value, tone]) => [
    `<div class="score mini ${statusClass(tone)}">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(value)}</strong>`,
    `</div>`,
  ].join("")).join("");
}

function drilldownReplayRows(drilldown) {
  return (drilldown.replay_steps || []).map(([time, event, detail, tone]) => [
    `<tr>`,
    `<td><code>${escapeHtml(time)}</code></td>`,
    `<td>${pill(event, tone)}</td>`,
    `<td>${escapeHtml(detail)}</td>`,
    `</tr>`,
  ].join(""));
}

function drilldownReplayCards(drilldown) {
  return (drilldown.replay_steps || []).map(([time, event, detail, tone]) => [
    `<div class="replay-step ${statusClass(tone)}">`,
    `<code>${escapeHtml(time)}</code>`,
    `<div>`,
    `<strong>${escapeHtml(event)}</strong>`,
    `<span>${escapeHtml(detail)}</span>`,
    `</div>`,
    `</div>`,
  ].join("")).join("");
}

function drilldownActionForm(drilldown, focus) {
  const note = `启动干预: ${drilldown.recommendation} / window ${drilldown.label}`;
  const evidenceRef = `risk-window:${focus.id}:${drilldown.label}`;
  const started = ["in_progress", "evidence_attached", "resolved"].includes(drilldown.action_status);
  const attached = drilldown.action_status === "evidence_attached";
  return [
    `<div class="drilldown-action-stack">`,
    `<form class="drilldown-action-form" method="post" action="/life-console">`,
    `<input type="hidden" name="intent" value="action_event">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<input type="hidden" name="hour" value="${escapeHtml(drilldown.hour)}">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(drilldown.action_id)}">`,
    `<input type="hidden" name="blocker" value="${escapeHtml(drilldown.blocker)}">`,
    `<input type="hidden" name="from_status" value="${escapeHtml(drilldown.action_status || "pending")}">`,
    `<input type="hidden" name="to_status" value="in_progress">`,
    `<input type="hidden" name="evidence_ref" value="${escapeHtml(evidenceRef)}">`,
    `<input type="hidden" name="note" value="${escapeHtml(note)}">`,
    `<button type="submit">${escapeHtml(started ? "重新启动干预" : "启动干预任务")}</button>`,
    `<span>${pill(drilldown.action_status || "pending", drilldown.action_status || "pending")} <code>${escapeHtml(drilldown.action_id)}</code></span>`,
    `</form>`,
    `<form class="drilldown-evidence-form" method="post" action="/life-console">`,
    `<input type="hidden" name="intent" value="action_event">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<input type="hidden" name="hour" value="${escapeHtml(drilldown.hour)}">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(drilldown.action_id)}">`,
    `<input type="hidden" name="blocker" value="${escapeHtml(drilldown.blocker)}">`,
    `<input type="hidden" name="from_status" value="${escapeHtml(drilldown.action_status || "pending")}">`,
    `<input type="hidden" name="to_status" value="evidence_attached">`,
    `<label><span>证据引用</span><input name="evidence_ref" maxlength="180" value="${escapeHtml(attached ? drilldown.latest_evidence_ref : "")}" placeholder="photo://dock-001 / screen://limit-on"></label>`,
    `<label><span>执行备注</span><input name="note" maxlength="180" value="${escapeHtml(attached ? drilldown.latest_event_note : "")}" placeholder="例如：手机已放客厅充电，短视频入口已锁定"></label>`,
    `<button type="submit">提交证据</button>`,
    `</form>`,
    `</div>`,
  ].join("");
}

function trackingMetric(label, value, tone = "neutral") {
  return [
    `<div class="tracking-metric ${statusClass(tone)}">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(value)}</strong>`,
    `</div>`,
  ].join("");
}

function quickFollowupForms(drilldown, focus) {
  const baseTrigger = drilldown.likely_trigger || "other";
  const items = [
    ["resisted", "扛住", baseTrigger, 2, "good"],
    ["slipped", "失控", baseTrigger, 5, "danger"],
    ["bypassed", "绕过限制", "friction_bypass", 4, "warn"],
  ];

  return [
    `<div class="quick-followup">`,
    `<div><strong>快速 Follow-up Trace</strong><span>写入当前窗口，立即进入 3 天效果评估。</span></div>`,
    `<div class="quick-followup-actions">`,
    items.map(([outcome, label, trigger, intensity, tone]) => [
      `<form method="post" action="/life-console">`,
      `<input type="hidden" name="intent" value="trace">`,
      `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
      `<input type="hidden" name="hour" value="${escapeHtml(drilldown.hour)}">`,
      `<input type="hidden" name="trigger" value="${escapeHtml(trigger)}">`,
      `<input type="hidden" name="intensity" value="${escapeHtml(intensity)}">`,
      `<input type="hidden" name="occurred_at" value="">`,
      `<input type="hidden" name="note" value="${escapeHtml(`followup:${drilldown.action_id}:${drilldown.label}:${outcome}`)}">`,
      `<button class="${statusClass(tone)}" type="submit" name="outcome" value="${escapeHtml(outcome)}">${escapeHtml(label)}</button>`,
      `</form>`,
    ].join("")).join(""),
    `</div>`,
    `</div>`,
  ].join("");
}

function escalationReplayPanel(replay) {
  if (!replay?.steps?.length) return "";

  return [
    `<div class="escalation-replay">`,
    `<div class="escalation-replay-head">`,
    `<strong>Escalation Replay</strong>`,
    `${pill(replay.status, replay.status)}`,
    `</div>`,
    `<div class="replay-stack">`,
    replay.steps.map((step) => [
      `<div class="replay-step ${statusClass(step.tone)}">`,
      `<code>${escapeHtml(eventTimeLabel(step.time))}</code>`,
      `<div>`,
      `<strong>${escapeHtml(step.stage)}</strong>`,
      `<span>${escapeHtml(step.detail)}</span>`,
      `<small><code>${escapeHtml(step.evidence_ref)}</code></small>`,
      `</div>`,
      `</div>`,
    ].join("")).join(""),
    `</div>`,
    `</div>`,
  ].join("");
}

function escalationPanel(tracking, focus, hour) {
  const escalation = tracking?.escalation;
  if (!escalation) return "";

  return [
    `<div class="escalation-panel ${statusClass(escalation.severity)}">`,
    `<div class="escalation-head">`,
    `<div>`,
    `<strong>干预升级规则</strong>`,
    `<span>${escapeHtml(escalation.trigger)}</span>`,
    `</div>`,
    `${pill(escalation.level, escalation.severity)}`,
    `</div>`,
    `<p>${escapeHtml(escalation.action)}</p>`,
    `<div class="escalation-meta">`,
    `<span>依据 <code>${escapeHtml(escalation.rationale)}</code></span>`,
    `<span>证据 <code>${escapeHtml(escalation.evidence_ref)}</code></span>`,
    `</div>`,
    `<form class="escalation-form" method="post" action="/life-console">`,
    `<input type="hidden" name="intent" value="action_event">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<input type="hidden" name="hour" value="${escapeHtml(hour)}">`,
    `<input type="hidden" name="return_to" value="risk-drilldown">`,
    `<input type="hidden" name="action_id" value="${escapeHtml(escalation.action_id)}">`,
    `<input type="hidden" name="blocker" value="${escapeHtml(escalation.blocker)}">`,
    `<input type="hidden" name="from_status" value="pending">`,
    `<input type="hidden" name="to_status" value="in_progress">`,
    `<input type="hidden" name="evidence_ref" value="${escapeHtml(escalation.evidence_ref)}">`,
    `<input type="hidden" name="note" value="${escapeHtml(`${escalation.level}: ${escalation.action}`)}">`,
    `<button type="submit">启动升级动作</button>`,
    `</form>`,
    escalationReplayPanel(escalation.replay),
    `</div>`,
  ].join("");
}

function drilldownTrackingPanel(drilldown, focus) {
  const tracking = drilldown.action_tracking;
  if (!tracking) {
    return [
      `<div class="tracking-panel idle">`,
      `<div class="tracking-head">`,
      `<h3>3 天效果追踪</h3>`,
      `${pill("pending", "pending")}`,
      `</div>`,
      `<p class="muted">启动干预后，系统会用同一 blocker 的前 3 天 / 后 3 天 trace 自动判断是否真的降风险。</p>`,
      `<div class="tracking-metrics">`,
      trackingMetric("Window", "未启动", "neutral"),
      trackingMetric("Follow-up", "0 trace", "neutral"),
      trackingMetric("Evidence", drilldown.latest_evidence_ref || "-", drilldown.latest_evidence_ref ? "warn" : "neutral"),
      `</div>`,
      quickFollowupForms(drilldown, focus),
      `</div>`,
    ].join("");
  }

  const delta = `${tracking.risk_delta >= 0 ? "+" : ""}${tracking.risk_delta}`;
  const deltaTone = tracking.risk_delta > 0 ? "good" : tracking.risk_delta < 0 ? "danger" : "neutral";
  const beforeLabel = `${tracking.before.incidents} incident / ${tracking.before.resisted} resisted`;
  const afterLabel = `${tracking.after.incidents} incident / ${tracking.after.resisted} resisted`;
  const remainingLabel = tracking.window_state === "closed" ? "closed" : `${tracking.days_remaining ?? "-"}d left`;

  return [
    `<div class="tracking-panel">`,
    `<div class="tracking-head">`,
    `<div>`,
    `<h3>3 天效果追踪</h3>`,
    `<p class="muted"><code>${escapeHtml(eventTimeLabel(tracking.window_start))}</code> -> <code>${escapeHtml(eventTimeLabel(tracking.window_end))}</code></p>`,
    `</div>`,
    `${pill(tracking.evaluation_status, tracking.evaluation_status)}`,
    `</div>`,
    `<div class="tracking-metrics">`,
    trackingMetric("Before", beforeLabel, tracking.before.incidents ? "danger" : "neutral"),
    trackingMetric("After", afterLabel, tracking.after.incidents ? "danger" : tracking.after.resisted ? "good" : "neutral"),
    trackingMetric("Risk delta", delta, deltaTone),
    trackingMetric("Follow-up", `${tracking.followup_trace_count} trace / ${remainingLabel}`, tracking.followup_trace_count ? "warn" : "neutral"),
    `</div>`,
    `<p class="muted tracking-evidence">证据: <code>${escapeHtml(tracking.latest_evidence_ref || tracking.source_event_id)}</code>${tracking.latest_note ? ` / ${escapeHtml(tracking.latest_note)}` : ""}</p>`,
    escalationPanel(tracking, focus, drilldown.hour),
    quickFollowupForms(drilldown, focus),
    `</div>`,
  ].join("");
}

function traceIntakeForm(focus) {
  const triggerOptions = [
    ["late_night", "深夜"],
    ["lonely_after_work", "下班孤独"],
    ["stress", "压力"],
    ["sleep_debt", "睡眠债"],
    ["boredom", "无聊"],
    ["friction_bypass", "绕过限制"],
    ["algorithm_pull", "算法牵引"],
    ["other", "其他"],
  ];
  const outcomeOptions = [
    ["resisted", "扛住"],
    ["slipped", "失控"],
    ["bypassed", "绕过限制"],
    ["clean", "正常"],
  ];

  return [
    `<form class="trace-form" method="post" action="/life-console">`,
    `<input type="hidden" name="focus" value="${escapeHtml(focus.id)}">`,
    `<label><span>结果</span><select name="outcome">${outcomeOptions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}</select></label>`,
    `<label><span>触发源</span><select name="trigger">${triggerOptions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}</select></label>`,
    `<label><span>强度</span><input name="intensity" type="number" min="1" max="5" value="3"></label>`,
    `<label><span>时间</span><input name="occurred_at" type="datetime-local"></label>`,
    `<label class="wide"><span>证据备注</span><input name="note" maxlength="280" placeholder="例如：22:40 打开短视频，10 分钟后停下"></label>`,
    `<button type="submit">记录 Trace</button>`,
    `</form>`,
  ].join("");
}

function focusNav(activeFocus) {
  return Object.values(FOCUS_CONFIG).map((item) => {
    const active = item.id === activeFocus ? "active" : "";
    return `<a class="${active}" href="/life-console?focus=${escapeHtml(item.id)}">${escapeHtml(item.label)}</a>`;
  }).join("");
}

export function renderLifeConsoleHtml(snapshot) {
  const focus = snapshot.focus;
  const riskBadgeValue = !snapshot.summary?.total_events || snapshot.summary?.risk_score === null || snapshot.summary?.risk_score === undefined
    ? focus.primaryRiskValue
    : `${snapshot.summary.risk_score}%`;
  const uptimeBadgeValue = snapshot.metrics?.[1]?.value || "-";
  const dailyAuditMarkdown = renderLifeDailyAuditMarkdown(snapshot);
  const markdownHref = escapeHtml(lifeConsoleHref({
    focusId: focus.id,
    hour: snapshot.risk_drilldown?.hour ?? 23,
    auditDay: snapshot.daily_audit_selection?.selected_day,
    format: "markdown",
  }));
  const reviewMarkdownHref = escapeHtml(lifeConsoleHref({
    focusId: focus.id,
    hour: snapshot.risk_drilldown?.hour ?? 23,
    format: "review_markdown",
  }));

  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>${escapeHtml(focus.title)} - ${escapeHtml(focus.label)}</title>`,
    "<style>",
    ":root{--bg:#0b0f0f;--surface:#14191a;--surface2:#1b2223;--surface3:#20292a;--line:#2d3a3b;--line2:#3c4b4c;--ink:#f1f5f2;--muted:#95a39f;--cyan:#4fd2c4;--green:#72d083;--amber:#e6b752;--red:#f06b66;--violet:#b893ff;--blue:#7aa7ff;}",
    "*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:linear-gradient(180deg,#0b0f0f 0%,#101515 46%,#0b0f0f 100%);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;letter-spacing:0}",
    ".shell{display:grid;grid-template-columns:268px minmax(0,1fr);min-height:100vh;min-width:0}.side{border-right:1px solid var(--line);background:rgba(13,17,18,.94);padding:22px 18px;position:sticky;top:0;height:100vh;overflow:auto;box-shadow:inset -1px 0 0 rgba(255,255,255,.03)}.main{width:100%;max-width:1360px;margin:0 auto;padding:24px;min-width:0}",
    ".brand{font-size:18px;font-weight:760;margin:0 0 5px}.sub{margin:0 0 18px;color:var(--muted)}.status{display:grid;gap:10px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(180deg,#151b1c,#101415);padding:14px}.status code{display:inline-block;margin-top:4px}",
    ".focus-nav{display:grid;gap:8px;margin:18px 0}.focus-nav a,.nav a{color:var(--ink);text-decoration:none;border:1px solid var(--line);background:#151a1b;border-radius:8px;padding:9px 10px;transition:border-color .15s ease,background .15s ease,color .15s ease}.focus-nav a.active{border-color:var(--cyan);color:var(--cyan);background:#102322}.nav{display:grid;gap:8px;margin-top:18px}.nav a:hover,.focus-nav a:hover{border-color:var(--cyan);background:#182122}",
    ".topbar{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:16px}.topbar h1{font-size:25px;line-height:1.1;margin:0 0 6px}.topbar p{margin:0;color:var(--muted)}",
    ".hero-strip{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,400px);gap:18px;align-items:stretch;margin-bottom:16px;height:340px;border:1px solid var(--line2);border-radius:8px;overflow:hidden;background:linear-gradient(120deg,#182021 0%,#101516 56%,#18251f 100%);box-shadow:0 18px 52px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.04)}.hero-copy{padding:26px 24px 20px;align-self:center}.eyebrow{margin:0 0 10px;color:var(--cyan);font-size:12px;text-transform:uppercase;letter-spacing:0}.hero-copy h1{font-size:32px;line-height:1.08;margin:0 0 10px}.hero-copy p{max-width:680px;margin:0;color:#b4c0bc;font-size:15px}.hero-badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}",
    ".operator-visual{position:relative;display:flex;align-items:flex-end;justify-content:center;margin:0;min-height:0;height:100%;overflow:hidden;background:linear-gradient(180deg,rgba(79,210,196,.13),rgba(16,18,20,0) 55%),repeating-linear-gradient(90deg,rgba(238,243,241,.055) 0 1px,transparent 1px 42px),repeating-linear-gradient(0deg,rgba(238,243,241,.04) 0 1px,transparent 1px 38px)}.operator-visual:before{content:\"\";position:absolute;inset:18px;border:1px solid rgba(79,210,196,.18);border-radius:8px}.operator-visual:after{content:\"\";position:absolute;inset:auto 28px 22px 28px;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent)}.operator-visual img{position:relative;z-index:1;height:436px;width:auto;max-width:96%;object-fit:contain;object-position:bottom center;transform:translate(-34px,92px);filter:drop-shadow(0 22px 28px rgba(0,0,0,.42))}.operator-signal{position:absolute;z-index:2;right:16px;bottom:16px;border:1px solid rgba(79,210,196,.58);background:rgba(10,15,15,.86);border-radius:8px;padding:8px 10px;min-width:108px}.operator-signal span{display:block;color:var(--muted);font-size:11px}.operator-signal strong{display:block;color:var(--cyan);font-size:15px;line-height:1.2}",
    ".control-cockpit{border:1px solid var(--line2);border-radius:8px;background:linear-gradient(180deg,#161d1e,#0e1314);padding:16px;margin-bottom:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}.cockpit-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}.cockpit-head h2{font-size:18px;margin:0 0 4px}.cockpit-head p{margin:0}.cockpit-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.cockpit-dial{position:relative;border:1px solid var(--line);border-radius:8px;background:#101516;padding:13px;min-height:126px;overflow:hidden}.cockpit-dial.primary{grid-column:span 2;min-height:152px;background:linear-gradient(180deg,#171e1f,#101415)}.cockpit-dial span{display:block;color:var(--muted);font-size:12px;margin-bottom:9px}.cockpit-dial strong{display:block;font-size:26px;line-height:1.02;margin-bottom:9px;overflow-wrap:anywhere}.cockpit-dial.primary strong{font-size:46px}.cockpit-dial small{display:block;color:#aeb9b5;line-height:1.35}.cockpit-dial.good{border-color:#3f6d51}.cockpit-dial.warn{border-color:#806530}.cockpit-dial.danger{border-color:#884141;box-shadow:inset 0 0 0 1px rgba(240,107,102,.12)}.sleep-debt-warning{display:grid;grid-template-columns:minmax(220px,.34fr) minmax(0,1fr);align-items:center;gap:14px;border:1px solid var(--line);border-radius:8px;background:#101516;padding:12px;margin-top:10px}.sleep-debt-warning.danger{border-color:#884141;background:#1a1111}.sleep-debt-warning.warn{border-color:#806530;background:#17140e}.sleep-debt-warning.good{border-color:#3f6d51;background:#101914}.sleep-debt-copy span,.sleep-debt-copy small{display:block;color:var(--muted)}.sleep-debt-copy strong{display:block;font-size:24px;line-height:1.1;margin:4px 0}.sleep-bar{height:14px;border:1px solid var(--line2);border-radius:999px;background:#0b0f10;overflow:hidden}.sleep-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--green),var(--amber),var(--red))}.cockpit-equation{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;color:var(--muted)}.cockpit-equation code{color:#d8f7ef}.cockpit-equation span{min-width:240px;flex:1}",
    ".intervention-layer{border:1px solid var(--line2);border-radius:8px;background:linear-gradient(180deg,#171717,#101314);padding:16px;margin-bottom:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}.intervention-layer.danger{border-color:#824040;background:linear-gradient(180deg,#1a1212,#101314)}.intervention-layer.warn{border-color:#765f31}.intervention-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}.intervention-head h2{font-size:22px;margin:0 0 4px;color:var(--ink)}.intervention-head p{margin:0}.intervention-command{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}.intervention-command div{border:1px solid var(--line);border-radius:8px;background:#101516;padding:10px}.intervention-command span{display:block;color:var(--muted);font-size:12px;margin-bottom:5px}.intervention-command strong{display:block;font-size:20px;line-height:1.15;overflow-wrap:anywhere}.cost-contract{border:1px solid #824040;border-radius:8px;background:#211313;color:#ffc7c3;padding:10px;margin-bottom:10px}.intervention-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.intervention-card{border:1px solid var(--line);border-radius:8px;background:#101516;padding:12px;min-width:0}.intervention-card.danger{border-color:#884141;background:#171111}.intervention-card.warn{border-color:#806530;background:#17140e}.intervention-card.good{border-color:#3f6d51;background:#101914}.intervention-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px}.intervention-card-head span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase}.intervention-card-head strong{display:block;font-size:15px;line-height:1.2}.intervention-card p{margin:0 0 10px;color:#d9e1de}.intervention-meta{display:grid;gap:6px;color:var(--muted);font-size:12px;margin-bottom:10px}.intervention-form,.intervention-evidence-form{display:grid;gap:7px;margin-top:8px}.intervention-form button,.intervention-evidence-form button{border:1px solid var(--red);border-radius:6px;background:#241415;color:var(--red);padding:8px 10px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer}.intervention-form button:hover,.intervention-evidence-form button:hover{border-color:var(--cyan);color:var(--cyan);background:#10201f}.intervention-evidence-form input{width:100%;min-width:0;border:1px solid var(--line);border-radius:6px;background:#0e1314;color:var(--ink);padding:7px 8px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}",
    ".device-anchor-layer{border:1px solid var(--line2);border-radius:8px;background:linear-gradient(180deg,#151a1b,#101415);padding:16px;margin-bottom:14px}.device-anchor-layer.danger{border-color:#824040;background:linear-gradient(180deg,#191313,#101415)}.device-anchor-layer.warn{border-color:#765f31}.anchor-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}.anchor-head h2{font-size:18px;margin:0 0 4px}.anchor-head p{margin:0}.anchor-score{display:grid;grid-template-columns:90px 92px minmax(0,1fr);align-items:center;gap:10px;border:1px solid var(--line);border-radius:8px;background:#101516;padding:10px;margin-bottom:10px}.anchor-score span{color:var(--muted)}.anchor-score strong{font-size:20px}.anchor-bar{height:12px;border:1px solid var(--line2);border-radius:999px;background:#0b0f10;overflow:hidden}.anchor-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--red),var(--amber),var(--green))}.anchor-form{display:grid;gap:6px;min-width:230px}.anchor-form input{width:100%;min-width:0;border:1px solid var(--line);border-radius:6px;background:#0e1314;color:var(--ink);padding:7px 8px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}.anchor-form button{border:1px solid var(--cyan);border-radius:6px;background:#10201f;color:var(--cyan);padding:7px 9px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer}.anchor-form button:hover{background:#12302e}",
    ".review-report{border:1px solid var(--line2);border-radius:8px;background:linear-gradient(180deg,#151b1c,#101415);padding:16px;margin-bottom:14px}.review-report.danger{border-color:#824040;background:linear-gradient(180deg,#1a1212,#101415)}.review-report.warn{border-color:#765f31}.review-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}.review-head h2{font-size:18px;margin:0 0 4px}.review-head p{margin:0}.review-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}.review-metric{border:1px solid var(--line);border-radius:8px;background:#101516;padding:10px;min-height:88px}.review-metric span,.review-metric small{display:block;color:var(--muted)}.review-metric strong{display:block;font-size:22px;margin:5px 0}.review-metric.good{border-color:#3f6d51}.review-metric.warn{border-color:#806530}.review-metric.danger{border-color:#884141}.review-verdict{border:1px solid var(--line);border-radius:8px;background:#0f1415;padding:12px;margin-bottom:10px}.review-verdict strong,.review-verdict span{display:block}.review-verdict span{color:var(--muted);margin-top:5px}.review-grid{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:12px}.review-export{display:flex;justify-content:flex-end;margin-top:10px}.review-export a{color:var(--cyan);text-decoration:none;border:1px solid var(--cyan);border-radius:6px;padding:7px 9px;font-size:12px;background:#10201f}",
    ".operator-rank{border:1px solid var(--line2);border-radius:8px;background:linear-gradient(180deg,#151b1c,#101415);padding:16px;margin-bottom:14px}.operator-rank.danger{border-color:#824040;background:linear-gradient(180deg,#1a1212,#101415)}.operator-rank.warn{border-color:#765f31}.operator-rank.good{border-color:#3f6d51}.rank-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}.rank-head h2{font-size:18px;margin:0 0 4px}.rank-head p{margin:0}.rank-hero{display:grid;grid-template-columns:120px 180px minmax(0,1fr);gap:8px;margin-bottom:10px}.rank-hero div{border:1px solid var(--line);border-radius:8px;background:#101516;padding:10px}.rank-hero span{display:block;color:var(--muted);font-size:12px;margin-bottom:5px}.rank-hero strong{display:block;font-size:18px;line-height:1.22;overflow-wrap:anywhere}.rank-hero div:first-child strong{font-size:32px}.rank-progress{height:12px;border:1px solid var(--line2);border-radius:999px;background:#0b0f10;overflow:hidden;margin-bottom:10px}.rank-progress i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--red),var(--amber),var(--green),var(--cyan))}.rank-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}.rank-dimension,.rank-badge{border:1px solid var(--line);border-radius:8px;background:#101516;padding:10px;min-height:82px}.rank-dimension span,.rank-dimension small,.rank-badge span,.rank-badge small{display:block;color:var(--muted)}.rank-dimension strong,.rank-badge strong{display:block;margin:5px 0;font-size:18px}.rank-dimension.good,.rank-badge.good{border-color:#3f6d51}.rank-dimension.warn,.rank-badge.warn{border-color:#806530}.rank-dimension.danger,.rank-badge.danger{border-color:#884141}.rank-badges{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}",
    ".mission-chain{border:1px solid var(--line2);border-radius:8px;background:linear-gradient(180deg,#151b1c,#101415);padding:16px;margin-bottom:14px}.mission-chain.danger{border-color:#824040;background:linear-gradient(180deg,#1a1212,#101415)}.mission-chain.warn{border-color:#765f31}.mission-chain.good{border-color:#3f6d51}.mission-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}.mission-head h2{font-size:18px;margin:0 0 4px}.mission-head p{margin:0}.mission-summary{display:grid;grid-template-columns:minmax(0,1fr) 120px 120px;gap:8px;margin-bottom:10px}.mission-summary div{border:1px solid var(--line);border-radius:8px;background:#101516;padding:10px}.mission-summary span{display:block;color:var(--muted);font-size:12px;margin-bottom:5px}.mission-summary strong{display:block;font-size:18px;line-height:1.22}.mission-progress{height:12px;border:1px solid var(--line2);border-radius:999px;background:#0b0f10;overflow:hidden;margin-bottom:10px}.mission-progress i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--red),var(--amber),var(--green),var(--cyan))}.mission-list{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.mission-card{border:1px solid var(--line);border-radius:8px;background:#101516;padding:12px;min-width:0}.mission-card.danger{border-color:#884141;background:#171111}.mission-card.warn{border-color:#806530;background:#17140e}.mission-card.good{border-color:#3f6d51;background:#101914}.mission-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px}.mission-card-head span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase}.mission-card-head strong{display:block;font-size:15px;line-height:1.22}.mission-card p{margin:0 0 10px;color:#d9e1de}.mission-meta{display:grid;gap:6px;color:var(--muted);font-size:12px;margin-bottom:10px}.mission-actions{display:grid;gap:7px}.mission-form{display:grid;gap:6px}.mission-form input{width:100%;min-width:0;border:1px solid var(--line);border-radius:6px;background:#0e1314;color:var(--ink);padding:7px 8px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}.mission-form button{border:1px solid var(--cyan);border-radius:6px;background:#10201f;color:var(--cyan);padding:7px 9px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer}.mission-form button:hover{background:#12302e}",
    ".grid{display:grid;gap:14px}.grid>*{min-width:0}.metrics{grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px}.two{grid-template-columns:minmax(0,1.2fr) minmax(330px,.8fr)}.three{grid-template-columns:repeat(3,minmax(0,1fr))}",
    ".panel{border:1px solid var(--line);border-radius:8px;background:linear-gradient(180deg,#151b1c,#111617);padding:16px;min-width:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}.panel+.panel{margin-top:14px}h2{font-size:17px;margin:0 0 12px}h3{font-size:14px;margin:14px 0 8px;color:var(--muted)}",
    ".metric{position:relative;border:1px solid var(--line);border-left:4px solid var(--cyan);border-radius:8px;background:linear-gradient(180deg,#171d1f,#111617);padding:14px;min-height:108px;overflow:hidden}.metric:after{content:\"\";position:absolute;right:12px;top:12px;width:34px;height:1px;background:var(--line2)}.metric span,.muted{color:var(--muted)}.metric strong{display:block;font-size:28px;line-height:1.1;margin:10px 0}.metric small{color:#aeb9b5}.metric.good{border-left-color:var(--green)}.metric.warn{border-left-color:var(--amber)}.metric.danger{border-left-color:var(--red)}",
    ".readiness{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.score{border:1px solid var(--line);border-radius:8px;background:#121619;padding:12px;min-height:82px}.score span{display:block;color:var(--muted);margin-bottom:8px}.score strong{font-size:24px}.score.mini{min-height:76px}.score.mini.good{border-color:#467d55}.score.mini.warn{border-color:#826831}.score.mini.danger{border-color:#8a3e3e}",
    ".pill{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;background:#151a1d;color:var(--ink);padding:2px 8px;font-size:12px;max-width:100%;line-height:1.35}.table-wrap .pill{white-space:nowrap}.pill.good{border-color:#467d55;color:var(--green);background:#132117}.pill.warn{border-color:#826831;color:var(--amber);background:#221d12}.pill.danger{border-color:#8a3e3e;color:var(--red);background:#241415}.pill.neutral{color:var(--muted)}",
    ".judge{border-left:4px solid var(--violet)}.judge p{margin:0 0 10px}.asset-row{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding:8px 0}.asset-row:last-child{border-bottom:0}.asset-row span{color:var(--muted)}",
    ".trace-form{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:10px;align-items:end}.trace-form label{display:grid;gap:5px;color:var(--muted)}.trace-form label.wide{grid-column:span 2}.trace-form select,.trace-form input{width:100%;min-width:0;border:1px solid var(--line);border-radius:6px;background:#101416;color:var(--ink);padding:8px 9px;font:13px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}.trace-form button,.drilldown-action-form button,.drilldown-evidence-form button{border:1px solid var(--cyan);border-radius:6px;background:#10201f;color:var(--cyan);padding:9px 11px;font:13px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer}.trace-form button:hover,.drilldown-action-form button:hover,.drilldown-evidence-form button:hover{background:#12302e}.flash{margin-bottom:14px;border-color:#467d55;background:#132117;color:var(--green)}",
    ".drilldown-action-stack{display:grid;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}.drilldown-action-form{display:grid;gap:8px}.drilldown-action-form span{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--muted)}.drilldown-evidence-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end;border:1px solid var(--line);border-radius:8px;background:#0d1213;padding:10px}.drilldown-evidence-form label{display:grid;gap:5px;color:var(--muted);font-size:12px}.drilldown-evidence-form input{width:100%;min-width:0;border:1px solid var(--line);border-radius:6px;background:#101416;color:var(--ink);padding:8px 9px;font:13px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}",
    ".action-state-form{display:grid;gap:6px;min-width:260px}.action-state-form input{width:100%;min-width:0;border:1px solid var(--line);border-radius:6px;background:#101416;color:var(--ink);padding:6px 8px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}.button-row{display:flex;gap:6px;flex-wrap:wrap}.button-row button{border:1px solid var(--line);border-radius:6px;background:#151a1d;color:var(--ink);padding:5px 8px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer}.button-row button:hover{border-color:var(--cyan);color:var(--cyan)}",
    ".table-wrap{overflow:auto;border:1px solid var(--line);border-radius:8px;min-width:0}table{width:100%;min-width:760px;border-collapse:collapse;background:#121718}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:10px 11px}tr:last-child td{border-bottom:0}tr.selected-row td{background:#132021;box-shadow:inset 3px 0 0 var(--cyan)}th{font-size:12px;color:var(--muted);background:#1a2021;text-transform:uppercase}code{background:#0d1112;border:1px solid var(--line);border-radius:4px;color:#d8f7ef;padding:1px 4px;font-size:12px}.empty{color:var(--muted);margin:0}.text-link{color:var(--cyan);text-decoration:none}.text-link:hover,.text-link.active{text-decoration:underline}",
    ".daily-audit-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}.daily-audit-head p{margin:4px 0 0}.audit-selected{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}.audit-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-bottom:12px}.audit-metric{border:1px solid var(--line);border-radius:8px;background:#101516;padding:10px;min-height:68px}.audit-metric span{display:block;color:var(--muted);font-size:12px;margin-bottom:7px}.audit-metric strong{font-size:20px}.audit-metric.good{border-color:#3f6d51}.audit-metric.warn{border-color:#806530}.audit-metric.danger{border-color:#884141}.audit-diff,.policy-patches{border:1px solid var(--line);border-radius:8px;background:#0f1415;padding:12px;margin-bottom:12px}.audit-diff-head,.policy-patch-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}.audit-diff-head h3,.policy-patch-head h3{margin:0;color:var(--ink)}.audit-diff-head p,.policy-patch-head p{margin:4px 0 0}.audit-diff-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}.audit-diff-card{border:1px solid var(--line);border-radius:8px;background:#101516;padding:10px;min-height:84px;min-width:0}.audit-diff-card span,.audit-diff-card small{display:block;color:var(--muted);font-size:12px}.audit-diff-card strong{display:block;margin:7px 0 5px;font-size:16px;line-height:1.25;overflow-wrap:anywhere}.audit-diff-card.good{border-color:#3f6d51}.audit-diff-card.warn{border-color:#806530}.audit-diff-card.danger{border-color:#884141}.policy-patches table{min-width:1120px}.patch-apply-form button{border:1px solid var(--cyan);border-radius:6px;background:#10201f;color:var(--cyan);padding:7px 9px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer;white-space:nowrap}.patch-apply-form button:hover{background:#12302e}.patch-tracking{display:grid;gap:5px;min-width:170px}.patch-tracking code{width:max-content}.audit-split,.audit-history-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);gap:12px}.audit-split h3,.audit-history-grid h3{margin-top:0}.audit-schedule{border:1px solid var(--line);border-radius:8px;background:#101516;padding:12px}.schedule-row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:7px 0}.schedule-row:first-child{padding-top:0}.schedule-row:last-child{border-bottom:0;padding-bottom:0}.schedule-row span{color:var(--muted)}.schedule-row strong{text-align:right}.audit-export{margin-top:12px;border:1px solid var(--line);border-radius:8px;background:#0f1415;padding:12px}.audit-export-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}.audit-export-head strong{display:block}.audit-export-head a{color:var(--cyan);text-decoration:none;border:1px solid var(--cyan);border-radius:6px;padding:7px 9px;font-size:12px;background:#10201f}.audit-export textarea{width:100%;min-height:220px;resize:vertical;border:1px solid var(--line);border-radius:6px;background:#0b0f10;color:#d8f7ef;padding:10px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
    ".heatmap-scroll{overflow:auto;border:1px solid var(--line);border-radius:8px;background:#101516}.heatmap-grid{display:grid;grid-template-columns:repeat(24,minmax(26px,1fr));gap:5px;min-width:760px;padding:11px}.heat-cell{height:74px;border:1px solid var(--line);border-radius:6px;background:#0f1415;color:#64716d;text-decoration:none;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:7px 4px;text-align:center;transition:transform .12s ease,border-color .12s ease,background .12s ease}.heat-cell span{font-size:11px}.heat-cell strong{font-size:13px;line-height:1}.heat-cell:hover{transform:translateY(-1px)}.heat-cell:hover,.heat-cell.selected{outline:2px solid var(--cyan);outline-offset:1px}.heat-cell.good{border-color:#3f6d51;background:#102018;color:var(--green)}.heat-cell.warn{border-color:#8c6d2d;background:#241d10;color:var(--amber)}.heat-cell.danger{border-color:#944242;background:#261313;color:var(--red)}.drilldown-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}.drilldown-head p{margin:0}.drilldown-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:14px}.drilldown-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}.drilldown-callout{border:1px solid var(--line);border-left:4px solid var(--cyan);border-radius:8px;background:#101516;padding:14px}.drilldown-callout p{margin:0 0 12px}.drilldown-callout p:last-child{margin-bottom:0}.tracking-panel{margin-top:14px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(180deg,#111819,#0e1314);padding:14px}.tracking-panel.idle{border-style:dashed}.tracking-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}.tracking-head h3{margin:0;color:var(--ink)}.tracking-head p{margin:4px 0 0}.tracking-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.tracking-metric{border:1px solid var(--line);border-radius:8px;background:#101516;padding:10px;min-height:70px}.tracking-metric span{display:block;color:var(--muted);font-size:12px;margin-bottom:7px}.tracking-metric strong{font-size:15px;line-height:1.25}.tracking-metric.good{border-color:#3f6d51}.tracking-metric.warn{border-color:#806530}.tracking-metric.danger{border-color:#884141}.tracking-evidence{margin:10px 0 0}.escalation-panel{margin-top:12px;border:1px solid var(--line);border-left:4px solid var(--amber);border-radius:8px;background:#14130f;padding:12px}.escalation-panel.danger{border-left-color:var(--red);background:#1a1111}.escalation-panel.warn{border-left-color:var(--amber)}.escalation-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.escalation-head strong{display:block}.escalation-head span{display:block;color:var(--muted);font-size:12px;margin-top:2px}.escalation-panel p{margin:10px 0;color:var(--ink)}.escalation-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;color:var(--muted);font-size:12px}.escalation-form{margin-top:10px}.escalation-form button{border:1px solid var(--red);border-radius:6px;background:#241415;color:var(--red);padding:8px 10px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer}.escalation-form button:hover{border-color:var(--cyan);color:var(--cyan);background:#10201f}.quick-followup{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;border-top:1px solid var(--line);padding-top:12px}.quick-followup strong{display:block}.quick-followup span{display:block;color:var(--muted);font-size:12px;margin-top:2px}.quick-followup-actions{display:flex;gap:7px;flex-wrap:wrap}.quick-followup-actions form{margin:0}.quick-followup-actions button{border:1px solid var(--line);border-radius:6px;background:#151a1d;color:var(--ink);padding:8px 10px;font:12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer;min-width:72px}.quick-followup-actions button.good{border-color:#467d55;color:var(--green);background:#132117}.quick-followup-actions button.warn{border-color:#826831;color:var(--amber);background:#221d12}.quick-followup-actions button.danger{border-color:#8a3e3e;color:var(--red);background:#241415}.quick-followup-actions button:hover{border-color:var(--cyan);color:var(--cyan)}.replay-stack{display:grid;gap:8px}.replay-step{display:grid;grid-template-columns:92px minmax(0,1fr);gap:10px;border:1px solid var(--line);border-radius:8px;background:#101516;padding:10px}.replay-step strong{display:block;margin-bottom:3px}.replay-step span{display:block;color:var(--muted)}.replay-step.good{border-color:#3f6d51}.replay-step.warn{border-color:#806530}.replay-step.danger{border-color:#884141}",
    ".escalation-replay{margin-top:12px;border-top:1px solid var(--line);padding-top:12px}.escalation-replay-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}.escalation-replay .replay-step{background:#0f1412}.escalation-replay .replay-step small{display:block;margin-top:5px;color:var(--muted)}",
    ".footer-note{margin-top:16px;color:var(--muted);font-size:12px}.section-space{margin-top:14px}",
    "@media(max-width:1320px) and (min-width:1101px){.audit-diff-cards,.audit-split,.audit-history-grid{grid-template-columns:1fr}.audit-diff table{min-width:640px}.audit-split table,.audit-history-grid table{min-width:720px}}",
    "@media(max-width:1100px){.shell{grid-template-columns:1fr}.side{position:relative;height:auto}.main{padding:16px}.topbar{display:block}.hero-strip{grid-template-columns:1fr;height:auto}.hero-copy{padding:18px}.hero-copy h1{font-size:26px}.operator-visual{height:300px}.operator-visual img{height:368px;width:auto;max-width:88%;transform:translate(-12px,78px)}.cockpit-head,.intervention-head,.anchor-head,.review-head,.rank-head,.mission-head{display:block}.cockpit-head .pill,.intervention-head .pill,.anchor-head .pill,.review-head .pill,.rank-head .pill,.mission-head .pill{margin-top:8px}.cockpit-grid,.sleep-debt-warning,.intervention-command,.intervention-actions,.anchor-score,.review-metrics,.review-grid,.rank-hero,.rank-grid,.rank-badges,.mission-summary,.mission-list,.two,.three,.readiness,.trace-form,.drilldown-grid,.drilldown-summary,.drilldown-evidence-form,.tracking-metrics,.escalation-meta,.audit-metrics,.audit-diff-cards,.audit-split,.audit-history-grid{grid-template-columns:1fr}.cockpit-dial.primary{grid-column:auto}.cockpit-dial.primary strong{font-size:38px}.daily-audit-head,.audit-diff-head,.policy-patch-head,.audit-export-head{display:block}.audit-export-head a{display:inline-block;margin-top:8px}.quick-followup{display:block}.quick-followup-actions{margin-top:10px}.trace-form label.wide{grid-column:auto}.metrics{grid-template-columns:1fr}table{min-width:680px}}",
    "</style>",
    "</head>",
    "<body>",
    "<div class=\"shell\">",
    "<aside class=\"side\">",
    `<p class="brand">${escapeHtml(focus.title)}</p>`,
    `<p class="sub">${escapeHtml(focus.subtitle)}</p>`,
    "<section class=\"status\">",
    `<div><span class="muted">Profile</span><br><code>${escapeHtml(snapshot.profile_id)}</code></div>`,
    `<div><span class="muted">Focus</span><br>${pill(focus.label, "neutral")}</div>`,
    `<div><span class="muted">Gate</span><br>${pill(snapshot.status.label, snapshot.status.tone)}</div>`,
    `<div><span class="muted">Generated</span><br><code>${escapeHtml(snapshot.generated_at)}</code></div>`,
    "</section>",
    `<nav class="focus-nav">${focusNav(focus.id)}</nav>`,
    "<nav class=\"nav\">",
    "<a href=\"#overview\">状态总览</a>",
    "<a href=\"#core-cockpit\">核心驾驶舱</a>",
    "<a href=\"#intervention-layer\">即时干预</a>",
    "<a href=\"#device-anchor\">防作弊锚点</a>",
    "<a href=\"#review-report\">周月复盘</a>",
    "<a href=\"#operator-rank\">身份等级</a>",
    "<a href=\"#mission-chain\">任务链</a>",
    "<a href=\"#daily-audit\">审计日报</a>",
    "<a href=\"#risk-heatmap\">风险热力图</a>",
    "<a href=\"#risk-drilldown\">窗口 Drilldown</a>",
    "<a href=\"#intake\">记录 Trace</a>",
    "<a href=\"#traces\">Trace Log</a>",
    "<a href=\"#gate\">自主门禁</a>",
    "<a href=\"#replay\">失控 Replay</a>",
    "<a href=\"#taxonomy\">失败 Taxonomy</a>",
    "<a href=\"#policy\">策略 Dry-run</a>",
    "<a href=\"#actions\">行动队列</a>",
    "<a href=\"#action-events\">行动事件</a>",
    "<a href=\"#action-effectiveness\">行动效果</a>",
    "<a href=\"#eval\">Eval 覆盖</a>",
    "<a href=\"#audit\">审计证据</a>",
    "</nav>",
    "</aside>",
    "<main class=\"main\">",
    "<header class=\"hero-strip\" id=\"overview\">",
    "<div class=\"hero-copy\">",
    "<p class=\"eyebrow\">Human Runtime / Risk Gate</p>",
    `<h1>${escapeHtml(focus.label)} 控制台</h1>`,
    `<p>不是打卡 APP，是把人的冲动、失控、证据、门禁和复盘做成一套可审计的运行系统。</p>`,
    "<div class=\"hero-badges\">",
    `${pill(snapshot.status.label, snapshot.status.tone)}`,
    `${pill(`Risk ${riskBadgeValue}`, snapshot.status.tone)}`,
    `${pill(`Uptime ${uptimeBadgeValue}`, "good")}`,
    "</div>",
    "</div>",
    "<figure class=\"operator-visual\" aria-label=\"阳光健康男性 LifeOps 操作员\">",
    "<img src=\"/lifeops/healthy-operator.png\" alt=\"阳光健康男性 LifeOps 操作员\">",
    "<div class=\"operator-signal\"><span>OPERATOR</span><strong>READY</strong></div>",
    "</figure>",
    "</header>",
    snapshot.recorded ? "<section class=\"panel flash\">Trace 已写入本地审计日志，评分已重新计算。</section>" : "",
    snapshot.action_recorded ? "<section class=\"panel flash\">行动状态已写入本地审计日志。</section>" : "",
    renderControlCockpit(snapshot.control_cockpit || {}),
    renderInterventionLayer(snapshot.intervention_layer || {}, focus, snapshot.risk_drilldown?.hour ?? ""),
    renderDeviceAnchorLayer(snapshot.device_anchor_layer || {}, focus, snapshot.risk_drilldown?.hour ?? ""),
    renderReviewReportPanel(snapshot.review_report || {}),
    renderOperatorRankPanel(snapshot.operator_rank || {}),
    renderMissionChainPanel(snapshot.mission_chain || {}, focus, snapshot.risk_drilldown?.hour ?? ""),
    `<div class="review-export"><a href="${reviewMarkdownHref}" download="lifeops-review-report.md">下载复盘 Markdown</a></div>`,
    `<section class="grid metrics">${snapshot.metrics.map(metricCard).join("")}</section>`,
    "<section class=\"panel\" id=\"daily-audit\">",
    "<div class=\"daily-audit-head\">",
    "<div>",
    "<h2>LifeOps Daily Audit</h2>",
    `<p class="muted">${escapeHtml(snapshot.daily_audit.window_label)} / ${escapeHtml(snapshot.daily_audit.headline)}</p>`,
    `<p class="audit-selected"><code>${escapeHtml(snapshot.daily_audit.report_id || "-")}</code>${pill(snapshot.daily_audit_selection?.is_historical ? "historical replay" : "current report", snapshot.daily_audit_selection?.is_historical ? "warn" : "good")}</p>`,
    "</div>",
    `${pill(snapshot.daily_audit.status, snapshot.daily_audit.tone)}`,
    "</div>",
    `<div class="audit-metrics">${dailyAuditMetricCards(snapshot.daily_audit.metrics || [])}</div>`,
    "<div class=\"audit-diff\">",
    "<div class=\"audit-diff-head\">",
    "<div>",
    "<h3>日报 Diff</h3>",
    `<p class="muted">${escapeHtml(snapshot.daily_audit_diff?.headline || "")}</p>`,
    "</div>",
    `${pill(snapshot.daily_audit_diff?.verdict || "stable", snapshot.daily_audit_diff?.tone || "neutral")}`,
    "</div>",
    `<div class="audit-diff-cards">${dailyAuditDiffCards(snapshot.daily_audit_diff || {})}</div>`,
    table(["指标", "当前", "前一日", "Delta", "判断"], dailyAuditDiffRows(snapshot.daily_audit_diff?.metrics || []), "暂无日报对比"),
    `<p class="footer-note">${escapeHtml(snapshot.daily_audit_diff?.recommendation || "")}</p>`,
    "</div>",
    "<div class=\"policy-patches\">",
    "<div class=\"policy-patch-head\">",
    "<div>",
    "<h3>Policy Patch Queue</h3>",
    "<p class=\"muted\">AI Judge 只生成策略草案；执行前仍需要人工确认。</p>",
    "</div>",
    `${pill(`${snapshot.daily_audit_policy_patches?.length || 0} proposed`, snapshot.daily_audit_policy_patches?.some((item) => item.priority === "P0") ? "danger" : "warn")}`,
    "</div>",
    table(
      ["优先级", "Patch", "类型", "目标", "变更", "依据", "验证信号", "执行"],
      policyPatchRows(snapshot.daily_audit_policy_patches || [], focus, snapshot.daily_audit_selection || {}, snapshot.risk_drilldown?.hour ?? ""),
      "暂无策略提案"
    ),
    "</div>",
    "<div class=\"audit-split\">",
    "<div>",
    "<h3>审计时间线</h3>",
    table(["时间", "事件", "说明", "证据"], dailyAuditTimelineRows(snapshot.daily_audit.timeline || []), "暂无日报事件"),
    "</div>",
    "<div>",
    "<h3>下一步动作</h3>",
    table(["Action", "状态", "严重度", "动作", "Blocker"], dailyAuditActionRows(snapshot.daily_audit.next_actions || []), "暂无待处理动作"),
    "</div>",
    "</div>",
    "<div class=\"audit-history-grid section-space\">",
    "<div>",
    "<h3>历史日报</h3>",
    table(["Report", "生成时间", "状态", "Incident/Resisted/Escalation", "摘要"], dailyAuditHistoryRows(snapshot.daily_audit_history || []), "暂无历史日报"),
    "</div>",
    "<div class=\"audit-schedule\">",
    "<h3>日报订阅</h3>",
    dailyAuditScheduleRows(snapshot.daily_audit_schedule || {}),
    `<p class="footer-note">${escapeHtml(snapshot.daily_audit_schedule?.prompt || "")}</p>`,
    "</div>",
    "</div>",
    "<div class=\"audit-export\">",
    "<div class=\"audit-export-head\">",
    "<strong>Markdown 审计报告</strong>",
    `<a href="${markdownHref}" download="lifeops-daily-audit.md">下载 Markdown</a>`,
    "</div>",
    `<textarea readonly rows="12">${escapeHtml(dailyAuditMarkdown)}</textarea>`,
    "</div>",
    "</section>",
    "<section class=\"grid two section-space\">",
    "<div class=\"panel\" id=\"risk-heatmap\">",
    "<h2>风险热力图</h2>",
    `<div class="heatmap-scroll"><div class="heatmap-grid">${heatmapCells(snapshot.risk_heatmap, focus, snapshot.risk_drilldown?.hour)}</div></div>`,
    "<p class=\"footer-note\">点击任意小时进入 Drilldown；24 小时风险分布会从本地 trace 动态重算。</p>",
    "</div>",
    "<div class=\"panel\">",
    "<h2>高风险窗口</h2>",
    table(["窗口", "风险", "Trace", "Incident", "均值强度", "证据", "操作"], riskWindowRows(snapshot.risk_heatmap?.windows || [], focus, snapshot.risk_drilldown?.hour)),
    "</div>",
    "</section>",
    "<section class=\"panel\" id=\"risk-drilldown\">",
    "<div class=\"drilldown-head\">",
    "<div>",
    `<h2>风险窗口 Drilldown: ${escapeHtml(snapshot.risk_drilldown.title)}</h2>`,
    `<p class="muted">${escapeHtml(snapshot.risk_drilldown.evidence_summary)} / confidence ${escapeHtml(snapshot.risk_drilldown.confidence)}${snapshot.risk_drilldown.source_event_id ? ` / source ${escapeHtml(snapshot.risk_drilldown.source_event_id)}` : ""}</p>`,
    "</div>",
    `${pill(snapshot.risk_drilldown.mode === "trace" ? "Trace-backed" : "Baseline", snapshot.risk_drilldown.mode === "trace" ? "good" : "warn")}`,
    "</div>",
    `<div class="drilldown-summary">${drilldownStatCards(snapshot.risk_drilldown)}</div>`,
    "<div class=\"drilldown-grid\">",
    "<div class=\"drilldown-callout\">",
    `<p><strong>Root cause</strong><br>${escapeHtml(snapshot.risk_drilldown.root_cause)}</p>`,
    `<p><strong>Next action</strong><br>${escapeHtml(snapshot.risk_drilldown.recommendation)}</p>`,
    `<p class="muted"><code>${escapeHtml(snapshot.risk_drilldown.blocker)}</code> / likely trigger: ${escapeHtml(triggerLabel(snapshot.risk_drilldown.likely_trigger))}</p>`,
    drilldownActionForm(snapshot.risk_drilldown, focus),
    "</div>",
    `<div class="replay-stack">${drilldownReplayCards(snapshot.risk_drilldown)}</div>`,
    "</div>",
    drilldownTrackingPanel(snapshot.risk_drilldown, focus),
    "<h3>窗口内 Trace</h3>",
    table(["时间", "结果", "触发源", "强度", "Taxonomy", "备注"], traceRows(snapshot.risk_drilldown.sample_events || []), "这个窗口还没有本地 trace，先按 baseline 监控。"),
    "</section>",
    "<section class=\"panel\" id=\"intake\">",
    "<h2>Trace Intake</h2>",
    traceIntakeForm(focus),
    "</section>",
    "<section class=\"panel\" id=\"traces\">",
    "<h2>最近行为 Trace</h2>",
    table(["时间", "结果", "触发源", "强度", "Taxonomy", "备注"], traceRows(snapshot.recent_traces || []), "暂无本地 trace"),
    "</section>",
    "<section class=\"grid two\">",
    "<div class=\"panel\" id=\"gate\">",
    "<h2>这个人现在可以放宽自主权吗？</h2>",
    `<p class="muted">${escapeHtml(snapshot.gate.question)}</p>`,
    "<div class=\"readiness\">",
    `<div class="score"><span>Autonomy</span><strong>${escapeHtml(snapshot.gate.autonomy_score)}/100</strong></div>`,
    `<div class="score"><span>Reliability</span><strong>${escapeHtml(snapshot.gate.reliability_score)}/100</strong></div>`,
    `<div class="score"><span>Risk Control</span><strong>${escapeHtml(snapshot.gate.risk_control_score)}/100</strong></div>`,
    `<div class="score"><span>Evidence</span><strong>${escapeHtml(snapshot.gate.evidence_score)}/100</strong></div>`,
    "</div>",
    "<h3>当前阻断</h3>",
    table(["阻断代码", "严重度", "当前 -> 目标", "证据"], blockerRows(snapshot.gate.blockers)),
    "</div>",
    "<div class=\"panel judge\">",
    "<h2>AI Judge</h2>",
    `<p><strong>${escapeHtml(snapshot.judge.verdict)}</strong></p>`,
    `<p class="muted">根因: ${escapeHtml(snapshot.judge.root_cause)}</p>`,
    `<p class="muted">建议: ${escapeHtml(snapshot.judge.recommendation)}</p>`,
    `<p class="footer-note">${escapeHtml(snapshot.judge.safety_boundary)}</p>`,
    "</div>",
    "</section>",
    "<section class=\"panel\" id=\"replay\">",
    `<h2>失控 Replay: ${escapeHtml(snapshot.replay.title)}</h2>`,
    `<p class="muted">Root cause: ${escapeHtml(snapshot.replay.root_cause)} / confidence ${escapeHtml(snapshot.replay.confidence)}${snapshot.replay.source_event_id ? ` / source ${escapeHtml(snapshot.replay.source_event_id)}` : ""}</p>`,
    table(["时间", "事件", "证据"], replayRows(snapshot.replay)),
    "</section>",
    "<section class=\"panel\" id=\"taxonomy\">",
    "<h2>Failure Taxonomy</h2>",
    table(["Taxonomy", "次数", "严重度", "模式", "建议 Eval"], taxonomyRows(snapshot.taxonomy)),
    "</section>",
    "<section class=\"grid two section-space\">",
    "<div class=\"panel\" id=\"policy\">",
    "<h2>策略草案 Dry-run</h2>",
    table(["策略", "状态", "历史命中", "误伤风险", "动作", "命中证据"], policyRows(snapshot.policies)),
    "</div>",
    "<div class=\"panel\">",
    "<h2>复利数据资产</h2>",
    assetRows(snapshot.assets),
    "</div>",
    "</section>",
    "<section class=\"panel\" id=\"actions\">",
    "<h2>认证推进队列</h2>",
    table(["优先级", "严重度", "推荐动作", "Blocker", "状态", "需要的证据", "操作"], actionRows(snapshot.action_queue, focus)),
    "</section>",
    "<section class=\"panel\" id=\"action-events\">",
    "<h2>行动事件时间线</h2>",
    table(["事件", "Action", "时间", "状态变化", "备注", "证据"], actionEventRows(snapshot.action_events || []), "暂无行动事件"),
    "</section>",
    "<section class=\"panel\" id=\"action-effectiveness\">",
    "<h2>行动效果评估</h2>",
    table(["Action", "Blocker", "效果", "追踪窗口", "Before incident/resisted/intensity", "After incident/resisted/intensity", "风险变化", "证据"], actionEffectivenessRows(snapshot.action_effectiveness || []), "暂无可评估行动"),
    "</section>",
    "<section class=\"panel\" id=\"eval\">",
    "<h2>Eval 覆盖地图</h2>",
    table(["触发源", "覆盖", "失败样本", "Replay Case", "已通过"], evalCoverageRows(snapshot.eval_coverage)),
    "</section>",
    "<section class=\"panel\" id=\"audit\">",
    "<h2>行为审计事件</h2>",
    table(["事件 ID", "动作", "说明", "状态"], auditRows(snapshot.audit_events)),
    "</section>",
    "</main>",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}
