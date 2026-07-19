import type { ProjectData } from "./types";
import type { EvidenceDirective, EvidenceKind, EvidenceLocator, SourceIntent, SourceKind, SourceRelationship, SourceRights, SourceRole } from "./sources";

export type BootstrapStatus = "collecting" | "ready" | "synthesizing" | "review" | "approving" | "approved" | "failed";
export type BootstrapField = "brandName" | "objective" | "targetDeliverable" | "industry" | "audience" | "promise";

export interface BootstrapSourceReference {
  id: string;
  kind: SourceKind;
  label: string;
  intent: SourceIntent;
  sourceId?: string;
  runId?: string;
  locator?: string;
  contentHash?: string;
  role?: SourceRole;
  relationship?: SourceRelationship;
  rights?: SourceRights;
}

export interface BootstrapEvidenceSnapshotLink {
  id: string;
  contentHash: string;
  evidenceIds: string[];
  sourceGraphUpdatedAt?: string;
}

export interface BootstrapReferenceObservation {
  /** Stable provenance id. Accepted observations use their evidence id; candidates use their candidate id. */
  id: string;
  sourceId: string;
  runId?: string;
  kind: EvidenceKind;
  value: string | number | boolean | string[] | Record<string, unknown>;
  confidence: number;
  status: "accepted" | "proposed" | "inspiration";
  directive?: EvidenceDirective;
  locator?: EvidenceLocator;
}

export interface BootstrapReferenceSnapshot {
  stagingProjectId: string;
  sourceId?: string;
  runId?: string;
  status: "queued" | "ready" | "partial" | "error";
  effectiveIntent?: SourceIntent;
  role?: SourceRole;
  observations: BootstrapReferenceObservation[];
  sourceContentHash?: string;
  /** Hash of the bounded observations supplied to synthesis, not of arbitrary source content. */
  observationHash: string;
  warning?: { code: string; message: string };
  error?: { code: string; message: string; recoverable: boolean };
  updatedAt: string;
}

export interface BootstrapInput {
  projectName?: string;
  brandName?: string;
  industry?: string;
  audience?: string;
  /** User-authored outcome in their own words; never silently replaced by synthesis. */
  objective?: string;
  targetDeliverable?: "web" | "slides";
  /** Legacy alias retained for compatibility with the original project form. */
  promise?: string;
  colors?: Partial<ProjectData["tokens"]["colors"]>;
  deliverables?: Array<"web" | "slides">;
  sourceRefs?: BootstrapSourceReference[];
  evidenceSnapshot?: BootstrapEvidenceSnapshotLink;
  selectedPresetId?: string;
}

export interface BootstrapQuestion {
  id: string;
  field: BootstrapField;
  prompt: string;
  reason: string;
  required: boolean;
  options?: string[];
}

export interface BootstrapAnswer {
  questionId: string;
  value: string;
  answeredAt: string;
}

export interface BriefFact {
  id: string;
  claim: string;
  evidenceIds: string[];
}

export interface BriefInference extends BriefFact {
  confidence: number;
}

export interface BriefAssumption extends BriefFact {
  status: "proposed" | "confirmed" | "rejected";
}

export interface StrategicCreativeBriefVersion {
  id: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  createdAt: string;
  createdBy: "system" | "codex" | "user";
  title: string;
  summary: string;
  facts: BriefFact[];
  inferences: BriefInference[];
  assumptions: BriefAssumption[];
  unknowns: string[];
  questions: BootstrapQuestion[];
  strategy: {
    audience: string;
    objective: string;
    positioning: string;
    voice: string;
    contentPriorities: string[];
  };
  creative: {
    opportunity: string;
    designPrinciples: string[];
    avoid: string[];
  };
  brandSeed: {
    name: string;
    industry: string;
    audience: string;
    promise: string;
    personality: string[];
    tone: string;
    visualDirection: string;
  };
}

export interface BootstrapEvent {
  id: string;
  at: string;
  action: "created" | "answered" | "synthesis.started" | "synthesis.completed" | "synthesis.failed" | "brief.revised" | "approved";
  detail?: Record<string, string | number | boolean>;
}

export interface BootstrapSession {
  schemaVersion: 1;
  id: string;
  status: BootstrapStatus;
  /** Original intake is immutable. Later clarification is stored in answers. */
  originalInput: Readonly<BootstrapInput>;
  inputHash: string;
  sourceRefs: BootstrapSourceReference[];
  evidenceSnapshot?: BootstrapEvidenceSnapshotLink;
  referenceSnapshot?: BootstrapReferenceSnapshot;
  questions: BootstrapQuestion[];
  answers: BootstrapAnswer[];
  briefs: StrategicCreativeBriefVersion[];
  activeBriefVersion?: number;
  projectDraft?: ProjectData;
  approval?: { status: "pending"; pendingProjectId: string; finalProjectId: string; startedAt: string };
  createdProjectId?: string;
  error?: { message: string; recoverable: boolean; at: string };
  createdAt: string;
  updatedAt: string;
  events: BootstrapEvent[];
}

const transitionTable: Record<BootstrapStatus, BootstrapStatus[]> = {
  collecting: ["ready"],
  ready: ["collecting", "synthesizing"],
  synthesizing: ["review", "failed"],
  review: ["synthesizing", "approving"],
  approving: ["approved"],
  approved: [],
  failed: ["synthesizing", "ready"]
};

export function assertBootstrapTransition(from: BootstrapStatus, to: BootstrapStatus) {
  if (from === to) return;
  if (!transitionTable[from].includes(to)) throw new Error(`Bootstrap cannot transition from ${from} to ${to}.`);
}

export function createBootstrapQuestions(input: BootstrapInput): BootstrapQuestion[] {
  const definitions: Record<BootstrapField, Omit<BootstrapQuestion, "id" | "field">> = {
    brandName: { prompt: "What name should this project use for the brand?", reason: "A stable brand identity is required before a project can be created.", required: true },
    audience: { prompt: "Who must this experience help or persuade?", reason: "Audience intent shapes hierarchy, language and calls to action.", required: true },
    objective: { prompt: "What should this project help the audience understand or achieve?", reason: "Codex needs the original objective so it can transform intent without inventing product claims.", required: true },
    targetDeliverable: { prompt: "Which deliverable should Codex create first?", reason: "The first artifact determines the initial creative and validation workflow.", required: true, options: ["web", "slides"] },
    promise: { prompt: "What should the audience understand or be able to do?", reason: "The project needs an explicit objective instead of invented product claims.", required: true },
    industry: { prompt: "Which sector or context should the work acknowledge?", reason: "Sector context can guide terminology without being inferred as fact.", required: false }
  };
  const missing: BootstrapField[] = [];
  if (!input.brandName?.trim()) missing.push("brandName");
  if (!(input.objective?.trim() || input.promise?.trim())) missing.push("objective");
  if (!input.targetDeliverable && !input.deliverables?.length) missing.push("targetDeliverable");
  return missing.slice(0, 3).map((field) => ({ id: `question:${field}`, field, ...definitions[field] }));
}

export function validateStrategicCreativeBrief(brief: StrategicCreativeBriefVersion) {
  if (!brief.title.trim() || !brief.summary.trim()) throw new Error("A strategic creative brief requires a title and summary.");
  if (brief.questions.length > 3) throw new Error("A strategic creative brief may ask at most three questions.");
  if (!brief.brandSeed.name.trim() || !brief.brandSeed.audience.trim() || !brief.brandSeed.promise.trim()) throw new Error("The brief requires a usable brand seed.");
  const claims = [...brief.facts, ...brief.inferences, ...brief.assumptions];
  if (claims.some((claim) => !claim.id.trim() || !claim.claim.trim() || !Array.isArray(claim.evidenceIds))) throw new Error("Brief claims require stable ids, text and evidence references.");
  if (brief.facts.some((fact) => fact.evidenceIds.length === 0)) throw new Error("Every factual brief claim must cite evidence.");
  if (brief.inferences.some((item) => item.confidence < 0 || item.confidence > 1)) throw new Error("Inference confidence must be between zero and one.");
  return brief;
}
