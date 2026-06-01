import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../lib/api-keys.mjs";
import { getPolicyReviewTask, updatePolicyReviewTaskStatus } from "../../../../lib/policy-dry-run.mjs";

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
    return Response.json({ policy_review_task: task }, { status: 200 });
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

export async function PATCH(
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
    const payload = await request.json();
    const result = updatePolicyReviewTaskStatus(taskId, {
      ...payload,
      actor_type: payload.actor_type || "api_user",
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.startsWith("Invalid policy review task") || message.includes("status is required")
      ? 400
      : 500;
    return Response.json({ error: message }, { status });
  }
}
