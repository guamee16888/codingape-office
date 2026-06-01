import { createProject } from "../../../lib/projects.mjs";
import { ValidationError } from "../../../lib/validation.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = createProject(payload);

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return Response.json(
        { error: error.message, details: error.details },
        { status: 400 }
      );
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

