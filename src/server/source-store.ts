import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Candidate,
  BootstrapReferenceInput,
  BootstrapReferenceState,
  Evidence,
  EvidenceDirective,
  EvidenceKind,
  EvidenceLocator,
  ExtractionError,
  ExtractionRun,
  ManualEvidenceInput,
  ProvenanceGraph,
  Source,
  SourceAuditEvent,
  SourceIntent,
  SourceKind,
  SourceOrigin,
  SourcePermissions,
  SourceRelationship,
  SourceRights,
  SourceRole
} from "@/domain/sources";
import { ensureProject } from "./store";
import { safeProjectPath } from "./paths";
import { assertSafeWebUrl } from "./network-policy";
import { renameWithRetry } from "./fs-atomic";

const graphFileName = "graph.json";
const mutationQueues = new Map<string, Promise<void>>();

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function now() {
  return new Date().toISOString();
}

function roleForIntent(intent: SourceIntent): SourceRole {
  return intent === "inspire" ? "inspiration" : "evidence";
}

export function normalizeSourcePolicy(_kind: SourceKind, input: {
  intent?: SourceIntent;
  role?: SourceRole;
  relationship?: SourceRelationship;
  rightsNotes?: string;
  rightsConfirmed?: boolean;
  permissions?: Partial<SourcePermissions>;
}) {
  const intent = input.intent ?? "extract";
  const relationship = input.relationship ?? "unknown";
  const role = input.role ?? roleForIntent(intent);
  const rights: SourceRights = {
    notes: input.rightsNotes?.trim() ?? "",
    confirmed: input.rightsConfirmed ?? false,
    relationship,
    permissions: {
      analyze: true,
      inspire: intent !== "extract" || input.permissions?.inspire === true,
      reproduceAssets: input.permissions?.reproduceAssets === true,
      reproduceCopy: input.permissions?.reproduceCopy === true,
      distribute: input.permissions?.distribute === true
    }
  };
  return { intent, role, rights };
}

function normalizePersistedSource(source: Source) {
  const policy = normalizeSourcePolicy(source.kind, {
    intent: source.intent,
    role: source.role,
    relationship: source.rights.relationship,
    rightsNotes: source.rights.notes,
    rightsConfirmed: source.rights.confirmed,
    permissions: source.rights.permissions
  });
  source.intent = policy.intent;
  source.role = policy.role;
  source.rights = policy.rights;
  return source;
}

function locatorFor(source: Source, value: Evidence["value"]): EvidenceLocator {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const provenance = record.provenance && typeof record.provenance === "object" && !Array.isArray(record.provenance) ? record.provenance as Record<string, unknown> : {};
  const type = String(provenance.type ?? "");
  const base = { sourceHash: source.contentHash };
  if (source.kind === "manual") return { type: "manual", ...base, field: typeof record.field === "string" ? record.field : undefined };
  if (source.kind === "url" || type === "web-capture") return {
    type: "web", ...base, requestedUrl: source.origin.locator,
    finalUrl: typeof provenance.finalUrl === "string" ? provenance.finalUrl : undefined,
    capturedAt: typeof provenance.capturedAt === "string" ? provenance.capturedAt : undefined,
    viewport: typeof provenance.viewport === "string" ? provenance.viewport : undefined,
    selector: typeof provenance.selector === "string" ? provenance.selector : undefined
  };
  if (["document", "deck", "spreadsheet"].includes(source.kind) || type === "document") {
    const format = typeof provenance.format === "string" ? provenance.format : "";
    const index = Number.isInteger(provenance.index) ? provenance.index as number : undefined;
    return {
      type: "document", ...base, fileName: source.origin.fileName,
      part: typeof provenance.part === "string" ? provenance.part : undefined,
      page: Number.isInteger(provenance.page) ? provenance.page as number : undefined,
      slide: format === "pptx" ? index : undefined,
      sheet: format === "xlsx" ? index : undefined,
      cell: typeof provenance.cell === "string" ? provenance.cell : undefined,
      assetPath: typeof record.embeddedPath === "string" ? record.embeddedPath : undefined
    };
  }
  if (["logo", "image", "screenshot"].includes(source.kind) || type === "original-asset") return { type: "image", ...base, fileName: source.origin.fileName, assetPath: typeof record.embeddedPath === "string" ? record.embeddedPath : undefined };
  if (source.kind === "codebase") return { type: "code", ...base, fileName: source.origin.fileName, part: typeof provenance.path === "string" ? provenance.path : undefined };
  return { type: "source", ...base, fileName: source.origin.fileName };
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortObject(child)]));
  }
  return value;
}

export function deterministicProvenanceJson(graph: ProvenanceGraph) {
  const normalized: ProvenanceGraph = {
    ...graph,
    sources: [...graph.sources].sort((a, b) => a.id.localeCompare(b.id)),
    evidence: [...graph.evidence].sort((a, b) => a.id.localeCompare(b.id)),
    candidates: [...graph.candidates].sort((a, b) => a.id.localeCompare(b.id)),
    extractionRuns: [...graph.extractionRuns].map((run) => ({ ...run, candidateIds: [...run.candidateIds].sort() })).sort((a, b) => a.id.localeCompare(b.id)),
    audit: [...graph.audit].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  };
  return `${JSON.stringify(sortObject(normalized), null, 2)}\n`;
}

async function sourcePaths(projectId: string) {
  await ensureProject(projectId);
  const root = await safeProjectPath(projectId, "sources");
  const blobs = await safeProjectPath(projectId, "sources", "blobs");
  const runs = await safeProjectPath(projectId, "sources", "runs");
  await Promise.all([mkdir(root, { recursive: true }), mkdir(blobs, { recursive: true }), mkdir(runs, { recursive: true })]);
  return { root, blobs, runs, graph: await safeProjectPath(projectId, "sources", graphFileName) };
}

function emptyGraph(projectId: string): ProvenanceGraph {
  return { schemaVersion: 1, projectId, updatedAt: now(), sources: [], evidence: [], candidates: [], extractionRuns: [], audit: [] };
}

export async function loadProvenanceGraph(projectId: string): Promise<ProvenanceGraph> {
  const paths = await sourcePaths(projectId);
  try {
    const graph = JSON.parse(await readFile(paths.graph, "utf8")) as ProvenanceGraph;
    graph.sources = graph.sources.map(normalizePersistedSource);
    const sources = new Map(graph.sources.map((source) => [source.id, source]));
    graph.candidates = graph.candidates.map((candidate) => ({ ...candidate, locator: candidate.locator ?? (sources.get(candidate.sourceId) ? locatorFor(sources.get(candidate.sourceId)!, candidate.value) : undefined) }));
    graph.evidence = graph.evidence.map((evidence) => {
      const source = sources.get(evidence.sourceId);
      return { ...evidence, locator: evidence.locator ?? (source ? locatorFor(source, evidence.value) : undefined), rights: evidence.rights ?? source?.rights };
    });
    return graph;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return emptyGraph(projectId);
  }
}

async function writeGraph(projectId: string, graph: ProvenanceGraph) {
  const paths = await sourcePaths(projectId);
  const temp = `${paths.graph}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, deterministicProvenanceJson(graph), "utf8");
  await renameWithRetry(temp, paths.graph);
  for (const run of graph.extractionRuns) {
    const runPath = path.join(paths.runs, `${run.id}.json`);
    const runTemp = `${runPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(runTemp, `${JSON.stringify(sortObject(run), null, 2)}\n`, "utf8");
    await renameWithRetry(runTemp, runPath);
  }
}

async function mutateGraph<T>(projectId: string, mutation: (graph: ProvenanceGraph) => Promise<T> | T): Promise<T> {
  const previous = mutationQueues.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  mutationQueues.set(projectId, queued);
  await previous;
  try {
    const graph = await loadProvenanceGraph(projectId);
    const result = await mutation(graph);
    graph.updatedAt = now();
    await writeGraph(projectId, graph);
    return result;
  } finally {
    release();
    if (mutationQueues.get(projectId) === queued) mutationQueues.delete(projectId);
  }
}

function audit(graph: ProvenanceGraph, event: Omit<SourceAuditEvent, "id" | "at">) {
  graph.audit.push({ id: `audit_${randomUUID()}`, at: now(), ...event });
}

export interface AddSourceInput {
  kind: SourceKind;
  label: string;
  content: Uint8Array;
  origin: Omit<SourceOrigin, "importedAt"> & { importedAt?: string };
  intent?: SourceIntent;
  role?: SourceRole;
  relationship?: SourceRelationship;
  rightsNotes?: string;
  rightsConfirmed?: boolean;
  permissions?: Partial<SourcePermissions>;
}

export async function addSource(projectId: string, input: AddSourceInput): Promise<{ source: Source; deduplicated: boolean; run: ExtractionRun }> {
  if (!input.content.byteLength) throw new Error("A source cannot be empty.");
  const contentHash = sha256(input.content);
  const policy = normalizeSourcePolicy(input.kind, input);
  const paths = await sourcePaths(projectId);
  const blobPath = `sources/blobs/${contentHash}`;
  const absoluteBlob = path.join(paths.root, "blobs", contentHash);
  return mutateGraph(projectId, async (graph) => {
    if (input.origin.context === "project-bootstrap") {
      const activeReference = graph.sources.find((source) => source.kind === "url" && source.origin.context === "project-bootstrap" && source.status !== "deleted" && source.contentHash !== contentHash);
      if (activeReference) throw new Error("A project bootstrap supports one active reference website. Remove it before adding another.");
    }
    const existing = graph.sources.find((source) => source.contentHash === contentHash);
    if (existing) {
      existing.status = "queued";
      existing.removedAt = undefined;
      existing.updatedAt = now();
      if (input.intent !== undefined || input.kind === "url") existing.intent = policy.intent;
      if (input.role !== undefined || input.intent !== undefined || input.kind === "url") existing.role = policy.role;
      if (input.kind === "url" || input.relationship !== undefined || input.rightsNotes !== undefined || input.rightsConfirmed !== undefined || input.permissions !== undefined) existing.rights = policy.rights;
      if (input.origin.context) existing.origin.context = input.origin.context;
      audit(graph, { action: "source.deduplicated", sourceId: existing.id, detail: { contentHash } });
      const run = queueRunInGraph(graph, existing, "deduplicate");
      return { source: existing, deduplicated: true, run };
    }
    try {
      await readFile(absoluteBlob);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const blobTemp = `${absoluteBlob}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(blobTemp, input.content);
      await renameWithRetry(blobTemp, absoluteBlob);
    }
    const timestamp = now();
    const source: Source = {
      id: `src_${contentHash.slice(0, 20)}`,
      kind: input.kind,
      label: input.label.trim() || input.origin.fileName || input.kind,
      contentHash,
      origin: { ...input.origin, importedAt: input.origin.importedAt ?? timestamp },
      intent: policy.intent,
      role: policy.role,
      rights: policy.rights,
      status: "queued",
      storage: { blobPath, byteLength: input.content.byteLength },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    graph.sources.push(source);
    audit(graph, { action: "source.added", sourceId: source.id, detail: { kind: source.kind, contentHash } });
    const run = queueRunInGraph(graph, source, "initial");
    return { source, deduplicated: false, run };
  });
}

export async function addBootstrapReferenceSite(projectId: string, input: BootstrapReferenceInput) {
  if (!input.url.trim() || input.url.length > 8_192) throw new Error("A public reference URL of at most 8,192 characters is required.");
  const safe = await assertSafeWebUrl(input.url);
  const canonical = safe.url.toString();
  return addSource(projectId, {
    kind: "url",
    label: input.label?.trim() || safe.url.hostname,
    content: Buffer.from(canonical),
    origin: { type: "url", locator: canonical, mediaType: "text/uri-list", context: "project-bootstrap" },
    intent: input.intent,
    role: input.role,
    relationship: input.relationship,
    rightsNotes: input.rightsNotes,
    rightsConfirmed: input.rightsConfirmed,
    permissions: input.permissions
  });
}

export function getBootstrapReferenceState(graph: ProvenanceGraph): BootstrapReferenceState | undefined {
  const source = graph.sources.find((item) => item.kind === "url" && item.origin.context === "project-bootstrap" && item.status !== "deleted");
  if (!source) return undefined;
  const run = graph.extractionRuns.find((item) => item.id === source.latestRunId);
  const relationship = source.rights.relationship ?? "unknown";
  const warning = source.rights.confirmed && (relationship === "owned" || relationship === "authorized") ? undefined : {
    code: "reference_rights_unconfirmed" as const,
    message: "Reference-site ownership and reuse rights are not verified. You are responsible for permission to use its content."
  };
  return {
    sourceId: source.id,
    runId: run?.id,
    status: source.status,
    runStatus: run?.status,
    effectiveIntent: source.intent,
    role: source.role ?? roleForIntent(source.intent),
    rights: source.rights,
    warning,
    error: run?.error,
    issues: run?.issues ?? []
  };
}

function queueRunInGraph(graph: ProvenanceGraph, source: Source, reason: "initial" | "retry" | "refresh" | "reprocess" | "deduplicate") {
  const attempt = graph.extractionRuns.filter((run) => run.sourceId === source.id).length + 1;
  const run: ExtractionRun = {
    id: `run_${randomUUID()}`,
    sourceId: source.id,
    status: "queued",
    progress: 0,
    phase: reason,
    attempt,
    requestedAt: now(),
    candidateIds: []
  };
  graph.extractionRuns.push(run);
  source.latestRunId = run.id;
  source.status = "queued";
  source.updatedAt = now();
  audit(graph, { action: reason === "refresh" ? "source.refreshed" : "run.queued", sourceId: source.id, runId: run.id, detail: { reason, attempt } });
  return run;
}

export async function queueExtraction(projectId: string, sourceId: string, reason: "retry" | "refresh" | "reprocess" = "reprocess") {
  return mutateGraph(projectId, (graph) => {
    const source = graph.sources.find((item) => item.id === sourceId && item.status !== "deleted");
    if (!source) throw new Error("Source not found.");
    return queueRunInGraph(graph, source, reason);
  });
}

export async function removeSource(projectId: string, sourceId: string) {
  return mutateGraph(projectId, (graph) => {
    const source = graph.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("Source not found.");
    source.status = "deleted";
    source.removedAt = now();
    source.updatedAt = source.removedAt;
    for (const run of graph.extractionRuns.filter((item) => item.sourceId === sourceId && ["queued", "running"].includes(item.status))) {
      run.status = "cancelled";
      run.cancellationRequestedAt = source.removedAt;
      run.finishedAt = source.removedAt;
      audit(graph, { action: "run.cancelled", sourceId, runId: run.id, detail: { reason: "source removed" } });
    }
    audit(graph, { action: "source.removed", sourceId });
    return source;
  });
}

export interface ExtractionRunUpdate {
  status: "running" | "succeeded" | "partial" | "failed" | "cancelled";
  progress?: number;
  phase?: string;
  error?: ExtractionError;
  issues?: ExtractionError[];
  candidates?: Array<{ kind: EvidenceKind; value: Evidence["value"]; confidence: number; locator?: EvidenceLocator }>;
}

export async function updateExtractionRun(projectId: string, runId: string, update: ExtractionRunUpdate) {
  return mutateGraph(projectId, (graph) => {
    const run = graph.extractionRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Extraction run not found.");
    const source = graph.sources.find((item) => item.id === run.sourceId);
    if (!source) throw new Error("Source not found.");
    if (["succeeded", "partial", "failed", "cancelled"].includes(run.status)) throw new Error("Extraction run is already terminal.");
    const timestamp = now();
    const status = update.status === "succeeded" && /partial/i.test(update.phase ?? "") ? "partial" : update.status;
    const priorStatus = run.status;
    run.status = status;
    run.progress = status === "succeeded" || status === "partial" ? 100 : Math.max(0, Math.min(100, update.progress ?? run.progress));
    run.phase = update.phase?.trim() || status;
    if (status === "running") run.startedAt ??= timestamp;
    if (status === "failed") run.error = update.error ?? { code: "extraction_failed", message: "Extraction failed.", recoverable: true };
    if (status === "partial") run.error = update.error ?? { code: "partial_extraction", message: "Extraction completed with incomplete evidence.", recoverable: true };
    const embeddedIssues = (update.candidates ?? []).flatMap((item) => item.value && typeof item.value === "object" && !Array.isArray(item.value) && (item.value as { evidenceType?: string }).evidenceType === "extraction-issues" && Array.isArray((item.value as { issues?: unknown }).issues) ? (item.value as { issues: ExtractionError[] }).issues : []);
    if (update.issues?.length || embeddedIssues.length) run.issues = structuredClone(update.issues?.length ? update.issues : embeddedIssues);
    if (status === "cancelled") run.cancellationRequestedAt = timestamp;
    if (status !== "running") run.finishedAt = timestamp;
    const action: SourceAuditEvent["action"] = status === "running" && priorStatus === "running" ? "run.progress" : `run.${status}` as SourceAuditEvent["action"];
    if (source.latestRunId === run.id) {
      source.status = status === "running" ? "processing" : status === "succeeded" ? "ready" : status === "partial" ? "partial" : status === "failed" ? "error" : graph.evidence.some((item) => item.sourceId === source.id) ? "ready" : "queued";
    }
    source.updatedAt = timestamp;
    if (status === "succeeded" || status === "partial") {
      for (const extracted of update.candidates ?? []) {
        const serialized = JSON.stringify(sortObject(extracted.value));
        const candidate: Candidate = {
          id: `cand_${sha256(`${source.id}:${run.id}:${extracted.kind}:${serialized}`).slice(0, 20)}`,
          sourceId: source.id,
          extractionRunId: run.id,
          kind: extracted.kind,
          value: extracted.value,
          contentHash: sha256(serialized),
          confidence: Math.max(0, Math.min(1, extracted.confidence)),
          locator: extracted.locator ?? locatorFor(source, extracted.value),
          status: "proposed",
          createdAt: timestamp
        };
        graph.candidates.push(candidate);
        run.candidateIds.push(candidate.id);
      }
    }
    audit(graph, { action, sourceId: source.id, runId, detail: { progress: run.progress, phase: run.phase, recoverable: run.error?.recoverable ?? false } });
    return run;
  });
}

export async function cancelExtraction(projectId: string, runId: string) {
  return updateExtractionRun(projectId, runId, { status: "cancelled", phase: "cancelled by user" });
}

export async function addManualEvidence(projectId: string, input: ManualEvidenceInput) {
  const serialized = JSON.stringify(sortObject({ kind: input.kind, value: input.value, directive: input.directive ?? "advisory", intent: input.intent ?? "extract" }));
  const sourceResult = await addSource(projectId, {
    kind: "manual",
    label: `Manual ${input.kind}`,
    content: Buffer.from(serialized),
    origin: { type: "manual" },
    intent: input.intent ?? "extract",
    role: input.directive && input.directive !== "advisory" ? "constraint" : "evidence",
    relationship: "owned",
    rightsNotes: input.rightsNotes ?? "User-authored input",
    rightsConfirmed: true,
    permissions: { analyze: true }
  });
  return mutateGraph(projectId, (graph) => {
    const timestamp = now();
    const directive: EvidenceDirective = input.directive ?? "advisory";
    const contentHash = sha256(serialized);
    const existing = graph.evidence.find((item) => item.sourceId === sourceResult.source.id && item.contentHash === contentHash);
    if (existing) {
      const source = graph.sources.find((item) => item.id === sourceResult.source.id);
      if (source) source.status = "ready";
      const run = graph.extractionRuns.find((item) => item.id === sourceResult.run.id);
      if (run) { run.status = "succeeded"; run.progress = 100; run.phase = "manual evidence already recorded"; run.startedAt = timestamp; run.finishedAt = timestamp; }
      audit(graph, { action: "run.succeeded", sourceId: sourceResult.source.id, runId: sourceResult.run.id, detail: { phase: "manual evidence already recorded" } });
      return existing;
    }
    const evidence: Evidence = {
      id: `ev_${sha256(`${sourceResult.source.id}:${serialized}`).slice(0, 20)}`,
      sourceId: sourceResult.source.id,
      kind: input.kind,
      value: input.value,
      contentHash,
      confidence: { score: 1, method: "manual" },
      locator: { type: "manual", sourceHash: sourceResult.source.contentHash, field: input.kind },
      intent: input.intent ?? "extract",
      directive,
      rightsNotes: input.rightsNotes?.trim() || "User-authored input",
      rights: sourceResult.source.rights,
      createdAt: timestamp
    };
    graph.evidence.push(evidence);
    const source = graph.sources.find((item) => item.id === sourceResult.source.id);
    if (source) source.status = "ready";
    const run = graph.extractionRuns.find((item) => item.id === sourceResult.run.id);
    if (run) { run.status = "succeeded"; run.progress = 100; run.phase = "manual evidence recorded"; run.startedAt = timestamp; run.finishedAt = timestamp; }
    audit(graph, { action: "run.succeeded", sourceId: evidence.sourceId, runId: sourceResult.run.id, detail: { phase: "manual evidence recorded" } });
    audit(graph, { action: "evidence.added", sourceId: evidence.sourceId, detail: { evidenceId: evidence.id, kind: evidence.kind, directive } });
    return evidence;
  });
}

export async function decideCandidate(projectId: string, candidateId: string, decision: "accepted" | "rejected") {
  return mutateGraph(projectId, (graph) => {
    const candidate = graph.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new Error("Candidate not found.");
    const source = graph.sources.find((item) => item.id === candidate.sourceId);
    if (!source) throw new Error("Source not found.");
    const effectiveDecision = decision === "accepted" && (source.role === "inspiration" || source.intent === "inspire") ? "inspiration" : decision;
    candidate.status = effectiveDecision;
    if ((effectiveDecision === "accepted" || effectiveDecision === "inspiration") && !candidate.evidenceId) {
      const evidence: Evidence = {
        id: `ev_${sha256(candidate.id).slice(0, 20)}`,
        sourceId: candidate.sourceId,
        candidateId: candidate.id,
        kind: candidate.kind,
        value: candidate.value,
        contentHash: candidate.contentHash,
        confidence: { score: candidate.confidence, method: "extracted" },
        locator: candidate.locator ?? locatorFor(source, candidate.value),
        intent: source.intent,
        directive: "advisory",
        rightsNotes: source.rights.notes,
        rights: source.rights,
        createdAt: now()
      };
      graph.evidence.push(evidence);
      candidate.evidenceId = evidence.id;
    }
    audit(graph, { action: "candidate.decided", sourceId: candidate.sourceId, detail: { candidateId, decision, effectiveDecision } });
    return candidate;
  });
}
