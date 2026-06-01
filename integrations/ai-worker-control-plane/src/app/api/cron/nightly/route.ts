import { runNightlyHealthChecksForDate } from "../../../../lib/nightly.mjs";

export const runtime = "nodejs";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const authorization = request.headers.get("authorization") || "";
  return authorization === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({}));
  const date = typeof payload.date === "string" && payload.date.trim()
    ? payload.date.trim()
    : new Date().toISOString().slice(0, 10);
  const targetAutonomyLevel = typeof payload.target_autonomy_level === "string" && payload.target_autonomy_level.trim()
    ? payload.target_autonomy_level.trim().toUpperCase()
    : undefined;

  const result = await runNightlyHealthChecksForDate(date, { targetAutonomyLevel });
  return Response.json(result, { status: 201 });
}
