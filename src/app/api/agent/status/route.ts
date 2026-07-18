import { NextResponse } from "next/server";
import { codexStatus } from "@/server/codex-client";

export const runtime = "nodejs";
export async function GET() { return NextResponse.json(await codexStatus()); }
