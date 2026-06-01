import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { getRemediationObjective, listRemediationObjectiveEvents } from "../../../../../lib/autonomy-certification.mjs";

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
    return Response.json({
      remediation_objective_events: listRemediationObjectiveEvents(objectiveId),
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
