import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { buildPolicyGovernanceDossier, renderPolicyGovernanceDossierMarkdown } from "../../../../../lib/policy-governance-dossier.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ policyRuleId: string }> }
) {
  try {
    const { policyRuleId } = await context.params;
    const dossier = buildPolicyGovernanceDossier(policyRuleId);

    if (!dossier) {
      return Response.json({ error: "Policy rule not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(dossier.project_id, readApiKeyFromHeaders(request.headers));
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "markdown") {
      return new Response(renderPolicyGovernanceDossierMarkdown(dossier), {
        status: 200,
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }

    return Response.json({ policy_governance_dossier: dossier }, { status: 200 });
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
