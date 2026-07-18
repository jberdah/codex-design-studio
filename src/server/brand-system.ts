import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactBinding,
  ArtifactKind,
  BrandSystemRegistry,
  BrandSystemSnapshot,
  ReconciliationDecision,
  ReconciliationGroup,
  ReconciliationOption,
  ReconciliationReview,
  ReconciliationSourceRef
} from "@/domain/brand-system";
import type { Evidence, ProvenanceGraph } from "@/domain/sources";
import type { ProjectData } from "@/domain/types";
import { safeProjectPath } from "./paths";
import { loadProvenanceGraph } from "./source-store";
import { ensureProject, loadProject, saveProjectManifest } from "./store";
import { validHexColors } from "./review";

function now() { return new Date().toISOString(); }
const mutationQueues = new Map<string, Promise<void>>();
const activePublishTransactions = new Set<string>();

async function mutateBrandSystem<T>(projectId: string, operation: () => Promise<T>) {
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

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function serialize(value: unknown) { return JSON.stringify(stable(value)); }
function hash(value: unknown) { return createHash("sha256").update(serialize(value)).digest("hex"); }

export function validateBrandSystemContent(brand: ProjectData["brand"], tokens: ProjectData["tokens"]) {
  if (!brand || typeof brand !== "object" || !tokens || typeof tokens !== "object") throw new Error("A complete brand profile and token set are required.");
  if (JSON.stringify({ brand, tokens }).length > 250_000) throw new Error("BrandSystem input exceeds the 250 KB limit.");
  const string = (value: unknown, label: string, max = 2_000) => {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be a non-empty string of at most ${max} characters.`);
  };
  for (const [key, value] of Object.entries({ name: brand.name, industry: brand.industry, audience: brand.audience, promise: brand.promise, tone: brand.tone, visualDirection: brand.visualDirection })) string(value, `Brand ${key}`);
  if (!Array.isArray(brand.personality) || brand.personality.length > 32) throw new Error("Brand personality must contain at most 32 values.");
  brand.personality.forEach((value, index) => string(value, `Brand personality ${index + 1}`, 200));
  string(tokens.version, "Token version", 100);
  const colorKeys = ["primary", "secondary", "accent", "background", "surface", "text"] as const;
  if (!tokens.colors || colorKeys.some((key) => typeof tokens.colors[key] !== "string") || !validHexColors(tokens)) throw new Error("BrandSystem colours must all be valid six-digit hex values.");
  string(tokens.typography?.display, "Display typeface", 500); string(tokens.typography?.body, "Body typeface", 500);
  const boundedNumbers = (values: Record<string, unknown> | undefined, label: string, max: number) => {
    if (!values || Object.values(values).some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max)) throw new Error(`${label} values must be finite numbers between 0 and ${max}.`);
  };
  boundedNumbers(tokens.typography?.scale, "Typography scale", 512);
  boundedNumbers(tokens.spacing, "Spacing", 2_048);
  boundedNumbers(tokens.shape, "Shape", 2_048);
  string(tokens.media?.style, "Media style"); string(tokens.media?.lighting, "Media lighting"); string(tokens.media?.composition, "Media composition");
  for (const [label, values] of [["Voice attributes", tokens.voice?.attributes], ["Forbidden voice patterns", tokens.voice?.forbiddenPatterns]] as const) {
    if (!Array.isArray(values) || values.length > 64) throw new Error(`${label} must contain at most 64 values.`);
    values.forEach((value, index) => string(value, `${label} ${index + 1}`, 500));
  }
}

async function atomicJson(filePath: string, value: unknown) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(stable(value), null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function storage(projectId: string) {
  await ensureProject(projectId);
  const root = await safeProjectPath(projectId, "design-system");
  const versions = path.join(root, "versions");
  await mkdir(versions, { recursive: true });
  return {
    root,
    versions,
    registry: path.join(root, "registry.json"),
    decisions: await safeProjectPath(projectId, "reviews", "reconciliation-decisions.json"),
    transaction: path.join(root, "publish-transaction.json")
  };
}

async function recoverInterruptedPublication(projectId: string, files: Awaited<ReturnType<typeof storage>>) {
  if (activePublishTransactions.has(projectId)) return;
  try {
    const transaction = JSON.parse(await readFile(files.transaction, "utf8")) as { priorRegistry?: BrandSystemRegistry; priorProject?: ProjectData };
    if (transaction.priorRegistry?.projectId !== projectId || transaction.priorProject?.id !== projectId) throw new Error("Invalid BrandSystem recovery transaction.");
    await atomicJson(files.registry, transaction.priorRegistry);
    await saveProjectManifest(transaction.priorProject, false);
    await unlink(files.transaction);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function emptyRegistry(projectId: string): BrandSystemRegistry {
  return { schemaVersion: 1, projectId, nextVersion: 1, versions: [], bindings: [], updatedAt: now() };
}

export async function loadBrandSystemRegistry(projectId: string) {
  const files = await storage(projectId);
  await recoverInterruptedPublication(projectId, files);
  try { return JSON.parse(await readFile(files.registry, "utf8")) as BrandSystemRegistry; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return emptyRegistry(projectId);
  }
}

async function loadDecisions(projectId: string): Promise<ReconciliationDecision[]> {
  const files = await storage(projectId);
  try { return JSON.parse(await readFile(files.decisions, "utf8")) as ReconciliationDecision[]; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
}

function evidenceForCandidate(graph: ProvenanceGraph, candidateId: string) {
  return graph.evidence.find((item) => item.candidateId === candidateId);
}

function groupKey(kind: string, value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const named = object.path ?? object.token ?? object.role ?? object.name ?? object.evidenceType;
    if (typeof named === "string" && named.trim()) return `${kind}:${named.trim().toLowerCase()}`;
  }
  return `${kind}:default`;
}

function sourceRef(graph: ProvenanceGraph, input: { candidateId?: string; evidence: Evidence | undefined; sourceId: string; value: unknown; confidence: number }): ReconciliationSourceRef | undefined {
  const source = graph.sources.find((item) => item.id === input.sourceId && item.status !== "deleted");
  if (!source) return undefined;
  const evidence = input.evidence;
  return {
    id: evidence?.id ?? input.candidateId ?? `${source.id}:${hash(input.value).slice(0, 12)}`,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceLocator: source.origin.fileName ?? source.origin.locator ?? source.kind,
    candidateId: input.candidateId,
    evidenceId: evidence?.id,
    confidence: evidence?.confidence.score ?? input.confidence,
    confidenceMethod: evidence?.confidence.method ?? "extracted",
    directive: evidence?.directive ?? "advisory",
    intent: evidence?.intent ?? source.intent,
    value: input.value,
    userAuthored: source.kind === "manual" || evidence?.confidence.method === "manual"
  };
}

function refPriority(ref: ReconciliationSourceRef) {
  const directive = ref.directive === "must-use" ? 300 : ref.directive === "must-avoid" ? 250 : 0;
  return directive + (ref.userAuthored ? 100 : 0) + Math.round(ref.confidence * 100);
}

/** Merges equivalent values while retaining every source, confidence, intent and user priority. */
export async function reconcileProjectEvidence(projectId: string): Promise<ReconciliationReview> {
  const [graph, decisions] = await Promise.all([loadProvenanceGraph(projectId), loadDecisions(projectId)]);
  const grouped = new Map<string, { kind: Evidence["kind"]; refs: ReconciliationSourceRef[] }>();
  const claimedEvidence = new Set<string>();

  for (const candidate of graph.candidates) {
    const evidence = evidenceForCandidate(graph, candidate.id);
    if (evidence) claimedEvidence.add(evidence.id);
    const ref = sourceRef(graph, { candidateId: candidate.id, evidence, sourceId: candidate.sourceId, value: candidate.value, confidence: candidate.confidence });
    if (!ref) continue;
    const key = groupKey(candidate.kind, candidate.value);
    const entry = grouped.get(key) ?? { kind: candidate.kind, refs: [] };
    entry.refs.push(ref); grouped.set(key, entry);
  }
  for (const evidence of graph.evidence.filter((item) => !claimedEvidence.has(item.id))) {
    const ref = sourceRef(graph, { evidence, sourceId: evidence.sourceId, value: evidence.value, confidence: evidence.confidence.score });
    if (!ref) continue;
    const key = groupKey(evidence.kind, evidence.value);
    const entry = grouped.get(key) ?? { kind: evidence.kind, refs: [] };
    entry.refs.push(ref); grouped.set(key, entry);
  }

  const groups: ReconciliationGroup[] = [...grouped.entries()].map(([key, entry]) => {
    const optionMap = new Map<string, ReconciliationSourceRef[]>();
    for (const ref of entry.refs) {
      const normalized = serialize(typeof ref.value === "string" ? ref.value.trim().toLowerCase() : ref.value);
      optionMap.set(normalized, [...(optionMap.get(normalized) ?? []), ref]);
    }
    const options: ReconciliationOption[] = [...optionMap.entries()].map(([normalizedValue, sources]) => ({
      id: `opt_${hash(`${key}:${normalizedValue}`).slice(0, 16)}`,
      value: sources[0].value,
      normalizedValue,
      sources: sources.sort((a, b) => refPriority(b) - refPriority(a)),
      confidence: Math.max(...sources.map((source) => source.confidence)),
      priority: Math.max(...sources.map(refPriority))
    })).sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || a.id.localeCompare(b.id));
    const extractable = options.filter((option) => option.sources.some((source) => source.intent !== "inspire" && source.directive !== "must-avoid"));
    const directiveConflict = options.some((option) => option.sources.some((source) => source.directive === "must-avoid") && option.sources.some((source) => source.intent !== "inspire" && source.directive !== "must-avoid"));
    const id = `grp_${hash(key).slice(0, 16)}`;
    const storedDecision = decisions.find((item) => item.groupId === id);
    const decision = storedDecision && (storedDecision.action !== "accept" || options.some((item) => item.id === storedDecision.optionId)) ? storedDecision : undefined;
    const conflict = extractable.length > 1 || directiveConflict;
    let resolvedValue: unknown;
    if (decision?.action === "accept") resolvedValue = options.find((item) => item.id === decision.optionId)?.value;
    else if (decision?.action === "override") resolvedValue = decision.overrideValue;
    else if (!conflict && extractable.length === 1) resolvedValue = extractable[0].value;
    const resolved = Boolean(decision) || !conflict;
    const top = options[0];
    return {
      id, kind: entry.kind, key,
      label: key.split(":").slice(1).join(":").replaceAll("-", " "),
      options, conflict, decision, resolved, resolvedValue,
      conflictExplanation: conflict
        ? directiveConflict
          ? "At least one active source requires a value that another source explicitly prohibits. A user decision is required."
          : `${extractable.length} incompatible values were found across ${new Set(extractable.flatMap((option) => option.sources.map((source) => source.sourceId))).size} active sources. ${top?.sources[0]?.userAuthored ? "A user-authored direction has priority but still requires confirmation." : "No source is allowed to silently win."}`
        : undefined
    };
  }).sort((a, b) => Number(b.conflict) - Number(a.conflict) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));

  return { schemaVersion: 1, projectId, generatedAt: now(), groups, unresolvedConflictCount: groups.filter((group) => group.conflict && !group.resolved).length };
}

export async function recordReconciliationDecision(projectId: string, decision: Omit<ReconciliationDecision, "decidedAt">) {
  return mutateBrandSystem(projectId, async () => {
    const review = await reconcileProjectEvidence(projectId);
    const group = review.groups.find((item) => item.id === decision.groupId);
    if (!group) throw new Error("Reconciliation group not found or no longer has active evidence.");
    if (["accept", "inspiration"].includes(decision.action) && !group.options.some((item) => item.id === decision.optionId)) throw new Error("The selected value does not belong to this conflict.");
    if (decision.action === "override" && (decision.overrideValue === undefined || decision.overrideValue === "")) throw new Error("An override value is required.");
    if (decision.overrideValue !== undefined && JSON.stringify(decision.overrideValue).length > 50_000) throw new Error("The override value exceeds the 50 KB limit.");
    const files = await storage(projectId);
    const decisions = await loadDecisions(projectId);
    const recorded: ReconciliationDecision = { ...decision, decidedAt: now() };
    const next = [...decisions.filter((item) => item.groupId !== decision.groupId), recorded].sort((a, b) => a.groupId.localeCompare(b.groupId));
    await atomicJson(files.decisions, next);
    return reconcileProjectEvidence(projectId);
  });
}

export async function createBrandSystemDraft(projectId: string, input?: Pick<ProjectData, "brand" | "tokens">) {
  return mutateBrandSystem(projectId, async () => {
    const [storedProject, reconciliation, registry] = await Promise.all([loadProject(projectId), reconcileProjectEvidence(projectId), loadBrandSystemRegistry(projectId)]);
    const project = structuredClone(storedProject);
    if (input?.brand) project.brand = structuredClone(input.brand);
    if (input?.tokens) project.tokens = structuredClone(input.tokens);
    validateBrandSystemContent(project.brand, project.tokens);
    const files = await storage(projectId);
    const number = registry.nextVersion;
    const createdAt = now();
    const id = `bsv_${String(number).padStart(4, "0")}_${randomUUID().slice(0, 8)}`;
    const content = { brand: project.brand, tokens: project.tokens, reconciliation };
    const snapshot: BrandSystemSnapshot = {
      schemaVersion: 1, id, number, createdAt, createdBy: "user", basedOnVersionId: registry.publishedVersionId,
      contentHash: hash(content), brand: structuredClone(project.brand), tokens: structuredClone(project.tokens), reconciliation
    };
    await writeFile(path.join(files.versions, `${id}.json`), `${JSON.stringify(stable(snapshot), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    registry.versions.push({ id, number, status: "draft", contentHash: snapshot.contentHash, createdAt });
    registry.nextVersion += 1;
    registry.draftVersionId = id;
    registry.updatedAt = createdAt;
    await atomicJson(files.registry, registry);
    return { snapshot, registry };
  });
}

export async function loadBrandSystemVersion(projectId: string, versionId: string) {
  if (!/^bsv_[a-z0-9_-]+$/i.test(versionId)) throw new Error("Invalid BrandSystem version id.");
  const files = await storage(projectId);
  return JSON.parse(await readFile(path.join(files.versions, `${versionId}.json`), "utf8")) as BrandSystemSnapshot;
}

function initialBindings(project: ProjectData, versionId: string, at: string): ArtifactBinding[] {
  return (["web", "slides"] as const).map((artifactId) => ({
    artifactId, brandSystemVersionId: versionId, boundAt: at,
    independentlyComposed: artifactId === "web" && Boolean(project.webCustomized),
    history: [{ brandSystemVersionId: versionId, boundAt: at, action: "initial" }]
  }));
}

export async function publishBrandSystem(projectId: string, versionId: string, options: { failAfterRegistry?: boolean } = {}) {
  return mutateBrandSystem(projectId, async () => {
  const [project, registry, snapshot] = await Promise.all([loadProject(projectId), loadBrandSystemRegistry(projectId), loadBrandSystemVersion(projectId, versionId)]);
  const files = await storage(projectId);
  const target = registry.versions.find((item) => item.id === versionId);
  if (!target || target.status !== "draft") throw new Error("Only a draft BrandSystem version can be published.");
  if (snapshot.reconciliation.unresolvedConflictCount) throw new Error(`${snapshot.reconciliation.unresolvedConflictCount} evidence conflict(s) must be resolved before publication.`);
  if (!validHexColors(snapshot.tokens)) throw new Error("BrandSystem colours must be valid six-digit hex values before publication.");
  if (hash({ brand: snapshot.brand, tokens: snapshot.tokens, reconciliation: snapshot.reconciliation }) !== snapshot.contentHash) throw new Error("BrandSystem snapshot integrity check failed.");

  const priorRegistry = structuredClone(registry);
  const priorProject = structuredClone(project);
  const publishedAt = now();
  activePublishTransactions.add(projectId);
  await atomicJson(files.transaction, { versionId, startedAt: publishedAt, priorRegistry, priorProject });
  try {
    for (const version of registry.versions) {
      if (version.status === "published") { version.status = "superseded"; version.supersededAt = publishedAt; }
    }
    target.status = "published"; target.publishedAt = publishedAt;
    registry.publishedVersionId = versionId;
    if (registry.draftVersionId === versionId) registry.draftVersionId = undefined;
    if (!registry.bindings.length) registry.bindings = initialBindings(project, versionId, publishedAt);
    registry.updatedAt = publishedAt;
    await atomicJson(files.registry, registry);
    if (options.failAfterRegistry) throw new Error("Injected publish failure.");
    project.tokens = structuredClone(snapshot.tokens);
    project.brand = structuredClone(snapshot.brand);
    project.lastSummary = `Published immutable BrandSystem v${snapshot.number}; artifact bindings were left unchanged.`;
    project.version += 1;
    await saveProjectManifest(project);
    await unlink(files.transaction).catch(() => undefined);
    return { snapshot, registry, project };
  } catch (error) {
    await atomicJson(files.registry, priorRegistry);
    await saveProjectManifest(priorProject, false);
    await unlink(files.transaction).catch(() => undefined);
    throw error;
  } finally {
    activePublishTransactions.delete(projectId);
  }
  });
}

export async function previewArtifactUpgrade(projectId: string, artifactId: ArtifactKind, versionId: string) {
  const [registry, snapshot] = await Promise.all([loadBrandSystemRegistry(projectId), loadBrandSystemVersion(projectId, versionId)]);
  const version = registry.versions.find((item) => item.id === versionId);
  if (!version || version.status === "draft") throw new Error("Artifacts can only preview published or superseded versions.");
  const binding = registry.bindings.find((item) => item.artifactId === artifactId);
  if (!binding) throw new Error("Artifact has no published BrandSystem binding.");
  return { artifactId, currentVersionId: binding?.brandSystemVersionId, targetVersion: version, snapshot, independentlyComposed: binding?.independentlyComposed ?? false, mutatesArtifact: false };
}

export async function changeArtifactBinding(projectId: string, artifactId: ArtifactKind, action: "upgrade" | "rollback", versionId?: string) {
  return mutateBrandSystem(projectId, async () => {
  const registry = await loadBrandSystemRegistry(projectId);
  const project = await loadProject(projectId);
  const binding = registry.bindings.find((item) => item.artifactId === artifactId);
  if (!binding) throw new Error("Artifact has no published BrandSystem binding.");
  let targetId = versionId;
  if (action === "rollback" && !targetId) {
    targetId = [...binding.history].reverse().find((item) => item.brandSystemVersionId !== binding.brandSystemVersionId)?.brandSystemVersionId;
  }
  const target = registry.versions.find((item) => item.id === targetId && item.status !== "draft");
  if (!target) throw new Error("A published or superseded target version is required.");
  await loadBrandSystemVersion(projectId, target.id);
  const boundAt = now();
  binding.brandSystemVersionId = target.id;
  binding.boundAt = boundAt;
  binding.independentlyComposed ||= artifactId === "web" && Boolean(project.webCustomized);
  binding.history.push({ brandSystemVersionId: target.id, boundAt, action });
  registry.updatedAt = boundAt;
  const files = await storage(projectId);
  await atomicJson(files.registry, registry);
  return { binding, registry, artifactPreserved: binding.independentlyComposed };
  });
}

export async function brandSystemWorkspace(projectId: string) {
  const [registry, reconciliation] = await Promise.all([loadBrandSystemRegistry(projectId), reconcileProjectEvidence(projectId)]);
  return { registry, reconciliation };
}
