import { NextResponse } from "next/server";
import type { BrandProfile, DesignTokens, LandingContent, ProjectData } from "@/domain/types";
import { renderLandingHtml } from "@/server/landing";
import { validHexColors } from "@/server/review";
import { loadProject, saveProject } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const project = await loadProject();
  return NextResponse.json({ project, landingHtml: renderLandingHtml(project) });
}

export async function PUT(request: Request) {
  const body = await request.json() as Partial<Pick<ProjectData, "brand" | "tokens" | "landing">>;
  const project = await loadProject();
  if (body.brand) project.brand = { ...project.brand, ...body.brand } as BrandProfile;
  if (body.tokens) project.tokens = { ...project.tokens, ...body.tokens, colors: { ...project.tokens.colors, ...body.tokens.colors }, typography: { ...project.tokens.typography, ...body.tokens.typography }, spacing: { ...project.tokens.spacing, ...body.tokens.spacing }, shape: { ...project.tokens.shape, ...body.tokens.shape } } as DesignTokens;
  if (body.landing) project.landing = { ...project.landing, ...body.landing } as LandingContent;
  if (!validHexColors(project.tokens)) return NextResponse.json({ error: "All colour tokens must be six-digit hex values." }, { status: 400 });
  project.version += 1;
  project.lastSummary = "Saved the brand system and regenerated both deliverables.";
  await saveProject(project);
  return NextResponse.json({ project, landingHtml: renderLandingHtml(project) });
}
