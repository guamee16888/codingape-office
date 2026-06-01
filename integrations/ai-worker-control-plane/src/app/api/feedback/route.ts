import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../lib/api-keys.mjs";
import { storeFeedback } from "../../../lib/feedback.mjs";
import { validateFeedbackPayload, ValidationError } from "../../../lib/validation.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const normalized = validateFeedbackPayload(payload);
    authenticateIngestionApiKey(normalized.project_id, readApiKeyFromHeaders(request.headers));
    const result = storeFeedback(normalized);

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof ValidationError) {
      return Response.json(
        { error: error.message, details: error.details },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.includes("not found") ? 404 : 500;

    return Response.json({ error: message }, { status });
  }
}
