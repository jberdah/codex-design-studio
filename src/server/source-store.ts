import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Candidate,
  Evidence,
  EvidenceDirective,
  EvidenceKind,
  ExtractionError,
  ExtractionRun,
  ManualEvidenceInput,
  ProvenanceGraph,
  Source,
  SourceAuditEvent,
  SourceIntent,
  SourceKind,
  SourceOrigin
} from "@/domain/sources";
import { ensureProject } from "./store";
import { safeProjectPath } from "./paths";

const graphFileName = "graph.json";
const mutationQueues = new Map<string, Promise<void>>();

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function now() {
  return new Date().toISOString();
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
    return JSON.parse(await readFile(paths.graph, "utf8")) as ProvenanceGraph;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return emptyGraph(projectId);
  }
}

async function writeGraph(projectId: string, graph: ProvenanceGraph) {
  const paths = await sourcePaths(projectId);
  const temp = `${paths.graph}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, deterministicProvenanceJson(graph), "utf8");
  await rename(temp, paths.graph);
  for (const run of graph.extractionRuns) {
    const runPath = path.join(paths.runs, `${run.id}.json`);
    const runTemp = `${runPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(runTemp, `${JSON.stringify(sortObject(run), null, 2)}\n`, "utf8");
    await rename(runTemp, runPath);
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
  rightsNotes?: string;
  rightsConfirmed?: boolean;
}

export async function addSource(projectId: string, input: AddSourceInput): Promise<{ source: Source; deduplicated: boolean; run: ExtractionRun }> {
  if (!input.content.byteLength) throw new Error("A source cannot be empty.");
  const contentHash = sha256(input.content);
  const paths = await sourcePaths(projectId);
  const blobPath = `sources/blobs/${contentHash}`;
  const absoluteBlob = path.join(paths.root, "blobs", contentHash);
  return mutateGraph(projectId, async (graph) => {
    const existing = graph.sources.find((source) => source.contentHash === contentHash);
    if (existing) {
      existing.status = "queued";
      existing.removedAt = undefined;
      existing.updatedAt = now();
      existing.intent = input.intent ?? existing.intent;
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
      await rename(blobTemp, absoluteBlob);
    }
    const timestamp = now();
    const source: Source = {
      id: `src_${contentHash.slice(0, 20)}`,
      kind: input.kind,
      label: input.label.trim() || input.origin.fileName || input.kind,
      contentHash,
      origin: { ...input.origin, importedAt: input.origin.importedAt ?? timestamp },
      intent: input.intent ?? "extract",
      rights: { notes: input.rightsNotes?.trim() ?? "", confirmed: input.rightsConfirmed ?? false },
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
  status: "running" | "succeeded" | "failed" | "cancelled";
  progress?: number;
  phase?: string;
  error?: ExtractionError;
  candidates?: Array<{ kind: EvidenceKind; value: Evidence["value"]; confidence: number }>;
}

export async function updateExtractionRun(projectId: string, runId: string, update: ExtractionRunUpdate) {
  return mutateGraph(projectId, (graph) => {
    const run = graph.extractionRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Extraction run not found.");
    const source = graph.sources.find((item) => item.id === run.sourceId);
    if (!source) throw new Error("Source not found.");
    if (["succeeded", "failed", "cancelled"].includes(run.status)) throw new Error("Extraction run is already terminal.");
    const timestamp = now();
    const priorStatus = run.status;
    run.status = update.status;
    run.progress = update.status === "succeeded" ? 100 : Math.max(0, Math.min(100, update.progress ?? run.progress));
    run.phase = update.phase?.trim() || update.status;
    if (update.status === "running") run.startedAt ??= timestamp;
    if (update.status === "failed") run.error = update.error ?? { code: "extraction_failed", message: "Extraction failed.", recoverable: true };
    if (update.status === "cancelled") run.cancellationRequestedAt = timestamp;
    if (update.status !== "running") run.finishedAt = timestamp;
    const action: SourceAuditEvent["action"] = update.status === "running" && priorStatus === "running" ? "run.progress" : `run.${update.status}` as SourceAuditEvent["action"];
    if (source.latestRunId === run.id) {
      source.status = update.status === "running" ? "processing" : update.status === "succeeded" ? "ready" : update.status === "failed" ? "error" : graph.evidence.some((item) => item.sourceId === source.id) ? "ready" : "queued";
    }
    source.updatedAt = timestamp;
    if (update.status === "succeeded") {
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
    rightsNotes: input.rightsNotes ?? "User-authored input",
    rightsConfirmed: true
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
      intent: input.intent ?? "extract",
      directive,
      rightsNotes: input.rightsNotes?.trim() || "User-authored input",
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
    candidate.status = decision;
    if (decision === "accepted" && !candidate.evidenceId) {
      const evidence: Evidence = {
        id: `ev_${sha256(candidate.id).slice(0, 20)}`,
        sourceId: candidate.sourceId,
        candidateId: candidate.id,
        kind: candidate.kind,
        value: candidate.value,
        contentHash: candidate.contentHash,
        confidence: { score: candidate.confidence, method: "extracted" },
        intent: graph.sources.find((source) => source.id === candidate.sourceId)?.intent ?? "extract",
        directive: "advisory",
        rightsNotes: graph.sources.find((source) => source.id === candidate.sourceId)?.rights.notes ?? "",
        createdAt: now()
      };
      graph.evidence.push(evidence);
      candidate.evidenceId = evidence.id;
    }
    audit(graph, { action: "candidate.decided", sourceId: candidate.sourceId, detail: { candidateId, decision } });
    return candidate;
  });
}
