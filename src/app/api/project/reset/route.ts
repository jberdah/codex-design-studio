import { NextResponse } from "next/server";
import { renderLandingHtml } from "@/server/landing";
import { resetProject } from "@/server/store";
import { activeProjectId } from "@/server/paths";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const project = await resetProject(activeProjectId(request));
  return NextResponse.json({ project, landingHtml: renderLandingHtml(project) });
}
