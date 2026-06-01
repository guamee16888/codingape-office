import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { listProjectSuggestions } from "../../../../../lib/assets.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const suggestions = listProjectSuggestions(projectId, {
      type: url.searchParams.get("type") || undefined,
      status: url.searchParams.get("status") || undefined,
      agentId: url.searchParams.get("agent_id") || undefined,
      limit: Number(url.searchParams.get("limit") || 50),
    });

    return Response.json({ project_id: projectId, suggestions }, { status: 200 });
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

