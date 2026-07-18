import { NextResponse } from "next/server";
import type { SelectionContext } from "@/domain/types";
import { runCodexRefinement, runCodexWebRefinement } from "@/server/codex-client";
import { applyProjectPatch, fallbackRefinement } from "@/server/refine";
import { loadLandingHtml, loadProject, saveProject, saveProjectManifest, writeLandingHtml } from "@/server/store";
import { runVisualCheck } from "@/server/visual";
import { activeProjectId } from "@/server/paths";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const { instruction, selection, deliverable, mode = "auto" } = await request.json() as { instruction?: unknown; selection?: SelectionContext; deliverable?: "brand" | "system" | "web" | "slides"; mode?: "auto" | "codex" | "fallback" };
  if (typeof instruction !== "string" || !instruction.trim()) return NextResponse.json({ error: "An instruction is required." }, { status: 400 });
  if (instruction.length > 2_000) return NextResponse.json({ error: "The instruction is too long." }, { status: 400 });
  if (!(["auto", "codex", "fallback"] as const).includes(mode)) return NextResponse.json({ error: "Unknown refinement mode." }, { status: 400 });
  const project = await loadProject(activeProjectId(request));
  let warning: string | undefined;
  if (deliverable === "web" && mode !== "fallback") {
    const originalHtml = await loadLandingHtml(project.id);
    try {
      await runVisualCheck(project.id, "before");
      const result = await runCodexWebRefinement(project, instruction.trim(), selection);
      project.threadId = result.threadId;
      if (result.changed) {
        project.version += 1;
        project.lastSummary = result.summary;
        project.webCustomized = true;
      }
      const visual = await runVisualCheck(project.id, "after");
      if (Object.values(visual.renders).some((render) => render.horizontalOverflow)) {
        await writeLandingHtml(project.id, originalHtml);
        return NextResponse.json({ error: "The proposed design overflowed its viewport, so the original artifact was restored." }, { status: 422 });
      }
      await saveProjectManifest(project);
      return NextResponse.json({ ...result, project, landingHtml: await loadLandingHtml(project.id), visual });
    } catch (error) {
      await writeLandingHtml(project.id, originalHtml);
      if (mode === "codex") return NextResponse.json({ error: error instanceof Error ? error.message : "Codex Web refinement failed." }, { status: 502 });
      if (project.webCustomized) return NextResponse.json({ error: "Codex could not safely refine this custom composition; the original artifact was preserved." }, { status: 502 });
      warning = `The direct Web editor was unavailable, so a safe structured refinement was used: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  }
  let result;
  if (mode !== "fallback") {
    try {
      const codex = await runCodexRefinement(project, instruction.trim(), selection);
      project.threadId = codex.threadId;
      result = applyProjectPatch(project, codex.patch, "codex");
      result.project.threadId = codex.threadId;
    } catch (error) {
      if (mode === "codex") return NextResponse.json({ error: error instanceof Error ? error.message : "Codex refinement failed." }, { status: 502 });
      warning = `Codex was unavailable, so the reliable local refinement was used: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  }
  result ??= fallbackRefinement(project, instruction.trim(), selection);
  if (deliverable === "web") result.project.webCustomized = false;
  await saveProject(result.project, { renderWeb: deliverable === "web" || !result.project.webCustomized });
  return NextResponse.json({ ...result, landingHtml: await loadLandingHtml(result.project.id), warning });
}
