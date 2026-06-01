import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createId } from "./ids.mjs";

const VALID_FOCUSES = new Set(["short_video", "dopamine", "impulse"]);
const VALID_OUTCOMES = new Set(["resisted", "slipped", "bypassed", "clean"]);
const VALID_ACTION_STATUSES = new Set(["pending", "in_progress", "evidence_attached", "resolved", "dismissed", "reopened"]);
const VALID_TRIGGERS = new Set([
  "late_night",
  "lonely_after_work",
  "stress",
  "sleep_debt",
  "boredom",
  "friction_bypass",
  "algorithm_pull",
  "other",
]);

export function defaultLifeEventPath() {
  return process.env.LIFEOPS_EVENT_PATH || join(process.cwd(), ".data", "lifeops-events.json");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeFocus(value) {
  const focus = String(value || "short_video");
  return VALID_FOCUSES.has(focus) ? focus : "short_video";
}

function normalizeOutcome(value) {
  const outcome = String(value || "resisted");
  return VALID_OUTCOMES.has(outcome) ? outcome : "resisted";
}

function normalizeTrigger(value) {
  const trigger = String(value || "other");
  return VALID_TRIGGERS.has(trigger) ? trigger : "other";
}

function normalizeActionStatus(value) {
  const status = String(value || "pending");
  return VALID_ACTION_STATUSES.has(status) ? status : "pending";
}

function validIsoOrNow(value, nowIso) {
  const raw = String(value || "").trim();
  if (!raw) return nowIso;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? nowIso : parsed.toISOString();
}

export function readLifeStore(options = {}) {
  const filePath = options.filePath || defaultLifeEventPath();
  if (!existsSync(filePath)) {
    return { version: 1, events: [], action_events: [] };
  }

  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  return {
    version: Number(parsed.version || 1),
    events: Array.isArray(parsed.events) ? parsed.events : [],
    action_events: Array.isArray(parsed.action_events) ? parsed.action_events : [],
  };
}

export function writeLifeStore(store = {}, options = {}) {
  const filePath = options.filePath || defaultLifeEventPath();
  const normalized = {
    version: Number(store.version || 1),
    events: Array.isArray(store.events) ? store.events : [],
    action_events: Array.isArray(store.action_events) ? store.action_events : [],
  };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
  return {
    filePath,
    event_count: normalized.events.length,
    action_event_count: normalized.action_events.length,
  };
}

export function taxonomyForLifeEvent(event) {
  if (event.outcome === "bypassed" || event.trigger === "friction_bypass") {
    return {
      code: "friction_bypass_reinstall",
      severity: "high",
      pattern: "限制工具被绕过或主动拆除",
      suggested_eval: "限制失效时的二级拦截测试",
    };
  }

  if (event.trigger === "late_night" || event.trigger === "algorithm_pull") {
    return {
      code: event.focus === "impulse" ? "late_night_impulse_loop" : "doom_scroll_late_night_loop",
      severity: "high",
      pattern: event.focus === "impulse" ? "独处熬夜时冲动升高" : "睡前低能量时进入无限滑动",
      suggested_eval: "23:00 高风险入口模拟回放",
    };
  }

  if (event.trigger === "lonely_after_work") {
    return {
      code: "lonely_after_work_trigger",
      severity: "medium",
      pattern: "工作后孤独或空虚触发即时奖励",
      suggested_eval: "独处 30 分钟无外部约束回放",
    };
  }

  if (event.trigger === "sleep_debt") {
    return {
      code: "sleep_debt_impulse_amplifier",
      severity: "medium",
      pattern: "睡眠债放大冲动和拖延",
      suggested_eval: "低睡眠日行动计划回放",
    };
  }

  if (event.trigger === "stress") {
    return {
      code: "stress_reward_substitution",
      severity: "medium",
      pattern: "压力释放需求被高刺激奖励替代",
      suggested_eval: "压力后 20 分钟替代路径回放",
    };
  }

  return {
    code: "unclassified_urge",
    severity: Number(event.intensity || 0) >= 4 ? "medium" : "low",
    pattern: "尚未归类的冲动或注意力波动",
    suggested_eval: "补充触发源标签后再生成 replay",
  };
}

export function normalizeLifeActionEvent(input = {}, options = {}) {
  const nowIso = options.now || new Date().toISOString();
  const fromStatus = input.from_status ? normalizeActionStatus(input.from_status) : "";
  return {
    id: input.id || createId("life_action_event"),
    action_id: String(input.action_id || "").trim().slice(0, 120),
    profile_id: String(input.profile_id || "human_local_alpha"),
    focus: normalizeFocus(input.focus),
    blocker: String(input.blocker || "").trim().slice(0, 120),
    from_status: fromStatus,
    to_status: normalizeActionStatus(input.to_status),
    note: String(input.note || "").trim().slice(0, 280),
    evidence_ref: String(input.evidence_ref || "").trim().slice(0, 180),
    created_at: nowIso,
    source: String(input.source || "local_console"),
  };
}

export function normalizeLifeEvent(input = {}, options = {}) {
  const nowIso = options.now || new Date().toISOString();
  const event = {
    id: input.id || createId("life_trace"),
    profile_id: String(input.profile_id || "human_local_alpha"),
    focus: normalizeFocus(input.focus),
    outcome: normalizeOutcome(input.outcome),
    trigger: normalizeTrigger(input.trigger),
    intensity: clampNumber(input.intensity, 1, 5, 3),
    note: String(input.note || "").trim().slice(0, 280),
    occurred_at: validIsoOrNow(input.occurred_at, nowIso),
    created_at: nowIso,
    source: String(input.source || "local_console"),
  };
  const taxonomy = taxonomyForLifeEvent(event);
  return {
    ...event,
    taxonomy_code: taxonomy.code,
    taxonomy_severity: taxonomy.severity,
  };
}

export function readLifeEvents(options = {}) {
  return readLifeStore(options).events;
}

export function readLifeActionEvents(options = {}) {
  return readLifeStore(options).action_events;
}

export function writeLifeEvents(events, options = {}) {
  const filePath = options.filePath || defaultLifeEventPath();
  const store = readLifeStore({ filePath });
  store.events = Array.isArray(events) ? events : [];
  const result = writeLifeStore(store, { filePath });
  return { filePath, count: result.event_count };
}

export function appendLifeEvent(input = {}, options = {}) {
  const filePath = options.filePath || defaultLifeEventPath();
  const event = normalizeLifeEvent(input, options);
  const store = readLifeStore({ filePath });
  store.events.push(event);
  writeLifeStore(store, { filePath });
  return event;
}

export function appendLifeActionEvent(input = {}, options = {}) {
  const filePath = options.filePath || defaultLifeEventPath();
  const event = normalizeLifeActionEvent(input, options);
  if (!event.action_id) {
    throw new Error("action_id is required");
  }
  const store = readLifeStore({ filePath });
  store.action_events.push(event);
  writeLifeStore(store, { filePath });
  return event;
}

export function summarizeLifeEvents(events = [], options = {}) {
  const focus = normalizeFocus(options.focus);
  const now = new Date(options.now || new Date().toISOString());
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const focused = events
    .filter((event) => event.focus === focus)
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  const weekEvents = focused.filter((event) => new Date(event.occurred_at) >= weekStart);
  const incidents = focused.filter((event) => ["slipped", "bypassed"].includes(event.outcome));
  const weekIncidents = weekEvents.filter((event) => ["slipped", "bypassed"].includes(event.outcome));
  const resisted = weekEvents.filter((event) => event.outcome === "resisted");
  const lateNight = weekEvents.filter((event) => ["late_night", "algorithm_pull"].includes(event.trigger));
  const avgIntensity = weekEvents.length
    ? weekEvents.reduce((sum, event) => sum + Number(event.intensity || 0), 0) / weekEvents.length
    : 0;
  const riskScore = Math.max(
    18,
    Math.min(
      96,
      Math.round(44 + avgIntensity * 7 + weekIncidents.length * 9 + lateNight.length * 4 - resisted.length * 3)
    )
  );
  const lastIncident = incidents[0] || null;
  const uptimeHours = lastIncident
    ? Math.max(0, Math.floor((now.getTime() - new Date(lastIncident.occurred_at).getTime()) / (60 * 60 * 1000)))
    : null;
  const cleanDays = lastIncident
    ? Math.max(0, Math.floor(uptimeHours / 24))
    : focused.length
      ? 7
      : null;

  return {
    focus,
    total_events: focused.length,
    week_events: weekEvents.length,
    week_incidents: weekIncidents.length,
    resisted_count: resisted.length,
    late_night_count: lateNight.length,
    avg_intensity: Number(avgIntensity.toFixed(1)),
    risk_score: riskScore,
    risk_tone: riskScore >= 75 ? "danger" : riskScore >= 55 ? "warn" : "good",
    gate_status: riskScore >= 75 ? "blocked" : riskScore >= 55 ? "limited" : "ready",
    uptime_hours: uptimeHours,
    clean_days: cleanDays,
    recent_events: focused.slice(0, 8),
  };
}
