import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { listProjectIncidentReports } from "../../../../../lib/incident-reports.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const incidentReports = listProjectIncidentReports(projectId, {
      agentId: url.searchParams.get("agent_id") || undefined,
      severity: url.searchParams.get("severity") || undefined,
      remediationStatus: url.searchParams.get("remediation_status") || undefined,
      limit: Number(url.searchParams.get("limit") || 50),
    });

    return Response.json({ project_id: projectId, incident_reports: incidentReports }, { status: 200 });
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
