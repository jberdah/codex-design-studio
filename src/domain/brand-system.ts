import type { BrandProfile, DesignTokens } from "./types";
import type { EvidenceDirective, EvidenceKind, SourceIntent } from "./sources";

export type ReconciliationAction = "accept" | "override" | "reject" | "inspiration";
export type BrandSystemStatus = "draft" | "published" | "superseded";
/** Registry-driven artifact identifier. `web` and `slides` are the built-ins, not a closed universe. */
export type ArtifactKind = string;

export interface ReconciliationSourceRef {
  id: string;
  sourceId: string;
  sourceLabel: string;
  sourceLocator: string;
  candidateId?: string;
  evidenceId?: string;
  confidence: number;
  confidenceMethod: "manual" | "extracted" | "inferred";
  directive: EvidenceDirective;
  intent: SourceIntent;
  value: unknown;
  userAuthored: boolean;
}

export interface ReconciliationOption {
  id: string;
  value: unknown;
  normalizedValue: string;
  sources: ReconciliationSourceRef[];
  confidence: number;
  priority: number;
}

export interface ReconciliationDecision {
  groupId: string;
  action: ReconciliationAction;
  optionId?: string;
  overrideValue?: unknown;
  note?: string;
  decidedAt: string;
}

export interface ReconciliationGroup {
  id: string;
  kind: EvidenceKind;
  key: string;
  label: string;
  options: ReconciliationOption[];
  conflict: boolean;
  conflictExplanation?: string;
  decision?: ReconciliationDecision;
  resolved: boolean;
  resolvedValue?: unknown;
}

export interface ReconciliationReview {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  groups: ReconciliationGroup[];
  unresolvedConflictCount: number;
}

export interface BrandSystemSnapshot {
  schemaVersion: 1;
  id: string;
  number: number;
  createdAt: string;
  createdBy: "user" | "codex" | "system";
  basedOnVersionId?: string;
  contentHash: string;
  brand: BrandProfile;
  tokens: DesignTokens;
  reconciliation: ReconciliationReview;
}

export interface BrandSystemVersionSummary {
  id: string;
  number: number;
  status: BrandSystemStatus;
  contentHash: string;
  createdAt: string;
  publishedAt?: string;
  supersededAt?: string;
}

export interface ArtifactBinding {
  artifactId: ArtifactKind;
  brandSystemVersionId: string;
  boundAt: string;
  independentlyComposed: boolean;
  history: Array<{ brandSystemVersionId: string; boundAt: string; action: "initial" | "upgrade" | "rollback" }>;
}

export interface BrandSystemRegistry {
  schemaVersion: 1;
  projectId: string;
  nextVersion: number;
  versions: BrandSystemVersionSummary[];
  draftVersionId?: string;
  publishedVersionId?: string;
  bindings: ArtifactBinding[];
  updatedAt: string;
}
