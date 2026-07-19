import { NextResponse } from "next/server";
import { synthesizeBootstrapWithPreparedReference } from "@/server/bootstrap-reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    return NextResponse.json(await synthesizeBootstrapWithPreparedReference(sessionId, { signal: request.signal }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not synthesize the strategic creative brief.";
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : /not ready|required|transition/i.test(message) ? 409 : 400 });
  }
}
