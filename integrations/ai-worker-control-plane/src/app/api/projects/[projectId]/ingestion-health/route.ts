import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { summarizeProjectIngestionHealth } from "../../../../../lib/ingestion-events.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const health = summarizeProjectIngestionHealth(projectId, {
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
    });

    return Response.json({ project_id: projectId, ingestion_health: health }, { status: 200 });
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
