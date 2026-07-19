import { NextResponse } from "next/server";
import { approveBootstrapSession } from "@/server/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const body = await request.json().catch(() => ({})) as { briefVersion?: unknown };
    const result = await approveBootstrapSession(sessionId, body.briefVersion === undefined ? undefined : Number(body.briefVersion));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not approve bootstrap.";
    return NextResponse.json({ error: message }, { status: /conflict|before approval|reviewed/i.test(message) ? 409 : /not found/i.test(message) ? 404 : 400 });
  }
}
