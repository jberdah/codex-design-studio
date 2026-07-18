import { NextResponse } from "next/server";
import type { CatalogFilter, DesignSystemBootstrapInput, TemplateCategory } from "@/domain/catalog";
import {
  bootstrapDesignSystemDraft,
  createArtifactFromTemplate,
  duplicatePreset,
  duplicateTemplate,
  exportProjectCatalog,
  importCustomPreset,
  importCustomTemplate,
  importProjectCatalog,
  listDesignSystemPresets,
  listTemplates
} from "@/server/catalog";
import { activeProjectId } from "@/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const projectId = activeProjectId(request);
  const url = new URL(request.url);
  const filter: CatalogFilter = {
    query: url.searchParams.get("q") ?? undefined,
    category: (url.searchParams.get("category") as TemplateCategory | null) ?? undefined,
    artifactKind: url.searchParams.get("artifactKind") ?? undefined,
    capability: (url.searchParams.get("capability") as CatalogFilter["capability"] | null) ?? undefined,
    ownership: (url.searchParams.get("ownership") as CatalogFilter["ownership"] | null) ?? undefined
  };
  return NextResponse.json({ presets: await listDesignSystemPresets(projectId), templates: await listTemplates(projectId, filter) });
}

export async function POST(request: Request) {
  try {
    const projectId = activeProjectId(request);
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "bootstrap") return NextResponse.json(await bootstrapDesignSystemDraft(projectId, (body.input ?? {}) as DesignSystemBootstrapInput), { status: 201 });
    if (body.action === "import-preset") return NextResponse.json(await importCustomPreset(projectId, body.manifest), { status: 201 });
    if (body.action === "import-template") return NextResponse.json(await importCustomTemplate(projectId, body.manifest), { status: 201 });
    if (body.action === "import-bundle") return NextResponse.json(await importProjectCatalog(projectId, body.bundle), { status: 201 });
    if (body.action === "duplicate-preset" && typeof body.sourceId === "string" && typeof body.id === "string") return NextResponse.json(await duplicatePreset(projectId, body.sourceId, body.id), { status: 201 });
    if (body.action === "duplicate-template" && typeof body.sourceId === "string" && typeof body.id === "string") return NextResponse.json(await duplicateTemplate(projectId, body.sourceId, body.id), { status: 201 });
    if (body.action === "create" && typeof body.templateId === "string" && typeof body.artifactId === "string" && typeof body.brandSystemVersionId === "string") {
      return NextResponse.json(await createArtifactFromTemplate(projectId, body.templateId, { artifactId: body.artifactId, brandSystemVersionId: body.brandSystemVersionId }), { status: 201 });
    }
    if (body.action === "export-bundle") return NextResponse.json(await exportProjectCatalog(projectId));
    return NextResponse.json({ error: "Unknown catalog action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Catalog operation failed." }, { status: 409 });
  }
}
