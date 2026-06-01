import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../lib/api-keys.mjs";
import { getPolicyRuleReviewCandidate, updatePolicyRuleReviewCandidateStatus } from "../../../../lib/policy-dry-run.mjs";

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
    return Response.json({ policy_rule_review_candidate: candidate }, { status: 200 });
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
  context: { params: Promise<{ candidateId: string }> }
) {
  try {
    const { candidateId } = await context.params;
    const candidate = getPolicyRuleReviewCandidate(candidateId);

    if (!candidate) {
      return Response.json({ error: "Policy review candidate not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(candidate.project_id, readApiKeyFromHeaders(request.headers));
    const payload = await request.json();
    const result = updatePolicyRuleReviewCandidateStatus(candidateId, {
      ...payload,
      actor_type: payload.actor_type || "api_user",
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.startsWith("Invalid policy review candidate") || message.includes("status is required")
      ? 400
      : 500;
    return Response.json({ error: message }, { status });
  }
}
