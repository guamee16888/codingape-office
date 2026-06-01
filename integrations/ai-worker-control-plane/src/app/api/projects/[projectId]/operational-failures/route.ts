import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { listProjectOperationalFailures } from "../../../../../lib/operations.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const result = listProjectOperationalFailures(projectId, {
      status: url.searchParams.get("status") || undefined,
      unresolvedOnly: url.searchParams.get("unresolved") !== "false",
      limit: Number(url.searchParams.get("limit") || 50),
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.includes("status must") ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
