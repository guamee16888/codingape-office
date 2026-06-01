import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../lib/api-keys.mjs";
import { getRemediationObjective, updateRemediationObjectiveStatus } from "../../../../lib/autonomy-certification.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ objectiveId: string }> }
) {
  try {
    const { objectiveId } = await context.params;
    const objective = getRemediationObjective(objectiveId);

    if (!objective) {
      return Response.json({ error: "Remediation objective not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(objective.project_id, readApiKeyFromHeaders(request.headers));
    return Response.json({ remediation_objective: objective }, { status: 200 });
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
  context: { params: Promise<{ objectiveId: string }> }
) {
  try {
    const { objectiveId } = await context.params;
    const objective = getRemediationObjective(objectiveId);

    if (!objective) {
      return Response.json({ error: "Remediation objective not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(objective.project_id, readApiKeyFromHeaders(request.headers));
    const payload = await request.json();
    const result = updateRemediationObjectiveStatus(objectiveId, payload);

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.startsWith("Invalid remediation objective") || message.includes("status is required")
      ? 400
      : 500;
    return Response.json({ error: message }, { status });
  }
}
