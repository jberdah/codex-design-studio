export type SourceKind = "url" | "codebase" | "logo" | "image" | "screenshot" | "document" | "deck" | "spreadsheet" | "manual";
export type SourceIntent = "extract" | "inspire" | "extract-and-inspire";
export type SourceStatus = "queued" | "processing" | "ready" | "error" | "deleted";
export type EvidenceKind = "color" | "font" | "tone" | "accessibility" | "rule" | "copy" | "visual" | "metadata";
export type EvidenceDirective = "must-use" | "must-avoid" | "advisory";
export type CandidateStatus = "proposed" | "accepted" | "rejected";
export type ExtractionRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface SourceOrigin {
  type: "upload" | "url" | "local-path" | "manual";
  locator?: string;
  fileName?: string;
  mediaType?: string;
  importedAt: string;
}

export interface SourceStorageRef {
  /** Workspace-relative path. Absolute machine paths are never persisted here. */
  blobPath: string;
  byteLength: number;
}

export interface Source {
  id: string;
  kind: SourceKind;
  label: string;
  contentHash: string;
  origin: SourceOrigin;
  intent: SourceIntent;
  rights: { notes: string; confirmed: boolean };
  status: SourceStatus;
  storage: SourceStorageRef;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
  latestRunId?: string;
}

export interface Evidence {
  id: string;
  sourceId: string;
  candidateId?: string;
  kind: EvidenceKind;
  value: string | number | boolean | string[] | Record<string, unknown>;
  contentHash: string;
  confidence: { score: number; method: "manual" | "extracted" | "inferred" };
  intent: SourceIntent;
  directive: EvidenceDirective;
  rightsNotes: string;
  createdAt: string;
}

export interface Candidate {
  id: string;
  sourceId: string;
  extractionRunId: string;
  kind: EvidenceKind;
  value: Evidence["value"];
  contentHash: string;
  confidence: number;
  status: CandidateStatus;
  evidenceId?: string;
  createdAt: string;
}

export interface ExtractionError {
  code: string;
  message: string;
  recoverable: boolean;
  detail?: string;
}

export interface ExtractionRun {
  id: string;
  sourceId: string;
  status: ExtractionRunStatus;
  progress: number;
  phase: string;
  attempt: number;
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancellationRequestedAt?: string;
  error?: ExtractionError;
  candidateIds: string[];
}

export interface SourceAuditEvent {
  id: string;
  at: string;
  action: "source.added" | "source.deduplicated" | "source.removed" | "source.refreshed" | "run.queued" | "run.started" | "run.progress" | "run.succeeded" | "run.failed" | "run.cancelled" | "evidence.added" | "candidate.decided";
  sourceId?: string;
  runId?: string;
  detail?: Record<string, string | number | boolean>;
}

export interface ProvenanceGraph {
  schemaVersion: 1;
  projectId: string;
  updatedAt: string;
  sources: Source[];
  evidence: Evidence[];
  candidates: Candidate[];
  extractionRuns: ExtractionRun[];
  audit: SourceAuditEvent[];
}

export interface ManualEvidenceInput {
  kind: Extract<EvidenceKind, "color" | "font" | "tone" | "accessibility" | "rule">;
  value: Evidence["value"];
  directive?: EvidenceDirective;
  intent?: SourceIntent;
  rightsNotes?: string;
}
