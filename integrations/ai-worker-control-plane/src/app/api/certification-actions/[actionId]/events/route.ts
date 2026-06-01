import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { getCertificationAction, listCertificationActionEvents } from "../../../../../lib/autonomy-certification.mjs";

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
    const url = new URL(request.url);

    return Response.json({
      certification_action_id: actionId,
      certification_action_events: listCertificationActionEvents(actionId, {
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
