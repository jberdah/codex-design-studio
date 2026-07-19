import { NextResponse } from "next/server";
import type { SelectionContext } from "@/domain/types";
import { runCodexRefinement, runCodexWebRefinement } from "@/server/codex-client";
import { applyProjectPatch, fallbackRefinement } from "@/server/refine";
import { loadLandingHtml, loadProject, saveProject, saveProjectManifest, writeLandingHtml } from "@/server/store";
import { runVisualCheck } from "@/server/visual";
import { activeProjectId, safeProjectPath } from "@/server/paths";
import { assessWebMutation, runFileRollbackTransaction } from "@/server/quality";
import { createWebRefinementCandidate } from "@/server/web-candidates";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const { instruction, selection, deliverable, mode = "auto" } = await request.json() as { instruction?: unknown; selection?: SelectionContext; deliverable?: "brand" | "system" | "web" | "slides"; mode?: "auto" | "codex" | "fallback" };
  if (typeof instruction !== "string" || !instruction.trim()) return NextResponse.json({ error: "An instruction is required." }, { status: 400 });
  if (instruction.length > 2_000) return NextResponse.json({ error: "The instruction is too long." }, { status: 400 });
  if (!(["auto", "codex", "fallback"] as const).includes(mode)) return NextResponse.json({ error: "Unknown refinement mode." }, { status: 400 });
  let project = await loadProject(activeProjectId(request));
  let warning: string | undefined;
  if (deliverable === "web" && mode !== "fallback") {
    const originalProject = structuredClone(project);
    const originalHtml = await loadLandingHtml(project.id);
    const landingPath = await safeProjectPath(project.id, "web", "index.html");
    try {
      const transaction = await runFileRollbackTransaction(landingPath, async () => {
        const beforeVisual = await runVisualCheck(project.id, "before");
        const result = await runCodexWebRefinement(project, instruction.trim(), selection);
        project.threadId = result.threadId;
        if (result.changed) {
          project.version += 1;
          project.lastSummary = result.summary;
          project.webCustomized = true;
        }
        const visual = await runVisualCheck(project.id, "after");
        const afterHtml = await loadLandingHtml(project.id);
        const assessment = assessWebMutation({ beforeSource: originalHtml, afterSource: afterHtml, beforeReport: beforeVisual, report: visual, claimedChanged: result.changed });
        return { result, visual, assessment, afterHtml };
      }, ({ assessment }) => assessment.accepted && !assessment.requiresUserDecision);
      if (!transaction.committed) {
        if (transaction.result.assessment.sourceChanged && transaction.result.result.changed) {
          const candidate = await createWebRefinementCandidate(project.id, {
            instruction: instruction.trim(), selection, summary: transaction.result.result.summary, threadId: transaction.result.result.threadId,
            baseProjectVersion: originalProject.version, beforeHtml: originalHtml, candidateHtml: transaction.result.afterHtml,
            assessment: transaction.result.assessment, visual: transaction.result.visual
          });
          project = originalProject;
          return NextResponse.json({
            ...transaction.result.result,
            project,
            landingHtml: originalHtml,
            candidateHtml: transaction.result.afterHtml,
            candidate,
            visual: transaction.result.visual,
            assessment: transaction.result.assessment
          }, { status: 202 });
        }
        return NextResponse.json({ error: `${transaction.result.assessment.reasons.join(" ")} The original artifact was preserved.`, assessment: transaction.result.assessment }, { status: 422 });
      }
      await saveProjectManifest(project);
      return NextResponse.json({ ...transaction.result.result, project, landingHtml: transaction.result.afterHtml, visual: transaction.result.visual, assessment: transaction.result.assessment });
    } catch (error) {
      await writeLandingHtml(project.id, originalHtml);
      project = originalProject;
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
