import { NextResponse } from "next/server";
import { renderLandingHtml } from "@/server/landing";
import { resetProject } from "@/server/store";

export const runtime = "nodejs";

export async function POST() {
  const project = await resetProject();
  return NextResponse.json({ project, landingHtml: renderLandingHtml(project) });
}
