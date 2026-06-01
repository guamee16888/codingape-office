import { AuthError, authenticateIngestionApiKey, readApiKeyFromHeaders } from "../../../../lib/api-keys.mjs";
import { runNightlyHealthCheck } from "../../../../lib/nightly.mjs";
import { validateNightlyReportPayload, ValidationError } from "../../../../lib/validation.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const normalized = validateNightlyReportPayload(payload);
    authenticateIngestionApiKey(normalized.project_id, readApiKeyFromHeaders(request.headers));

    const result = await runNightlyHealthCheck(normalized.project_id, normalized.date, {
      deliverTo: normalized.deliver_to,
      targetAutonomyLevel: normalized.target_autonomy_level,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof ValidationError) {
      return Response.json({ error: error.message, details: error.details }, { status: 400 });
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
