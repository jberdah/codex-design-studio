import { NextResponse } from "next/server";
import type { ArtifactKind } from "@/domain/brand-system";
import { activeProjectId } from "@/server/paths";
import { changeArtifactBinding, loadBrandSystemVersion, previewArtifactUpgrade } from "@/server/brand-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ versionId: string }> }) {
  try {
    const { versionId } = await context.params;
    const artifact = new URL(request.url).searchParams.get("artifact") as ArtifactKind | null;
    if (artifact && /^[a-z0-9][a-z0-9._-]{0,99}$/i.test(artifact)) return NextResponse.json(await previewArtifactUpgrade(activeProjectId(request), artifact, versionId));
    return NextResponse.json({ snapshot: await loadBrandSystemVersion(activeProjectId(request), versionId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "BrandSystem version not found." }, { status: 404 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ versionId: string }> }) {
  try {
    const { versionId } = await context.params;
    const body = await request.json() as { action?: unknown; artifactId?: unknown };
    if (!(["upgrade", "rollback"].includes(String(body.action))) || typeof body.artifactId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(body.artifactId)) return NextResponse.json({ error: "A valid artifact action is required." }, { status: 400 });
    return NextResponse.json(await changeArtifactBinding(activeProjectId(request), body.artifactId as ArtifactKind, body.action as "upgrade" | "rollback", versionId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Artifact binding failed." }, { status: 409 });
  }
}
