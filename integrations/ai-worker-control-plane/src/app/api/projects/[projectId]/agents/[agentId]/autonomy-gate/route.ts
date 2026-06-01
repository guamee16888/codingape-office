import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../../../lib/api-keys.mjs";
import { checkAgentAutonomyGate, listProjectAutonomyGateChecks } from "../../../../../../../lib/autonomy-gates.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; agentId: string }> }
) {
  try {
    const { projectId, agentId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const url = new URL(request.url);
    const checks = listProjectAutonomyGateChecks(projectId, {
      agentId,
      limit: Number(url.searchParams.get("limit") || 20),
    });

    return Response.json({ project_id: projectId, agent_id: agentId, autonomy_gate_checks: checks }, { status: 200 });
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

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; agentId: string }> }
) {
  try {
    const { projectId, agentId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const result = checkAgentAutonomyGate(projectId, agentId);

    return Response.json(result, { status: 201 });
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
