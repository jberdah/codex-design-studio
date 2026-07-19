import { NextResponse } from "next/server";
import { createBootstrapSession, listBootstrapSessions } from "@/server/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ sessions: await listBootstrapSessions() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { input?: unknown } & Record<string, unknown>;
    const session = await createBootstrapSession(body.input ?? body);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start bootstrap." }, { status: 400 });
  }
}
