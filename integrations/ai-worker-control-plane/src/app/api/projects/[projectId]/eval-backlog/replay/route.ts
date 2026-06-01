import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../../lib/api-keys.mjs";
import { runEvalBacklogReplay } from "../../../../../../lib/eval-backlog-replay.mjs";
import { ValidationError, validateEvalBacklogReplayPayload } from "../../../../../../lib/validation.mjs";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const payload = validateEvalBacklogReplayPayload(await request.json());
    const result = runEvalBacklogReplay(projectId, payload);

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
