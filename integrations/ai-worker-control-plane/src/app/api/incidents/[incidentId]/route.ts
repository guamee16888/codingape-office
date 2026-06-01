import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../lib/api-keys.mjs";
import { getIncidentReport, updateIncidentRemediation } from "../../../../lib/incident-reports.mjs";

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
    return Response.json({ incident_report: incident }, { status: 200 });
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
  context: { params: Promise<{ incidentId: string }> }
) {
  try {
    const { incidentId } = await context.params;
    const incident = getIncidentReport(incidentId);

    if (!incident) {
      return Response.json({ error: "Incident report not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(incident.project_id, readApiKeyFromHeaders(request.headers));
    const payload = await request.json();
    const result = updateIncidentRemediation(incidentId, payload);

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.startsWith("Invalid incident remediation") || message.includes("already in remediation")
      ? 400
      : 500;
    return Response.json({ error: message }, { status });
  }
}
