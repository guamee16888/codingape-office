import { buildLifeConsoleSnapshot, renderLifeConsoleHtml, renderLifeDailyAuditMarkdown, renderLifeReviewMarkdown } from "../../lib/life-console.mjs";
import { appendLifeActionEvent, appendLifeEvent, readLifeActionEvents, readLifeEvents } from "../../lib/life-events.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const snapshot = buildLifeConsoleSnapshot({
    focus: url.searchParams.get("focus") || "short_video",
    events: readLifeEvents(),
    actionEvents: readLifeActionEvents(),
    hour: url.searchParams.get("hour"),
    auditDay: url.searchParams.get("audit_day"),
    recorded: url.searchParams.get("recorded") === "1",
    actionRecorded: url.searchParams.get("action_recorded") === "1",
  });

  if (url.searchParams.get("format") === "markdown") {
    return new Response(renderLifeDailyAuditMarkdown(snapshot), {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": "attachment; filename=\"lifeops-daily-audit.md\"",
      },
    });
  }

  if (url.searchParams.get("format") === "review_markdown") {
    return new Response(renderLifeReviewMarkdown(snapshot), {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": "attachment; filename=\"lifeops-review-report.md\"",
      },
    });
  }

  return new Response(renderLifeConsoleHtml(snapshot), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const focus = String(form.get("focus") || "short_video");
  const intent = String(form.get("intent") || "trace");

  if (intent === "action_event") {
    const hour = String(form.get("hour") || "");
    const returnTo = String(form.get("return_to") || "");
    const auditDay = String(form.get("audit_day") || "");
    appendLifeActionEvent({
      focus,
      action_id: String(form.get("action_id") || ""),
      blocker: String(form.get("blocker") || ""),
      from_status: String(form.get("from_status") || ""),
      to_status: String(form.get("to_status") || "pending"),
      note: String(form.get("note") || ""),
      evidence_ref: String(form.get("evidence_ref") || ""),
    });

    const actionTarget = returnTo === "risk-drilldown" && hour
      ? `/life-console?focus=${encodeURIComponent(focus)}&hour=${encodeURIComponent(hour)}&action_recorded=1#risk-drilldown`
      : returnTo === "intervention-layer"
        ? `/life-console?focus=${encodeURIComponent(focus)}${hour ? `&hour=${encodeURIComponent(hour)}` : ""}&action_recorded=1#intervention-layer`
      : returnTo === "device-anchor"
        ? `/life-console?focus=${encodeURIComponent(focus)}${hour ? `&hour=${encodeURIComponent(hour)}` : ""}&action_recorded=1#device-anchor`
      : returnTo === "mission-chain"
        ? `/life-console?focus=${encodeURIComponent(focus)}${hour ? `&hour=${encodeURIComponent(hour)}` : ""}&action_recorded=1#mission-chain`
      : returnTo === "daily-audit"
        ? `/life-console?focus=${encodeURIComponent(focus)}${hour ? `&hour=${encodeURIComponent(hour)}` : ""}${auditDay ? `&audit_day=${encodeURIComponent(auditDay)}` : ""}&action_recorded=1#daily-audit`
      : `/life-console?focus=${encodeURIComponent(focus)}${hour ? `&hour=${encodeURIComponent(hour)}` : ""}&action_recorded=1#actions`;

    return Response.redirect(
      new URL(actionTarget, request.url),
      303
    );
  }

  appendLifeEvent({
    focus,
    outcome: String(form.get("outcome") || "resisted"),
    trigger: String(form.get("trigger") || "other"),
    intensity: String(form.get("intensity") || "3"),
    occurred_at: String(form.get("occurred_at") || ""),
    note: String(form.get("note") || ""),
  });

  const hour = String(form.get("hour") || "");
  const traceTarget = hour
    ? `/life-console?focus=${encodeURIComponent(focus)}&hour=${encodeURIComponent(hour)}&recorded=1#risk-drilldown`
    : `/life-console?focus=${encodeURIComponent(focus)}&recorded=1#traces`;

  return Response.redirect(
    new URL(traceTarget, request.url),
    303
  );
}
