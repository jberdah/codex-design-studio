import { NextResponse } from "next/server";
import type { ProjectData } from "@/domain/types";
import { activeProjectId } from "@/server/paths";
import { brandSystemWorkspace, createBrandSystemDraft, publishBrandSystem } from "@/server/brand-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json(await brandSystemWorkspace(activeProjectId(request)));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown; versionId?: unknown; brand?: ProjectData["brand"]; tokens?: ProjectData["tokens"] };
    const projectId = activeProjectId(request);
    if (body.action === "draft") return NextResponse.json(await createBrandSystemDraft(projectId, body.brand && body.tokens ? { brand: body.brand, tokens: body.tokens } : undefined), { status: 201 });
    if (body.action === "publish" && typeof body.versionId === "string") return NextResponse.json(await publishBrandSystem(projectId, body.versionId));
    return NextResponse.json({ error: "Use draft or publish with a version id." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "BrandSystem transaction failed." }, { status: 409 });
  }
}
