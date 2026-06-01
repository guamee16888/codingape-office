import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../../../lib/api-keys.mjs";
import {
  listAutonomyCertificationRechecks,
  runAutonomyCertificationRecheck,
} from "../../../../../../../lib/autonomy-certification.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; agentId: string }> }
) {
  try {
    const { projectId, agentId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));
    return Response.json({
      autonomy_gate_recheck_history: listAutonomyCertificationRechecks(projectId, agentId),
    }, { status: 200 });
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
  context: { params: Promise<{ projectId: string; agentId: string }> }
) {
  try {
    const { projectId, agentId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));
    const payload = await request.json().catch(() => ({}));
    const result = runAutonomyCertificationRecheck(projectId, agentId, {
      targetAutonomyLevel: payload.target_autonomy_level || "L2",
      actorType: payload.actor_type || "api_user",
      actorId: payload.actor_id || null,
    });

    return Response.json(result, { status: 201 });
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
