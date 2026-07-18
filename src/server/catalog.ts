import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NO_ARTIFACT_ACTIONS, SLIDE_DIMENSIONS, createSlideDocument, createWebDocument, type ArtifactAction, type ArtifactActionCapabilities } from "@/domain/artifacts";
import {
  TEMPLATE_CATEGORIES,
  type CatalogFilter,
  type DesignSystemBootstrapInput,
  type DesignSystemPreset,
  type PartialDesignTokens,
  type PortableCatalogBundle,
  type TemplateCategory,
  type TemplateDefinition
} from "@/domain/catalog";
import { defaultProject } from "@/domain/defaults";
import type { BrandProfile, DesignTokens } from "@/domain/types";
import { createArtifactVersion, loadArtifactRegistry } from "./artifacts";
import { createBrandSystemDraft, validateBrandSystemContent } from "./brand-system";
import { safeProjectPath } from "./paths";
import { ensureProject, loadProject } from "./store";

const CURATED_AT = "2026-07-18T00:00:00.000Z";
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i;
const MAX_IMPORT_BYTES = 1_000_000;
const MAX_BUNDLE_ITEMS = 256;
const actionKeys: ArtifactAction[] = ["create", "edit", "preview", "animate", "export"];
const mutations = new Map<string, Promise<void>>();

function clone<T>(value: T): T { return structuredClone(value); }

function preset(input: Omit<DesignSystemPreset, "schemaVersion" | "kind" | "ownership" | "provenance" | "license">): DesignSystemPreset {
  return {
    schemaVersion: 1, kind: "design-system-preset", ownership: "builtin",
    provenance: { source: "curated", author: "Codex Design Studio", createdAt: CURATED_AT },
    license: { name: "Codex Design Studio Starter License" }, ...input
  };
}

const CURATED_PRESETS: DesignSystemPreset[] = [
  preset({
    id: "ds.asteria-editorial", version: "1.0.0", name: "Asteria Editorial", description: "Luminous editorial clarity for ambitious technology brands.",
    thumbnail: { uri: "asset://presets/asteria-editorial.svg", alt: "Forest green editorial layout with a lime accent" }, tags: ["editorial", "premium", "technology"],
    seed: { brand: clone(defaultProject.brand), tokens: clone(defaultProject.tokens) }
  }),
  preset({
    id: "ds.signal-modern", version: "1.0.0", name: "Signal Modern", description: "High-contrast product communication with a crisp technical voice.",
    thumbnail: { uri: "asset://presets/signal-modern.svg", alt: "Dark navy interface with electric blue accents" }, tags: ["modern", "product", "technical"],
    seed: {
      brand: { ...clone(defaultProject.brand), name: "Signal", industry: "Technology", promise: "Make complex systems immediately understandable.", personality: ["direct", "technical", "assured"], tone: "Direct and evidence-led", visualDirection: "High contrast grids, sharp type and electric accents" },
      tokens: { ...clone(defaultProject.tokens), colors: { primary: "#111827", secondary: "#475569", accent: "#38BDF8", background: "#F8FAFC", surface: "#FFFFFF", text: "#0F172A" }, typography: { ...clone(defaultProject.tokens.typography), display: "Arial", body: "Arial" }, shape: { radiusSm: 4, radiusCard: 12, radiusButton: 6 } }
    }
  }),
  preset({
    id: "ds.warm-humanist", version: "1.0.0", name: "Warm Humanist", description: "A generous, approachable system for services and community stories.",
    thumbnail: { uri: "asset://presets/warm-humanist.svg", alt: "Cream layout with terracotta and plum details" }, tags: ["warm", "human", "services"],
    seed: {
      brand: { ...clone(defaultProject.brand), name: "Common Ground", industry: "Services", promise: "Help people move forward with clarity and care.", personality: ["warm", "grounded", "optimistic"], tone: "Plain-spoken and encouraging", visualDirection: "Humanist typography, warm neutrals and documentary imagery" },
      tokens: { ...clone(defaultProject.tokens), colors: { primary: "#5A2A42", secondary: "#B85C46", accent: "#E9B872", background: "#FFF8ED", surface: "#FFFFFF", text: "#321E28" }, typography: { ...clone(defaultProject.tokens.typography), display: "Georgia", body: "Verdana" }, shape: { radiusSm: 10, radiusCard: 28, radiusButton: 999 } }
    }
  })
];

const WEB_ACTIONS: ArtifactActionCapabilities = { create: true, edit: true, preview: true, animate: false, export: true, exportFormats: ["html", "zip"] };
const SLIDE_ACTIONS: ArtifactActionCapabilities = { create: true, edit: true, preview: true, animate: false, export: true, exportFormats: ["pptx", "pdf"] };

function webStarter(id: string) {
  return createWebDocument({ documentId: id, html: '<!doctype html>\n<main data-design-node-id="page"><h1 data-design-node-id="headline">Start with a clear idea</h1></main>', stylesheets: [{ id: "base", code: "main { min-height: 100vh; display: grid; place-content: center; }" }] });
}

function slideStarter(id: string) {
  return createSlideDocument({ documentId: id, dimensions: { ...SLIDE_DIMENSIONS.wide }, slides: [{ id: "cover", name: "Cover", nodes: [{ id: "headline", type: "text", text: "Start with a clear idea", editable: true, frame: { x: 72, y: 160, width: 816, height: 120 }, zIndex: 1 }] }] });
}

function template(input: Pick<TemplateDefinition, "id" | "name" | "description" | "category" | "artifactKind" | "adapterId" | "capabilities" | "tags" | "starter">): TemplateDefinition {
  return {
    schemaVersion: 1, kind: "template", version: "1.0.0", ownership: "builtin",
    provenance: { source: "curated", author: "Codex Design Studio", createdAt: CURATED_AT },
    license: { name: "Codex Design Studio Starter License" },
    thumbnail: { uri: `asset://templates/${input.id}.svg`, alt: `${input.name} template preview` }, ...input
  };
}

const BUILTIN_TEMPLATES: TemplateDefinition[] = [
  template({ id: "tpl.slides.story", name: "Story Deck", description: "Editable widescreen narrative deck.", category: "Slides", artifactKind: "slides", adapterId: "slides-v1", capabilities: SLIDE_ACTIONS, tags: ["deck", "presentation"], starter: slideStarter("story-deck") }),
  template({ id: "tpl.web.launch", name: "Launch Page", description: "Responsive code-native launch page.", category: "Web", artifactKind: "web", adapterId: "web-v1", capabilities: WEB_ACTIONS, tags: ["website", "launch"], starter: webStarter("launch-page") }),
  ...([
    ["mobile-app", "Mobile App", "Mobile App"], ["wireframe", "Wireframe", "Wireframe"], ["document", "Document", "Document"],
    ["animation", "Animation", "Animation"], ["ui-mockups", "UI Mockups", "UI Mockups"], ["resume", "Resume", "Resume"],
    ["3d-object", "3D Object", "3D Object"], ["research", "Research", "Research"], ["html-email", "HTML Email", "HTML Email"],
    ["color-type", "Color and Type Pairing", "Color and Type Pairing"], ["diagram", "Diagram", "Diagram"], ["flyer", "Flyer", "Flyer"]
  ] as Array<[string, TemplateCategory, string]>).map(([kind, category, name]) => template({
    id: `tpl.${kind}.starter`, name: `${name} Starter`, description: `${name} manifest ready for a future adapter.`, category,
    artifactKind: kind, adapterId: "unavailable", capabilities: clone(NO_ARTIFACT_ACTIONS), tags: [kind], starter: undefined
  }))
];

interface StoredCatalog { schemaVersion: 1; presets: DesignSystemPreset[]; templates: TemplateDefinition[] }

async function storage(projectId: string) {
  await ensureProject(projectId);
  const root = await safeProjectPath(projectId, "catalog");
  await mkdir(root, { recursive: true });
  return path.join(root, "custom.json");
}

async function loadCustom(projectId: string): Promise<StoredCatalog> {
  try { return JSON.parse(await readFile(await storage(projectId), "utf8")) as StoredCatalog; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { schemaVersion: 1, presets: [], templates: [] };
  }
}

async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function mutate<T>(projectId: string, operation: (catalog: StoredCatalog) => Promise<T>) {
  const prior = mutations.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const active = new Promise<void>((resolve) => { release = resolve; });
  const queued = prior.then(() => active); mutations.set(projectId, queued); await prior;
  try {
    const catalog = await loadCustom(projectId);
    const result = await operation(catalog);
    await atomicJson(await storage(projectId), catalog);
    return result;
  } finally { release(); if (mutations.get(projectId) === queued) mutations.delete(projectId); }
}

function string(value: unknown, label: string, max = 500): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be a non-empty string of at most ${max} characters.`);
}

function safeUri(value: unknown, label: string) {
  string(value, label, 2_000);
  if (!/^(asset|project):\/\/[a-z0-9][a-z0-9/_.-]*$/i.test(value)) throw new Error(`${label} must use a portable asset:// or project:// URI.`);
}

function baseManifest(value: unknown, kind: "template" | "design-system-preset") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Catalog manifests must be objects.");
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new Error("Catalog manifests must be portable JSON values."); }
  if (Buffer.byteLength(encoded, "utf8") > MAX_IMPORT_BYTES) throw new Error("Catalog import exceeds the 1 MB limit.");
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1 || manifest.kind !== kind) throw new Error(`Expected a version 1 ${kind} manifest.`);
  string(manifest.id, "Catalog id", 128); if (!IDENTIFIER.test(manifest.id)) throw new Error("Catalog ids must be stable lowercase identifiers.");
  string(manifest.version, "Catalog version", 64); if (!SEMVER.test(manifest.version)) throw new Error("Catalog versions must use semantic versioning.");
  string(manifest.name, "Catalog name", 200); string(manifest.description, "Catalog description", 2_000);
  const thumbnail = manifest.thumbnail as Record<string, unknown> | undefined;
  safeUri(thumbnail?.uri, "Catalog thumbnail"); string(thumbnail?.alt, "Catalog thumbnail alt text", 500);
  const license = manifest.license as Record<string, unknown> | undefined; string(license?.name, "Catalog license", 200);
  if (license?.spdxId !== undefined && (typeof license.spdxId !== "string" || !/^[a-z0-9.+-]{1,100}$/i.test(license.spdxId))) throw new Error("Catalog SPDX license id is invalid.");
  if (license?.url !== undefined && (typeof license.url !== "string" || !/^https:\/\//.test(license.url))) throw new Error("Catalog license URLs must use HTTPS.");
  if (!Array.isArray(manifest.tags) || manifest.tags.length > 64 || manifest.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 100)) throw new Error("Catalog tags are invalid.");
  if (new Set(manifest.tags).size !== manifest.tags.length) throw new Error("Catalog tags must be unique.");
  const provenance = manifest.provenance as Record<string, unknown> | undefined;
  if (!provenance || !["curated", "project", "imported", "duplicated"].includes(String(provenance.source))) throw new Error("Catalog provenance source is invalid.");
  string(provenance.author, "Catalog provenance author", 200); string(provenance.createdAt, "Catalog provenance timestamp", 100);
  if (Number.isNaN(Date.parse(provenance.createdAt))) throw new Error("Catalog provenance timestamp must be ISO-compatible.");
  if (provenance.sourceId !== undefined) string(provenance.sourceId, "Catalog provenance source id", 500);
  return manifest;
}

function assertPortableJson(value: unknown, seen = new Set<object>()) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (typeof value !== "object") throw new Error("Template starter documents must contain only portable JSON values.");
  if (seen.has(value)) throw new Error("Template starter documents cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) value.forEach((child) => assertPortableJson(child, seen));
  else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("Template starter documents must use plain JSON objects.");
    for (const child of Object.values(value as Record<string, unknown>)) assertPortableJson(child, seen);
  }
  seen.delete(value);
}

function validatePreset(value: unknown): DesignSystemPreset {
  const manifest = baseManifest(value, "design-system-preset");
  const seed = manifest.seed as Record<string, unknown> | undefined;
  if (!seed?.brand || !seed.tokens) throw new Error("A preset requires a complete brand and token seed.");
  const candidate = clone(value as DesignSystemPreset);
  validateBrandSystemContent(candidate.seed.brand, candidate.seed.tokens);
  return candidate;
}

function validateCapabilities(value: unknown): ArtifactActionCapabilities {
  if (!value || typeof value !== "object") throw new Error("Template capabilities are required.");
  const capabilities = clone(value as ArtifactActionCapabilities);
  for (const action of actionKeys) if (typeof capabilities[action] !== "boolean") throw new Error(`Template capability ${action} must be boolean.`);
  if (!Array.isArray(capabilities.exportFormats) || capabilities.exportFormats.some((format) => typeof format !== "string" || !/^[a-z0-9.+-]+$/i.test(format))) throw new Error("Template export formats are invalid.");
  if (!capabilities.export && capabilities.exportFormats.length) throw new Error("Templates without export support cannot declare export formats.");
  return capabilities;
}

function validateTemplate(value: unknown): TemplateDefinition {
  const manifest = baseManifest(value, "template");
  if (!TEMPLATE_CATEGORIES.includes(manifest.category as TemplateCategory)) throw new Error("Template category is not recognized.");
  string(manifest.artifactKind, "Template artifact kind", 128); if (!IDENTIFIER.test(manifest.artifactKind)) throw new Error("Template artifact kind is invalid.");
  string(manifest.adapterId, "Template adapter id", 128); if (!IDENTIFIER.test(manifest.adapterId)) throw new Error("Template adapter id is invalid.");
  validateCapabilities(manifest.capabilities);
  if (manifest.starter !== undefined) assertPortableJson(manifest.starter);
  return clone(value as TemplateDefinition);
}

function projectOwned<T extends DesignSystemPreset | TemplateDefinition>(manifest: T, provenance: T["provenance"]): T {
  return { ...clone(manifest), ownership: "project", provenance: clone(provenance) };
}

function imported<T extends DesignSystemPreset | TemplateDefinition>(manifest: T, sourceId?: string): T {
  return projectOwned(manifest, { source: "imported", sourceId, author: manifest.provenance?.author || "Unknown", createdAt: new Date().toISOString() });
}

function parseImport(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (Buffer.byteLength(value, "utf8") > MAX_IMPORT_BYTES) throw new Error("Catalog import exceeds the 1 MB limit.");
  try { return JSON.parse(value); } catch { throw new Error("Catalog import is not valid JSON."); }
}

export function curatedDesignSystemPresets() { return clone(CURATED_PRESETS); }
export function starterTemplateCatalog() { return clone(BUILTIN_TEMPLATES); }

export async function listDesignSystemPresets(projectId: string) {
  return [...curatedDesignSystemPresets(), ...clone((await loadCustom(projectId)).presets)];
}

export async function listTemplates(projectId: string, filter: CatalogFilter = {}) {
  const templates = [...starterTemplateCatalog(), ...clone((await loadCustom(projectId)).templates)];
  const query = filter.query?.trim().toLocaleLowerCase();
  return templates.filter((item) => {
    if (filter.category && item.category !== filter.category) return false;
    if (filter.artifactKind && item.artifactKind !== filter.artifactKind) return false;
    if (filter.ownership && item.ownership !== filter.ownership) return false;
    if (filter.capability && !item.capabilities[filter.capability]) return false;
    return !query || [item.name, item.description, item.category, item.artifactKind, ...item.tags].some((value) => value.toLocaleLowerCase().includes(query));
  });
}

export async function getDesignSystemPreset(projectId: string, id: string) {
  const found = (await listDesignSystemPresets(projectId)).find((item) => item.id === id);
  if (!found) throw new Error(`Design-system preset ${id} was not found.`);
  return clone(found);
}

export async function getTemplate(projectId: string, id: string) {
  const found = (await listTemplates(projectId)).find((item) => item.id === id);
  if (!found) throw new Error(`Template ${id} was not found.`);
  return clone(found);
}

async function assertAdapterClaims(projectId: string, item: TemplateDefinition) {
  const adapter = (await loadArtifactRegistry(projectId)).kinds.find((kind) => kind.kind === item.artifactKind && kind.adapterId === item.adapterId);
  for (const action of actionKeys) if (item.capabilities[action] && !adapter?.actions?.[action]) throw new Error(`Template ${item.id} claims unsupported ${action} capability.`);
  for (const format of item.capabilities.exportFormats) if (!adapter?.actions?.exportFormats.includes(format)) throw new Error(`Template ${item.id} claims unsupported ${format} export.`);
}

export async function importCustomPreset(projectId: string, input: unknown) {
  const item = imported(validatePreset(parseImport(input)));
  return mutate(projectId, async (catalog) => {
    if (CURATED_PRESETS.some((entry) => entry.id === item.id) || catalog.presets.some((entry) => entry.id === item.id && entry.version === item.version)) throw new Error("A preset with this id and version already exists.");
    catalog.presets.push(item); return clone(item);
  });
}

export async function importCustomTemplate(projectId: string, input: unknown) {
  const item = imported(validateTemplate(parseImport(input)));
  await assertAdapterClaims(projectId, item);
  return mutate(projectId, async (catalog) => {
    if (BUILTIN_TEMPLATES.some((entry) => entry.id === item.id) || catalog.templates.some((entry) => entry.id === item.id && entry.version === item.version)) throw new Error("A template with this id and version already exists.");
    catalog.templates.push(item); return clone(item);
  });
}

function nextPatch(version: string) {
  const [major, minor, patch] = version.split("-")[0].split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function compareSemver(left: string, right: string) {
  const a = left.split("-")[0].split(".").map(Number);
  const b = right.split("-")[0].split(".").map(Number);
  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
}

export async function duplicatePreset(projectId: string, sourceId: string, id: string) {
  if (!IDENTIFIER.test(id)) throw new Error("Catalog ids must be stable lowercase identifiers.");
  const source = await getDesignSystemPreset(projectId, sourceId);
  const item = validatePreset(projectOwned({ ...source, id, version: "1.0.0", name: `${source.name} Copy` }, { source: "duplicated", sourceId, author: "Project user", createdAt: new Date().toISOString() }));
  return mutate(projectId, async (catalog) => {
    if (CURATED_PRESETS.some((entry) => entry.id === item.id) || catalog.presets.some((entry) => entry.id === item.id && entry.version === item.version)) throw new Error("A preset with this id and version already exists.");
    catalog.presets.push(item); return clone(item);
  });
}

export async function duplicateTemplate(projectId: string, sourceId: string, id: string) {
  if (!IDENTIFIER.test(id)) throw new Error("Catalog ids must be stable lowercase identifiers.");
  const source = await getTemplate(projectId, sourceId);
  const item = validateTemplate(projectOwned({ ...source, id, version: "1.0.0", name: `${source.name} Copy` }, { source: "duplicated", sourceId, author: "Project user", createdAt: new Date().toISOString() }));
  await assertAdapterClaims(projectId, item);
  return mutate(projectId, async (catalog) => {
    if (BUILTIN_TEMPLATES.some((entry) => entry.id === item.id) || catalog.templates.some((entry) => entry.id === item.id && entry.version === item.version)) throw new Error("A template with this id and version already exists.");
    catalog.templates.push(item); return clone(item);
  });
}

export async function versionCustomPreset(projectId: string, id: string, mutateSeed: (seed: DesignSystemPreset["seed"]) => DesignSystemPreset["seed"]) {
  const source = (await loadCustom(projectId)).presets.filter((item) => item.id === id).sort((a, b) => compareSemver(b.version, a.version))[0];
  if (!source) throw new Error("Only project-local presets can be versioned.");
  const item = validatePreset(projectOwned({ ...source, version: nextPatch(source.version), seed: mutateSeed(clone(source.seed)) }, { source: "project", sourceId: `${id}@${source.version}`, author: "Project user", createdAt: new Date().toISOString() }));
  return mutate(projectId, async (catalog) => { catalog.presets.push(item); return clone(item); });
}

export async function versionCustomTemplate(projectId: string, id: string, changes: Partial<Pick<TemplateDefinition, "name" | "description" | "tags" | "starter">>) {
  const source = (await loadCustom(projectId)).templates.filter((item) => item.id === id).sort((a, b) => compareSemver(b.version, a.version))[0];
  if (!source) throw new Error("Only project-local templates can be versioned.");
  const item = validateTemplate(projectOwned({ ...source, ...clone(changes), version: nextPatch(source.version) }, { source: "project", sourceId: `${id}@${source.version}`, author: "Project user", createdAt: new Date().toISOString() }));
  await assertAdapterClaims(projectId, item);
  return mutate(projectId, async (catalog) => { catalog.templates.push(item); return clone(item); });
}

export async function exportProjectCatalog(projectId: string): Promise<PortableCatalogBundle> {
  const catalog = await loadCustom(projectId);
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), presets: clone(catalog.presets), templates: clone(catalog.templates) };
}

export async function importProjectCatalog(projectId: string, input: unknown) {
  const parsed = parseImport(input) as PortableCatalogBundle;
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.presets) || !Array.isArray(parsed.templates)) throw new Error("Expected a version 1 portable catalog bundle.");
  let encoded: string;
  try { encoded = JSON.stringify(parsed); } catch { throw new Error("Catalog bundles must contain portable JSON values."); }
  if (Buffer.byteLength(encoded, "utf8") > MAX_IMPORT_BYTES) throw new Error("Catalog import exceeds the 1 MB limit.");
  if (parsed.presets.length + parsed.templates.length > MAX_BUNDLE_ITEMS) throw new Error(`Catalog bundles may contain at most ${MAX_BUNDLE_ITEMS} items.`);
  if (typeof parsed.exportedAt !== "string" || Number.isNaN(Date.parse(parsed.exportedAt))) throw new Error("Catalog bundle export timestamp is invalid.");
  // Validate the entire bundle before writing anything.
  const presets = parsed.presets.map(validatePreset);
  const templates = parsed.templates.map(validateTemplate);
  for (const item of templates) await assertAdapterClaims(projectId, item);
  return mutate(projectId, async (catalog) => {
    const keys = new Set([...CURATED_PRESETS, ...BUILTIN_TEMPLATES, ...catalog.presets, ...catalog.templates].map((item) => `${item.kind}:${item.id}@${item.version}`));
    for (const item of presets) { const value = imported(item, `bundle:${parsed.exportedAt}`); const key = `${value.kind}:${value.id}@${value.version}`; if (keys.has(key)) throw new Error(`Catalog bundle duplicates ${value.id}@${value.version}.`); keys.add(key); catalog.presets.push(value); }
    for (const item of templates) { const value = imported(item, `bundle:${parsed.exportedAt}`); const key = `${value.kind}:${value.id}@${value.version}`; if (keys.has(key)) throw new Error(`Catalog bundle duplicates ${value.id}@${value.version}.`); keys.add(key); catalog.templates.push(value); }
    return { presets: clone(presets), templates: clone(templates) };
  });
}

function mergeTokens(base: DesignTokens, partial?: PartialDesignTokens): DesignTokens {
  if (!partial) return clone(base);
  return {
    ...clone(base), ...clone(partial),
    colors: { ...base.colors, ...partial.colors },
    typography: { ...base.typography, ...partial.typography, scale: { ...base.typography.scale, ...partial.typography?.scale } },
    spacing: { ...base.spacing, ...partial.spacing }, shape: { ...base.shape, ...partial.shape },
    media: { ...base.media, ...partial.media }, voice: { ...base.voice, ...partial.voice }
  };
}

function mergeBrand(base: BrandProfile, partial?: Partial<BrandProfile>): BrandProfile { return { ...clone(base), ...clone(partial ?? {}) }; }

/** Seeds a detached project draft. Later project edits never mutate the immutable catalog preset. */
export async function bootstrapDesignSystemDraft(projectId: string, input: DesignSystemBootstrapInput = {}) {
  const project = await loadProject(projectId);
  const selected = input.presetId ? await getDesignSystemPreset(projectId, input.presetId) : undefined;
  let brand = clone(selected?.seed.brand ?? project.brand);
  let tokens = clone(selected?.seed.tokens ?? project.tokens);
  brand = mergeBrand(brand, input.extracted?.brand); tokens = mergeTokens(tokens, input.extracted?.tokens);
  brand = mergeBrand(brand, input.manual?.brand); tokens = mergeTokens(tokens, input.manual?.tokens);
  const draft = await createBrandSystemDraft(projectId, { brand, tokens });
  return { ...draft, selectedPreset: selected ? { id: selected.id, version: selected.version } : undefined, inputs: { preset: Boolean(selected), extracted: Boolean(input.extracted), manual: Boolean(input.manual) } };
}

export async function assertTemplateAction(projectId: string, templateId: string, action: ArtifactAction, format?: string) {
  const item = await getTemplate(projectId, templateId);
  if (!item.capabilities[action]) throw new Error(`Template ${templateId} does not support ${action}.`);
  if (action === "export" && format && !item.capabilities.exportFormats.includes(format)) throw new Error(`Template ${templateId} cannot export ${format}.`);
  await assertAdapterClaims(projectId, item);
  return item;
}

export async function createArtifactFromTemplate(projectId: string, templateId: string, input: { artifactId: string; brandSystemVersionId: string; createdBy?: "user" | "codex" | "system" }) {
  const item = await assertTemplateAction(projectId, templateId, "create");
  if (item.starter === undefined) throw new Error(`Template ${templateId} has no portable starter document.`);
  return createArtifactVersion(projectId, { artifactId: input.artifactId, kind: item.artifactKind, brandSystemVersionId: input.brandSystemVersionId, createdBy: input.createdBy, document: clone(item.starter), provenance: [{ id: `prov_${randomUUID()}`, action: "created", actor: input.createdBy ?? "user", at: new Date().toISOString(), sourceId: `${item.id}@${item.version}`, note: `Created from ${item.name}` }] });
}
