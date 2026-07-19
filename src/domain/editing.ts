import {
  createSlideDocument,
  createWebDocument,
  type SlideDocument,
  type SlideFrame,
  type SlideNode,
  type SlideTextNode,
  type WebDocument
} from "./artifacts";

export type EditableArtifactDocument = SlideDocument | WebDocument;
export type ResponsiveScope = "shared" | "desktop" | "mobile";
export type EditBoundary = "gesture" | "keyboard" | "inline-edit" | "control" | "autosave";

export const EDIT_LIMITS = {
  maxOperationsPerTransaction: 64,
  maxTransactionBytes: 256_000,
  maxHistoryEntries: 100,
  maxWebStyleBytes: 100_000
} as const;

export interface TextSelectionContext {
  anchor: number;
  focus: number;
  direction?: "forward" | "backward" | "none";
}

export interface TypographyPatch {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
}

export type SlideAlignment = "left" | "horizontal-center" | "right" | "top" | "vertical-center" | "bottom";

export type ArtifactEditOperation =
  | { type: "slide.move"; slideId: string; nodeIds: string[]; dx: number; dy: number }
  | { type: "slide.resize"; slideId: string; nodeId: string; frame: Partial<SlideFrame>; minSize?: number }
  | { type: "slide.align"; slideId: string; nodeIds: string[]; alignment: SlideAlignment }
  | { type: "slide.distribute"; slideId: string; nodeIds: string[]; axis: "horizontal" | "vertical" }
  | { type: "slide.group"; slideId: string; nodeIds: string[]; groupId: string; name?: string }
  | { type: "slide.ungroup"; slideId: string; groupId: string }
  | { type: "slide.z-order"; slideId: string; nodeIds: string[]; direction: "front" | "forward" | "backward" | "back" }
  | { type: "slide.text"; slideId: string; nodeId: string; text: string; selection?: TextSelectionContext; typography?: TypographyPatch }
  | { type: "slide.control"; slideId: string; nodeIds: string[]; control: GeneratedControlId; value: string | number; scope: "selection" | "group" | "slide" }
  | { type: "web.text"; nodeId: string; text: string; selection?: TextSelectionContext }
  | { type: "web.style"; nodeIds: string[]; declarations: Record<string, string | number>; scope: ResponsiveScope };

export type GeneratedControlId =
  | "spacing.padding"
  | "spacing.gap"
  | "color.foreground"
  | "color.background"
  | "typography.size"
  | "typography.weight"
  | "typography.lineHeight"
  | "density"
  | "layout.columns";

export interface GeneratedControlDefinition {
  id: GeneratedControlId;
  category: "spacing" | "color" | "typography" | "density" | "layout";
  label: string;
  valueType: "number" | "color";
  min?: number;
  max?: number;
  step?: number;
  scopes: Array<"selection" | "group" | "slide" | ResponsiveScope>;
}

/**
 * Controls exposed by generated UIs. Every value and target scope is
 * constrained, and the advertised scopes match what the engine can apply:
 * spacing and layout controls are Web-only (slide nodes have no padding, gap,
 * or column model), while typography, colour, and density act on slide nodes.
 */
export const GENERATED_ARTIFACT_CONTROLS: readonly GeneratedControlDefinition[] = [
  { id: "spacing.padding", category: "spacing", label: "Padding", valueType: "number", min: 0, max: 240, step: 1, scopes: ["shared", "desktop", "mobile"] },
  { id: "spacing.gap", category: "spacing", label: "Gap", valueType: "number", min: 0, max: 240, step: 1, scopes: ["shared", "desktop", "mobile"] },
  { id: "color.foreground", category: "color", label: "Text colour", valueType: "color", scopes: ["selection", "group", "slide", "shared", "desktop", "mobile"] },
  { id: "color.background", category: "color", label: "Fill colour", valueType: "color", scopes: ["selection", "group", "slide", "shared", "desktop", "mobile"] },
  { id: "typography.size", category: "typography", label: "Type size", valueType: "number", min: 8, max: 256, step: 1, scopes: ["selection", "group", "slide", "shared", "desktop", "mobile"] },
  { id: "typography.weight", category: "typography", label: "Type weight", valueType: "number", min: 100, max: 900, step: 100, scopes: ["selection", "group", "slide", "shared", "desktop", "mobile"] },
  { id: "typography.lineHeight", category: "typography", label: "Line height", valueType: "number", min: 0.8, max: 3, step: 0.05, scopes: ["selection", "group", "slide", "shared", "desktop", "mobile"] },
  { id: "density", category: "density", label: "Density", valueType: "number", min: 0.5, max: 2, step: 0.05, scopes: ["selection", "group", "slide", "shared", "desktop", "mobile"] },
  { id: "layout.columns", category: "layout", label: "Columns", valueType: "number", min: 1, max: 12, step: 1, scopes: ["shared", "desktop", "mobile"] }
] as const;

/** Accepts the CSS hex colour forms: #rgb, #rgba, #rrggbb, #rrggbbaa. */
export function isCssHexColor(value: string) {
  return /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
}

export interface EditFeedback {
  level: "info" | "warning";
  code: "text-overflow" | "responsive-override";
  message: string;
  nodeId: string;
  scope?: ResponsiveScope;
  overflowBy?: number;
}

export interface EditResult<TDocument extends EditableArtifactDocument = EditableArtifactDocument> {
  document: TDocument;
  feedback: EditFeedback[];
}

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
}

function uniqueIds(ids: string[], minimum = 1) {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length || unique.length < minimum || unique.some((id) => !id.trim())) throw new Error("Edit node ids must be unique and non-empty.");
  return unique;
}

function slideAndNodes(document: SlideDocument, slideId: string, nodeIds: string[], minimum = 1) {
  const slide = document.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new Error(`Slide ${slideId} was not found.`);
  const ids = uniqueIds(nodeIds, minimum);
  const nodes = ids.map((id) => slide.nodes.find((node) => node.id === id));
  if (nodes.some((node) => !node)) throw new Error("One or more selected slide nodes no longer exist.");
  return { slide, nodes: nodes as SlideNode[] };
}

function bounds(nodes: SlideNode[]): SlideFrame {
  const left = Math.min(...nodes.map((node) => node.frame.x));
  const top = Math.min(...nodes.map((node) => node.frame.y));
  const right = Math.max(...nodes.map((node) => node.frame.x + node.frame.width));
  const bottom = Math.max(...nodes.map((node) => node.frame.y + node.frame.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function typography(node: SlideTextNode, patch: TypographyPatch) {
  if (patch.fontFamily !== undefined && (!patch.fontFamily.trim() || patch.fontFamily.length > 120)) throw new Error("Font family must contain 1–120 characters.");
  if (patch.fontSize !== undefined && (patch.fontSize < 8 || patch.fontSize > 256)) throw new Error("Font size must be between 8 and 256 points.");
  if (patch.fontWeight !== undefined && (patch.fontWeight < 100 || patch.fontWeight > 900 || patch.fontWeight % 100 !== 0)) throw new Error("Font weight must be a 100–900 step of 100.");
  if (patch.lineHeight !== undefined && (patch.lineHeight < 0.8 || patch.lineHeight > 3)) throw new Error("Line height must be between 0.8 and 3.");
  if (patch.letterSpacing !== undefined && (patch.letterSpacing < -10 || patch.letterSpacing > 40)) throw new Error("Letter spacing must be between -10 and 40 points.");
  node.style = { ...node.style, ...patch };
}

function textOverflow(node: SlideTextNode): EditFeedback | undefined {
  const size = node.style?.fontSize ?? 24;
  const lineHeight = node.style?.lineHeight ?? 1.2;
  const charactersPerLine = Math.max(1, Math.floor(node.frame.width / (size * 0.55)));
  const visualLines = node.text.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
  const required = visualLines * size * lineHeight;
  if (required <= node.frame.height) return undefined;
  return { level: "warning", code: "text-overflow", nodeId: node.id, overflowBy: Math.ceil(required - node.frame.height), message: `Text exceeds its frame by approximately ${Math.ceil(required - node.frame.height)}pt.` };
}

function assertTextSelection(selection: TextSelectionContext | undefined, text: string) {
  if (!selection) return;
  if (![selection.anchor, selection.focus].every(Number.isInteger) || selection.anchor < 0 || selection.focus < 0 || selection.anchor > text.length || selection.focus > text.length) throw new Error("Text selection falls outside the edited value.");
}

function slideControlApplies(controlId: GeneratedControlId, node: SlideNode) {
  if (controlId === "typography.size" || controlId === "typography.weight" || controlId === "typography.lineHeight" || controlId === "color.foreground") return node.type === "text";
  if (controlId === "color.background") return node.type === "shape";
  if (controlId === "density") return node.type !== "group";
  return false;
}

/**
 * Expands the selection to the operation's declared scope: the whole slide,
 * the enclosing groups' members, or the explicit selection unchanged.
 */
function resolveControlScope(slide: SlideDocument["slides"][number], nodes: SlideNode[], scope: "selection" | "group" | "slide") {
  if (scope === "selection") return { targets: nodes, expanded: false };
  if (scope === "slide") return { targets: slide.nodes, expanded: true };
  const ids = new Set<string>();
  for (const node of nodes) {
    const groupId = node.type === "group" ? node.id : node.groupId;
    const group = groupId ? slide.nodes.find((candidate) => candidate.id === groupId) : undefined;
    if (group?.type === "group") for (const childId of group.childIds) ids.add(childId);
    else ids.add(node.id);
  }
  return { targets: slide.nodes.filter((node) => ids.has(node.id)), expanded: true };
}

function slideControl(nodes: SlideNode[], controlId: GeneratedControlId, value: string | number, dimensions: { width: number; height: number }, expanded = false) {
  const definition = GENERATED_ARTIFACT_CONTROLS.find((control) => control.id === controlId);
  if (!definition) throw new Error("Unknown generated control.");
  if (definition.valueType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < (definition.min ?? -Infinity) || value > (definition.max ?? Infinity)) throw new Error(`${definition.label} is outside its safe range.`);
  } else if (typeof value !== "string" || !isCssHexColor(value)) throw new Error(`${definition.label} must be a hexadecimal colour.`);
  if (!definition.scopes.some((scope) => scope === "selection" || scope === "group" || scope === "slide")) throw new Error(`${definition.label} is only available for Web layout nodes.`);
  // A scope-expanded target set applies to every node the control understands;
  // an explicit selection must match exactly so mistakes surface as errors.
  const targets = expanded ? nodes.filter((node) => slideControlApplies(controlId, node)) : nodes;
  if (expanded && !targets.length) throw new Error(`${definition.label} matches no node in the selected scope.`);
  for (const node of targets) {
    if (controlId === "typography.size" || controlId === "typography.weight" || controlId === "typography.lineHeight" || controlId === "color.foreground") {
      if (node.type !== "text") throw new Error(`${definition.label} only applies to text nodes.`);
      const patch: TypographyPatch = controlId === "typography.size" ? { fontSize: value as number }
        : controlId === "typography.weight" ? { fontWeight: value as number }
          : controlId === "typography.lineHeight" ? { lineHeight: value as number }
            : { color: value as string };
      typography(node, patch);
    } else if (controlId === "color.background") {
      if (node.type !== "shape") throw new Error("Fill colour only applies to shape nodes.");
      node.fill = value as string;
    } else {
      // density: group frames are decorative (rendering flattens groups), so
      // scaling them silently corrupts state instead of changing pixels.
      if (node.type === "group") throw new Error("Density applies to individual nodes; select the group's contents instead.");
      const factor = value as number;
      node.frame.width = clamp(node.frame.width * factor, 1, Math.max(1, dimensions.width - node.frame.x));
      node.frame.height = clamp(node.frame.height * factor, 1, Math.max(1, dimensions.height - node.frame.y));
    }
  }
}

const WEB_STYLE_PROPERTIES = new Set([
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "gap", "row-gap", "column-gap",
  "color", "background", "background-color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
  "display", "grid-template-columns", "align-items", "justify-content", "flex-direction", "border-radius", "width", "height", "max-width", "min-height", "opacity"
]);

function cssValue(value: string | number) {
  const rendered = typeof value === "number" ? String(value) : value.trim();
  if (!rendered || rendered.length > 160 || /[\u0000-\u001f{};@<>"'`\\]|\/\*/.test(rendered)) throw new Error("Web style values may not contain markup, rules, at-rules, comments, quotes, or escapes.");
  if (/\b(?:url|image-set|cross-fade|element|expression)\s*\(/i.test(rendered) || /javascript\s*:/i.test(rendered)) throw new Error("Web style values may not load external resources or execute expressions.");
  return rendered;
}

function webSelector(id: string) {
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(id)) throw new Error("Web edits require a stable design id.");
  return `[data-design-node-id="${id}"]`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] ?? character);
}

function patchWebText(document: WebDocument, nodeId: string, text: string) {
  webSelector(nodeId);
  if (text.length > 10_000) throw new Error("Inline text is limited to 10,000 characters.");
  const escapedId = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(<([a-z][\\w:-]*)\\b[^>]*\\bdata-design-node-id\\s*=\\s*(?:"${escapedId}"|'${escapedId}'|${escapedId})[^>]*>)([^<]*)(<\\/\\2\\s*>)`, "i");
  if (!pattern.test(document.html)) throw new Error(`Web node ${nodeId} must be a text-only stable design node for inline editing.`);
  const escapedText = escapeHtml(text);
  document.html = document.html.replace(pattern, (_match, opening: string, _tag: string, _prior: string, closing: string) => `${opening}${escapedText}${closing}`);
}

function patchWebStyles(document: WebDocument, nodeIds: string[], declarations: Record<string, string | number>, scope: ResponsiveScope) {
  const ids = uniqueIds(nodeIds);
  for (const id of ids) if (!document.designNodes.some((node) => node.id === id)) throw new Error(`Web design node ${id} was not found.`);
  const entries = Object.entries(declarations);
  if (!entries.length || entries.length > 24) throw new Error("A Web style edit requires 1–24 declarations.");
  const code = entries.map(([property, value]) => {
    if (!WEB_STYLE_PROPERTIES.has(property)) throw new Error(`Web style property ${property} is not editable.`);
    return `${property}:${cssValue(value)}`;
  }).join(";");
  const rules = ids.map((id) => `${webSelector(id)}{${code}}`).join("\n");
  const scoped = scope === "shared" ? rules : `@media ${scope === "mobile" ? "(max-width:760px)" : "(min-width:761px)"}{${rules}}`;
  let stylesheet = document.stylesheets.find((candidate) => candidate.id === "studio-direct-edits");
  if (!stylesheet) {
    stylesheet = { id: "studio-direct-edits", code: "" };
    document.stylesheets.push(stylesheet);
  }
  const nextCode = `${stylesheet.code}${stylesheet.code ? "\n" : ""}${scoped}`;
  if (new TextEncoder().encode(nextCode).byteLength > EDIT_LIMITS.maxWebStyleBytes) throw new Error("Direct Web styles exceed the 100 KB safety limit.");
  stylesheet.code = nextCode;
}

function clamp(value: number, minimum: number, maximum: number) {
  if (minimum > maximum) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

function boundedMovement(document: SlideDocument, nodes: SlideNode[], dx: number, dy: number) {
  const area = bounds(nodes);
  const maxDx = document.dimensions.width - (area.x + area.width);
  const maxDy = document.dimensions.height - (area.y + area.height);
  return {
    dx: area.width > document.dimensions.width ? 0 : clamp(dx, -area.x, maxDx),
    dy: area.height > document.dimensions.height ? 0 : clamp(dy, -area.y, maxDy)
  };
}

export function applyArtifactEdits<TDocument extends EditableArtifactDocument>(source: TDocument, operations: ArtifactEditOperation[]): EditResult<TDocument> {
  if (!operations.length) throw new Error("An edit transaction requires at least one operation.");
  if (operations.length > EDIT_LIMITS.maxOperationsPerTransaction) throw new Error(`An edit transaction is limited to ${EDIT_LIMITS.maxOperationsPerTransaction} operations.`);
  if (new TextEncoder().encode(JSON.stringify(operations)).byteLength > EDIT_LIMITS.maxTransactionBytes) throw new Error("An edit transaction exceeds the 256 KB safety limit.");
  const document = structuredClone(source);
  const feedback: EditFeedback[] = [];
  for (const operation of operations) {
    if (document.kind === "slides") {
      if (!operation.type.startsWith("slide.")) throw new Error("Web operations cannot be applied to slides.");
      if (operation.type === "slide.move") {
        finite(operation.dx, "Horizontal movement"); finite(operation.dy, "Vertical movement");
        const { nodes } = slideAndNodes(document, operation.slideId, operation.nodeIds);
        const movement = boundedMovement(document, nodes, operation.dx, operation.dy);
        for (const node of nodes) { node.frame.x += movement.dx; node.frame.y += movement.dy; }
      } else if (operation.type === "slide.resize") {
        const { nodes: [node] } = slideAndNodes(document, operation.slideId, [operation.nodeId]);
        const next = { ...node.frame, ...operation.frame };
        Object.values(next).forEach((value) => finite(value, "Resize value"));
        const minimum = operation.minSize ?? 1;
        if (next.width < minimum || next.height < minimum) throw new Error(`Resized nodes must be at least ${minimum}pt.`);
        next.x = clamp(next.x, 0, Math.max(0, document.dimensions.width - minimum));
        next.y = clamp(next.y, 0, Math.max(0, document.dimensions.height - minimum));
        next.width = Math.min(next.width, document.dimensions.width - next.x);
        next.height = Math.min(next.height, document.dimensions.height - next.y);
        node.frame = next;
      } else if (operation.type === "slide.align") {
        const { nodes } = slideAndNodes(document, operation.slideId, operation.nodeIds, 2);
        const area = bounds(nodes);
        for (const node of nodes) {
          if (operation.alignment === "left") node.frame.x = area.x;
          if (operation.alignment === "horizontal-center") node.frame.x = area.x + (area.width - node.frame.width) / 2;
          if (operation.alignment === "right") node.frame.x = area.x + area.width - node.frame.width;
          if (operation.alignment === "top") node.frame.y = area.y;
          if (operation.alignment === "vertical-center") node.frame.y = area.y + (area.height - node.frame.height) / 2;
          if (operation.alignment === "bottom") node.frame.y = area.y + area.height - node.frame.height;
        }
      } else if (operation.type === "slide.distribute") {
        const { nodes } = slideAndNodes(document, operation.slideId, operation.nodeIds, 3);
        const horizontal = operation.axis === "horizontal";
        const sorted = [...nodes].sort((a, b) => (horizontal ? a.frame.x - b.frame.x : a.frame.y - b.frame.y));
        const start = horizontal ? sorted[0].frame.x : sorted[0].frame.y;
        const end = horizontal ? sorted.at(-1)!.frame.x + sorted.at(-1)!.frame.width : sorted.at(-1)!.frame.y + sorted.at(-1)!.frame.height;
        const occupied = sorted.reduce((total, node) => total + (horizontal ? node.frame.width : node.frame.height), 0);
        const gap = (end - start - occupied) / (sorted.length - 1);
        let cursor = start;
        for (const node of sorted) { if (horizontal) node.frame.x = cursor; else node.frame.y = cursor; cursor += (horizontal ? node.frame.width : node.frame.height) + gap; }
      } else if (operation.type === "slide.group") {
        if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(operation.groupId)) throw new Error("Group id contains unsupported characters.");
        const { slide, nodes } = slideAndNodes(document, operation.slideId, operation.nodeIds, 2);
        if (slide.nodes.some((node) => node.id === operation.groupId)) throw new Error(`Slide node ${operation.groupId} already exists.`);
        const parents = new Set(nodes.map((node) => node.groupId));
        if (parents.size > 1) throw new Error("Grouped nodes must share the same parent.");
        const frame = bounds(nodes);
        const zIndex = Math.min(...nodes.map((node) => node.zIndex));
        const groupId = operation.groupId;
        const parentId = nodes[0].groupId;
        for (const node of nodes) node.groupId = groupId;
        slide.nodes.push({ id: groupId, type: "group", childIds: nodes.map((node) => node.id), groupId: parentId, frame, zIndex, name: operation.name });
        if (parentId) {
          const parent = slide.nodes.find((node) => node.id === parentId);
          if (parent?.type !== "group") throw new Error("Grouped nodes reference an invalid parent.");
          const childIds = new Set(nodes.map((node) => node.id));
          let inserted = false;
          parent.childIds = parent.childIds.flatMap((id) => {
            if (!childIds.has(id)) return [id];
            if (inserted) return [];
            inserted = true;
            return [groupId];
          });
        }
      } else if (operation.type === "slide.ungroup") {
        const { slide, nodes: [group] } = slideAndNodes(document, operation.slideId, [operation.groupId]);
        if (group.type !== "group") throw new Error("Only group nodes can be ungrouped.");
        for (const childId of group.childIds) {
          const child = slide.nodes.find((node) => node.id === childId)!;
          child.groupId = group.groupId;
        }
        if (group.groupId) {
          const parent = slide.nodes.find((node) => node.id === group.groupId);
          if (parent?.type === "group") parent.childIds = parent.childIds.flatMap((id) => id === group.id ? group.childIds : [id]);
        }
        slide.nodes = slide.nodes.filter((node) => node.id !== group.id);
      } else if (operation.type === "slide.z-order") {
        const { slide, nodes } = slideAndNodes(document, operation.slideId, operation.nodeIds);
        const selected = new Set(nodes.map((node) => node.id));
        const ordered = [...slide.nodes].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
        if (operation.direction === "front" || operation.direction === "back") {
          const rest = ordered.filter((node) => !selected.has(node.id));
          const picked = ordered.filter((node) => selected.has(node.id));
          ordered.splice(0, ordered.length, ...(operation.direction === "front" ? [...rest, ...picked] : [...picked, ...rest]));
        } else {
          const forward = operation.direction === "forward";
          const indices = ordered.map((node, index) => selected.has(node.id) ? index : -1).filter((index) => index >= 0);
          const traversal = forward ? [...indices].reverse() : indices;
          for (const index of traversal) {
            const swap = index + (forward ? 1 : -1);
            if (swap >= 0 && swap < ordered.length && !selected.has(ordered[swap].id)) [ordered[index], ordered[swap]] = [ordered[swap], ordered[index]];
          }
        }
        ordered.forEach((node, index) => { node.zIndex = index; });
      } else if (operation.type === "slide.text") {
        const { nodes: [node] } = slideAndNodes(document, operation.slideId, [operation.nodeId]);
        if (node.type !== "text" || !node.editable) throw new Error("Only editable text nodes support inline editing.");
        if (operation.text.length > 10_000) throw new Error("Inline text is limited to 10,000 characters.");
        assertTextSelection(operation.selection, operation.text);
        node.text = operation.text;
        if (operation.typography) typography(node, operation.typography);
        const overflow = textOverflow(node); if (overflow) feedback.push(overflow);
      } else if (operation.type === "slide.control") {
        const { slide, nodes } = slideAndNodes(document, operation.slideId, operation.nodeIds);
        const { targets, expanded } = resolveControlScope(slide, nodes, operation.scope);
        slideControl(targets, operation.control, operation.value, document.dimensions, expanded);
      }
    } else {
      if (operation.type === "web.text") {
        assertTextSelection(operation.selection, operation.text);
        if (!document.designNodes.some((node) => node.id === operation.nodeId)) throw new Error(`Web design node ${operation.nodeId} was not found.`);
        patchWebText(document, operation.nodeId, operation.text);
      } else if (operation.type === "web.style") {
        patchWebStyles(document, operation.nodeIds, operation.declarations, operation.scope);
        for (const nodeId of operation.nodeIds) feedback.push({ level: "info", code: "responsive-override", nodeId, scope: operation.scope, message: operation.scope === "shared" ? "Edit affects the shared composition." : `Edit affects ${operation.scope} only.` });
      } else throw new Error("Slide operations cannot be applied to Web documents.");
    }
  }
  const validated = document.kind === "slides" ? createSlideDocument(document) : createWebDocument(document);
  return { document: validated as TDocument, feedback };
}

export interface EditHistoryEntry<TDocument extends EditableArtifactDocument = EditableArtifactDocument> {
  id: string;
  label: string;
  boundary: EditBoundary;
  at: string;
  before: TDocument;
  after: TDocument;
  operations: ArtifactEditOperation[];
  feedback: EditFeedback[];
}

export interface ArtifactEditSession<TDocument extends EditableArtifactDocument = EditableArtifactDocument> {
  schemaVersion: 1;
  sessionId: string;
  artifactId: string;
  baseArtifactVersionId?: string;
  version: number;
  document: TDocument;
  undoStack: Array<EditHistoryEntry<TDocument>>;
  redoStack: Array<EditHistoryEntry<TDocument>>;
  dirty: boolean;
  lastAutosavedAt?: string;
  lastCommittedAt?: string;
}

export interface EditTransactionInput {
  id: string;
  expectedVersion: number;
  label: string;
  boundary: Exclude<EditBoundary, "autosave">;
  operations: ArtifactEditOperation[];
  at?: string;
}

export function createArtifactEditSession<TDocument extends EditableArtifactDocument>(input: { sessionId: string; artifactId: string; document: TDocument; baseArtifactVersionId?: string }): ArtifactEditSession<TDocument> {
  if (!input.sessionId.trim() || !input.artifactId.trim()) throw new Error("Edit session and artifact ids are required.");
  const document = input.document.kind === "slides" ? createSlideDocument(input.document) : createWebDocument(input.document);
  return { schemaVersion: 1, sessionId: input.sessionId, artifactId: input.artifactId, baseArtifactVersionId: input.baseArtifactVersionId, version: 0, document: document as TDocument, undoStack: [], redoStack: [], dirty: false };
}

function expected(session: ArtifactEditSession, version: number) {
  if (session.version !== version) throw new Error(`Edit version conflict: expected ${version}, current version is ${session.version}.`);
}

export function applyEditTransaction<TDocument extends EditableArtifactDocument>(source: ArtifactEditSession<TDocument>, input: EditTransactionInput): ArtifactEditSession<TDocument> {
  expected(source, input.expectedVersion);
  if (!input.id.trim() || !input.label.trim()) throw new Error("Edit transaction id and label are required.");
  const session = structuredClone(source);
  const result = applyArtifactEdits(session.document, input.operations);
  const entry: EditHistoryEntry<TDocument> = { id: input.id, label: input.label, boundary: input.boundary, at: input.at ?? new Date().toISOString(), before: session.document, after: result.document, operations: structuredClone(input.operations), feedback: result.feedback };
  session.document = result.document;
  session.undoStack.push(entry);
  if (session.undoStack.length > EDIT_LIMITS.maxHistoryEntries) session.undoStack.splice(0, session.undoStack.length - EDIT_LIMITS.maxHistoryEntries);
  session.redoStack = [];
  session.version += 1;
  session.dirty = true;
  return session;
}

export function undoEditTransaction<TDocument extends EditableArtifactDocument>(source: ArtifactEditSession<TDocument>, expectedVersion: number): ArtifactEditSession<TDocument> {
  expected(source, expectedVersion);
  if (!source.undoStack.length) throw new Error("There is no edit to undo.");
  const session = structuredClone(source);
  const entry = session.undoStack.pop()!;
  session.document = entry.before;
  session.redoStack.push(entry);
  session.version += 1;
  session.dirty = true;
  return session;
}

export function redoEditTransaction<TDocument extends EditableArtifactDocument>(source: ArtifactEditSession<TDocument>, expectedVersion: number): ArtifactEditSession<TDocument> {
  expected(source, expectedVersion);
  if (!source.redoStack.length) throw new Error("There is no edit to redo.");
  const session = structuredClone(source);
  const entry = session.redoStack.pop()!;
  session.document = entry.after;
  session.undoStack.push(entry);
  session.version += 1;
  session.dirty = true;
  return session;
}

export function markEditAutosaved<TDocument extends EditableArtifactDocument>(source: ArtifactEditSession<TDocument>, expectedVersion: number, at = new Date().toISOString()): ArtifactEditSession<TDocument> {
  expected(source, expectedVersion);
  return { ...structuredClone(source), lastAutosavedAt: at };
}

export function markEditCommitted<TDocument extends EditableArtifactDocument>(source: ArtifactEditSession<TDocument>, expectedVersion: number, artifactVersionId: string, at = new Date().toISOString()): ArtifactEditSession<TDocument> {
  expected(source, expectedVersion);
  if (!artifactVersionId.trim()) throw new Error("A committed artifact version id is required.");
  return { ...structuredClone(source), baseArtifactVersionId: artifactVersionId, dirty: false, lastCommittedAt: at };
}

export function recoverArtifactEditSession(value: unknown): ArtifactEditSession {
  const session = structuredClone(value) as ArtifactEditSession;
  if (session?.schemaVersion !== 1 || !Number.isInteger(session.version) || session.version < 0 || !Array.isArray(session.undoStack) || !Array.isArray(session.redoStack)) throw new Error("The edit recovery journal is invalid.");
  const document = session.document?.kind === "slides" ? createSlideDocument(session.document) : session.document?.kind === "web" ? createWebDocument(session.document) : undefined;
  if (!document) throw new Error("The edit recovery journal has no supported document.");
  session.document = document;
  return session;
}
