import type { ArtifactKind } from "./brand-system";

export type ArtifactVersionId = string;
export type ArtifactBranchId = string;
export type ArtifactApprovalStatus = "pending" | "changes_requested" | "approved" | "rejected";
export type ArtifactActor = "user" | "codex" | "system";

export interface ArtifactComment {
  id: string;
  author: ArtifactActor;
  body: string;
  createdAt: string;
  resolvedAt?: string;
  target?: { nodeId?: string; slideId?: string; path?: string };
}

export interface ArtifactProvenance {
  id: string;
  action: "created" | "generated" | "edited" | "branched" | "restored" | "promoted" | "imported";
  actor: ArtifactActor;
  at: string;
  sourceVersionId?: ArtifactVersionId;
  sourceId?: string;
  note?: string;
}

export interface ArtifactValidation {
  id: string;
  validator: string;
  status: "pass" | "warning" | "error";
  message: string;
  checkedAt: string;
  nodeId?: string;
}

export interface ArtifactApprovalEvent {
  from: ArtifactApprovalStatus;
  to: ArtifactApprovalStatus;
  actor: ArtifactActor;
  at: string;
  note?: string;
}

export interface ArtifactApproval {
  status: ArtifactApprovalStatus;
  events: ArtifactApprovalEvent[];
  approvedAt?: string;
  approvedBy?: ArtifactActor;
}

export interface ArtifactExport {
  id: string;
  format: string;
  uri: string;
  createdAt: string;
  contentHash?: string;
}

/** Metadata shared by every registered artifact kind and every immutable version. */
export interface ArtifactMetadata {
  schemaVersion: 1;
  artifactId: string;
  versionId: ArtifactVersionId;
  kind: ArtifactKind;
  brandSystemVersionId: string;
  parentVersionId?: ArtifactVersionId;
  branchId: ArtifactBranchId;
  branchName: string;
  createdAt: string;
  createdBy: ArtifactActor;
  designThesis?: string;
  intendedDeviations: string[];
  comments: ArtifactComment[];
  provenance: ArtifactProvenance[];
  validations: ArtifactValidation[];
  approval: ArtifactApproval;
  exports: ArtifactExport[];
}

export interface SemanticTokenReference {
  /** Dot-separated path in the bound BrandSystem, for example `colors.primary`. */
  path: string;
  fallback?: string | number;
}

export const WEB_DESIGN_NODE_ATTRIBUTE = "data-design-node-id" as const;

export interface WebDesignNode {
  id: string;
  /** An HTML/CSS anchor, not a fixed-layout scene node. */
  anchor: { attribute: typeof WEB_DESIGN_NODE_ATTRIBUTE; value: string };
  label?: string;
  role?: string;
}

export interface WebDocument {
  schemaVersion: 1;
  kind: "web";
  model: "code-native-html";
  documentId: string;
  /** Preserved byte-for-byte by the adapter. */
  html: string;
  stylesheets: Array<{ id: string; code: string; media?: string }>;
  scripts: Array<{ id: string; code: string; type?: string }>;
  designNodes: WebDesignNode[];
  semanticTokens: Record<string, SemanticTokenReference>;
}

export interface WebDocumentInput {
  documentId: string;
  html: string;
  stylesheets?: WebDocument["stylesheets"];
  scripts?: WebDocument["scripts"];
  designNodes?: WebDesignNode[];
  semanticTokens?: Record<string, SemanticTokenReference>;
}

function assertStableIds(values: Array<{ id: string }>, label: string) {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value.id.trim()) throw new Error(`${label} ids must be non-empty.`);
    if (ids.has(value.id)) throw new Error(`${label} id ${value.id} is duplicated.`);
    ids.add(value.id);
  }
}

function anchoredNodeIds(html: string) {
  const ids: string[] = [];
  const expression = /\bdata-design-node-id\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/gi;
  for (const match of html.matchAll(expression)) ids.push(match[1] ?? match[2] ?? match[3]);
  return ids;
}

/**
 * Adapts authored HTML without parsing or rewriting it. Stable node anchors are
 * indexed separately so the code remains the source of truth.
 */
export function createWebDocument(input: WebDocumentInput): WebDocument {
  if (!input.documentId.trim()) throw new Error("A WebDocument id is required.");
  if (!input.html.trim()) throw new Error("A WebDocument requires HTML source.");
  const anchored = anchoredNodeIds(input.html);
  const designNodes = input.designNodes ?? anchored.map((id) => ({ id, anchor: { attribute: WEB_DESIGN_NODE_ATTRIBUTE, value: id } }));
  assertStableIds(designNodes, "Web design node");
  if (new Set(anchored).size !== anchored.length) throw new Error("Web design node anchors must be unique in the HTML source.");
  const anchorSet = new Set(anchored);
  for (const node of designNodes) {
    if (node.anchor.attribute !== WEB_DESIGN_NODE_ATTRIBUTE || node.anchor.value !== node.id) throw new Error(`Web design node ${node.id} must use its stable id as the anchor value.`);
    if (!anchorSet.has(node.anchor.value)) throw new Error(`Web design node ${node.id} has no matching HTML anchor.`);
  }
  const stylesheets = structuredClone(input.stylesheets ?? []);
  const scripts = structuredClone(input.scripts ?? []);
  assertStableIds(stylesheets, "Web stylesheet");
  assertStableIds(scripts, "Web script");
  return {
    schemaVersion: 1,
    kind: "web",
    model: "code-native-html",
    documentId: input.documentId,
    html: input.html,
    stylesheets,
    scripts,
    designNodes: structuredClone(designNodes),
    semanticTokens: structuredClone(input.semanticTokens ?? {})
  };
}

export const SLIDE_DIMENSIONS = {
  wide: { width: 960, height: 540, unit: "pt" },
  standard: { width: 720, height: 540, unit: "pt" }
} as const;

export interface SlideFrame { x: number; y: number; width: number; height: number }

interface SlideNodeBase {
  id: string;
  frame: SlideFrame;
  zIndex: number;
  rotation?: number;
  opacity?: number;
  groupId?: string;
  name?: string;
  semanticTokens?: Record<string, SemanticTokenReference>;
}

export interface SlideTextNode extends SlideNodeBase {
  type: "text";
  text: string;
  editable: true;
  style?: { fontFamily?: string; fontSize?: number; fontWeight?: number; color?: string; align?: "left" | "center" | "right"; lineHeight?: number; letterSpacing?: number };
}

export interface SlideMediaNode extends SlideNodeBase {
  type: "media";
  mediaType: "image" | "video" | "audio";
  source: { uri: string; contentHash?: string };
  altText: string;
  fit?: "cover" | "contain" | "fill";
}

export interface SlideShapeNode extends SlideNodeBase {
  type: "shape";
  shape: "rectangle" | "ellipse" | "line" | "path";
  path?: string;
  fill?: string;
  stroke?: string;
}

export interface SlideGroupNode extends SlideNodeBase {
  type: "group";
  childIds: string[];
}

export type SlideNode = SlideTextNode | SlideMediaNode | SlideShapeNode | SlideGroupNode;

export interface SlidePage {
  id: string;
  name: string;
  nodes: SlideNode[];
  notes?: string;
}

export interface SlideDocument {
  schemaVersion: 1;
  kind: "slides";
  model: "physical-scene-graph";
  documentId: string;
  dimensions: { width: number; height: number; unit: "pt" };
  slides: SlidePage[];
}

function assertFinite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
}

/** Creates a validated, editable physical scene graph in canonical point units. */
export function createSlideDocument(input: Omit<SlideDocument, "schemaVersion" | "kind" | "model">): SlideDocument {
  if (!input.documentId.trim()) throw new Error("A SlideDocument id is required.");
  if (input.dimensions.unit !== "pt" || input.dimensions.width <= 0 || input.dimensions.height <= 0) throw new Error("Slide dimensions must be positive physical point values.");
  assertFinite(input.dimensions.width, "Slide width");
  assertFinite(input.dimensions.height, "Slide height");
  assertStableIds(input.slides, "Slide");
  for (const slide of input.slides) {
    assertStableIds(slide.nodes, `Slide ${slide.id} node`);
    const nodes = new Map(slide.nodes.map((node) => [node.id, node]));
    for (const node of slide.nodes) {
      for (const [key, value] of Object.entries(node.frame)) {
        assertFinite(value, `Node ${node.id} ${key}`);
        if ((key === "width" || key === "height") && value < 0) throw new Error(`Node ${node.id} ${key} cannot be negative.`);
      }
      assertFinite(node.zIndex, `Node ${node.id} zIndex`);
      if (node.type === "text" && node.editable !== true) throw new Error(`Text node ${node.id} must remain editable.`);
      if (node.groupId && (nodes.get(node.groupId)?.type !== "group" || node.groupId === node.id)) throw new Error(`Node ${node.id} references an invalid group.`);
      if (node.type === "group") {
        const uniqueChildren = new Set(node.childIds);
        if (uniqueChildren.size !== node.childIds.length || node.childIds.some((id) => !nodes.has(id) || id === node.id)) throw new Error(`Group ${node.id} contains invalid child ids.`);
        for (const id of node.childIds) if (nodes.get(id)?.groupId !== node.id) throw new Error(`Group ${node.id} and child ${id} must reference each other.`);
      }
    }
    for (const node of slide.nodes) {
      const visited = new Set([node.id]);
      let parentId = node.groupId;
      while (parentId) {
        if (visited.has(parentId)) throw new Error(`Slide ${slide.id} contains a cyclic group hierarchy.`);
        visited.add(parentId);
        parentId = nodes.get(parentId)?.groupId;
      }
    }
  }
  return { ...structuredClone(input), schemaVersion: 1, kind: "slides", model: "physical-scene-graph" };
}

export interface CreativeBrief {
  id: string;
  title: string;
  summary: string;
  goals: string[];
  audience?: string;
  constraints?: string[];
}

export interface CreativeHostContract {
  schemaVersion: 1;
  contract: "artifact-direction";
  input: { briefId: string; brandSystemVersionId: string; artifactKind: ArtifactKind };
  output: {
    requiredFields: Array<"document" | "designThesis" | "intendedDeviations" | "validationNotes">;
    documentModel: string;
    preserveStableNodeIds: true;
  };
}

export interface CreativeDirection {
  id: string;
  name: string;
  designThesis: string;
  intendedDeviations: string[];
  divergence: {
    composition: "modular" | "editorial" | "immersive";
    density: "compact" | "balanced" | "spacious";
    typography: "systematic" | "expressive" | "restrained";
    media: "diagrammatic" | "documentary" | "abstract";
  };
  hostContract: CreativeHostContract;
}

/** Produces exactly three intentionally orthogonal, deterministic directions. */
export function generateCreativeDirections(brief: CreativeBrief, artifactKind: ArtifactKind, brandSystemVersionId: string): CreativeDirection[] {
  if (!brief.id.trim() || !brief.title.trim() || !brief.summary.trim()) throw new Error("A complete creative brief is required.");
  if (!brandSystemVersionId.trim()) throw new Error("Creative exploration must bind to a BrandSystem version.");
  const model = artifactKind === "web" ? "code-native-html" : artifactKind === "slides" ? "physical-scene-graph" : `registered:${artifactKind}`;
  const contract = (): CreativeHostContract => ({
    schemaVersion: 1,
    contract: "artifact-direction",
    input: { briefId: brief.id, brandSystemVersionId, artifactKind },
    output: { requiredFields: ["document", "designThesis", "intendedDeviations", "validationNotes"], documentModel: model, preserveStableNodeIds: true }
  });
  return [
    {
      id: `${brief.id}:signal-structure`, name: "Signal & Structure",
      designThesis: `${brief.title} becomes a high-information system: explicit hierarchy makes the next decision feel inevitable.`,
      intendedDeviations: ["Compress spacing to expose more useful context", "Use modular evidence blocks and visible rules", "Prefer diagrammatic media over atmospheric imagery"],
      divergence: { composition: "modular", density: "compact", typography: "systematic", media: "diagrammatic" }, hostContract: contract()
    },
    {
      id: `${brief.id}:human-momentum`, name: "Human Momentum",
      designThesis: `${brief.title} is a guided human story: generous pacing and documentary moments turn the brief into forward motion.`,
      intendedDeviations: ["Expand whitespace and stage one message at a time", "Use expressive scale changes for emotional pacing", "Lead with documentary, audience-centred media"],
      divergence: { composition: "immersive", density: "spacious", typography: "expressive", media: "documentary" }, hostContract: contract()
    },
    {
      id: `${brief.id}:editorial-contrast`, name: "Editorial Contrast",
      designThesis: `${brief.title} reads as a confident point of view: asymmetric restraint creates tension without sacrificing clarity.`,
      intendedDeviations: ["Use asymmetric editorial composition", "Keep typography restrained and let contrast carry hierarchy", "Introduce abstract crops as counterpoints to the copy"],
      divergence: { composition: "editorial", density: "balanced", typography: "restrained", media: "abstract" }, hostContract: contract()
    }
  ];
}

export interface ArtifactVersion<TDocument = unknown> {
  metadata: ArtifactMetadata;
  contentHash: string;
  document: TDocument;
}

export interface ArtifactKindRegistration {
  kind: ArtifactKind;
  label: string;
  documentModel: string;
  capabilities: Array<"responsive" | "physical-layout" | "editable-text" | "media" | "semantic-tokens">;
  /** Runtime operations implemented by this kind's adapter. Omitted registrations are read-only. */
  actions?: ArtifactActionCapabilities;
  adapterId?: string;
  registeredAt: string;
}

export type ArtifactAction = "create" | "edit" | "preview" | "animate" | "export";

/** Actions are deliberately independent: support for preview never implies edit or export. */
export interface ArtifactActionCapabilities {
  create: boolean;
  edit: boolean;
  preview: boolean;
  animate: boolean;
  export: boolean;
  exportFormats: string[];
}

export const NO_ARTIFACT_ACTIONS: ArtifactActionCapabilities = {
  create: false, edit: false, preview: false, animate: false, export: false, exportFormats: []
};

export interface ArtifactBranch {
  id: ArtifactBranchId;
  artifactId: string;
  name: string;
  createdAt: string;
  createdFromVersionId?: ArtifactVersionId;
  headVersionId?: ArtifactVersionId;
}

export interface ArtifactVersionSummary {
  artifactId: string;
  versionId: ArtifactVersionId;
  kind: ArtifactKind;
  branchId: ArtifactBranchId;
  parentVersionId?: ArtifactVersionId;
  brandSystemVersionId: string;
  approvalStatus: ArtifactApprovalStatus;
  createdAt: string;
  contentHash: string;
}

export interface ArtifactRegistry {
  schemaVersion: 1;
  projectId: string;
  kinds: ArtifactKindRegistration[];
  branches: ArtifactBranch[];
  versions: ArtifactVersionSummary[];
  promotedVersionIds: Record<string, ArtifactVersionId>;
  updatedAt: string;
}

export type ComparisonFrame =
  | { id: string; label: "Desktop" | "Mobile"; width: number; height: number; source: string }
  | { id: string; label: string; width: number; height: number; source: string; slideId: string };

export interface ComparisonVariant {
  versionId: ArtifactVersionId;
  directionName: string;
  designThesis?: string;
  frames: ComparisonFrame[];
}

export interface ComparisonSheet {
  schemaVersion: 1;
  kind: "web-contact-sheet" | "slide-sheet";
  title: string;
  frameStyle: { background: string; border: string; labelPosition: "below"; versionIdentifier: "visible" };
  variants: ComparisonVariant[];
}
