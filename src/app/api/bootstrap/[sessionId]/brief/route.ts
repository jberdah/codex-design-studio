import { NextResponse } from "next/server";
import type { StrategicCreativeBriefVersion } from "@/domain/bootstrap";
import { reviseBootstrapBrief } from "@/server/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const body = await request.json() as { expectedVersion?: unknown; brief?: StrategicCreativeBriefVersion };
    if (!body.brief) return NextResponse.json({ error: "A strategic creative brief is required." }, { status: 400 });
    return NextResponse.json({ session: await reviseBootstrapBrief(sessionId, Number(body.expectedVersion), body.brief) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not revise the strategic creative brief.";
    return NextResponse.json({ error: message }, { status: /conflict|not in review/i.test(message) ? 409 : /not found/i.test(message) ? 404 : 400 });
  }
}
