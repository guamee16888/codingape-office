const TASK_ID_PATTERN = /task_[a-z0-9]+_[a-z0-9]+/i;
const MISSION_MODES = new Set(["review_only", "proposal", "verify", "sandbox_patch"]);
const MODE_EVENT_TYPES = {
  review_only: new Set(["task_queued", "task_evidence", "task_completed"]),
  proposal: new Set(["task_queued", "task_evidence", "judge_review", "patch_plan", "task_completed"]),
  verify: new Set([
    "task_queued",
    "task_evidence",
    "judge_review",
    "patch_plan",
    "verification_blocked",
    "verification_failed",
    "verification_passed",
    "task_completed"
  ]),
  sandbox_patch: null
};

function normalizeMissionMode(mode) {
  return MISSION_MODES.has(mode) ? mode : "";
}

export function taskIdFromTimelineEvent(event) {
  if (!event) return "";
  if (event.taskId) return String(event.taskId);

  const fields = [
    event.id,
    event.title,
    event.detail,
    ...(Array.isArray(event.evidence) ? event.evidence : [])
  ];
  for (const field of fields) {
    const match = String(field || "").match(TASK_ID_PATTERN);
    if (match) return match[0];
  }
  return "";
}

export function timelineEventKey(event) {
  if (!event) return "";
  if (event.id) return String(event.id);

  const parts = [
    event.type,
    event.projectId,
    event.workerId,
    event.timestamp,
    taskIdFromTimelineEvent(event),
    event.title
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  return parts.join("|");
}

export function missionModeFromTimelineEvent(event) {
  const explicit = normalizeMissionMode(String(event?.mode || ""));
  if (explicit) return explicit;

  const source = String(event?.source || "");
  if (source.startsWith("mission_")) {
    return normalizeMissionMode(source.replace("mission_", ""));
  }

  return "";
}

function timelineEventMatchesMode(event, mode) {
  const normalizedMode = normalizeMissionMode(mode);
  if (!normalizedMode) return true;

  const eventMode = missionModeFromTimelineEvent(event);
  if (eventMode && eventMode !== normalizedMode) return false;

  const allowedTypes = MODE_EVENT_TYPES[normalizedMode];
  if (!allowedTypes) return true;

  const type = String(event?.type || "").toLowerCase();
  return allowedTypes.has(type);
}

export function inspectorTabForTimelineEvent(event) {
  const type = String(event?.type || "").toLowerCase();
  if (/apply|approval|human_gate|gate/.test(type)) return "gate";
  if (/evidence|verification|patch|judge|proposal/.test(type)) return "evidence";
  if (type === "task_completed" && taskIdFromTimelineEvent(event)) return "evidence";
  return "mission";
}

export function focusNodeForTimelineEvent(event) {
  const type = String(event?.type || "").toLowerCase();
  if (/apply/.test(type)) return "apply";
  if (/human_gate|approval|gate/.test(type)) return "human";
  if (/patch_run/.test(type)) return "diff";
  if (/patch_plan|proposal/.test(type)) return "proposal";
  if (/verification/.test(type)) return "verification";
  if (/judge/.test(type)) return "judge";
  if (/evidence/.test(type)) return "evidence";
  if (/completed/.test(type)) return "report";
  if (/queued|assigned|task/.test(type)) return "task";
  return "";
}

export function focusWorkerForTimelineEvent(event) {
  const workerId = String(event?.workerId || "");
  if (workerId) return workerId;

  const type = String(event?.type || "").toLowerCase();
  if (/apply|ops|blocked|failed/.test(type)) return "ops-yuan";
  if (/judge|verification|human_gate|approval|gate/.test(type)) return "judge-yuan";
  if (/task|evidence|proposal|patch/.test(type)) return "coding-yuan";
  return "";
}

export function timelineEventSeverity(event) {
  const type = String(event?.type || "").toLowerCase();
  const risk = String(event?.risk || "").toLowerCase();
  if (/failed|blocked|pending/.test(type) || risk === "high") return "danger";
  if (/approval|gate|rework/.test(type) || risk === "medium") return "warning";
  if (/passed|approved|ready|completed|applied/.test(type)) return "success";
  return "info";
}

function eventTimestamp(event) {
  const timestamp = Date.parse(event?.timestamp || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function timelineEventImportance(event) {
  const type = String(event?.type || "").toLowerCase();
  const risk = String(event?.risk || "").toLowerCase();
  if (/failed|blocked|apply_gate|human_gate|approval/.test(type) || risk === "high") return 100;
  if (/verification|patch_run|proposal|judge/.test(type)) return 82;
  if (/evidence|completed/.test(type)) return 68;
  if (/queued|assigned/.test(type)) return 42;
  return 0;
}

export function significantTimelineEvents(events = [], options = {}) {
  const limit = Math.max(1, Number(options.limit || 8));
  const taskId = String(options.taskId || "").trim();
  const taskEvents = taskId
    ? events.filter((event) => taskIdFromTimelineEvent(event) === taskId)
    : [];
  const modeFiltered = (taskEvents.length ? taskEvents : events)
    .filter((event) => timelineEventMatchesMode(event, options.mode));
  const sourceEvents = modeFiltered.length ? modeFiltered : taskEvents.length ? taskEvents : events;
  const scored = sourceEvents
    .map((event, index) => ({
      event,
      index,
      score: timelineEventImportance(event),
      timestamp: eventTimestamp(event)
    }))
    .filter((entry) => entry.score > 0);

  const source = scored.length
    ? scored
    : events.map((event, index) => ({
      event,
      index,
      score: 1,
      timestamp: eventTimestamp(event)
    }));

  return source
    .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => b.timestamp - a.timestamp || a.index - b.index)
    .map((entry) => entry.event);
}

export function timelineReplaySummary(event) {
  if (!event) {
    return {
      evidenceCount: 0,
      inspectorTab: "mission",
      severity: "info",
      taskId: "",
      title: "No event selected"
    };
  }

  return {
    evidenceCount: Array.isArray(event.evidence) ? event.evidence.length : 0,
    focusNode: focusNodeForTimelineEvent(event),
    focusWorkerId: focusWorkerForTimelineEvent(event),
    inspectorTab: inspectorTabForTimelineEvent(event),
    projectId: event.projectId || "",
    severity: timelineEventSeverity(event),
    taskId: taskIdFromTimelineEvent(event),
    title: event.title || "Timeline event",
    type: event.type || "event"
  };
}
