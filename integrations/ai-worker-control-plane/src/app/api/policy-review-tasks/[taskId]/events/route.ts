import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { getPolicyReviewTask, listPolicyReviewTaskEvents } from "../../../../../lib/policy-dry-run.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await context.params;
    const task = getPolicyReviewTask(taskId);

    if (!task) {
      return Response.json({ error: "Policy review task not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(task.project_id, readApiKeyFromHeaders(request.headers));
    const url = new URL(request.url);

    return Response.json({
      policy_review_task_id: taskId,
      policy_review_task_events: listPolicyReviewTaskEvents(taskId, {
        limit: Number(url.searchParams.get("limit") || 50),
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
