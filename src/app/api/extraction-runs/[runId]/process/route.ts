import { NextResponse } from "next/server";
import { activeProjectId } from "@/server/paths";
import { processExtractionRun } from "@/server/extraction-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    return NextResponse.json({ run: await processExtractionRun(activeProjectId(request), runId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not process extraction." }, { status: 409 });
  }
}
