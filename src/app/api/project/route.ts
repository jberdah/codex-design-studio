import { NextResponse } from "next/server";
import type { BrandProfile, DesignTokens, LandingContent, ProjectData } from "@/domain/types";
import { readJsonBody } from "@/server/http";
import { createSlideDocument } from "@/domain/artifacts";
import { validHexColors } from "@/server/review";
import { loadLandingHtml, loadProject, mutateProject } from "@/server/store";
import { activeProjectId } from "@/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const project = await loadProject(activeProjectId(request));
  return NextResponse.json({ project, landingHtml: await loadLandingHtml(project.id) });
}

export async function PUT(request: Request) {
  const body = await readJsonBody<Partial<Pick<ProjectData, "brand" | "tokens" | "landing" | "slides" | "slideDocument">> & { expectedVersion?: number }>(request);
  if (!body) return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  if (!Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 0) return NextResponse.json({ error: "An integer expectedVersion is required for project mutations." }, { status: 400 });
  if (body.slides !== undefined && !Array.isArray(body.slides)) return NextResponse.json({ error: "Slides must be an array." }, { status: 400 });
  const projectId = activeProjectId(request);
  try {
    const project = await mutateProject(projectId, body.expectedVersion as number, (current) => {
      if (body.brand) current.brand = { ...current.brand, ...body.brand } as BrandProfile;
      if (body.tokens) current.tokens = { ...current.tokens, ...body.tokens, colors: { ...current.tokens.colors, ...body.tokens.colors }, typography: { ...current.tokens.typography, ...body.tokens.typography }, spacing: { ...current.tokens.spacing, ...body.tokens.spacing }, shape: { ...current.tokens.shape, ...body.tokens.shape } } as DesignTokens;
      if (body.landing) current.landing = { ...current.landing, ...body.landing } as LandingContent;
      if (body.slides) current.slides = structuredClone(body.slides);
      if (body.slideDocument) current.slideDocument = createSlideDocument(body.slideDocument);
      if (!validHexColors(current.tokens)) throw new Error("All colour tokens must be six-digit hex values.");
      current.lastSummary = current.webCustomized
        ? "Saved the brand system while preserving the custom Web composition."
        : "Saved the brand system and regenerated both deliverables.";
    }, (current) => ({ renderWeb: !current.webCustomized }));
    return NextResponse.json({ project, landingHtml: await loadLandingHtml(project.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Project mutation failed.";
    return NextResponse.json({ error: message }, { status: /version conflict/i.test(message) ? 409 : 400 });
  }
}
