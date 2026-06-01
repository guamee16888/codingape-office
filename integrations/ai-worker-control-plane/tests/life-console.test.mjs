import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLifeConsoleSnapshot, renderLifeConsoleHtml, renderLifeDailyAuditMarkdown, renderLifeReviewMarkdown } from "../src/lib/life-console.mjs";
import { appendLifeActionEvent, appendLifeEvent, readLifeActionEvents, readLifeEvents, summarizeLifeEvents } from "../src/lib/life-events.mjs";

test("life console renders the behavior-control-plane shape", () => {
  const snapshot = buildLifeConsoleSnapshot({ focus: "short_video" });
  const html = renderLifeConsoleHtml(snapshot);

  assert.equal(snapshot.focus.id, "short_video");
  assert.match(html, /LifeOps Control Plane/);
  assert.match(html, /失控 Replay/);
  assert.match(html, /Failure Taxonomy/);
  assert.match(html, /策略草案 Dry-run/);
  assert.match(html, /行为审计事件/);
  assert.match(html, /LifeOps Daily Audit/);
  assert.match(html, /Markdown 审计报告/);
  assert.match(html, /风险热力图/);
  assert.match(html, /Core Cockpit \/ 核心驾驶舱/);
  assert.match(html, /RELAPSE RISK/);
  assert.match(html, /ATTENTION READINESS/);
  assert.match(html, /EVIDENCE ASSET/);
  assert.match(html, /Immediate Intervention \/ 即时干预层/);
  assert.match(html, /LOCKDOWN NOW/);
  assert.match(html, /KILL SWITCH/);
  assert.match(html, /Cost Contract/);
  assert.match(html, /Device Anchor \/ 防作弊锚点层/);
  assert.match(html, /CHEAT SURFACE OPEN/);
  assert.match(html, /SCREEN TIME/);
  assert.match(html, /LifeOps Review Report \/ 周月复盘/);
  assert.match(html, /下载复盘 Markdown/);
  assert.match(html, /Operator Rank \/ 身份等级/);
  assert.match(html, /Identity System \/ 长期身份层/);
  assert.match(html, /Mission Chain \/ 晋级任务链/);
  assert.match(html, /可执行晋级路径/);
  assert.match(html, /\/lifeops\/healthy-operator\.png/);
});

test("life console supports focused behavior slices", () => {
  const snapshot = buildLifeConsoleSnapshot({ focus: "impulse" });
  const html = renderLifeConsoleHtml(snapshot);

  assert.equal(snapshot.focus.id, "impulse");
  assert.match(html, /色情冲动风险/);
  assert.match(html, /10 分钟延迟与离屏协议/);
});

test("life events persist locally and update risk taxonomy", () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeops-"));
  const filePath = join(dir, "events.json");

  try {
    const event = appendLifeEvent({
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      occurred_at: "2026-05-23T23:20:00.000Z",
      note: "opened short video after bedtime",
    }, { filePath, now: "2026-05-23T23:21:00.000Z" });

    assert.equal(event.taxonomy_code, "doom_scroll_late_night_loop");
    const events = readLifeEvents({ filePath });
    const summary = summarizeLifeEvents(events, {
      focus: "short_video",
      now: "2026-05-24T00:00:00.000Z",
    });
    assert.equal(summary.total_events, 1);
    assert.equal(summary.week_incidents, 1);
    assert.equal(summary.gate_status, "blocked");

    const snapshot = buildLifeConsoleSnapshot({
      focus: "short_video",
      events,
      now: "2026-05-24T00:00:00.000Z",
    });
    const html = renderLifeConsoleHtml(snapshot);
    const cleanMetric = snapshot.metrics.find((item) => item.label === "Clean Streak");
    const evidenceMetric = snapshot.metrics.find((item) => item.label === "行为证据");
    assert.match(html, /opened short video after bedtime/);
    assert.match(html, /life_trace.ingested/);
    assert.match(html, /Trace Intake/);
    assert.equal(snapshot.control_cockpit.dials[0].value, "92%");
    assert.equal(snapshot.control_cockpit.dials[1].value, "18/100");
    assert.match(snapshot.control_cockpit.equation, /104 - Risk\(92\) - 深夜惩罚\(3\)/);
    assert.equal(snapshot.intervention_layer.mode, "LOCKDOWN NOW");
    assert.equal(snapshot.intervention_layer.readiness_score, 18);
    assert.equal(snapshot.intervention_layer.duration_minutes, 45);
    assert.equal(snapshot.intervention_layer.actions.find((item) => item.code === "kill_switch")?.priority, "P0");
    assert.equal(snapshot.device_anchor_layer.status, "CHEAT SURFACE OPEN");
    assert.equal(snapshot.device_anchor_layer.anchors.length, 5);
    assert.equal(snapshot.device_anchor_layer.anchors.find((item) => item.code === "screen_time")?.status, "pending");
    assert.equal(snapshot.review_report.weekly.incident_count, 1);
    assert.equal(snapshot.review_report.monthly.trace_count, 1);
    assert.match(snapshot.review_report.verdict, /绕过面|证据密度|控制链/);
    assert.equal(snapshot.operator_rank.rank, "RECOVERY CADET");
    assert.equal(snapshot.operator_rank.level >= 1, true);
    assert.match(snapshot.operator_rank.identity, /恢复期|恢复学员|操作员/);
    assert.equal(snapshot.operator_rank.badges.some((item) => item.label === "Evidence Banker"), true);
    assert.equal(snapshot.mission_chain.missions.length, 4);
    assert.equal(snapshot.mission_chain.missions[0].code, "lock_two_anchors");
    assert.equal(snapshot.mission_chain.missions[1].status, "blocked");
    assert.match(snapshot.mission_chain.active_mission, /Lock 2 Anti-cheat Anchors/);
    assert.match(cleanMetric.detail, /当前连续周期已断/);
    assert.match(evidenceMetric.detail, /累计资产/);
    assert.match(html, /Streak 断了，证据不归零/);
    assert.match(html, /提交干预证据/);
    assert.match(html, /锁定锚点/);
    assert.match(html, /7D Trigger Board/);
    assert.match(html, /Next Mission/);
    assert.match(html, /Evidence Banker/);
    assert.match(html, /Lock 2 Anti-cheat Anchors/);
    assert.match(html, /提交任务证据/);

    const reviewMarkdown = renderLifeReviewMarkdown(snapshot);
    assert.match(reviewMarkdown, /# LifeOps Review Report/);
    assert.match(reviewMarkdown, /## Weekly/);
    assert.match(reviewMarkdown, /## Intervention \/ Anchors/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("life console builds replay from the latest relevant trace", () => {
  const events = [
    {
      id: "life_trace_late",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      note: "23:40 opened short video",
      occurred_at: "2026-05-23T23:40:00.000Z",
      created_at: "2026-05-23T23:41:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
  ];
  const snapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    now: "2026-05-24T00:00:00.000Z",
  });
  const html = renderLifeConsoleHtml(snapshot);

  assert.equal(snapshot.replay.title, "深夜 -> 失控");
  assert.match(snapshot.replay.root_cause, /深夜低能量/);
  assert.match(html, /life_trace_late/);
  assert.match(html, /23:40 opened short video/);
});

test("life console builds a trace-driven risk heatmap", () => {
  const events = [
    {
      id: "life_trace_heat_late",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      note: "late-night failure sample",
      occurred_at: "2026-05-23T23:20:00.000",
      created_at: "2026-05-23T23:21:00.000",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
    {
      id: "life_trace_heat_resisted",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "resisted",
      trigger: "stress",
      intensity: 2,
      note: "walked outside",
      occurred_at: "2026-05-23T18:00:00.000",
      created_at: "2026-05-23T18:01:00.000",
      source: "test",
      taxonomy_code: "stress_reward_substitution",
      taxonomy_severity: "medium",
    },
  ];
  const snapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    now: "2026-05-24T00:10:00.000",
  });
  const html = renderLifeConsoleHtml(snapshot);
  const lateNightBucket = snapshot.risk_heatmap.buckets.find((bucket) => bucket.hour === 23);

  assert.equal(lateNightBucket.count, 1);
  assert.equal(lateNightBucket.incidents, 1);
  assert.equal(lateNightBucket.tone, "danger");
  assert.equal(snapshot.risk_heatmap.windows[0].hour, 23);
  assert.match(html, /late-night failure sample/);
  assert.match(html, /23:00/);
});

test("life console opens heatmap hours into risk drilldown", () => {
  const events = [
    {
      id: "life_trace_drilldown_late",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      note: "opened the feed after docking failed",
      occurred_at: "2026-05-23T23:20:00.000",
      created_at: "2026-05-23T23:21:00.000",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
    {
      id: "life_trace_drilldown_evening",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "resisted",
      trigger: "stress",
      intensity: 3,
      note: "walked after work",
      occurred_at: "2026-05-23T19:10:00.000",
      created_at: "2026-05-23T19:11:00.000",
      source: "test",
      taxonomy_code: "stress_reward_substitution",
      taxonomy_severity: "medium",
    },
  ];
  const snapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    hour: "23",
    now: "2026-05-24T00:10:00.000",
  });
  const html = renderLifeConsoleHtml(snapshot);

  assert.equal(snapshot.risk_drilldown.hour, 23);
  assert.equal(snapshot.risk_drilldown.mode, "trace");
  assert.equal(snapshot.risk_drilldown.source_event_id, "life_trace_drilldown_late");
  assert.match(snapshot.risk_drilldown.root_cause, /深夜低能量/);
  assert.match(snapshot.risk_drilldown.recommendation, /22:30/);
  assert.match(html, /风险窗口 Drilldown: 23:00 睡前高风险窗口/);
  assert.match(html, /opened the feed after docking failed/);
  assert.match(html, /href="\/life-console\?focus=short_video&amp;hour=23#risk-drilldown"/);
  assert.match(html, /class="heat-cell danger selected"/);
  assert.match(html, /class="replay-step/);
  assert.equal(snapshot.risk_drilldown.action_id, "life_action_phone_dock");
  assert.match(html, /启动干预任务/);
  assert.match(html, /name="action_id" value="life_action_phone_dock"/);
});

test("life drilldown can start an intervention action", () => {
  const events = [
    {
      id: "life_trace_action_seed",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      note: "failed before action",
      occurred_at: "2026-05-23T23:20:00.000Z",
      created_at: "2026-05-23T23:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
  ];
  const before = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    hour: "23",
    now: "2026-05-24T00:10:00.000Z",
  });
  const actionEvent = {
    id: "life_action_event_drilldown_start",
    action_id: before.risk_drilldown.action_id,
    profile_id: "human_local_alpha",
    focus: "short_video",
    blocker: before.risk_drilldown.blocker,
    from_status: "pending",
    to_status: "in_progress",
    note: `启动干预: ${before.risk_drilldown.recommendation} / window ${before.risk_drilldown.label}`,
    evidence_ref: "risk-window:short_video:23:00",
    created_at: "2026-05-24T00:11:00.000Z",
    source: "test",
  };
  const after = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    actionEvents: [actionEvent],
    hour: "23",
    now: "2026-05-24T00:12:00.000Z",
  });
  const action = after.action_queue.find((item) => item.action_id === "life_action_phone_dock");
  const html = renderLifeConsoleHtml(after);

  assert.equal(before.risk_drilldown.action_status, "pending");
  assert.equal(action.status, "in_progress");
  assert.equal(after.risk_drilldown.action_status, "in_progress");
  assert.match(html, /重新启动干预/);
  assert.match(html, /risk-window:short_video:23:00/);
});

test("life drilldown accepts evidence and exposes three-day tracking", () => {
  const events = [
    {
      id: "life_trace_before_evidence",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      note: "failed before evidence",
      occurred_at: "2026-05-23T23:20:00.000Z",
      created_at: "2026-05-23T23:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
    {
      id: "life_trace_after_evidence",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "resisted",
      trigger: "late_night",
      intensity: 2,
      note: "phone docked and feed resisted",
      occurred_at: "2026-05-24T00:20:00.000Z",
      created_at: "2026-05-24T00:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
  ];
  const actionEvents = [
    {
      id: "life_action_event_started_evidence_flow",
      action_id: "life_action_phone_dock",
      profile_id: "human_local_alpha",
      focus: "short_video",
      blocker: "late_night_high_risk_window",
      from_status: "pending",
      to_status: "in_progress",
      note: "started",
      evidence_ref: "risk-window:short_video:23:00",
      created_at: "2026-05-24T00:11:00.000Z",
      source: "test",
    },
    {
      id: "life_action_event_evidence_attached",
      action_id: "life_action_phone_dock",
      profile_id: "human_local_alpha",
      focus: "short_video",
      blocker: "late_night_high_risk_window",
      from_status: "in_progress",
      to_status: "evidence_attached",
      note: "phone docked in living room",
      evidence_ref: "photo://dock-001",
      created_at: "2026-05-24T00:13:00.000Z",
      source: "test",
    },
  ];
  const snapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    actionEvents,
    hour: "23",
    now: "2026-05-24T01:00:00.000Z",
  });
  const html = renderLifeConsoleHtml(snapshot);

  assert.equal(snapshot.risk_drilldown.action_status, "evidence_attached");
  assert.equal(snapshot.risk_drilldown.latest_evidence_ref, "photo://dock-001");
  assert.equal(snapshot.risk_drilldown.action_tracking.evaluation_status, "improved");
  assert.equal(snapshot.risk_drilldown.action_tracking.followup_trace_count, 1);
  assert.match(html, /3 天效果追踪/);
  assert.match(html, /提交证据/);
  assert.match(html, /photo:\/\/dock-001/);
  assert.match(html, /name="to_status" value="evidence_attached"/);
  assert.match(html, /快速 Follow-up Trace/);
  assert.match(html, /name="hour" value="23"/);
  assert.match(html, /name="outcome" value="resisted"/);
  assert.match(html, /followup:life_action_phone_dock:23:00:resisted/);
});

test("life drilldown escalates failed follow-up into stronger intervention", () => {
  const events = [
    {
      id: "life_trace_before_escalation",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      note: "failed before action",
      occurred_at: "2026-05-23T23:20:00.000Z",
      created_at: "2026-05-23T23:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
    {
      id: "life_trace_after_bypass",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "bypassed",
      trigger: "late_night",
      intensity: 4,
      note: "bypassed the dock after intervention",
      occurred_at: "2026-05-24T00:20:00.000Z",
      created_at: "2026-05-24T00:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
  ];
  const actionEvents = [
    {
      id: "life_action_event_started_escalation_flow",
      action_id: "life_action_phone_dock",
      profile_id: "human_local_alpha",
      focus: "short_video",
      blocker: "late_night_high_risk_window",
      from_status: "pending",
      to_status: "in_progress",
      note: "started",
      evidence_ref: "risk-window:short_video:23:00",
      created_at: "2026-05-24T00:11:00.000Z",
      source: "test",
    },
    {
      id: "life_action_event_escalation_started",
      action_id: "life_action_escalate_late_night_high_risk_window",
      profile_id: "human_local_alpha",
      focus: "short_video",
      blocker: "late_night_high_risk_window",
      from_status: "pending",
      to_status: "in_progress",
      note: "started secondary lock",
      evidence_ref: "life_trace_after_bypass",
      created_at: "2026-05-24T00:30:00.000Z",
      source: "test",
    },
  ];
  const snapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    actionEvents,
    hour: "23",
    now: "2026-05-24T01:00:00.000Z",
  });
  const html = renderLifeConsoleHtml(snapshot);
  const tracking = snapshot.risk_drilldown.action_tracking;
  const escalationAction = snapshot.action_queue.find((item) => item.action_id === "life_action_escalate_late_night_high_risk_window");

  assert.equal(tracking.evaluation_status, "ineffective");
  assert.equal(tracking.escalation.level, "L3 二级锁定");
  assert.equal(tracking.escalation.status, "in_progress");
  assert.equal(tracking.escalation.evidence_ref, "life_trace_after_bypass");
  assert.equal(tracking.escalation.replay.steps.length, 4);
  assert.equal(tracking.escalation.replay.steps[0].stage, "原始失控");
  assert.equal(tracking.escalation.replay.steps[3].stage, "升级动作启动");
  assert.equal(escalationAction.status, "in_progress");
  assert.match(escalationAction.action, /二级锁/);
  assert.match(html, /干预升级规则/);
  assert.match(html, /Escalation Replay/);
  assert.match(html, /原始失控/);
  assert.match(html, /干预启动/);
  assert.match(html, /follow-up 失败/);
  assert.match(html, /升级动作启动/);
  assert.match(html, /启动升级动作/);
  assert.match(html, /name="return_to" value="risk-drilldown"/);
  assert.match(html, /life_action_escalate_late_night_high_risk_window/);
});

test("life console builds a daily audit from traces, actions, and escalation evidence", () => {
  const events = [
    {
      id: "life_trace_daily_before",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      note: "daily audit baseline incident",
      occurred_at: "2026-05-23T23:20:00.000Z",
      created_at: "2026-05-23T23:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
    {
      id: "life_trace_daily_bypass",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "bypassed",
      trigger: "late_night",
      intensity: 4,
      note: "daily audit follow-up failed",
      occurred_at: "2026-05-24T00:20:00.000Z",
      created_at: "2026-05-24T00:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
    {
      id: "life_trace_daily_old",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "resisted",
      trigger: "late_night",
      intensity: 2,
      note: "outside audit window",
      occurred_at: "2026-05-22T00:20:00.000Z",
      created_at: "2026-05-22T00:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
  ];
  const actionEvents = [
    {
      id: "life_action_event_daily_start",
      action_id: "life_action_phone_dock",
      profile_id: "human_local_alpha",
      focus: "short_video",
      blocker: "late_night_high_risk_window",
      from_status: "pending",
      to_status: "in_progress",
      note: "daily start",
      evidence_ref: "risk-window:short_video:23:00",
      created_at: "2026-05-24T00:11:00.000Z",
      source: "test",
    },
  ];
  const snapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    actionEvents,
    hour: "23",
    now: "2026-05-24T01:00:00.000Z",
  });
  const html = renderLifeConsoleHtml(snapshot);

  assert.equal(snapshot.daily_audit.status, "escalated");
  assert.equal(snapshot.daily_audit.report_id, "lifeops_daily_short_video_2026-05-24");
  assert.equal(snapshot.daily_audit_selection.selected_day, "2026-05-24");
  assert.equal(snapshot.daily_audit_selection.is_historical, false);
  assert.equal(snapshot.daily_audit_diff.verdict, "worse");
  assert.equal(snapshot.daily_audit_diff.previous_report_id, "lifeops_daily_short_video_2026-05-23");
  assert.equal(snapshot.daily_audit_diff.metrics.find((item) => item.label === "Incident")?.delta, 2);
  assert.equal(snapshot.daily_audit_diff.status.current, "escalated");
  assert.equal(snapshot.daily_audit_policy_patches.some((item) => item.type === "tighten_gate" && item.priority === "P0"), true);
  assert.equal(snapshot.daily_audit_policy_patches.some((item) => item.type === "start_escalation_action"), true);
  assert.match(snapshot.daily_audit_policy_patches[0].evidence_ref, /lifeops_daily_short_video_2026-05-24/);
  assert.equal(snapshot.daily_audit.summary.incidents, 2);
  assert.equal(snapshot.daily_audit.summary.escalations, 1);
  assert.equal(snapshot.daily_audit_schedule.status, "active");
  assert.equal(snapshot.daily_audit_history.length, 7);
  assert.equal(snapshot.daily_audit_history[0].status, "escalated");
  assert.equal(snapshot.daily_audit_history[0].selected, true);
  assert.match(snapshot.daily_audit_history[0].href, /audit_day=2026-05-24/);
  assert.equal(snapshot.daily_audit.timeline.some((item) => item.event === "升级链"), true);
  assert.equal(snapshot.daily_audit.next_actions.some((item) => item.action_id === "life_action_escalate_late_night_high_risk_window"), true);
  assert.match(html, /LifeOps Daily Audit/);
  assert.match(html, /current report/);
  assert.match(html, /audit_day=2026-05-24/);
  assert.match(html, /日报 Diff/);
  assert.match(html, /收紧最高风险窗口/);
  assert.match(html, /Policy Patch Queue/);
  assert.match(html, /tighten_gate/);
  assert.match(html, /审计时间线/);
  assert.match(html, /下一步动作/);
  assert.match(html, /历史日报/);
  assert.match(html, /日报订阅/);
  assert.match(html, /23:30 local/);
  assert.match(html, /下载 Markdown/);
  assert.match(html, /format=markdown/);
  assert.match(html, /daily audit follow-up failed/);

  const markdown = renderLifeDailyAuditMarkdown(snapshot);
  assert.match(markdown, /^# LifeOps Daily Audit - 戒短视频/m);
  assert.match(markdown, /Report: lifeops_daily_short_video_2026-05-24/);
  assert.match(markdown, /Audit Day: 2026-05-24/);
  assert.match(markdown, /## Metrics/);
  assert.match(markdown, /## Audit Diff/);
  assert.match(markdown, /Previous Report: lifeops_daily_short_video_2026-05-23/);
  assert.match(markdown, /## Policy Patch Queue/);
  assert.match(markdown, /tighten_gate/);
  assert.match(markdown, /## Audit Timeline/);
  assert.match(markdown, /## Audit History/);
  assert.match(markdown, /Subscription: active \/ daily \/ 23:30 local/);
  assert.match(markdown, /life_action_escalate_late_night_high_risk_window/);
  assert.match(markdown, /系统只提供自愿的自我治理建议/);
});

test("life console can replay a selected daily audit day", () => {
  const events = [
    {
      id: "life_trace_selected_day",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      note: "selected day incident",
      occurred_at: "2026-05-22T23:20:00.000Z",
      created_at: "2026-05-22T23:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
    {
      id: "life_trace_current_day",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "bypassed",
      trigger: "late_night",
      intensity: 4,
      note: "current day incident",
      occurred_at: "2026-05-24T00:20:00.000Z",
      created_at: "2026-05-24T00:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
  ];
  const snapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    hour: "23",
    auditDay: "2026-05-23",
    now: "2026-05-24T01:00:00.000Z",
  });
  const html = renderLifeConsoleHtml(snapshot);
  const markdown = renderLifeDailyAuditMarkdown(snapshot);

  assert.equal(snapshot.daily_audit_selection.selected_day, "2026-05-23");
  assert.equal(snapshot.daily_audit_selection.current_day, "2026-05-24");
  assert.equal(snapshot.daily_audit_selection.is_historical, true);
  assert.equal(snapshot.daily_audit.generated_at, "2026-05-23T01:00:00.000Z");
  assert.equal(snapshot.daily_audit.summary.incidents, 1);
  assert.equal(snapshot.daily_audit_diff.current_report_id, "lifeops_daily_short_video_2026-05-23");
  assert.equal(snapshot.daily_audit_diff.previous_report_id, "lifeops_daily_short_video_2026-05-22");
  assert.equal(snapshot.daily_audit_diff.metrics.find((item) => item.label === "Incident")?.delta, 1);
  assert.equal(snapshot.daily_audit_policy_patches.some((item) => item.evidence_ref.includes("lifeops_daily_short_video_2026-05-23")), true);
  assert.equal(snapshot.daily_audit.timeline.some((item) => String(item.detail).includes("selected day incident")), true);
  assert.equal(snapshot.daily_audit.timeline.some((item) => String(item.detail).includes("current day incident")), false);
  assert.equal(snapshot.daily_audit_history.find((item) => item.generated_at.startsWith("2026-05-23"))?.selected, true);
  assert.match(html, /historical replay/);
  assert.match(html, /lifeops_daily_short_video_2026-05-23/);
  assert.match(markdown, /Audit Day: 2026-05-23/);
  assert.match(markdown, /selected day incident/);
  assert.doesNotMatch(markdown, /current day incident/);
});

test("life policy patches can be applied and tracked as action events", () => {
  const events = [
    {
      id: "life_trace_patch_incident",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      note: "patch apply baseline incident",
      occurred_at: "2026-05-24T00:20:00.000Z",
      created_at: "2026-05-24T00:21:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
  ];
  const before = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    hour: "0",
    now: "2026-05-24T01:00:00.000Z",
  });
  const patch = before.daily_audit_policy_patches.find((item) => item.type === "tighten_gate");
  assert.equal(Boolean(patch), true);
  assert.equal(patch.status, "proposed");
  assert.match(patch.action_id, /^life_action_policy_patch_/);

  const after = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    hour: "0",
    now: "2026-05-24T01:06:00.000Z",
    actionEvents: [
      {
        id: "life_action_event_patch_apply",
        action_id: patch.action_id,
        profile_id: "human_local_alpha",
        focus: "short_video",
        blocker: patch.blocker,
        from_status: "pending",
        to_status: "in_progress",
        note: `apply policy patch: ${patch.type}`,
        evidence_ref: patch.evidence_ref,
        created_at: "2026-05-24T01:05:00.000Z",
        source: "test",
      },
    ],
  });
  const applied = after.daily_audit_policy_patches.find((item) => item.action_id === patch.action_id);
  const html = renderLifeConsoleHtml(after);
  const markdown = renderLifeDailyAuditMarkdown(after);

  assert.equal(applied.status, "in_progress");
  assert.equal(applied.latest_event_id, "life_action_event_patch_apply");
  assert.equal(applied.tracking.evaluation_status, "awaiting_followup_trace");
  assert.equal(applied.tracking.before.incidents, 1);
  assert.match(html, /awaiting_followup_trace/);
  assert.match(html, /apply policy patch/);
  assert.match(markdown, /in_progress/);
  assert.match(markdown, /policy_patch_/);
});

test("life console preserves baseline high-risk priors when trace data is sparse", () => {
  const snapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    hour: "23",
    events: [
      {
        id: "life_trace_evening_only",
        profile_id: "human_local_alpha",
        focus: "short_video",
        outcome: "resisted",
        trigger: "stress",
        intensity: 3,
        note: "only an evening trace exists",
        occurred_at: "2026-05-23T19:10:00.000",
        created_at: "2026-05-23T19:11:00.000",
        source: "test",
        taxonomy_code: "stress_reward_substitution",
        taxonomy_severity: "medium",
      },
    ],
    now: "2026-05-24T00:10:00.000",
  });
  const html = renderLifeConsoleHtml(snapshot);

  assert.equal(snapshot.risk_drilldown.hour, 23);
  assert.equal(snapshot.risk_drilldown.mode, "baseline");
  assert.equal(snapshot.risk_drilldown.count, 0);
  assert.equal(snapshot.risk_drilldown.risk_score > 0, true);
  assert.match(html, /baseline risk prior/);
  assert.match(html, /睡前高风险窗口/);
});

test("life console replay highlights bypass incidents as gate failures", () => {
  const events = [
    {
      id: "life_trace_bypass",
      profile_id: "human_local_alpha",
      focus: "dopamine",
      outcome: "bypassed",
      trigger: "friction_bypass",
      intensity: 4,
      note: "removed the limiter",
      occurred_at: "2026-05-23T21:00:00.000Z",
      created_at: "2026-05-23T21:01:00.000Z",
      source: "test",
      taxonomy_code: "friction_bypass_reinstall",
      taxonomy_severity: "high",
    },
  ];
  const snapshot = buildLifeConsoleSnapshot({
    focus: "dopamine",
    events,
    now: "2026-05-24T00:00:00.000Z",
  });

  assert.equal(snapshot.replay.title, "绕过限制 -> 绕过限制");
  assert.match(snapshot.replay.root_cause, /二级拦截/);
  assert.equal(snapshot.replay.source_event_id, "life_trace_bypass");
});

test("life console dry-runs policies from recent traces", () => {
  const events = [
    {
      id: "life_trace_late",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      note: "late night scroll",
      occurred_at: "2026-05-23T23:00:00.000Z",
      created_at: "2026-05-23T23:01:00.000Z",
      source: "test",
      taxonomy_code: "doom_scroll_late_night_loop",
      taxonomy_severity: "high",
    },
    {
      id: "life_trace_bypass",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "bypassed",
      trigger: "friction_bypass",
      intensity: 4,
      note: "removed limiter",
      occurred_at: "2026-05-23T22:00:00.000Z",
      created_at: "2026-05-23T22:01:00.000Z",
      source: "test",
      taxonomy_code: "friction_bypass_reinstall",
      taxonomy_severity: "high",
    },
    {
      id: "life_trace_stress",
      profile_id: "human_local_alpha",
      focus: "short_video",
      outcome: "resisted",
      trigger: "stress",
      intensity: 3,
      note: "walked instead",
      occurred_at: "2026-05-22T18:00:00.000Z",
      created_at: "2026-05-22T18:01:00.000Z",
      source: "test",
      taxonomy_code: "stress_reward_substitution",
      taxonomy_severity: "medium",
    },
  ];
  const snapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    events,
    now: "2026-05-24T00:00:00.000Z",
  });
  const phoneDock = snapshot.policies.find((policy) => policy.id === "phone_dock");
  const secondaryLock = snapshot.policies.find((policy) => policy.id === "secondary_lock");
  const fallbackPath = snapshot.policies.find((policy) => policy.id === "fallback_path");
  const html = renderLifeConsoleHtml(snapshot);

  assert.equal(phoneDock.match_count, 1);
  assert.equal(phoneDock.state, "dry_run_ready");
  assert.deepEqual(phoneDock.matched_trace_ids, ["life_trace_late"]);
  assert.equal(secondaryLock.false_positive_risk, "low");
  assert.deepEqual(secondaryLock.matched_trace_ids, ["life_trace_bypass"]);
  assert.equal(fallbackPath.match_count, 1);
  assert.equal(fallbackPath.state, "needs_evidence");
  assert.equal(snapshot.action_queue.some((item) => item.blocker === "friction_bypass_pattern"), true);
  assert.equal(snapshot.action_queue.some((item) => item.blocker === "late_night_high_risk_window"), true);
  assert.match(html, /当前 7 日风险/);
});

test("life action events persist and drive action queue state", () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeops-action-"));
  const filePath = join(dir, "events.json");

  try {
    appendLifeEvent({
      focus: "short_video",
      outcome: "slipped",
      trigger: "late_night",
      intensity: 5,
      occurred_at: "2026-05-23T23:20:00.000Z",
      note: "late trace",
    }, { filePath, now: "2026-05-23T23:21:00.000Z" });

    const actionEvent = appendLifeActionEvent({
      focus: "short_video",
      action_id: "life_action_phone_dock",
      blocker: "late_night_high_risk_window",
      from_status: "pending",
      to_status: "evidence_attached",
      note: "phone docked for one night",
      evidence_ref: "photo://dock-001",
    }, { filePath, now: "2026-05-24T00:00:00.000Z" });

    const actionEvents = readLifeActionEvents({ filePath });
    const snapshot = buildLifeConsoleSnapshot({
      focus: "short_video",
      events: readLifeEvents({ filePath }),
      actionEvents,
      now: "2026-05-24T00:01:00.000Z",
    });
    const phoneAction = snapshot.action_queue.find((item) => item.action_id === "life_action_phone_dock");
    const html = renderLifeConsoleHtml(snapshot);

    assert.equal(actionEvent.to_status, "evidence_attached");
    assert.equal(actionEvents.length, 1);
    assert.equal(phoneAction.status, "evidence_attached");
    assert.equal(phoneAction.latest_evidence_ref, "photo://dock-001");
    assert.equal(snapshot.action_effectiveness[0].evaluation_status, "awaiting_followup_trace");
    assert.match(html, /phone docked for one night/);
    assert.match(html, /行动事件时间线/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("life action effectiveness evaluates follow-up traces", () => {
  const baseActionEvent = {
    id: "life_action_event_start",
    action_id: "life_action_phone_dock",
    profile_id: "human_local_alpha",
    focus: "short_video",
    blocker: "late_night_high_risk_window",
    from_status: "pending",
    to_status: "in_progress",
    note: "started",
    evidence_ref: "",
    created_at: "2026-05-23T23:30:00.000Z",
    source: "test",
  };
  const beforeTrace = {
    id: "life_trace_before",
    profile_id: "human_local_alpha",
    focus: "short_video",
    outcome: "slipped",
    trigger: "late_night",
    intensity: 5,
    note: "failed before action",
    occurred_at: "2026-05-23T23:20:00.000Z",
    created_at: "2026-05-23T23:21:00.000Z",
    source: "test",
    taxonomy_code: "doom_scroll_late_night_loop",
    taxonomy_severity: "high",
  };
  const improvedSnapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    events: [
      beforeTrace,
      {
        id: "life_trace_after_resisted",
        profile_id: "human_local_alpha",
        focus: "short_video",
        outcome: "resisted",
        trigger: "late_night",
        intensity: 2,
        note: "docked phone and resisted",
        occurred_at: "2026-05-24T00:10:00.000Z",
        created_at: "2026-05-24T00:11:00.000Z",
        source: "test",
        taxonomy_code: "doom_scroll_late_night_loop",
        taxonomy_severity: "high",
      },
    ],
    actionEvents: [baseActionEvent],
    now: "2026-05-24T01:00:00.000Z",
  });
  const ineffectiveSnapshot = buildLifeConsoleSnapshot({
    focus: "short_video",
    events: [
      beforeTrace,
      {
        id: "life_trace_after_slipped",
        profile_id: "human_local_alpha",
        focus: "short_video",
        outcome: "slipped",
        trigger: "late_night",
        intensity: 5,
        note: "failed again",
        occurred_at: "2026-05-24T00:10:00.000Z",
        created_at: "2026-05-24T00:11:00.000Z",
        source: "test",
        taxonomy_code: "doom_scroll_late_night_loop",
        taxonomy_severity: "high",
      },
    ],
    actionEvents: [baseActionEvent],
    now: "2026-05-24T01:00:00.000Z",
  });
  const html = renderLifeConsoleHtml(improvedSnapshot);

  assert.equal(improvedSnapshot.action_effectiveness[0].evaluation_status, "improved");
  assert.equal(improvedSnapshot.action_effectiveness[0].risk_delta > 0, true);
  assert.equal(ineffectiveSnapshot.action_effectiveness[0].evaluation_status, "ineffective");
  assert.match(html, /行动效果评估/);
  assert.match(html, /docked phone and resisted|1 条后续 trace/);
});
