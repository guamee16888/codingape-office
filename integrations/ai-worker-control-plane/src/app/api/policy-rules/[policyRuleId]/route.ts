import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../lib/api-keys.mjs";
import { getPolicyRule, updatePolicyRuleReviewStatus } from "../../../../lib/policy-rules.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ policyRuleId: string }> }
) {
  try {
    const { policyRuleId } = await context.params;
    const policyRule = getPolicyRule(policyRuleId);

    if (!policyRule) {
      return Response.json({ error: "Policy rule not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(policyRule.project_id, readApiKeyFromHeaders(request.headers));
    return Response.json({ policy_rule: policyRule }, { status: 200 });
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
  context: { params: Promise<{ policyRuleId: string }> }
) {
  try {
    const { policyRuleId } = await context.params;
    const policyRule = getPolicyRule(policyRuleId);

    if (!policyRule) {
      return Response.json({ error: "Policy rule not found" }, { status: 404 });
    }

    authenticateIngestionApiKey(policyRule.project_id, readApiKeyFromHeaders(request.headers));
    const payload = await request.json();
    const result = updatePolicyRuleReviewStatus(policyRuleId, {
      ...payload,
      actor_type: payload.actor_type || "api_user",
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.startsWith("Invalid policy rule") || message.includes("status is required")
      ? 400
      : 500;
    return Response.json({ error: message }, { status });
  }
}
