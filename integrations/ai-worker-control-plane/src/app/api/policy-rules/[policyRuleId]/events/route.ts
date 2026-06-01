import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { getPolicyRule, listPolicyRuleEvents } from "../../../../../lib/policy-rules.mjs";

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
    const url = new URL(request.url);

    return Response.json({
      policy_rule_id: policyRuleId,
      policy_rule_events: listPolicyRuleEvents(policyRuleId, {
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
