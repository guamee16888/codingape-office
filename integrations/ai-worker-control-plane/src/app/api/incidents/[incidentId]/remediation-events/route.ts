import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { getIncidentReport, listIncidentRemediationEvents } from "../../../../../lib/incident-reports.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ incidentId: string }> }
) {
  try {
    const { incidentId } = await context.params;
    const incident = getIncidentReport(incidentId);

    if (!incident) {
      return Response.json({ error: "Incident report not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(incident.project_id, readApiKeyFromHeaders(request.headers));
    const url = new URL(request.url);
    const remediationEvents = listIncidentRemediationEvents(incidentId, {
      limit: Number(url.searchParams.get("limit") || 50),
    });

    return Response.json({
      incident_report_id: incidentId,
      remediation_events: remediationEvents,
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
