import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../../../lib/api-keys.mjs";
import { listCertificationActionQueue } from "../../../../../../../lib/autonomy-certification.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; agentId: string }> }
) {
  try {
    const { projectId, agentId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const status = url.searchParams.get("status") || undefined;
    const recheckId = url.searchParams.get("recheck_id") || undefined;
    const limit = Number(url.searchParams.get("limit") || 50);

    return Response.json({
      project_id: projectId,
      agent_id: agentId,
      certification_action_queue: listCertificationActionQueue(projectId, agentId, {
        status,
        recheckId,
        limit,
      }),
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
