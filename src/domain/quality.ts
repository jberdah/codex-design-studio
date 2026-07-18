import type { ArtifactActor, ArtifactApprovalStatus, ArtifactVersionId } from "./artifacts";

export type ReviewFindingCategory =
  | "hierarchy"
  | "brand-adherence"
  | "content-fit"
  | "user-intent"
  | "cross-artifact-consistency"
  | "accessibility"
  | "render-integrity";

export type ReviewEvidenceKind = "source" | "screenshot" | "metric" | "structure" | "render" | "export";

export interface ReviewEvidence {
  id: string;
  kind: ReviewEvidenceKind;
  artifactVersionId: ArtifactVersionId;
  brandSystemVersionId: string;
  locator: string;
  description: string;
  capturedAt: string;
  contentHash?: string;
  viewport?: { name: string; width: number; height: number };
  value?: unknown;
}

export interface StructuredCritiqueFinding {
  id: string;
  category: ReviewFindingCategory;
  severity: "suggestion" | "warning" | "error";
  claim: string;
  recommendation?: string;
  evidenceIds: string[];
  relatedNodeIds?: string[];
}

interface VersionBoundReview {
  schemaVersion: 1;
  id: string;
  artifactId: string;
  artifactVersionId: ArtifactVersionId;
  brandSystemVersionId: string;
  createdAt: string;
  evidence: ReviewEvidence[];
  findings: StructuredCritiqueFinding[];
}

/** Creative feedback. It informs selection and never acts as a release gate. */
export interface ExplorationReview extends VersionBoundReview {
  kind: "exploration";
  directionId: string;
  intendedDeviations: string[];
  recommendation: "consider" | "iterate" | "discard";
}

export interface RegressionCheck {
  id: string;
  status: "pass" | "warning" | "error";
  message: string;
  evidenceIds: string[];
  invariantKey?: string;
}

/** Deterministic release gate against an approved golden baseline. */
export interface RegressionReview extends VersionBoundReview {
  kind: "regression";
  baselineId: string;
  baselineVersionId: ArtifactVersionId;
  declaredIntentionalChanges: string[];
  checks: RegressionCheck[];
  status: "pass" | "warning" | "fail";
}

export type VersionedReview = ExplorationReview | RegressionReview;

export interface GoldenCapture {
  id: string;
  label: string;
  width: number;
  height: number;
  source: string;
  contentHash: string;
}

export interface StructuralInvariant {
  key: string;
  value: string | number | boolean;
  required: boolean;
}

export interface GoldenBaseline {
  schemaVersion: 1;
  id: string;
  artifactId: string;
  artifactVersionId: ArtifactVersionId;
  brandSystemVersionId: string;
  approval: {
    status: "approved";
    approvedAt: string;
    approvedBy: ArtifactActor;
  };
  captures: GoldenCapture[];
  structuralInvariants: StructuralInvariant[];
  createdAt: string;
}

export interface GoldenComparison {
  baselineId: string;
  baselineVersionId: ArtifactVersionId;
  artifactVersionId: ArtifactVersionId;
  structural: Array<{ key: string; expected: StructuralInvariant["value"]; actual?: StructuralInvariant["value"]; status: "pass" | "warning" | "error" }>;
  pixels: Array<{ captureId: string; differenceRatio: number | null; threshold: number; status: "pass" | "warning" | "error" }>;
}

export interface WebAuditFinding {
  id: string;
  status: "pass" | "warning" | "error";
  message: string;
  evidence: unknown;
}

export interface WebRenderAudit {
  viewport: { width: number; height: number };
  screenshot: string;
  horizontalOverflow: boolean;
  clippedElements: Array<{ locator: string; reason: string }>;
  brokenAssets: Array<{ locator: string; source: string; reason: string }>;
  contrast: Array<{ locator: string; ratio: number | null; required: number; foreground: string; background: string; conclusive: boolean; reason?: string }>;
  focusOrder: { locators: string[]; positiveTabIndexes: Array<{ locator: string; tabIndex: number }>; duplicateLandmarks: string[] };
  landmarks: { main: number; navigation: number; header: number; footer: number; unlabeledNavigation: number; h1: number };
  structure: { headingCount: number; interactiveCount: number; designNodeIds: string[]; bodyScrollHeight: number };
  pixelDifference?: number | null;
  findings: WebAuditFinding[];
}

export interface WebVisualCheckReport {
  schemaVersion: 2;
  phase: "before" | "after";
  file: string;
  renders: Record<string, WebRenderAudit>;
  summary: { errors: number; warnings: number; responsiveStates: string[] };
  generatedAt: string;
}

export interface PresentationRenderCapability {
  adapterId: "libreoffice" | "quicklook" | "powerpoint-macos" | "keynote-macos" | "ooxml-structural";
  installed: boolean;
  available: boolean;
  mode: "office-raster" | "office-pdf" | "system-preview" | "structural-only";
  coverage: "all-slides" | "first-slide" | "structure-only";
  requiresUserConsent: boolean;
  note: string;
}

export interface PresentationExportValidation {
  schemaVersion: 1;
  exportHash: string;
  byteLength: number;
  slideCount: number;
  dimensions: { width: number; height: number; unit: "pt" };
  capability: PresentationRenderCapability;
  rendered: boolean;
  renderFiles: Array<{ slide: number; file: string; width?: number; height?: number; contentHash: string }>;
  checks: Array<{ id: string; status: "pass" | "warning" | "error"; message: string }>;
  generatedAt: string;
}

export interface EvidenceBundleManifest {
  schemaVersion: 1;
  id: string;
  projectId: string;
  artifactId: string;
  artifactVersionId: ArtifactVersionId;
  brandSystemVersionId: string;
  createdAt: string;
  exactCommands: string[];
  files: Array<{ path: string; contentHash: string; byteLength: number; role: "input" | "screenshot" | "report" | "metric" | "export" }>;
}

export interface ApprovedVersionBinding {
  artifactId: string;
  artifactVersionId: ArtifactVersionId;
  brandSystemVersionId: string;
  approvalStatus: ArtifactApprovalStatus;
  approvedAt?: string;
  approvedBy?: ArtifactActor;
}
