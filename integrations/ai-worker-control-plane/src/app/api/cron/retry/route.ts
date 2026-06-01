import { runRetryQueue } from "../../../../lib/retries.mjs";

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
  const result = await runRetryQueue({
    now: typeof payload.now === "string" ? payload.now : undefined,
    maxRetries: Number.isFinite(Number(payload.max_retries)) ? Number(payload.max_retries) : undefined,
    limit: Number.isFinite(Number(payload.limit)) ? Number(payload.limit) : undefined,
  });

  return Response.json(result, { status: 200 });
}

