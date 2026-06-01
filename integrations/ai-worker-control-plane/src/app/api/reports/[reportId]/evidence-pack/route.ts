import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { buildReportEvidencePack, recordReportEvidencePackExport } from "../../../../../lib/report-evidence.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await context.params;
    const url = new URL(request.url);
    const redact = ["1", "true", "yes"].includes((url.searchParams.get("redact") || "").toLowerCase());
    const pack = buildReportEvidencePack(reportId, { redact });

    if (!pack) {
      return Response.json({ error: "Report not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(pack.report.project_id, readApiKeyFromHeaders(request.headers));
    recordReportEvidencePackExport(reportId, pack, {
      actorType: "api_key",
      actorId: null,
      exportSurface: "api",
    });
    return Response.json(pack, { status: 200 });
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
