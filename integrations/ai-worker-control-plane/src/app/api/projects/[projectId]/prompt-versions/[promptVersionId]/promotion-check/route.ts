import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../../../../lib/api-keys.mjs";
import { checkPromptPromotionReadiness } from "../../../../../../../lib/prompt-versions.mjs";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; promptVersionId: string }> }
) {
  try {
    const { projectId, promptVersionId } = await context.params;
    authenticateIngestionApiKey(projectId, readApiKeyFromHeaders(request.headers));

    const result = checkPromptPromotionReadiness(projectId, promptVersionId);

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
