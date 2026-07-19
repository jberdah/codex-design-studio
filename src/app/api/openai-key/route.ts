import { NextResponse } from "next/server";
import { readJsonBody } from "@/server/http";
import { MacOSOpenAIKeychain } from "@/server/openai-keychain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const keychain = new MacOSOpenAIKeychain();
  return NextResponse.json({ configured: Boolean(await keychain.getApiKey()), purpose: "Explicit BYOK/high-volume generation only", defaultAuth: "chatgpt" });
}

export async function POST(request: Request) {
  const body = await readJsonBody<{ apiKey?: unknown }>(request);
  if (!body || typeof body.apiKey !== "string") return NextResponse.json({ error: "A Platform API key is required." }, { status: 400 });
  try { await new MacOSOpenAIKeychain().setApiKey(body.apiKey); return NextResponse.json({ configured: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not store the Platform API key." }, { status: 409 }); }
}

export async function DELETE() {
  try { await new MacOSOpenAIKeychain().deleteApiKey(); return NextResponse.json({ configured: false }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove the Platform API key." }, { status: 409 }); }
}
