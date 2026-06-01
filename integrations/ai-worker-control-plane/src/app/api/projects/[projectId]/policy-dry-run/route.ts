import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { dryRunPolicyRules, listPolicyDryRunEvidence } from "../../../../../lib/policy-dry-run.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const result = dryRunPolicyRules(projectId, date, {
      includeEnabled: url.searchParams.get("include_enabled") === "true",
      limit: Number(url.searchParams.get("limit") || 100),
    });

    if (url.searchParams.get("include_evidence") === "true") {
      return Response.json({
        ...result,
        persisted_evidence: listPolicyDryRunEvidence(projectId, {
          reportId: url.searchParams.get("report_id") || undefined,
          policyRuleId: url.searchParams.get("policy_rule_id") || undefined,
        }),
      }, { status: 200 });
    }

    return Response.json(result, { status: 200 });
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
