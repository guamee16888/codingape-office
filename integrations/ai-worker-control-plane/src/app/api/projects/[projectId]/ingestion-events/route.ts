import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { listProjectIngestionEvents } from "../../../../../lib/ingestion-events.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const signatureVerified = url.searchParams.has("signature_verified")
      ? url.searchParams.get("signature_verified") === "true"
      : undefined;
    const deduplicated = url.searchParams.has("deduplicated")
      ? url.searchParams.get("deduplicated") === "true"
      : undefined;

    const ingestionEvents = listProjectIngestionEvents(projectId, {
      action: url.searchParams.get("action") || undefined,
      targetId: url.searchParams.get("target_id") || undefined,
      signatureVerified,
      deduplicated,
      limit: Number(url.searchParams.get("limit") || 50),
    });

    return Response.json({ project_id: projectId, ingestion_events: ingestionEvents }, { status: 200 });
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
