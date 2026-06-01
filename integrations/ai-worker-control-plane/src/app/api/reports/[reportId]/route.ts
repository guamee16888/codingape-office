import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../lib/api-keys.mjs";
import { getReport } from "../../../../lib/reports.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await context.params;
    const report = getReport(reportId);

    if (!report) {
      return Response.json({ error: "Report not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(report.project_id, readApiKeyFromHeaders(request.headers));
    return Response.json(report, { status: 200 });
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

