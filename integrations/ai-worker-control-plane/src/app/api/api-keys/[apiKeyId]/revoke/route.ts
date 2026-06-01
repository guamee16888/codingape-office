import { AuthError, authenticateIngestionApiKey, getIngestionApiKeyRecord, readApiKeyFromHeaders, revokeIngestionApiKey } from "../../../../../lib/api-keys.mjs";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ apiKeyId: string }> }
) {
  try {
    const { apiKeyId } = await context.params;
    const existing = getIngestionApiKeyRecord(apiKeyId);

    if (!existing) {
      return Response.json({ error: "Ingestion API key not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(existing.project_id, readApiKeyFromHeaders(request.headers));
    const revoked = revokeIngestionApiKey(apiKeyId);

    return Response.json(revoked, { status: 200 });
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
