import { NextResponse } from "next/server";
import { codexAccount } from "@/server/codex-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await codexAccount.account()); }
  catch (error) { return NextResponse.json({ account: null, requiresOpenaiAuth: true, error: error instanceof Error ? error.message : "Could not read the Codex account." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const body = await request.json() as { action?: "login" | "apiKey" | "logout"; apiKey?: string };
  try {
    if (body.action === "login") return NextResponse.json(await codexAccount.loginWithChatGPT());
    if (body.action === "apiKey") {
      if (!body.apiKey || body.apiKey.length > 500) return NextResponse.json({ error: "A valid API key is required." }, { status: 400 });
      return NextResponse.json(await codexAccount.loginWithApiKey(body.apiKey));
    }
    if (body.action === "logout") { await codexAccount.logout(); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: "Unknown account action." }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Codex account action failed." }, { status: 502 }); }
}
