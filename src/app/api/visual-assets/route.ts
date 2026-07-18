import { NextResponse } from "next/server";
import type { VisualAssetBrief, VisualAssetTarget, VisualGenerationAdapter } from "@/domain/visual-assets";
import { activeProjectId } from "@/server/paths";
import { MacOSOpenAIKeychain } from "@/server/openai-keychain";
import { CodexVisualBriefPlanner, createDefaultVisualGenerationAdapter, OpenAIImageApiAdapter, OpenAIResponsesImageAdapter } from "@/server/openai-visual";
import { loadProject } from "@/server/store";
import {
  approveVisualAsset,
  cancelVisualAssetGeneration,
  compareVisualAssetVersions,
  generateVisualAsset,
  loadVisualAssetRegistry,
  placeVisualAsset,
  refineVisualAsset,
  restoreVisualAsset,
  retryVisualAssetGeneration,
  saveVisualAssetBrief,
  transitionVisualAssetApproval
} from "@/server/visual-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function adapter(name: unknown): VisualGenerationAdapter {
  if (name === undefined || name === "codex-app-server") return createDefaultVisualGenerationAdapter();
  const keychain = new MacOSOpenAIKeychain();
  if (name === "openai-image-api") return new OpenAIImageApiAdapter(keychain);
  if (name === "openai-responses-api") return new OpenAIResponsesImageAdapter(keychain);
  throw new Error("Unknown visual generation adapter.");
}

function failure(error: unknown, status = 409) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Visual asset operation failed." }, { status });
}

export async function GET(request: Request) {
  try {
    const projectId = activeProjectId(request);
    const compare = new URL(request.url).searchParams.get("compare");
    if (compare) return NextResponse.json({ comparison: await compareVisualAssetVersions(projectId, compare.split(",").filter(Boolean)) });
    return NextResponse.json({ registry: await loadVisualAssetRegistry(projectId), defaultAdapter: "codex-app-server", zeroKey: true });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const projectId = activeProjectId(request);
    const body = await request.json() as { action?: unknown; assetId?: unknown; brief?: VisualAssetBrief; sourceVersionId?: unknown; instruction?: unknown; adapter?: unknown; objective?: unknown; target?: VisualAssetTarget; brandSystemVersionId?: unknown; output?: VisualAssetBrief["output"] };
    if (body.action === "brief" && body.brief) return NextResponse.json({ brief: await saveVisualAssetBrief(projectId, body.brief) }, { status: 201 });
    if (body.action === "draft-brief" && typeof body.objective === "string" && body.target && typeof body.brandSystemVersionId === "string" && body.output) return NextResponse.json({ brief: await new CodexVisualBriefPlanner().plan(projectId, await loadProject(projectId), { objective: body.objective, target: body.target, brandSystemVersionId: body.brandSystemVersionId, output: body.output }) });
    if (body.action === "generate" && typeof body.assetId === "string" && body.brief) return NextResponse.json(await generateVisualAsset(projectId, body.assetId, body.brief, adapter(body.adapter)), { status: 201 });
    if (body.action === "refine" && typeof body.sourceVersionId === "string" && typeof body.instruction === "string") return NextResponse.json(await refineVisualAsset(projectId, body.sourceVersionId, body.instruction, adapter(body.adapter)), { status: 201 });
    return failure(new Error("Use brief, generate or refine with the required structured fields."), 400);
  } catch (error) { return failure(error, 502); }
}

export async function PATCH(request: Request) {
  try {
    const projectId = activeProjectId(request);
    const body = await request.json() as { action?: unknown; versionId?: unknown; runId?: unknown; target?: VisualAssetTarget; placementId?: unknown; note?: unknown; adapter?: unknown };
    if (body.action === "approve" && typeof body.versionId === "string") return NextResponse.json({ version: await approveVisualAsset(projectId, body.versionId, { note: typeof body.note === "string" ? body.note : undefined }) });
    if ((body.action === "reject" || body.action === "changes_requested") && typeof body.versionId === "string") return NextResponse.json({ version: await transitionVisualAssetApproval(projectId, body.versionId, body.action === "reject" ? "rejected" : "changes_requested", { note: typeof body.note === "string" ? body.note : undefined }) });
    if (body.action === "restore" && typeof body.versionId === "string") return NextResponse.json({ version: await restoreVisualAsset(projectId, body.versionId) }, { status: 201 });
    if (body.action === "place" && typeof body.versionId === "string" && body.target) return NextResponse.json({ placement: await placeVisualAsset(projectId, body.versionId, body.target, { placementId: typeof body.placementId === "string" ? body.placementId : undefined }) });
    if (body.action === "cancel" && typeof body.runId === "string") return NextResponse.json({ run: await cancelVisualAssetGeneration(projectId, body.runId) });
    if (body.action === "retry" && typeof body.runId === "string") return NextResponse.json({ versions: await retryVisualAssetGeneration(projectId, body.runId, adapter(body.adapter)) }, { status: 201 });
    return failure(new Error("Unknown visual asset lifecycle action."), 400);
  } catch (error) { return failure(error); }
}
