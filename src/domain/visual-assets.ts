import type { ArtifactApprovalStatus } from "./artifacts";
import type { ArtifactKind } from "./brand-system";

export type VisualAssetId = string;
export type VisualAssetVersionId = string;
export type MediaGenerationRunId = string;
export type VisualAssetEncoding = "png" | "jpeg" | "webp";
export type VisualAssetAdapterId = "codex-app-server" | "openai-image-api" | "openai-responses-api";
export type VisualAssetCredentialMode = "chatgpt" | "platform-keychain";

export interface VisualAssetTarget {
  artifactId: string;
  artifactKind: ArtifactKind | "template";
  contextId: string;
  role: string;
  context:
    | { type: "web"; viewport: { width: number; height: number }; crop: { width: number; height: number }; fit: "cover" | "contain" }
    | { type: "slide"; slideId: string; frame: { width: number; height: number; unit: "pt" }; fit: "cover" | "contain" }
    | { type: "template"; slotId: string; frame: { width: number; height: number }; fit: "cover" | "contain" };
}

export interface VisualAssetOutputParameters {
  width: number;
  height: number;
  quality: "low" | "medium" | "high" | "auto";
  encoding: VisualAssetEncoding;
  compression?: number;
  background: "opaque" | "transparent" | "auto";
  variants: number;
  maxBytes: number;
}

export interface VisualAssetInputReference {
  versionId?: VisualAssetVersionId;
  uri?: string;
  contentHash: string;
  purpose: "reference" | "edit-source" | "mask";
}

export interface VisualAssetBrief {
  schemaVersion: 1;
  id: string;
  title: string;
  objective: string;
  audience: string;
  target: VisualAssetTarget;
  brandSystemVersionId: string;
  brandDirection: {
    personality: string[];
    visualStyle: string;
    lighting: string;
    composition: string;
    palette: string[];
    mustInclude: string[];
    mustAvoid: string[];
  };
  prompt: string;
  inputAssets: VisualAssetInputReference[];
  output: VisualAssetOutputParameters;
  createdAt: string;
  createdBy: "user" | "codex";
}

export interface VisualAssetLineage {
  parentVersionId?: VisualAssetVersionId;
  inputVersionIds: VisualAssetVersionId[];
  generationRunId: MediaGenerationRunId;
  providerItemId?: string;
  providerResponseId?: string;
  restoredFromVersionId?: VisualAssetVersionId;
}

export interface VisualAssetApprovalEvent {
  from: ArtifactApprovalStatus;
  to: ArtifactApprovalStatus;
  actor: "user" | "codex" | "system";
  at: string;
  note?: string;
}

export interface VisualAssetValidation {
  id: string;
  context: "source" | "web" | "slide" | "template";
  status: "pass" | "warning" | "error";
  message: string;
  checkedAt: string;
  measurements?: Record<string, number | string | boolean>;
}

export interface GeneratedAssetVersion {
  schemaVersion: 1;
  assetId: VisualAssetId;
  versionId: VisualAssetVersionId;
  briefId: string;
  brandSystemVersionId: string;
  target: VisualAssetTarget;
  prompt: string;
  revisedPrompt?: string;
  inputAssets: VisualAssetInputReference[];
  model: { adapter: VisualAssetAdapterId; name: string };
  output: VisualAssetOutputParameters & {
    actualWidth: number;
    actualHeight: number;
    actualBytes: number;
    actualEncoding: VisualAssetEncoding;
    hasTransparency: boolean;
  };
  lineage: VisualAssetLineage;
  contentHash: string;
  fileUri: string;
  createdAt: string;
  approval: {
    status: ArtifactApprovalStatus;
    events: VisualAssetApprovalEvent[];
    approvedAt?: string;
    approvedBy?: "user" | "codex" | "system";
  };
  validations: VisualAssetValidation[];
}

export interface MediaGenerationAttempt {
  number: number;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  providerRequestId?: string;
  error?: { code: string; message: string; retryable: boolean };
}

export interface MediaGenerationRun {
  schemaVersion: 1;
  id: MediaGenerationRunId;
  projectId: string;
  assetId: VisualAssetId;
  brief: VisualAssetBrief;
  adapter: VisualAssetAdapterId;
  credentialMode: VisualAssetCredentialMode;
  model: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  prompts: string[];
  attempts: MediaGenerationAttempt[];
  outputVersionIds: VisualAssetVersionId[];
  costGuard: { maxVariants: number; maxAttempts: number; maxOutputBytes: number };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  failure?: { code: string; message: string; retryable: boolean };
}

export interface VisualAssetPlacement {
  id: string;
  target: VisualAssetTarget;
  assetId: VisualAssetId;
  versionId: VisualAssetVersionId;
  placedAt: string;
  placedBy: "user" | "codex" | "system";
}

export interface VisualAssetRegistry {
  schemaVersion: 1;
  projectId: string;
  briefs: VisualAssetBrief[];
  versions: GeneratedAssetVersion[];
  runs: MediaGenerationRun[];
  placements: VisualAssetPlacement[];
  approvedVersionIds: Record<VisualAssetId, VisualAssetVersionId>;
  updatedAt: string;
}

export interface VisualGenerationRequest {
  runId: MediaGenerationRunId;
  projectId: string;
  brief: VisualAssetBrief;
  prompts: string[];
  model: string;
  output: VisualAssetOutputParameters;
  inputAssets: Array<VisualAssetInputReference & { bytes?: Uint8Array; mediaType?: string }>;
}

export interface VisualGenerationOutput {
  bytes: Uint8Array;
  providerItemId?: string;
  providerResponseId?: string;
  revisedPrompt?: string;
}

export interface VisualGenerationAdapter {
  readonly id: VisualAssetAdapterId;
  readonly credentialMode: VisualAssetCredentialMode;
  readonly model: string;
  generate(request: VisualGenerationRequest, signal?: AbortSignal): Promise<VisualGenerationOutput[]>;
}

function boundedInteger(value: number, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
}

export function validateVisualAssetBrief(brief: VisualAssetBrief) {
  if (brief.schemaVersion !== 1 || !brief.id.trim() || !brief.title.trim() || !brief.objective.trim() || !brief.prompt.trim()) throw new Error("A complete visual asset brief is required.");
  if (!brief.brandSystemVersionId.trim()) throw new Error("A visual asset brief must bind to a BrandSystem version.");
  if (!brief.target.artifactId.trim() || !brief.target.contextId.trim() || !brief.target.role.trim()) throw new Error("A visual asset target must identify its artifact, context and role.");
  const targetFrame = brief.target.context.type === "web" ? brief.target.context.crop : brief.target.context.frame;
  if (!Number.isFinite(targetFrame.width) || !Number.isFinite(targetFrame.height) || targetFrame.width <= 0 || targetFrame.height <= 0) throw new Error("A visual asset target must have positive finite crop dimensions.");
  if (brief.prompt.length > 8_000) throw new Error("Visual asset prompts are limited to 8,000 characters.");
  boundedInteger(brief.output.width, "Output width", 64, 8192);
  boundedInteger(brief.output.height, "Output height", 64, 8192);
  boundedInteger(brief.output.variants, "Variant count", 1, 4);
  boundedInteger(brief.output.maxBytes, "Output byte budget", 1_024, 50_000_000);
  if (brief.output.compression !== undefined) boundedInteger(brief.output.compression, "Compression", 0, 100);
  if (brief.inputAssets.length > 8) throw new Error("A visual asset brief may reference at most eight input assets.");
  for (const input of brief.inputAssets) {
    if (!input.contentHash.match(/^[a-f0-9]{64}$/i) || (!input.versionId && !input.uri)) throw new Error("Input assets require a SHA-256 hash and a stable version or URI.");
  }
  return brief;
}

/** Creates prompts that differ in composition, camera and visual rhythm rather than seed alone. */
export function buildDeliberateVariantPrompts(brief: VisualAssetBrief) {
  validateVisualAssetBrief(brief);
  const directions = [
    "graphic and architectural; strong negative space; a single decisive focal point",
    "documentary and human; tactile detail; off-centre editorial crop",
    "abstract and atmospheric; layered depth; rhythmic shapes and unexpected scale",
    "product-led and precise; controlled studio light; modular balanced composition"
  ];
  const brand = `Brand direction: ${brief.brandDirection.visualStyle}; ${brief.brandDirection.lighting}; ${brief.brandDirection.composition}. Palette: ${brief.brandDirection.palette.join(", ")}.`;
  const guardrails = `Must include: ${brief.brandDirection.mustInclude.join(", ") || "none"}. Avoid: ${brief.brandDirection.mustAvoid.join(", ") || "none"}.`;
  return directions.slice(0, brief.output.variants).map((direction, index) => `${brief.prompt}\n${brand}\n${guardrails}\nVariant ${index + 1}: ${direction}. Deliberately do not reuse the composition of the other variants.`);
}
