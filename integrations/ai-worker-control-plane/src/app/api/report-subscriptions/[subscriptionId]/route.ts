import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../lib/api-keys.mjs";
import { getReportSubscription, updateReportSubscription } from "../../../../lib/report-subscriptions.mjs";
import { ValidationError } from "../../../../lib/validation.mjs";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ subscriptionId: string }> }
) {
  try {
    const { subscriptionId } = await context.params;
    const existing = getReportSubscription(subscriptionId);

    if (!existing) {
      return Response.json({ error: "Report subscription not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(existing.project_id, readApiKeyFromHeaders(request.headers));
    const subscription = updateReportSubscription(subscriptionId, await request.json());

    return Response.json(subscription, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof ValidationError) {
      return Response.json({ error: error.message, details: error.details }, { status: 400 });
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
