import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../lib/api-keys.mjs";
import { getCertificationAction, updateCertificationActionStatus } from "../../../../lib/autonomy-certification.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ actionId: string }> }
) {
  try {
    const { actionId } = await context.params;
    const action = getCertificationAction(actionId);

    if (!action) {
      return Response.json({ error: "Certification action not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(action.project_id, readApiKeyFromHeaders(request.headers));
    return Response.json({ certification_action: action }, { status: 200 });
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
  context: { params: Promise<{ actionId: string }> }
) {
  try {
    const { actionId } = await context.params;
    const action = getCertificationAction(actionId);

    if (!action) {
      return Response.json({ error: "Certification action not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(action.project_id, readApiKeyFromHeaders(request.headers));
    const payload = await request.json();
    const result = updateCertificationActionStatus(actionId, {
      ...payload,
      actor_type: payload.actor_type || "api_user",
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.startsWith("Invalid certification action") || message.includes("status is required")
      ? 400
      : 500;
    return Response.json({ error: message }, { status });
  }
}
