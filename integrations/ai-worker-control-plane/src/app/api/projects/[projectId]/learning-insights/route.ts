import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { listProjectLearningInsights } from "../../../../../lib/learning-insights.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const insights = listProjectLearningInsights(projectId, {
      reportId: url.searchParams.get("report_id") || undefined,
      insightType: url.searchParams.get("insight_type") || undefined,
      status: url.searchParams.get("status") || undefined,
      limit: Number(url.searchParams.get("limit") || 50),
    });

    return Response.json({ project_id: projectId, learning_insights: insights }, { status: 200 });
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
