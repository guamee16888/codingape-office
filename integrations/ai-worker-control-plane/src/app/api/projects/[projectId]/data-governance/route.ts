import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { summarizeProjectDataGovernance } from "../../../../../lib/data-governance.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const governance = summarizeProjectDataGovernance(projectId, {
      asOf: url.searchParams.get("as_of") || undefined,
    });

    return Response.json({ project_id: projectId, data_governance: governance }, { status: 200 });
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
