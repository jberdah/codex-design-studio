import { NextResponse } from "next/server";
import { activeProjectId } from "@/server/paths";
import { queueExtraction, removeSource } from "@/server/source-store";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const { sourceId } = await context.params;
    return NextResponse.json({ source: await removeSource(activeProjectId(request), sourceId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove source." }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const { sourceId } = await context.params;
    const body = await request.json() as { action?: unknown };
    if (!["retry", "refresh", "reprocess"].includes(String(body.action))) return NextResponse.json({ error: "Unsupported source action." }, { status: 400 });
    const run = await queueExtraction(activeProjectId(request), sourceId, body.action as "retry" | "refresh" | "reprocess");
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not queue extraction." }, { status: 404 });
  }
}
