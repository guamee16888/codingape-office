import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../lib/api-keys.mjs";
import { getRunTrace } from "../../../../lib/assets.mjs";

export const runtime = "nodejs";

export async function GET(
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
    return Response.json(trace, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

