import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import type { BootstrapReferenceObservation, BootstrapReferenceSnapshot, BootstrapSession } from "@/domain/bootstrap";
import type { BootstrapReferenceInput, BootstrapReferenceState, ExtractionRun, ProvenanceGraph } from "@/domain/sources";
import { loadBootstrapSession, recordBootstrapReferenceSnapshot } from "./bootstrap";
import { synthesizeBootstrapWithCodexFallback, type BootstrapBriefSynthesizer, type BootstrapSynthesisOutcome } from "./bootstrap-codex";
import { processExtractionRun } from "./extraction-worker";
import { safeProjectRoot } from "./paths";
import { addBootstrapReferenceSite, getBootstrapReferenceState, loadProvenanceGraph, queueExtraction } from "./source-store";

const prepareQueues = new Map<string, Promise<BootstrapReferenceSnapshot | undefined>>();

export function bootstrapStagingProjectId(sessionId: string) {
  if (!/^bst_[a-f0-9]{24}$/.test(sessionId)) throw new Error("Invalid bootstrap session id.");
  return `bootstrap-${sessionId.slice(4)}`;
}

function finiteCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1_000_000) : undefined;
}

function countedValues(value: unknown, normalize: (raw: unknown) => string | undefined, maximum: number) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximum * 2).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const normalized = normalize(item.value);
    const count = finiteCount(item.count);
    return normalized && count !== undefined ? [{ value: normalized, count }] : [];
  }).slice(0, maximum);
}

function safeColor(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (/^#[a-f\d]{6}$/i.test(normalized)) return normalized.toUpperCase();
  const match = normalized.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*(?:,|\/)\s*([\d.]+))?\s*\)$/i);
  if (!match || match.slice(1, 4).some((part) => Number(part) > 255) || (match[4] !== undefined && Number(match[4]) < 1)) return undefined;
  return `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function safeFontTuple(value: unknown) {
  if (typeof value !== "string" || value.length > 240 || /(?:https?:|url\s*\(|[<>])/i.test(value)) return undefined;
  const [family, size, weight, lineHeight, letterSpacing] = value.split("|");
  if (!family || !/^[\w ,'".-]{1,100}$/.test(family) || !/^\d+(?:\.\d+)?px$/.test(size ?? "") || !/^(?:normal|bold|[1-9]00)$/.test(weight ?? "")) return undefined;
  const metric = (part: string | undefined) => part && /^(?:normal|\d+(?:\.\d+)?(?:px|em|rem|%))$/.test(part) ? part : undefined;
  return [family.trim(), size, weight, metric(lineHeight), metric(letterSpacing)].filter(Boolean).join("|");
}

function safeMetric(value: unknown) {
  return typeof value === "string" && /^(?:none|repeat\([\d, .a-z%-]+\)|minmax\([\d. a-z%,-]+\)|[\d.]+(?:px|rem|em|fr|%)?)(?:\s+[\d.]+(?:px|rem|em|fr|%)?)*$/i.test(value.trim()) ? value.trim().slice(0, 160) : undefined;
}

function normalizeObservationValue(kind: string, value: unknown): BootstrapReferenceObservation["value"] | undefined {
  if (kind === "color") {
    const scalar = safeColor(value);
    if (scalar) return scalar;
  }
  if (kind === "font" && typeof value === "string" && /^[\w ,'".-]{1,100}$/.test(value) && !/https?/i.test(value)) return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.evidenceType === "computed-colors") {
    const colors = countedValues(item.values, safeColor, 12);
    return colors.length ? { evidenceType: "computed-colors", colors } : undefined;
  }
  if (item.evidenceType === "computed-typography") {
    const fonts = countedValues(item.values, safeFontTuple, 12);
    return fonts.length ? { evidenceType: "computed-typography", fonts } : undefined;
  }
  if (item.evidenceType === "css-variables" && item.values && typeof item.values === "object" && !Array.isArray(item.values)) {
    const tokens = Object.entries(item.values as Record<string, unknown>).filter(([name, token]) => /^--[a-z0-9_-]{1,64}$/i.test(name) && Boolean(safeColor(token))).slice(0, 16).map(([name, token]) => ({ name, value: safeColor(token)! }));
    return tokens.length ? { evidenceType: "css-variables", tokens } : undefined;
  }
  if (item.evidenceType === "layout-system") {
    const spacing = countedValues(item.spacing, safeMetric, 10);
    const radii = countedValues(item.radii, safeMetric, 8);
    const grids = countedValues(item.grids, safeMetric, 8);
    return spacing.length || radii.length || grids.length ? { evidenceType: "layout-system", spacing, radii, grids } : undefined;
  }
  if (item.evidenceType === "recurring-components" && Array.isArray(item.patterns)) {
    const components = item.patterns.slice(0, 16).flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const pattern = raw as Record<string, unknown>;
      const count = finiteCount(pattern.count);
      if (typeof pattern.value !== "string" || count === undefined) return [];
      const [tag, role, display] = pattern.value.split("|");
      if (![tag, role, display].every((part) => part !== undefined && /^[a-z0-9_-]{0,40}$/i.test(part))) return [];
      return [{ tag, role, display, count }];
    });
    return components.length ? { evidenceType: "recurring-components", components } : undefined;
  }
  return undefined;
}

function boundedObservations(graph: ProvenanceGraph, state: BootstrapReferenceState): BootstrapReferenceObservation[] {
  const accepted = graph.evidence
    .filter((item) => item.sourceId === state.sourceId)
    .flatMap((item): BootstrapReferenceObservation[] => {
      const value = normalizeObservationValue(item.kind, item.value);
      if (value === undefined) return [];
      return [{
      id: item.id,
      sourceId: item.sourceId,
      runId: item.candidateId ? graph.candidates.find((candidate) => candidate.id === item.candidateId)?.extractionRunId : state.runId,
      kind: item.kind,
      value,
      confidence: Math.max(0, Math.min(1, item.confidence.score)),
      status: "accepted",
      directive: item.directive,
      locator: item.locator
    }]; });
  const acceptedCandidateIds = new Set(graph.evidence.flatMap((item) => item.candidateId ? [item.candidateId] : []));
  const candidates = graph.candidates
    .filter((item) => item.sourceId === state.sourceId && item.extractionRunId === state.runId && !acceptedCandidateIds.has(item.id) && item.status !== "rejected" && item.status !== "accepted")
    .flatMap((item): BootstrapReferenceObservation[] => {
      const value = normalizeObservationValue(item.kind, item.value);
      if (value === undefined) return [];
      return [{
      id: item.id,
      sourceId: item.sourceId,
      runId: item.extractionRunId,
      kind: item.kind,
      value,
      confidence: Math.max(0, Math.min(1, item.confidence)),
      status: item.status === "inspiration" || state.role === "inspiration" ? "inspiration" : "proposed",
      locator: item.locator
    }]; });
  const priority = (item: BootstrapReferenceObservation) => (item.status === "accepted" ? 100 : 0) + ({ color: 8, font: 7, tone: 6, rule: 5, visual: 4, accessibility: 3, metadata: 2, copy: 1 }[item.kind] ?? 0) + item.confidence;
  const selected: BootstrapReferenceObservation[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const observation of [...accepted, ...candidates].sort((left, right) => priority(right) - priority(left) || left.id.localeCompare(right.id))) {
    const identity = JSON.stringify([observation.kind, observation.value, observation.locator]);
    if (seen.has(identity)) continue;
    const size = JSON.stringify(observation).length;
    if (selected.length >= 24 || bytes + size > 12_000) break;
    selected.push(observation);
    seen.add(identity);
    bytes += size;
  }
  return selected;
}

function snapshotHash(observations: BootstrapReferenceObservation[]) {
  return createHash("sha256").update(JSON.stringify(observations)).digest("hex");
}

function sourceInput(session: BootstrapSession, locator: string): BootstrapReferenceInput {
  const reference = session.sourceRefs.find((item) => item.kind === "url" && item.locator === locator)!;
  return {
    url: locator,
    label: reference.label,
    intent: reference.intent,
    role: reference.role,
    relationship: reference.relationship ?? reference.rights?.relationship,
    rightsConfirmed: reference.rights?.confirmed,
    rightsNotes: reference.rights?.notes,
    permissions: reference.rights?.permissions
  };
}

export interface BootstrapReferenceDependencies {
  addReference(projectId: string, input: BootstrapReferenceInput): Promise<{ source: { id: string }; run: ExtractionRun }>;
  loadGraph(projectId: string): Promise<ProvenanceGraph>;
  processRun(projectId: string, runId: string): Promise<unknown>;
  queueRun(projectId: string, sourceId: string): Promise<ExtractionRun>;
}

const defaultDependencies: BootstrapReferenceDependencies = {
  addReference: addBootstrapReferenceSite,
  loadGraph: loadProvenanceGraph,
  processRun: processExtractionRun,
  queueRun: (projectId, sourceId) => queueExtraction(projectId, sourceId, "retry")
};

function statusFor(state: BootstrapReferenceState): BootstrapReferenceSnapshot["status"] {
  if (state.runStatus === "succeeded" || state.status === "ready") return "ready";
  if (state.runStatus === "partial" || state.status === "partial") return "partial";
  if (state.runStatus === "failed" || state.status === "error") return "error";
  return "queued";
}

/**
 * Captures a single public reference into an invisible staging project before synthesis.
 * Capture failures remain transparent and recoverable; they never turn source text into instructions.
 */
async function prepareBootstrapReferenceOnce(sessionId: string, dependencies: BootstrapReferenceDependencies): Promise<BootstrapReferenceSnapshot | undefined> {
  const session = await loadBootstrapSession(sessionId);
  const references = session.sourceRefs.filter((item) => item.kind === "url" && item.locator);
  if (!references.length) return undefined;
  const stagingProjectId = bootstrapStagingProjectId(sessionId);
  const updatedAt = new Date().toISOString();
  const record = (snapshot: BootstrapReferenceSnapshot) => recordAndReturn(sessionId, snapshot, { status: session.status, updatedAt: session.updatedAt });
  if (references.length > 1) {
    return record({ stagingProjectId, status: "error", observations: [], observationHash: snapshotHash([]), error: { code: "multiple_reference_sites", message: "A bootstrap accepts one active reference website.", recoverable: true }, warning: { code: "reference_extraction_failed", message: "The reference website could not be prepared; synthesis continued without it." }, updatedAt });
  }
  try {
    let graph = await dependencies.loadGraph(stagingProjectId);
    let state = getBootstrapReferenceState(graph);
    if (!state) {
      const added = await dependencies.addReference(stagingProjectId, sourceInput(session, references[0].locator!));
      await dependencies.processRun(stagingProjectId, added.run.id);
      graph = await dependencies.loadGraph(stagingProjectId);
      state = getBootstrapReferenceState(graph);
    } else if (["failed", "partial"].includes(state.runStatus ?? "") && session.referenceSnapshot?.runId === state.runId) {
      const retry = await dependencies.queueRun(stagingProjectId, state.sourceId);
      await dependencies.processRun(stagingProjectId, retry.id);
      graph = await dependencies.loadGraph(stagingProjectId);
      state = getBootstrapReferenceState(graph);
    } else if (state.runStatus === "queued" && state.runId) {
      await dependencies.processRun(stagingProjectId, state.runId);
      graph = await dependencies.loadGraph(stagingProjectId);
      state = getBootstrapReferenceState(graph);
    }
    if (!state) throw new Error("Reference extraction did not create a durable source state.");
    const observations = boundedObservations(graph, state);
    const extractionError = state.error ?? state.issues.find((issue) => issue.recoverable);
    return record({
      stagingProjectId,
      sourceId: state.sourceId,
      runId: state.runId,
      status: statusFor(state),
      effectiveIntent: state.effectiveIntent,
      role: state.role,
      observations,
      sourceContentHash: graph.sources.find((source) => source.id === state.sourceId)?.contentHash,
      observationHash: snapshotHash(observations),
      warning: state.warning ?? (extractionError ? { code: "reference_extraction_partial", message: "The reference website was only partially extracted; available observations remain advisory." } : undefined),
      error: state.error,
      updatedAt
    });
  } catch (error) {
    const prior = session.referenceSnapshot;
    if (!prior?.sourceId) await rm(await safeProjectRoot(stagingProjectId), { recursive: true, force: true });
    return record({
      stagingProjectId,
      sourceId: prior?.sourceId,
      runId: prior?.runId,
      status: "error",
      observations: prior?.observations ?? [],
      sourceContentHash: prior?.sourceContentHash,
      observationHash: prior?.observationHash ?? snapshotHash([]),
      warning: { code: "reference_extraction_failed", message: "The reference website could not be prepared; synthesis continued without new observations." },
      error: { code: "reference_extraction_failed", message: error instanceof Error ? error.message : "Reference extraction failed.", recoverable: true },
      updatedAt
    });
  }
}

/** Serializes preparation per session so concurrent POSTs cannot create duplicate durable runs. */
export function prepareBootstrapReference(sessionId: string, dependencies: BootstrapReferenceDependencies = defaultDependencies): Promise<BootstrapReferenceSnapshot | undefined> {
  const active = prepareQueues.get(sessionId);
  if (active) return active;
  const current = prepareBootstrapReferenceOnce(sessionId, dependencies);
  prepareQueues.set(sessionId, current);
  void current.finally(() => { if (prepareQueues.get(sessionId) === current) prepareQueues.delete(sessionId); }).catch(() => undefined);
  return current;
}

async function recordAndReturn(sessionId: string, snapshot: BootstrapReferenceSnapshot, expected?: { status: BootstrapSession["status"]; updatedAt: string }) {
  await recordBootstrapReferenceSnapshot(sessionId, snapshot, expected);
  return snapshot;
}

export interface PreparedBootstrapSynthesisOutcome extends BootstrapSynthesisOutcome {
  reference?: Pick<BootstrapReferenceSnapshot, "status" | "warning" | "error" | "observationHash">;
}

export async function synthesizeBootstrapWithPreparedReference(sessionId: string, options: { synthesizer?: BootstrapBriefSynthesizer; signal?: AbortSignal; referenceDependencies?: BootstrapReferenceDependencies } = {}): Promise<PreparedBootstrapSynthesisOutcome> {
  const reference = await prepareBootstrapReference(sessionId, options.referenceDependencies);
  const outcome = await synthesizeBootstrapWithCodexFallback(sessionId, { synthesizer: options.synthesizer, signal: options.signal });
  return { ...outcome, reference: reference ? { status: reference.status, warning: reference.warning, error: reference.error, observationHash: reference.observationHash } : undefined };
}
