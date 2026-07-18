import { NextResponse } from "next/server";
import { activeProjectId } from "@/server/paths";
import { cancelExtraction, updateExtractionRun } from "@/server/source-store";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const body = await request.json();
    if (!body || !["running", "succeeded", "failed", "cancelled"].includes(body.status)) return NextResponse.json({ error: "Invalid extraction status." }, { status: 400 });
    const run = body.status === "cancelled"
      ? await cancelExtraction(activeProjectId(request), runId)
      : await updateExtractionRun(activeProjectId(request), runId, body);
    return NextResponse.json({ run });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update extraction." }, { status: 409 });
  }
}
