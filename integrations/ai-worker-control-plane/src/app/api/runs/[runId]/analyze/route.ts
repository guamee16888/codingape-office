import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { getRunTrace } from "../../../../../lib/assets.mjs";
import { analyzeRun } from "../../../../../lib/judge.mjs";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await context.params;
    const trace = getRunTrace(runId);

    if (!trace) {
      return Response.json({ error: "Agent run not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(trace.run.project_id, readApiKeyFromHeaders(request.headers));
    const result = await analyzeRun(runId);

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.includes("not found") ? 404 : 500;

    return Response.json({ error: message }, { status });
  }
}
