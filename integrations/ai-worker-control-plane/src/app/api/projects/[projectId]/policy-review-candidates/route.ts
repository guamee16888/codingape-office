import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { listProjectPolicyRuleReviewCandidates } from "../../../../../lib/policy-dry-run.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));
    const url = new URL(request.url);

    return Response.json({
      project_id: projectId,
      policy_rule_review_candidates: listProjectPolicyRuleReviewCandidates(projectId, {
        status: url.searchParams.get("status") || undefined,
        policyRuleId: url.searchParams.get("policy_rule_id") || undefined,
        limit: Number(url.searchParams.get("limit") || 50),
      }),
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
