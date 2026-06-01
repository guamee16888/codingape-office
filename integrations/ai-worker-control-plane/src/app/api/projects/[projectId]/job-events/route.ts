import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { listProjectJobEvents } from "../../../../../lib/job-events.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const events = listProjectJobEvents(projectId, {
      status: url.searchParams.get("status") || undefined,
      jobType: url.searchParams.get("job_type") || undefined,
      targetType: url.searchParams.get("target_type") || undefined,
      unresolvedOnly: url.searchParams.get("unresolved") === "true",
      limit: Number(url.searchParams.get("limit") || 50),
    });

    return Response.json({ project_id: projectId, job_events: events }, { status: 200 });
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

