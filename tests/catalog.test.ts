import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATEGORIES, type TemplateDefinition } from "@/domain/catalog";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-catalog-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

describe("design-system preset gallery and bootstrap", () => {
  it("keeps curated presets immutable and seeds detached project-owned drafts", async () => {
    const catalog = await import("@/server/catalog");
    const firstGallery = catalog.curatedDesignSystemPresets();
    firstGallery[0].seed.tokens.colors.primary = "#000000";
    firstGallery.push(firstGallery[0]);

    const draft = await catalog.bootstrapDesignSystemDraft("detached", { presetId: "ds.asteria-editorial" });
    draft.snapshot.tokens.colors.primary = "#FFFFFF";
    const secondGallery = catalog.curatedDesignSystemPresets();

    expect(secondGallery).toHaveLength(3);
    expect(secondGallery[0].seed.tokens.colors.primary).toBe("#1C3D38");
    expect(draft.selectedPreset).toEqual({ id: "ds.asteria-editorial", version: "1.0.0" });
    expect((await catalog.getDesignSystemPreset("detached", "ds.asteria-editorial")).seed.tokens.colors.primary).toBe("#1C3D38");
  });

  it("combines preset, extracted sources and manual colors and typography in explicit precedence order", async () => {
    const catalog = await import("@/server/catalog");
    const result = await catalog.bootstrapDesignSystemDraft("combined", {
      presetId: "ds.signal-modern",
      extracted: { brand: { audience: "Design teams" }, tokens: { colors: { accent: "#FF00AA" }, typography: { body: "Inter" } } },
      manual: { brand: { name: "Northstar" }, tokens: { colors: { accent: "#00FF88" }, typography: { display: "Helvetica" } } }
    });

    expect(result.snapshot.brand).toMatchObject({ name: "Northstar", audience: "Design teams", industry: "Technology" });
    expect(result.snapshot.tokens.colors).toMatchObject({ primary: "#111827", accent: "#00FF88" });
    expect(result.snapshot.tokens.typography).toMatchObject({ display: "Helvetica", body: "Inter" });
    expect(result.inputs).toEqual({ preset: true, extracted: true, manual: true });
  });
});

describe("registry-driven template catalog", () => {
  it("covers every requested format and supports query, category, ownership and capability filters", async () => {
    const catalog = await import("@/server/catalog");
    const templates = await catalog.listTemplates("filters");

    expect(new Set(templates.map((item) => item.category))).toEqual(new Set(TEMPLATE_CATEGORIES));
    expect((await catalog.listTemplates("filters", { query: "email" })).map((item) => item.category)).toEqual(["HTML Email"]);
    expect((await catalog.listTemplates("filters", { category: "Slides" })).map((item) => item.id)).toEqual(["tpl.slides.story"]);
    expect((await catalog.listTemplates("filters", { capability: "edit" })).map((item) => item.artifactKind).sort()).toEqual(["slides", "web"]);
    expect(await catalog.listTemplates("filters", { ownership: "project" })).toEqual([]);
  });

  it("creates supported artifacts and rejects unsupported actions without mutating the version graph", async () => {
    const brandSystem = await import("@/server/brand-system");
    const catalog = await import("@/server/catalog");
    const artifacts = await import("@/server/artifacts");
    const draft = await brandSystem.createBrandSystemDraft("creation");
    await brandSystem.publishBrandSystem("creation", draft.snapshot.id);

    const artifact = await catalog.createArtifactFromTemplate("creation", "tpl.web.launch", { artifactId: "launch", brandSystemVersionId: draft.snapshot.id });
    expect(artifact.document).toMatchObject({ kind: "web", model: "code-native-html" });
    expect(artifact.metadata.provenance[0].sourceId).toBe("tpl.web.launch@1.0.0");
    await expect(catalog.assertTemplateAction("creation", "tpl.mobile-app.starter", "create")).rejects.toThrow("does not support create");
    await expect(catalog.assertTemplateAction("creation", "tpl.web.launch", "animate")).rejects.toThrow("does not support animate");
    await expect(catalog.assertTemplateAction("creation", "tpl.web.launch", "export", "pptx")).rejects.toThrow("cannot export pptx");
    expect((await artifacts.loadArtifactRegistry("creation")).versions).toHaveLength(1);
  });

  it("rejects capability inflation by imported templates", async () => {
    const catalog = await import("@/server/catalog");
    const unsafe = catalog.starterTemplateCatalog().find((item) => item.category === "Animation") as TemplateDefinition;
    unsafe.id = "custom.animation.claim";
    unsafe.capabilities.animate = true;

    await expect(catalog.importCustomTemplate("unsafe", JSON.stringify(unsafe))).rejects.toThrow("unsupported animate capability");
    expect(await catalog.listTemplates("unsafe", { ownership: "project" })).toEqual([]);
  });
});

describe("project-local catalog portability", () => {
  it("duplicates, versions, validates and round-trips custom presets and templates", async () => {
    const catalog = await import("@/server/catalog");
    const preset = await catalog.duplicatePreset("source", "ds.warm-humanist", "team.warm");
    const next = await catalog.versionCustomPreset("source", preset.id, (seed) => ({ ...seed, tokens: { ...seed.tokens, colors: { ...seed.tokens.colors, accent: "#ABCDEF" } } }));
    await catalog.duplicateTemplate("source", "tpl.web.launch", "team.launch");
    const bundle = await catalog.exportProjectCatalog("source");
    const imported = await catalog.importProjectCatalog("destination", JSON.stringify(bundle));

    expect(next.version).toBe("1.0.1");
    expect(bundle.presets.map((item) => item.version)).toEqual(["1.0.0", "1.0.1"]);
    expect(imported).toMatchObject({ presets: [{ id: "team.warm" }, { id: "team.warm" }], templates: [{ id: "team.launch" }] });
    expect(await catalog.listTemplates("destination", { ownership: "project", query: "launch" })).toHaveLength(1);
    await expect(catalog.importCustomPreset("destination", "{not json")).rejects.toThrow("not valid JSON");
    await expect(catalog.importCustomTemplate("destination", { ...bundle.templates[0], id: "Bad ID" })).rejects.toThrow("stable lowercase identifiers");
  });

  it("rejects oversized bundles and collisions with immutable built-ins", async () => {
    const catalog = await import("@/server/catalog");
    const builtin = catalog.curatedDesignSystemPresets()[0];
    const colliding = { schemaVersion: 1, exportedAt: new Date().toISOString(), presets: [builtin], templates: [] };

    await expect(catalog.importProjectCatalog("collision", colliding)).rejects.toThrow(`duplicates ${builtin.id}@${builtin.version}`);
    await expect(catalog.importProjectCatalog("oversized", {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      presets: Array.from({ length: 257 }, () => builtin),
      templates: []
    })).rejects.toThrow("at most 256 items");
  });
});
