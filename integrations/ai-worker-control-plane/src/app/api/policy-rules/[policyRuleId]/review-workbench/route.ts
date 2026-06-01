import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { buildPolicyReviewWorkbench, renderPolicyReviewWorkbenchMarkdown } from "../../../../../lib/policy-governance-dossier.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ policyRuleId: string }> }
) {
  try {
    const { policyRuleId } = await context.params;
    const workbench = buildPolicyReviewWorkbench(policyRuleId);

    if (!workbench) {
      return Response.json({ error: "Policy rule not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(workbench.project_id, readApiKeyFromHeaders(request.headers));
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "markdown") {
      return new Response(renderPolicyReviewWorkbenchMarkdown(workbench), {
        status: 200,
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }

    return Response.json({ policy_review_workbench: workbench }, { status: 200 });
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
