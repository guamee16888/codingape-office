import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { getRunJudgementByRunId, getRunTrace } from "../../../../../lib/assets.mjs";

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
    const judgement = getRunJudgementByRunId(runId);

    if (!judgement) {
      return Response.json({ error: "Run judgement not found" }, { status: 404 });
    }

    return Response.json(judgement, { status: 200 });
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

