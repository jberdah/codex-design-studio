import { NextResponse } from "next/server";
import { answerBootstrapQuestions, loadBootstrapSession } from "@/server/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    return NextResponse.json({ session: await loadBootstrapSession(sessionId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bootstrap session was not found." }, { status: 404 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const body = await request.json() as { answers?: unknown };
    return NextResponse.json({ session: await answerBootstrapQuestions(sessionId, body.answers) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update bootstrap answers.";
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : /after synthesis|transition/i.test(message) ? 409 : 400 });
  }
}
