import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../lib/api-keys.mjs";
import { buildLearningRuleReview, getLearningRule, listProjectLearningRules, updateLearningRuleStatus } from "../../../../../lib/learning-rules.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const review = url.searchParams.get("review") === "true";
    if (review) {
      const result = buildLearningRuleReview(projectId, {
        ruleType: url.searchParams.get("rule_type") || undefined,
        status: url.searchParams.get("status") || undefined,
        limit: Number(url.searchParams.get("limit") || 50),
      });
      return Response.json(result, { status: 200 });
    }

    const learningRules = listProjectLearningRules(projectId, {
      ruleType: url.searchParams.get("rule_type") || undefined,
      status: url.searchParams.get("status") || undefined,
      limit: Number(url.searchParams.get("limit") || 50),
    });

    return Response.json({ project_id: projectId, learning_rules: learningRules }, { status: 200 });
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
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));
    const payload = await request.json();
    const learningRuleId = String(payload.learning_rule_id || payload.id || "");
    if (!learningRuleId) {
      return Response.json({ error: "learning_rule_id is required" }, { status: 400 });
    }
    const existing = getLearningRule(learningRuleId);
    if (!existing) {
      return Response.json({ error: "Learning rule not found" }, { status: 404 });
    }
    if (existing.project_id !== projectId) {
      return Response.json({ error: "Learning rule does not belong to project" }, { status: 403 });
    }
    const result = updateLearningRuleStatus(learningRuleId, {
      status: payload.status,
      note: payload.note,
      evidence: payload.evidence,
      actor_type: payload.actor_type || "api",
      actor_id: payload.actor_id || null,
    });
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
