import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createSlideDocument,
  createWebDocument,
  generateCreativeDirections,
  type ArtifactActor,
  type ArtifactActionCapabilities,
  type ArtifactApprovalStatus,
  type ArtifactBranch,
  type ArtifactComment,
  type ArtifactExport,
  type ArtifactKindRegistration,
  type ArtifactMetadata,
  type ArtifactProvenance,
  type ArtifactRegistry,
  type ArtifactValidation,
  type ArtifactVersion,
  type ComparisonSheet,
  type ComparisonVariant,
  type CreativeBrief,
  type SlideDocument,
  type WebDocument
} from "@/domain/artifacts";
import type { ArtifactKind } from "@/domain/brand-system";
import { loadBrandSystemRegistry } from "./brand-system";
import { ensureProject } from "./store";
import { safeProjectPath } from "./paths";
import { renameWithRetry } from "./fs-atomic";

const mutationQueues = new Map<string, Promise<void>>();

function timestamp(clock?: () => Date) { return (clock?.() ?? new Date()).toISOString(); }

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

async function atomicJson(filePath: string, value: unknown) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(stable(value), null, 2)}\n`, "utf8");
  await renameWithRetry(temporary, filePath);
}

async function mutateArtifacts<T>(projectId: string, operation: () => Promise<T>) {
  const previous = mutationQueues.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  mutationQueues.set(projectId, queued);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (mutationQueues.get(projectId) === queued) mutationQueues.delete(projectId);
  }
}

async function storage(projectId: string) {
  await ensureProject(projectId);
  const root = await safeProjectPath(projectId, "artifacts");
  const versions = path.join(root, "versions");
  await mkdir(versions, { recursive: true });
  return { root, versions, registry: path.join(root, "registry.json") };
}

function builtInKinds(at: string): ArtifactKindRegistration[] {
  return [
    {
      kind: "web", label: "Web document", documentModel: "code-native-html", adapterId: "web-v1",
      capabilities: ["responsive", "media", "semantic-tokens"],
      actions: { create: true, edit: true, preview: true, animate: false, export: true, exportFormats: ["html", "zip"] }, registeredAt: at
    },
    {
      kind: "slides", label: "Slide document", documentModel: "physical-scene-graph", adapterId: "slides-v1",
      capabilities: ["physical-layout", "editable-text", "media", "semantic-tokens"],
      actions: { create: true, edit: true, preview: true, animate: false, export: true, exportFormats: ["pptx", "pdf"] }, registeredAt: at
    }
  ];
}

function emptyRegistry(projectId: string): ArtifactRegistry {
  const at = new Date(0).toISOString();
  return { schemaVersion: 1, projectId, kinds: builtInKinds(at), branches: [], versions: [], promotedVersionIds: {}, updatedAt: at };
}

export async function loadArtifactRegistry(projectId: string): Promise<ArtifactRegistry> {
  const files = await storage(projectId);
  try { return JSON.parse(await readFile(files.registry, "utf8")) as ArtifactRegistry; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return emptyRegistry(projectId);
  }
}

function assertIdentifier(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) throw new Error(`${label} contains unsupported characters.`);
}

export async function registerArtifactKind(projectId: string, input: Omit<ArtifactKindRegistration, "registeredAt">, options: { clock?: () => Date } = {}) {
  return mutateArtifacts(projectId, async () => {
    assertIdentifier(input.kind, "Artifact kind");
    if (input.adapterId) assertIdentifier(input.adapterId, "Artifact adapter id");
    if (!input.label.trim() || input.label.length > 200 || !input.documentModel.trim() || input.documentModel.length > 200) throw new Error("Artifact kind label and document model must contain at most 200 characters.");
    if (new Set(input.capabilities).size !== input.capabilities.length) throw new Error("Artifact kind capabilities must be unique.");
    validateActionCapabilities(input.actions);
    const files = await storage(projectId);
    const registry = await loadArtifactRegistry(projectId);
    if (registry.kinds.some((kind) => kind.kind === input.kind)) throw new Error(`Artifact kind ${input.kind} is already registered.`);
    const registration = { ...structuredClone(input), registeredAt: timestamp(options.clock) };
    registry.kinds.push(registration);
    registry.kinds.sort((a, b) => a.kind.localeCompare(b.kind));
    registry.updatedAt = registration.registeredAt;
    await atomicJson(files.registry, registry);
    return registration;
  });
}

function validateActionCapabilities(actions?: ArtifactActionCapabilities) {
  if (!actions) return;
  for (const action of ["create", "edit", "preview", "animate", "export"] as const) {
    if (typeof actions[action] !== "boolean") throw new Error(`Artifact action ${action} must be boolean.`);
  }
  if (!Array.isArray(actions.exportFormats) || actions.exportFormats.some((format) => typeof format !== "string" || !/^[a-z0-9][a-z0-9.+-]{0,31}$/i.test(format))) throw new Error("Artifact export formats are invalid.");
  if (new Set(actions.exportFormats).size !== actions.exportFormats.length) throw new Error("Artifact export formats must be unique.");
  if (!actions.export && actions.exportFormats.length) throw new Error("An adapter without export support cannot advertise export formats.");
}

export async function assertArtifactAction(projectId: string, kind: ArtifactKind, action: keyof Omit<ArtifactActionCapabilities, "exportFormats">, format?: string) {
  const registration = (await loadArtifactRegistry(projectId)).kinds.find((item) => item.kind === kind);
  if (!registration) throw new Error(`Artifact kind ${kind} is not registered.`);
  if (!registration.actions?.[action]) throw new Error(`Artifact kind ${kind} does not support ${action}.`);
  if (action === "export" && format && !registration.actions.exportFormats.includes(format)) throw new Error(`Artifact kind ${kind} cannot export ${format}.`);
  return registration;
}

async function assertPublishedBrandSystem(projectId: string, versionId: string) {
  const registry = await loadBrandSystemRegistry(projectId);
  const version = registry.versions.find((item) => item.id === versionId);
  if (!version || version.status !== "published") throw new Error("Artifact exploration requires a published BrandSystem version.");
}

function validateDocument(kind: ArtifactKind, document: unknown) {
  const serialized = JSON.stringify(document);
  if (!serialized) throw new Error("Artifact documents must be JSON-serializable values.");
  if (serialized.length > 5_000_000) throw new Error("Artifact document exceeds the 5 MB JSON limit.");
  if (kind === "web") {
    const web = document as WebDocument;
    if (web.kind !== "web" || web.model !== "code-native-html") throw new Error("The web artifact requires a WebDocument.");
    createWebDocument(web);
  } else if (kind === "slides") {
    const slides = document as SlideDocument;
    if (slides.kind !== "slides" || slides.model !== "physical-scene-graph") throw new Error("The slides artifact requires a SlideDocument.");
    createSlideDocument(slides);
  }
}

function versionPath(files: Awaited<ReturnType<typeof storage>>, versionId: string) {
  if (!/^av_[a-f0-9-]{36}$/i.test(versionId)) throw new Error("Invalid artifact version id.");
  return path.join(files.versions, `${versionId}.json`);
}

export async function loadArtifactVersion<TDocument = unknown>(projectId: string, versionId: string): Promise<ArtifactVersion<TDocument>> {
  const files = await storage(projectId);
  return JSON.parse(await readFile(versionPath(files, versionId), "utf8")) as ArtifactVersion<TDocument>;
}

export interface CreateArtifactVersionInput<TDocument> {
  artifactId: string;
  kind: ArtifactKind;
  brandSystemVersionId: string;
  document: TDocument;
  branchId?: string;
  branchName?: string;
  parentVersionId?: string;
  createdBy?: ArtifactActor;
  designThesis?: string;
  intendedDeviations?: string[];
  comments?: ArtifactComment[];
  validations?: ArtifactValidation[];
  provenance?: ArtifactProvenance[];
}

async function createVersionLocked<TDocument>(projectId: string, input: CreateArtifactVersionInput<TDocument>, registry: ArtifactRegistry, files: Awaited<ReturnType<typeof storage>>, clock?: () => Date) {
  assertIdentifier(input.artifactId, "Artifact id");
  const registration = registry.kinds.find((kind) => kind.kind === input.kind);
  if (!registration) throw new Error(`Artifact kind ${input.kind} is not registered.`);
  validateDocument(input.kind, input.document);
  const at = timestamp(clock);
  let branch = input.branchId ? registry.branches.find((item) => item.id === input.branchId && item.artifactId === input.artifactId) : registry.branches.find((item) => item.artifactId === input.artifactId && item.name === (input.branchName ?? "main"));
  if (!branch) {
    const id = input.branchId ?? `abr_${randomUUID()}`;
    assertIdentifier(id, "Artifact branch id");
    branch = { id, artifactId: input.artifactId, name: input.branchName?.trim() || "main", createdAt: at };
    registry.branches.push(branch);
  }
  if (input.parentVersionId && branch.headVersionId && input.parentVersionId !== branch.headVersionId) throw new Error("A new artifact version must descend from the current branch head.");
  const parentVersionId = input.parentVersionId ?? branch.headVersionId;
  if (parentVersionId) {
    const parent = registry.versions.find((version) => version.versionId === parentVersionId);
    if (!parent || parent.artifactId !== input.artifactId || parent.kind !== input.kind) throw new Error("Artifact parent version is not part of this artifact graph.");
  }
  const versionId = `av_${randomUUID()}`;
  const actor = input.createdBy ?? "codex";
  const metadata: ArtifactMetadata = {
    schemaVersion: 1,
    artifactId: input.artifactId,
    versionId,
    kind: input.kind,
    brandSystemVersionId: input.brandSystemVersionId,
    parentVersionId,
    branchId: branch.id,
    branchName: branch.name,
    createdAt: at,
    createdBy: actor,
    designThesis: input.designThesis,
    intendedDeviations: structuredClone(input.intendedDeviations ?? []),
    comments: structuredClone(input.comments ?? []),
    provenance: structuredClone(input.provenance ?? [{ id: `prov_${randomUUID()}`, action: "created", actor, at }]),
    validations: structuredClone(input.validations ?? []),
    approval: { status: "pending", events: [] },
    exports: []
  };
  const version: ArtifactVersion<TDocument> = { metadata, contentHash: hash(input.document), document: structuredClone(input.document) };
  await writeFile(versionPath(files, versionId), `${JSON.stringify(stable(version), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  registry.versions.push({
    artifactId: input.artifactId, versionId, kind: input.kind, branchId: branch.id, parentVersionId,
    brandSystemVersionId: input.brandSystemVersionId, approvalStatus: "pending", createdAt: at, contentHash: version.contentHash
  });
  branch.headVersionId = versionId;
  registry.updatedAt = at;
  await atomicJson(files.registry, registry);
  return version;
}

export async function createArtifactVersion<TDocument>(projectId: string, input: CreateArtifactVersionInput<TDocument>, options: { clock?: () => Date } = {}) {
  await assertPublishedBrandSystem(projectId, input.brandSystemVersionId);
  return mutateArtifacts(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadArtifactRegistry(projectId);
    return createVersionLocked(projectId, input, registry, files, options.clock);
  });
}

export async function startCreativeExploration(projectId: string, brief: CreativeBrief, artifactKind: ArtifactKind, brandSystemVersionId: string) {
  await assertPublishedBrandSystem(projectId, brandSystemVersionId);
  const registry = await loadArtifactRegistry(projectId);
  if (!registry.kinds.some((entry) => entry.kind === artifactKind)) throw new Error(`Artifact kind ${artifactKind} is not registered.`);
  return generateCreativeDirections(brief, artifactKind, brandSystemVersionId);
}

async function updateVersionMetadata(projectId: string, versionId: string, update: (metadata: ArtifactMetadata) => void, clock?: () => Date) {
  return mutateArtifacts(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadArtifactRegistry(projectId);
    const summary = registry.versions.find((item) => item.versionId === versionId);
    if (!summary) throw new Error("Artifact version not found.");
    const version = await loadArtifactVersion(projectId, versionId);
    const originalHash = hash(version.document);
    if (originalHash !== version.contentHash || originalHash !== summary.contentHash) throw new Error("Artifact version integrity check failed.");
    update(version.metadata);
    const at = timestamp(clock);
    registry.updatedAt = at;
    summary.approvalStatus = version.metadata.approval.status;
    if ((version.metadata.approval.status !== "approved" || version.metadata.validations.some((validation) => validation.status === "error")) && registry.promotedVersionIds[version.metadata.artifactId] === versionId) {
      delete registry.promotedVersionIds[version.metadata.artifactId];
    }
    await atomicJson(versionPath(files, versionId), version);
    await atomicJson(files.registry, registry);
    return version;
  });
}

const approvalTransitions: Record<ArtifactApprovalStatus, ArtifactApprovalStatus[]> = {
  pending: ["approved", "rejected", "changes_requested"],
  changes_requested: ["approved", "rejected"],
  approved: ["changes_requested"],
  rejected: []
};

export async function transitionArtifactApproval(projectId: string, versionId: string, to: ArtifactApprovalStatus, input: { actor?: ArtifactActor; note?: string; clock?: () => Date } = {}) {
  const at = timestamp(input.clock);
  return updateVersionMetadata(projectId, versionId, (metadata) => {
    const from = metadata.approval.status;
    if (!approvalTransitions[from].includes(to)) throw new Error(`Artifact approval cannot transition from ${from} to ${to}.`);
    const actor = input.actor ?? "user";
    metadata.approval.status = to;
    metadata.approval.events.push({ from, to, actor, at, note: input.note });
    if (to === "approved") { metadata.approval.approvedAt = at; metadata.approval.approvedBy = actor; }
    else { metadata.approval.approvedAt = undefined; metadata.approval.approvedBy = undefined; }
  }, input.clock);
}

export function approveArtifactVersion(projectId: string, versionId: string, input: { actor?: ArtifactActor; note?: string; clock?: () => Date } = {}) {
  return transitionArtifactApproval(projectId, versionId, "approved", input);
}

export function rejectArtifactVersion(projectId: string, versionId: string, input: { actor?: ArtifactActor; note?: string; clock?: () => Date } = {}) {
  return transitionArtifactApproval(projectId, versionId, "rejected", input);
}

export function requestArtifactChanges(projectId: string, versionId: string, input: { actor?: ArtifactActor; note?: string; clock?: () => Date } = {}) {
  return transitionArtifactApproval(projectId, versionId, "changes_requested", input);
}

export async function branchArtifactVersion(projectId: string, sourceVersionId: string, branchName: string, options: { actor?: ArtifactActor; clock?: () => Date } = {}) {
  if (!branchName.trim()) throw new Error("A branch name is required.");
  return mutateArtifacts(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadArtifactRegistry(projectId);
    const source = await loadArtifactVersion(projectId, sourceVersionId);
    if (registry.branches.some((branch) => branch.artifactId === source.metadata.artifactId && branch.name === branchName.trim())) throw new Error("Artifact branch names must be unique within an artifact.");
    const at = timestamp(options.clock);
    const branch: ArtifactBranch = { id: `abr_${randomUUID()}`, artifactId: source.metadata.artifactId, name: branchName.trim(), createdAt: at, createdFromVersionId: sourceVersionId };
    registry.branches.push(branch);
    return createVersionLocked(projectId, {
      artifactId: source.metadata.artifactId,
      kind: source.metadata.kind,
      brandSystemVersionId: source.metadata.brandSystemVersionId,
      document: source.document,
      branchId: branch.id,
      branchName: branch.name,
      parentVersionId: sourceVersionId,
      createdBy: options.actor ?? "user",
      designThesis: source.metadata.designThesis,
      intendedDeviations: source.metadata.intendedDeviations,
      provenance: [{ id: `prov_${randomUUID()}`, action: "branched", actor: options.actor ?? "user", at, sourceVersionId }]
    }, registry, files, options.clock);
  });
}

export async function restoreArtifactVersion(projectId: string, sourceVersionId: string, options: { targetBranchId?: string; actor?: ArtifactActor; clock?: () => Date } = {}) {
  return mutateArtifacts(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadArtifactRegistry(projectId);
    const source = await loadArtifactVersion(projectId, sourceVersionId);
    const targetBranch = options.targetBranchId
      ? registry.branches.find((branch) => branch.id === options.targetBranchId && branch.artifactId === source.metadata.artifactId)
      : registry.branches.find((branch) => branch.id === source.metadata.branchId);
    if (!targetBranch) throw new Error("Restore target branch not found.");
    const at = timestamp(options.clock);
    return createVersionLocked(projectId, {
      artifactId: source.metadata.artifactId,
      kind: source.metadata.kind,
      brandSystemVersionId: source.metadata.brandSystemVersionId,
      document: source.document,
      branchId: targetBranch.id,
      parentVersionId: targetBranch.headVersionId,
      createdBy: options.actor ?? "user",
      designThesis: source.metadata.designThesis,
      intendedDeviations: source.metadata.intendedDeviations,
      provenance: [{ id: `prov_${randomUUID()}`, action: "restored", actor: options.actor ?? "user", at, sourceVersionId }]
    }, registry, files, options.clock);
  });
}

export async function promoteArtifactVersion(projectId: string, versionId: string, options: { actor?: ArtifactActor; clock?: () => Date } = {}) {
  return mutateArtifacts(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadArtifactRegistry(projectId);
    const version = await loadArtifactVersion(projectId, versionId);
    const summary = registry.versions.find((item) => item.versionId === versionId);
    const currentHash = hash(version.document);
    if (!summary || currentHash !== version.contentHash || currentHash !== summary.contentHash) throw new Error("Artifact version integrity check failed.");
    if (version.metadata.approval.status !== "approved") throw new Error("Only an approved artifact version can be promoted.");
    if (version.metadata.validations.some((validation) => validation.status === "error")) throw new Error("Artifact versions with validation errors cannot be promoted.");
    const at = timestamp(options.clock);
    registry.promotedVersionIds[version.metadata.artifactId] = versionId;
    registry.updatedAt = at;
    version.metadata.provenance.push({ id: `prov_${randomUUID()}`, action: "promoted", actor: options.actor ?? "user", at, sourceVersionId: versionId });
    await atomicJson(versionPath(files, versionId), version);
    await atomicJson(files.registry, registry);
    return { version, registry };
  });
}

export function addArtifactComment(projectId: string, versionId: string, comment: ArtifactComment) {
  return updateVersionMetadata(projectId, versionId, (metadata) => {
    if (!comment.id.trim() || !comment.body.trim() || metadata.comments.some((item) => item.id === comment.id)) throw new Error("Artifact comment requires a unique id and body.");
    metadata.comments.push(structuredClone(comment));
  });
}

export function recordArtifactValidation(projectId: string, versionId: string, validation: ArtifactValidation) {
  return updateVersionMetadata(projectId, versionId, (metadata) => {
    metadata.validations = [...metadata.validations.filter((item) => item.id !== validation.id), structuredClone(validation)];
  });
}

export function recordArtifactExport(projectId: string, versionId: string, artifactExport: ArtifactExport) {
  return updateVersionMetadata(projectId, versionId, (metadata) => {
    if (metadata.exports.some((item) => item.id === artifactExport.id)) throw new Error("Artifact export ids must be unique.");
    metadata.exports.push(structuredClone(artifactExport));
  });
}

async function ancestry(projectId: string, version: ArtifactVersion) {
  const ancestors: string[] = [];
  let parent = version.metadata.parentVersionId;
  const visited = new Set<string>();
  while (parent) {
    if (visited.has(parent)) throw new Error("Artifact version graph contains a cycle.");
    visited.add(parent); ancestors.push(parent);
    parent = (await loadArtifactVersion(projectId, parent)).metadata.parentVersionId;
  }
  return ancestors;
}

export async function compareArtifactVersions(projectId: string, leftVersionId: string, rightVersionId: string) {
  const [left, right] = await Promise.all([loadArtifactVersion(projectId, leftVersionId), loadArtifactVersion(projectId, rightVersionId)]);
  if (left.metadata.artifactId !== right.metadata.artifactId) throw new Error("Only versions of the same artifact can be compared.");
  const [leftAncestors, rightAncestors] = await Promise.all([ancestry(projectId, left), ancestry(projectId, right)]);
  const rightLineage = new Set([rightVersionId, ...rightAncestors]);
  const commonAncestorVersionId = [leftVersionId, ...leftAncestors].find((id) => rightLineage.has(id));
  return {
    artifactId: left.metadata.artifactId,
    left: { versionId: leftVersionId, branchId: left.metadata.branchId, approval: left.metadata.approval.status, contentHash: left.contentHash },
    right: { versionId: rightVersionId, branchId: right.metadata.branchId, approval: right.metadata.approval.status, contentHash: right.contentHash },
    commonAncestorVersionId,
    sameContent: left.contentHash === right.contentHash,
    intendedDeviationChanges: {
      removed: left.metadata.intendedDeviations.filter((value) => !right.metadata.intendedDeviations.includes(value)),
      added: right.metadata.intendedDeviations.filter((value) => !left.metadata.intendedDeviations.includes(value))
    }
  };
}

export function createWebContactSheet(title: string, variants: Array<Omit<ComparisonVariant, "frames"> & { desktop: string; mobile: string }>): ComparisonSheet {
  return {
    schemaVersion: 1, kind: "web-contact-sheet", title,
    frameStyle: { background: "#F3F3F3", border: "#D4D4D4", labelPosition: "below", versionIdentifier: "visible" },
    variants: variants.map(({ desktop, mobile, ...variant }) => ({ ...variant, frames: [
      { id: `${variant.versionId}:desktop`, label: "Desktop", width: 1440, height: 900, source: desktop },
      { id: `${variant.versionId}:mobile`, label: "Mobile", width: 390, height: 844, source: mobile }
    ] }))
  };
}

export function createSlideSheet(title: string, variants: Array<Omit<ComparisonVariant, "frames"> & { slides: Array<{ slideId: string; source: string; label?: string }> }>): ComparisonSheet {
  return {
    schemaVersion: 1, kind: "slide-sheet", title,
    frameStyle: { background: "#F3F3F3", border: "#D4D4D4", labelPosition: "below", versionIdentifier: "visible" },
    variants: variants.map(({ slides, ...variant }) => ({ ...variant, frames: slides.map((slide, index) => ({
      id: `${variant.versionId}:${slide.slideId}`, label: slide.label ?? `Slide ${index + 1}`, width: 960, height: 540, source: slide.source, slideId: slide.slideId
    })) }))
  };
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function safeComparisonSource(value: string) {
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) && value.length <= 8_000_000) return value;
  if (/^\/(?!\/)[a-z0-9._/-]+$/i.test(value) && !value.split("/").includes("..")) return value;
  throw new Error("Comparison frames must use a bounded raster data URL or a project-relative image path.");
}

/** Renders a portable, consistently framed comparison sheet for browser capture. */
export function renderComparisonSheetHtml(sheet: ComparisonSheet) {
  const variants = sheet.variants.map((variant) => `<section class="variant"><header><strong>${escapeHtml(variant.directionName)}</strong><code>${escapeHtml(variant.versionId)}</code>${variant.designThesis ? `<p>${escapeHtml(variant.designThesis)}</p>` : ""}</header><div class="frames">${variant.frames.map((frame) => `<figure><div class="frame" style="aspect-ratio:${frame.width}/${frame.height}"><img src="${escapeHtml(safeComparisonSource(frame.source))}" alt="${escapeHtml(`${variant.directionName}, ${frame.label}, ${variant.versionId}`)}"></div><figcaption>${escapeHtml(frame.label)} · ${escapeHtml(variant.versionId)}</figcaption></figure>`).join("")}</div></section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sheet.title)}</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:${sheet.frameStyle.background};font:14px/1.4 system-ui;color:#191919}h1{margin:0 0 24px}.sheet{display:grid;gap:24px}.variant{background:white;border:1px solid ${sheet.frameStyle.border};padding:20px}.variant header{display:grid;grid-template-columns:1fr auto;gap:4px 16px}.variant p{grid-column:1/-1;margin:0;color:#666}.frames{display:flex;align-items:flex-start;gap:16px;margin-top:16px;overflow:auto}figure{margin:0;min-width:220px;flex:1}.frame{display:grid;place-items:center;background:#e8e8e8;border:1px solid ${sheet.frameStyle.border};overflow:hidden}.frame img{display:block;width:100%;height:100%;object-fit:contain}figcaption{margin-top:8px;font-size:12px;color:#555}code{font-size:12px}</style></head><body><h1>${escapeHtml(sheet.title)}</h1><main class="sheet">${variants}</main></body></html>`;
}
