import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { buildReadinessDossier, renderReadinessDossierMarkdown } from "../../../../../lib/readiness-dossier.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await context.params;
    const dossier = buildReadinessDossier(reportId);

    if (!dossier) {
      return Response.json({ error: "Report not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(dossier.project_id, readApiKeyFromHeaders(request.headers));
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "markdown") {
      return new Response(renderReadinessDossierMarkdown(dossier), {
        status: 200,
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }

    return Response.json({ readiness_dossier: dossier }, { status: 200 });
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
