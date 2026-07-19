export type SourceKind = "url" | "codebase" | "logo" | "image" | "screenshot" | "document" | "deck" | "spreadsheet" | "manual";
export type SourceIntent = "extract" | "inspire" | "extract-and-inspire";
export type SourceRole = "constraint" | "evidence" | "inspiration";
export type SourceRelationship = "owned" | "authorized" | "third-party" | "unknown";
export type SourceStatus = "queued" | "processing" | "ready" | "partial" | "error" | "deleted";
export type EvidenceKind = "color" | "font" | "tone" | "accessibility" | "rule" | "copy" | "visual" | "metadata";
export type EvidenceDirective = "must-use" | "must-avoid" | "advisory";
export type CandidateStatus = "proposed" | "accepted" | "rejected" | "inspiration";
export type ExtractionRunStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "cancelled";

export interface SourcePermissions {
  /** Inspect/extract bounded observations from the source. */
  analyze: boolean;
  /** Use observations as non-authoritative creative inspiration. */
  inspire: boolean;
  /** Reuse or adapt original image/logo assets in a generated artifact. */
  reproduceAssets: boolean;
  /** Reuse or adapt original authored copy in a generated artifact. */
  reproduceCopy: boolean;
  /** Include reproduced source material in an exported/distributed artifact. */
  distribute: boolean;
}

export interface SourceRights {
  /** Backwards-compatible acknowledgement retained from schema v1. */
  notes: string;
  confirmed: boolean;
  /** Optional on legacy graphs; new intake always persists both fields. */
  relationship?: SourceRelationship;
  permissions?: SourcePermissions;
}

export interface EvidenceLocator {
  type: "manual" | "web" | "document" | "image" | "code" | "source";
  sourceHash?: string;
  requestedUrl?: string;
  finalUrl?: string;
  capturedAt?: string;
  viewport?: string;
  selector?: string;
  fileName?: string;
  part?: string;
  page?: number;
  slide?: number;
  sheet?: number;
  cell?: string;
  assetPath?: string;
  field?: string;
}

export interface SourceOrigin {
  type: "upload" | "url" | "local-path" | "manual";
  locator?: string;
  fileName?: string;
  mediaType?: string;
  context?: "project-bootstrap" | "workspace";
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
  role?: SourceRole;
  rights: SourceRights;
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
  locator?: EvidenceLocator;
  intent: SourceIntent;
  directive: EvidenceDirective;
  rightsNotes: string;
  rights?: SourceRights;
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
  locator?: EvidenceLocator;
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
  issues?: ExtractionError[];
  candidateIds: string[];
}

export interface SourceAuditEvent {
  id: string;
  at: string;
  action: "source.added" | "source.deduplicated" | "source.removed" | "source.refreshed" | "run.queued" | "run.started" | "run.progress" | "run.succeeded" | "run.partial" | "run.failed" | "run.cancelled" | "evidence.added" | "candidate.decided";
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

export interface BootstrapReferenceInput {
  url: string;
  intent?: SourceIntent;
  role?: SourceRole;
  relationship?: SourceRelationship;
  rightsNotes?: string;
  rightsConfirmed?: boolean;
  permissions?: Partial<SourcePermissions>;
  label?: string;
}

export interface BootstrapReferenceState {
  sourceId: string;
  runId?: string;
  status: SourceStatus;
  runStatus?: ExtractionRunStatus;
  effectiveIntent: SourceIntent;
  role: SourceRole;
  rights: SourceRights;
  warning?: {
    code: "reference_rights_unconfirmed";
    message: string;
  };
  error?: ExtractionError;
  issues: ExtractionError[];
}
