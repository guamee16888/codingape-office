import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { listProjectEvalRuns, runEvalReplay } from "../../../../../lib/eval-replay.mjs";
import { ValidationError, validateEvalRunPayload } from "../../../../../lib/validation.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const evalRuns = listProjectEvalRuns(projectId, {
      agentId: url.searchParams.get("agent_id") || undefined,
      limit: Number(url.searchParams.get("limit") || 20),
    });

    return Response.json({ project_id: projectId, eval_runs: evalRuns }, { status: 200 });
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

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const payload = validateEvalRunPayload(await request.json());
    const result = runEvalReplay(projectId, payload.agent_id, payload);

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof ValidationError) {
      return Response.json({ error: error.message, details: error.details }, { status: 400 });
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
