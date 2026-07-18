import { NextResponse } from "next/server";
import type { SelectionContext } from "@/domain/types";
import { runCodexRefinement } from "@/server/codex-client";
import { renderLandingHtml } from "@/server/landing";
import { applyProjectPatch, fallbackRefinement } from "@/server/refine";
import { loadProject, saveProject } from "@/server/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const { instruction, selection, mode = "auto" } = await request.json() as { instruction?: unknown; selection?: SelectionContext; mode?: "auto" | "codex" | "fallback" };
  if (typeof instruction !== "string" || !instruction.trim()) return NextResponse.json({ error: "An instruction is required." }, { status: 400 });
  if (instruction.length > 2_000) return NextResponse.json({ error: "The instruction is too long." }, { status: 400 });
  if (!(["auto", "codex", "fallback"] as const).includes(mode)) return NextResponse.json({ error: "Unknown refinement mode." }, { status: 400 });
  const project = await loadProject();
  let result;
  let warning: string | undefined;
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
  await saveProject(result.project);
  return NextResponse.json({ ...result, landingHtml: renderLandingHtml(result.project), warning });
}
