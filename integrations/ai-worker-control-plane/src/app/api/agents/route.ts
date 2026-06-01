import { createAgent } from "../../../lib/projects.mjs";
import { ValidationError } from "../../../lib/validation.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = createAgent(payload);

    return Response.json(result, { status: 201 });
  } catch (error) {
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

