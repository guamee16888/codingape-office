import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { getReportHtml } from "../../../../../lib/report-rendering.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await context.params;
    const locale = new URL(request.url).searchParams.get("locale") || undefined;
    const rendered = getReportHtml(reportId, { locale });

    if (!rendered) {
      return Response.json({ error: "Report not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(rendered.report.project_id, readApiKeyFromHeaders(request.headers));
    return new Response(rendered.html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
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
