import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { listProjectPolicyRules } from "../../../../../lib/policy-rules.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const enabledParam = url.searchParams.get("enabled");
    const enabled = enabledParam === null ? undefined : enabledParam === "true" || enabledParam === "1";
    const policyRules = listProjectPolicyRules(projectId, {
      ruleType: url.searchParams.get("rule_type") || undefined,
      reviewStatus: url.searchParams.get("review_status") || undefined,
      enabled,
      limit: Number(url.searchParams.get("limit") || 50),
    });

    return Response.json({ project_id: projectId, policy_rules: policyRules }, { status: 200 });
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
