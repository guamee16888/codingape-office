import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { createReportSubscription, listReportSubscriptions } from "../../../../../lib/report-subscriptions.mjs";
import { ValidationError } from "../../../../../lib/validation.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const subscriptions = listReportSubscriptions(projectId);
    return Response.json({ project_id: projectId, subscriptions }, { status: 200 });
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

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const subscription = createReportSubscription(projectId, await request.json());
    return Response.json(subscription, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof ValidationError) {
      return Response.json({ error: error.message, details: error.details }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.includes("not found") ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}

