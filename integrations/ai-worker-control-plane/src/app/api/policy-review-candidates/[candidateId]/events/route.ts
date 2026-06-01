import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { getPolicyRuleReviewCandidate, listProjectPolicyRuleReviewCandidateEvents } from "../../../../../lib/policy-dry-run.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ candidateId: string }> }
) {
  try {
    const { candidateId } = await context.params;
    const candidate = getPolicyRuleReviewCandidate(candidateId);

    if (!candidate) {
      return Response.json({ error: "Policy review candidate not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(candidate.project_id, readApiKeyFromHeaders(request.headers));
    const url = new URL(request.url);
    const events = listProjectPolicyRuleReviewCandidateEvents(candidate.project_id, {
      limit: Number(url.searchParams.get("limit") || 50),
    }).filter((event: { policy_rule_review_candidate_id?: string }) => event.policy_rule_review_candidate_id === candidateId);

    return Response.json({
      policy_rule_review_candidate_id: candidateId,
      policy_rule_review_candidate_events: events,
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
