import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import type {
  GeneratedAssetVersion,
  MediaGenerationRun,
  VisualAssetApprovalEvent,
  VisualAssetBrief,
  VisualAssetEncoding,
  VisualAssetPlacement,
  VisualAssetRegistry,
  VisualAssetTarget,
  VisualAssetValidation,
  VisualGenerationAdapter,
  VisualGenerationOutput,
  VisualGenerationRequest
} from "@/domain/visual-assets";
import { buildDeliberateVariantPrompts, validateVisualAssetBrief } from "@/domain/visual-assets";
import { loadBrandSystemRegistry } from "./brand-system";
import { ensureProject } from "./store";
import { safeProjectPath } from "./paths";
import { renameWithRetry } from "./fs-atomic";

const mutations = new Map<string, Promise<void>>();
const activeRuns = new Map<string, AbortController>();

function now(clock?: () => Date) { return (clock?.() ?? new Date()).toISOString(); }
function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

async function atomicJson(filePath: string, value: unknown) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(stable(value), null, 2)}\n`, "utf8");
  await renameWithRetry(temporary, filePath);
}

async function mutate<T>(projectId: string, operation: () => Promise<T>) {
  const previous = mutations.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  mutations.set(projectId, queued);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (mutations.get(projectId) === queued) mutations.delete(projectId);
  }
}

async function storage(projectId: string) {
  await ensureProject(projectId);
  const root = await safeProjectPath(projectId, "visual-assets");
  const files = path.join(root, "files");
  const versions = path.join(root, "versions");
  const runs = path.join(root, "runs");
  await Promise.all([mkdir(files, { recursive: true }), mkdir(versions, { recursive: true }), mkdir(runs, { recursive: true })]);
  return { root, files, versions, runs, registry: path.join(root, "registry.json") };
}

function emptyRegistry(projectId: string): VisualAssetRegistry {
  return { schemaVersion: 1, projectId, briefs: [], versions: [], runs: [], placements: [], approvedVersionIds: {}, updatedAt: new Date(0).toISOString() };
}

export async function loadVisualAssetRegistry(projectId: string): Promise<VisualAssetRegistry> {
  const files = await storage(projectId);
  try { return JSON.parse(await readFile(files.registry, "utf8")) as VisualAssetRegistry; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return emptyRegistry(projectId);
  }
}

async function assertPublishedBrandSystem(projectId: string, versionId: string) {
  const registry = await loadBrandSystemRegistry(projectId);
  const version = registry.versions.find((item) => item.id === versionId);
  if (!version || version.status !== "published") throw new Error("Visual generation requires the currently published BrandSystem version.");
}

export async function saveVisualAssetBrief(projectId: string, brief: VisualAssetBrief, options: { clock?: () => Date } = {}) {
  validateVisualAssetBrief(brief);
  await assertPublishedBrandSystem(projectId, brief.brandSystemVersionId);
  return mutate(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadVisualAssetRegistry(projectId);
    if (registry.briefs.some((item) => item.id === brief.id)) throw new Error("Visual asset brief ids must be unique.");
    registry.briefs.push(structuredClone(brief));
    registry.updatedAt = now(options.clock);
    await atomicJson(files.registry, registry);
    return structuredClone(brief);
  });
}

interface ImageInspection { encoding: VisualAssetEncoding; width: number; height: number; hasTransparency: boolean }

function inspectPng(bytes: Uint8Array): ImageInspection | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colorType = bytes[25];
  let hasTransparency = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > bytes.length) break;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "tRNS") hasTransparency = true;
    offset += length + 12;
  }
  if ((colorType === 4 || colorType === 6) && !hasTransparency) {
    const decoded = PNG.sync.read(Buffer.from(bytes));
    for (let index = 3; index < decoded.data.length; index += 4) {
      if (decoded.data[index] < 255) { hasTransparency = true; break; }
    }
  }
  return { encoding: "png", width: view.getUint32(16), height: view.getUint32(20), hasTransparency };
}

function inspectJpeg(bytes: Uint8Array): ImageInspection | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + length + 2 > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { encoding: "jpeg", height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8], hasTransparency: false };
    }
    offset += length + 2;
  }
  throw new Error("JPEG output does not contain readable dimensions.");
}

function readUint24LE(bytes: Uint8Array, offset: number) { return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16); }

function inspectWebp(bytes: Uint8Array): ImageInspection | undefined {
  if (bytes.length < 30 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") return undefined;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") return { encoding: "webp", hasTransparency: Boolean(bytes[20] & 0x10), width: 1 + readUint24LE(bytes, 24), height: 1 + readUint24LE(bytes, 27) };
  if (chunk === "VP8L") {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { encoding: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, hasTransparency: Boolean(bits & (1 << 28)) };
  }
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { encoding: "webp", width: bytes[26] | ((bytes[27] & 0x3f) << 8), height: bytes[28] | ((bytes[29] & 0x3f) << 8), hasTransparency: false };
  throw new Error("WebP output does not contain readable dimensions.");
}

export function inspectGeneratedImage(bytes: Uint8Array): ImageInspection {
  if (!bytes.length) throw new Error("The generation adapter returned an empty image.");
  const inspection = inspectPng(bytes) ?? inspectJpeg(bytes) ?? inspectWebp(bytes);
  if (!inspection || inspection.width < 1 || inspection.height < 1) throw new Error("Generated output must be a valid PNG, JPEG or WebP image.");
  return inspection;
}

function targetCrop(target: VisualAssetTarget) {
  if (target.context.type === "web") return { context: "web" as const, width: target.context.crop.width, height: target.context.crop.height, fit: target.context.fit };
  if (target.context.type === "slide") return { context: "slide" as const, width: target.context.frame.width, height: target.context.frame.height, fit: target.context.fit };
  return { context: "template" as const, width: target.context.frame.width, height: target.context.frame.height, fit: target.context.fit };
}

export function validateGeneratedAsset(bytes: Uint8Array, brief: VisualAssetBrief, clock?: () => Date) {
  const inspected = inspectGeneratedImage(bytes);
  const checkedAt = now(clock);
  const validations: VisualAssetValidation[] = [];
  const add = (id: string, context: VisualAssetValidation["context"], status: VisualAssetValidation["status"], message: string, measurements?: VisualAssetValidation["measurements"]) => validations.push({ id, context, status, message, checkedAt, measurements });
  add("encoding", "source", inspected.encoding === brief.output.encoding ? "pass" : "error", inspected.encoding === brief.output.encoding ? `Encoding is ${inspected.encoding}.` : `Expected ${brief.output.encoding}, received ${inspected.encoding}.`);
  add("dimensions", "source", inspected.width === brief.output.width && inspected.height === brief.output.height ? "pass" : "error", `Image measures ${inspected.width}×${inspected.height}; requested ${brief.output.width}×${brief.output.height}.`, { width: inspected.width, height: inspected.height });
  add("bytes", "source", bytes.byteLength <= brief.output.maxBytes ? "pass" : "error", `${bytes.byteLength} bytes of ${brief.output.maxBytes} allowed.`, { bytes: bytes.byteLength, maxBytes: brief.output.maxBytes });
  const transparencyOkay = brief.output.background !== "transparent" || inspected.hasTransparency;
  add("transparency", "source", transparencyOkay ? "pass" : "error", inspected.hasTransparency ? "Transparency is present." : brief.output.background === "transparent" ? "Transparent output was required but no alpha channel was found." : "Opaque output accepted.");
  const crop = targetCrop(brief.target);
  const sourceRatio = inspected.width / inspected.height;
  const targetRatio = crop.width / crop.height;
  const retainedFraction = crop.fit === "contain" ? 1 : Math.min(sourceRatio / targetRatio, targetRatio / sourceRatio);
  const cropStatus = retainedFraction < 0.35 ? "error" : retainedFraction < 0.65 ? "warning" : "pass";
  add(`crop:${brief.target.contextId}`, crop.context, cropStatus, crop.fit === "contain" ? "The complete image remains visible in the target context." : `${Math.round(retainedFraction * 100)}% of the source area remains visible with cover cropping.`, { sourceAspectRatio: sourceRatio, targetAspectRatio: targetRatio, retainedFraction, fit: crop.fit });
  return { inspected, validations };
}

function extension(encoding: VisualAssetEncoding) { return encoding === "jpeg" ? "jpg" : encoding; }

function publicFileUri(versionId: string, encoding: VisualAssetEncoding) { return `/api/visual-assets/files/${versionId}.${extension(encoding)}`; }

async function persistOutput(projectId: string, run: MediaGenerationRun, output: VisualGenerationOutput, index: number, clock?: () => Date) {
  return mutate(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadVisualAssetRegistry(projectId);
    const currentRun = registry.runs.find((item) => item.id === run.id);
    if (!currentRun) throw new Error("Generation run disappeared before output persistence.");
    const { inspected, validations } = validateGeneratedAsset(output.bytes, run.brief, clock);
    const versionId = `gav_${randomUUID()}`;
    const createdAt = now(clock);
    const version: GeneratedAssetVersion = {
      schemaVersion: 1,
      assetId: run.assetId,
      versionId,
      briefId: run.brief.id,
      brandSystemVersionId: run.brief.brandSystemVersionId,
      target: structuredClone(run.brief.target),
      prompt: run.prompts[index] ?? run.brief.prompt,
      revisedPrompt: output.revisedPrompt,
      inputAssets: structuredClone(run.brief.inputAssets),
      model: { adapter: run.adapter, name: run.model },
      output: { ...structuredClone(run.brief.output), actualWidth: inspected.width, actualHeight: inspected.height, actualBytes: output.bytes.byteLength, actualEncoding: inspected.encoding, hasTransparency: inspected.hasTransparency },
      lineage: {
        parentVersionId: run.brief.inputAssets.find((item) => item.purpose === "edit-source")?.versionId,
        inputVersionIds: run.brief.inputAssets.flatMap((item) => item.versionId ? [item.versionId] : []),
        generationRunId: run.id,
        providerItemId: output.providerItemId,
        providerResponseId: output.providerResponseId
      },
      contentHash: sha256(output.bytes),
      fileUri: publicFileUri(versionId, inspected.encoding),
      createdAt,
      approval: { status: "pending", events: [] },
      validations
    };
    const filePath = path.join(files.files, `${versionId}.${extension(inspected.encoding)}`);
    await writeFile(filePath, output.bytes, { flag: "wx" });
    await atomicJson(path.join(files.versions, `${versionId}.json`), version);
    registry.versions.push(version);
    currentRun.outputVersionIds.push(versionId);
    registry.updatedAt = createdAt;
    await Promise.all([atomicJson(path.join(files.runs, `${run.id}.json`), currentRun), atomicJson(files.registry, registry)]);
    return version;
  });
}

function sanitizedError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 1_000);
  const retryable = /timeout|timed out|rate|429|5\d\d|temporar|connection|abort/i.test(message);
  return { code: error instanceof DOMException && error.name === "AbortError" ? "cancelled" : retryable ? "transient_provider_error" : "generation_failed", message, retryable };
}

async function updateRun(projectId: string, runId: string, update: (run: MediaGenerationRun) => void, clock?: () => Date) {
  return mutate(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadVisualAssetRegistry(projectId);
    const run = registry.runs.find((item) => item.id === runId);
    if (!run) throw new Error("Generation run not found.");
    update(run);
    registry.updatedAt = now(clock);
    await Promise.all([atomicJson(path.join(files.runs, `${run.id}.json`), run), atomicJson(files.registry, registry)]);
    return structuredClone(run);
  });
}

async function executeRun(projectId: string, runId: string, adapter: VisualGenerationAdapter, options: { clock?: () => Date; signal?: AbortSignal } = {}) {
  const registry = await loadVisualAssetRegistry(projectId);
  const stored = registry.runs.find((item) => item.id === runId);
  if (!stored) throw new Error("Generation run not found.");
  if (stored.attempts.length >= stored.costGuard.maxAttempts) throw new Error("Generation retry cost guard exhausted.");
  const controller = new AbortController();
  const relay = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", relay, { once: true });
  activeRuns.set(runId, controller);
  const attemptNumber = stored.attempts.length + 1;
  const running = await updateRun(projectId, runId, (run) => {
    run.status = "running"; run.startedAt ??= now(options.clock); run.failure = undefined;
    run.attempts.push({ number: attemptNumber, status: "running", startedAt: now(options.clock) });
  }, options.clock);
  try {
    const inputAssets = await hydrateVisualInputs(projectId, running.brief.inputAssets);
    const outputs = await adapter.generate({ runId, projectId, brief: running.brief, prompts: running.prompts, model: running.model, output: running.brief.output, inputAssets }, controller.signal);
    if (outputs.length !== running.prompts.length) throw new Error(`Generation adapter returned ${outputs.length} outputs for ${running.prompts.length} deliberate variants.`);
    const versions: GeneratedAssetVersion[] = [];
    for (const [index, output] of outputs.entries()) versions.push(await persistOutput(projectId, running, output, index, options.clock));
    await updateRun(projectId, runId, (run) => {
      const attempt = run.attempts.find((item) => item.number === attemptNumber)!;
      attempt.status = "completed"; attempt.completedAt = now(options.clock);
      run.status = "completed"; run.completedAt = now(options.clock); run.failure = undefined;
    }, options.clock);
    return versions;
  } catch (error) {
    const failure = sanitizedError(error);
    await updateRun(projectId, runId, (run) => {
      const attempt = run.attempts.find((item) => item.number === attemptNumber)!;
      attempt.status = controller.signal.aborted || failure.code === "cancelled" ? "cancelled" : "failed";
      attempt.completedAt = now(options.clock); attempt.error = failure;
      run.status = attempt.status === "cancelled" ? "cancelled" : "failed";
      if (run.status === "cancelled") run.cancelledAt = now(options.clock);
      else run.failure = failure;
      run.completedAt = now(options.clock);
    }, options.clock);
    throw new Error(failure.message);
  } finally {
    options.signal?.removeEventListener("abort", relay);
    activeRuns.delete(runId);
  }
}

export async function generateVisualAsset(projectId: string, assetId: string, brief: VisualAssetBrief, adapter: VisualGenerationAdapter, options: { clock?: () => Date; signal?: AbortSignal; maxAttempts?: number } = {}) {
  validateVisualAssetBrief(brief);
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(assetId)) throw new Error("Asset id contains unsupported characters.");
  if (brief.output.variants > 4) throw new Error("At most four variants may be generated in one guarded run.");
  await assertPublishedBrandSystem(projectId, brief.brandSystemVersionId);
  const prompts = buildDeliberateVariantPrompts(brief);
  const run = await mutate(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadVisualAssetRegistry(projectId);
    const existingBrief = registry.briefs.find((item) => item.id === brief.id);
    if (existingBrief && JSON.stringify(stable(existingBrief)) !== JSON.stringify(stable(brief))) throw new Error("Visual asset brief ids must identify immutable content.");
    if (!existingBrief) registry.briefs.push(structuredClone(brief));
    const createdAt = now(options.clock);
    const created: MediaGenerationRun = {
      schemaVersion: 1, id: `mgr_${randomUUID()}`, projectId, assetId, brief: structuredClone(brief), adapter: adapter.id,
      credentialMode: adapter.credentialMode, model: adapter.model, status: "queued", prompts, attempts: [], outputVersionIds: [],
      costGuard: { maxVariants: 4, maxAttempts: Math.min(Math.max(options.maxAttempts ?? 2, 1), 3), maxOutputBytes: brief.output.maxBytes * brief.output.variants }, createdAt
    };
    registry.runs.push(created); registry.updatedAt = createdAt;
    await Promise.all([atomicJson(path.join(files.runs, `${created.id}.json`), created), atomicJson(files.registry, registry)]);
    return created;
  });
  const versions = await executeRun(projectId, run.id, adapter, options);
  return { run: (await loadVisualAssetRegistry(projectId)).runs.find((item) => item.id === run.id)!, versions };
}

export async function retryVisualAssetGeneration(projectId: string, runId: string, adapter: VisualGenerationAdapter, options: { clock?: () => Date; signal?: AbortSignal } = {}) {
  const registry = await loadVisualAssetRegistry(projectId);
  const run = registry.runs.find((item) => item.id === runId);
  if (!run || run.status !== "failed" || !run.failure?.retryable) throw new Error("Only retryable failed generation runs can be retried.");
  if (run.adapter !== adapter.id || run.model !== adapter.model) throw new Error("Retries must use the original adapter and model for provenance continuity.");
  return executeRun(projectId, runId, adapter, options);
}

export async function cancelVisualAssetGeneration(projectId: string, runId: string, options: { clock?: () => Date } = {}) {
  activeRuns.get(runId)?.abort(new DOMException("Generation cancelled", "AbortError"));
  return updateRun(projectId, runId, (run) => {
    if (["completed", "failed", "cancelled"].includes(run.status)) return;
    run.status = "cancelled"; run.cancelledAt = now(options.clock); run.completedAt = now(options.clock);
  }, options.clock);
}

const transitions: Record<GeneratedAssetVersion["approval"]["status"], GeneratedAssetVersion["approval"]["status"][]> = {
  pending: ["approved", "changes_requested", "rejected"], changes_requested: ["approved", "rejected"], approved: ["changes_requested"], rejected: []
};

export async function transitionVisualAssetApproval(projectId: string, versionId: string, to: GeneratedAssetVersion["approval"]["status"], options: { actor?: VisualAssetApprovalEvent["actor"]; note?: string; clock?: () => Date } = {}) {
  return mutate(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadVisualAssetRegistry(projectId);
    const version = registry.versions.find((item) => item.versionId === versionId);
    if (!version) throw new Error("Visual asset version not found.");
    const from = version.approval.status;
    if (!transitions[from].includes(to)) throw new Error(`Visual asset approval cannot transition from ${from} to ${to}.`);
    if (to === "approved" && version.validations.some((item) => item.status === "error")) throw new Error("Visual assets must pass encoding, dimensions, transparency, byte budget and target crop validation before approval.");
    const at = now(options.clock); const actor = options.actor ?? "user";
    version.approval.status = to; version.approval.events.push({ from, to, actor, at, note: options.note });
    if (to === "approved") { version.approval.approvedAt = at; version.approval.approvedBy = actor; registry.approvedVersionIds[version.assetId] = versionId; }
    else { version.approval.approvedAt = undefined; version.approval.approvedBy = undefined; if (registry.approvedVersionIds[version.assetId] === versionId) delete registry.approvedVersionIds[version.assetId]; }
    registry.updatedAt = at;
    await Promise.all([atomicJson(path.join(files.versions, `${versionId}.json`), version), atomicJson(files.registry, registry)]);
    return structuredClone(version);
  });
}

export function approveVisualAsset(projectId: string, versionId: string, options: { actor?: VisualAssetApprovalEvent["actor"]; note?: string; clock?: () => Date } = {}) { return transitionVisualAssetApproval(projectId, versionId, "approved", options); }

export async function restoreVisualAsset(projectId: string, sourceVersionId: string, options: { actor?: VisualAssetApprovalEvent["actor"]; clock?: () => Date } = {}) {
  return mutate(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadVisualAssetRegistry(projectId);
    const source = registry.versions.find((item) => item.versionId === sourceVersionId);
    if (!source) throw new Error("Restore source version not found.");
    const sourceFile = path.join(files.files, `${sourceVersionId}.${extension(source.output.actualEncoding)}`);
    const bytes = await readFile(sourceFile);
    if (sha256(bytes) !== source.contentHash) throw new Error("Restore source integrity check failed.");
    const versionId = `gav_${randomUUID()}`; const createdAt = now(options.clock);
    const restored: GeneratedAssetVersion = {
      ...structuredClone(source), versionId, createdAt, fileUri: publicFileUri(versionId, source.output.actualEncoding),
      lineage: { ...structuredClone(source.lineage), parentVersionId: registry.versions.filter((item) => item.assetId === source.assetId).at(-1)?.versionId, generationRunId: source.lineage.generationRunId, restoredFromVersionId: sourceVersionId },
      approval: { status: "pending", events: [] }
    };
    await writeFile(path.join(files.files, `${versionId}.${extension(source.output.actualEncoding)}`), bytes, { flag: "wx" });
    await atomicJson(path.join(files.versions, `${versionId}.json`), restored);
    registry.versions.push(restored); registry.updatedAt = createdAt;
    await atomicJson(files.registry, registry);
    return restored;
  });
}

export async function placeVisualAsset(projectId: string, versionId: string, target: VisualAssetTarget, options: { placementId?: string; actor?: VisualAssetPlacement["placedBy"]; clock?: () => Date } = {}) {
  return mutate(projectId, async () => {
    const files = await storage(projectId);
    const registry = await loadVisualAssetRegistry(projectId);
    const version = registry.versions.find((item) => item.versionId === versionId);
    if (!version || version.approval.status !== "approved") throw new Error("Only approved visual asset versions can be placed.");
    const brief = registry.briefs.find((item) => item.id === version.briefId);
    if (!brief) throw new Error("Visual asset placement requires its immutable source brief.");
    const bytes = await readFile(path.join(files.files, `${versionId}.${extension(version.output.actualEncoding)}`));
    if (sha256(bytes) !== version.contentHash) throw new Error("Visual asset placement integrity check failed.");
    const placementChecks = validateGeneratedAsset(bytes, { ...structuredClone(brief), target }, options.clock).validations;
    if (placementChecks.some((item) => item.status === "error")) throw new Error("Visual asset does not pass validation in the requested placement target.");
    const id = options.placementId ?? `vap_${randomUUID()}`;
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(id)) throw new Error("Placement id contains unsupported characters.");
    const placement: VisualAssetPlacement = { id, target: structuredClone(target), assetId: version.assetId, versionId, placedAt: now(options.clock), placedBy: options.actor ?? "user" };
    registry.placements = [...registry.placements.filter((item) => item.id !== id), placement];
    registry.updatedAt = placement.placedAt;
    await atomicJson(files.registry, registry);
    return placement;
  });
}

export async function compareVisualAssetVersions(projectId: string, versionIds: string[]) {
  if (versionIds.length < 2 || versionIds.length > 4 || new Set(versionIds).size !== versionIds.length) throw new Error("Compare requires two to four distinct visual asset versions.");
  const registry = await loadVisualAssetRegistry(projectId);
  const versions = versionIds.map((id) => registry.versions.find((item) => item.versionId === id));
  if (versions.some((item) => !item)) throw new Error("A compared visual asset version was not found.");
  if (new Set(versions.map((item) => item!.assetId)).size !== 1) throw new Error("Only versions of the same visual asset can be compared.");
  return versions.map((version) => ({ versionId: version!.versionId, fileUri: version!.fileUri, contentHash: version!.contentHash, prompt: version!.prompt, revisedPrompt: version!.revisedPrompt, approvalStatus: version!.approval.status, validations: version!.validations }));
}

export async function refineVisualAsset(projectId: string, sourceVersionId: string, instruction: string, adapter: VisualGenerationAdapter, options: { clock?: () => Date; signal?: AbortSignal } = {}) {
  if (!instruction.trim() || instruction.length > 4_000) throw new Error("A refinement instruction of at most 4,000 characters is required.");
  const registry = await loadVisualAssetRegistry(projectId);
  const source = registry.versions.find((item) => item.versionId === sourceVersionId);
  if (!source) throw new Error("Refinement source version not found.");
  const originalBrief = registry.briefs.find((item) => item.id === source.briefId);
  if (!originalBrief) throw new Error("Refinement source brief not found.");
  const brief: VisualAssetBrief = {
    ...structuredClone(originalBrief), id: `vab_${randomUUID()}`, title: `${originalBrief.title} refinement`,
    prompt: `${source.revisedPrompt ?? source.prompt}\nRefinement: ${instruction.trim()}\nPreserve all unmentioned details.`,
    inputAssets: [...originalBrief.inputAssets.filter((item) => item.purpose !== "edit-source"), { versionId: sourceVersionId, contentHash: source.contentHash, purpose: "edit-source" }],
    output: { ...originalBrief.output, variants: 1 }, createdAt: now(options.clock), createdBy: "user"
  };
  return generateVisualAsset(projectId, source.assetId, brief, adapter, options);
}

async function hydrateVisualInputs(projectId: string, inputs: VisualAssetBrief["inputAssets"]): Promise<VisualGenerationRequest["inputAssets"]> {
  const hydrated: VisualGenerationRequest["inputAssets"] = [];
  for (const input of inputs) {
    if (!input.versionId) throw new Error("Visual reference URIs must be imported as immutable asset versions before generation.");
    const { version, bytes } = await readVisualAssetFile(projectId, input.versionId);
    if (version.contentHash !== input.contentHash) throw new Error("Visual reference hash does not match its immutable asset version.");
    hydrated.push({ ...structuredClone(input), bytes: new Uint8Array(bytes), mediaType: version.output.actualEncoding === "jpeg" ? "image/jpeg" : `image/${version.output.actualEncoding}` });
  }
  return hydrated;
}

export async function readVisualAssetFile(projectId: string, versionId: string) {
  const registry = await loadVisualAssetRegistry(projectId);
  const version = registry.versions.find((item) => item.versionId === versionId);
  if (!version) throw new Error("Visual asset version not found.");
  const files = await storage(projectId);
  const bytes = await readFile(path.join(files.files, `${versionId}.${extension(version.output.actualEncoding)}`));
  if (sha256(bytes) !== version.contentHash) throw new Error("Visual asset file integrity check failed.");
  return { version, bytes };
}
