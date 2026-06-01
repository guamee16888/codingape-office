import { ingestAgentRun } from "../../../lib/runs.mjs";
import { ValidationError, validateRunPayload } from "../../../lib/validation.mjs";
import {
  AuthError,
  authenticateIngestionApiKey,
  readApiKeyFromHeaders,
  verifyWebhookSignature,
} from "../../../lib/api-keys.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const payload = JSON.parse(body);
    const normalized = validateRunPayload(payload);
    const apiKey = readApiKeyFromHeaders(request.headers);
    const auth = authenticateIngestionApiKey(normalized.project_id, apiKey);
    const signature = verifyWebhookSignature({
      apiKey,
      body,
      headers: request.headers,
      required: process.env.AIWC_REQUIRE_WEBHOOK_SIGNATURE === "true",
    });
    const result = ingestAgentRun(normalized, {
      requireExistingScope: true,
      authContext: {
        api_key_id: auth.api_key_id,
        signature,
        source: "webhook",
      },
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json(
        { error: error.message },
        { status: error.status }
      );
    }

    if (error instanceof ValidationError) {
      return Response.json(
        { error: error.message, details: error.details },
        { status: 400 }
      );
    }

    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "Run payload must be valid JSON" },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.includes("not found") ? 404 : 500;

    return Response.json({ error: message }, { status });
  }
}
