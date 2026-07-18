import type { SlideDocument, SlideNode, SlidePage } from "./artifacts";

export interface SlideRenderNode {
  node: Exclude<SlideNode, { type: "group" }>;
  framePercent: { left: number; top: number; width: number; height: number };
}

export interface SlideRenderModel {
  documentId: string;
  slideId: string;
  name: string;
  dimensions: SlideDocument["dimensions"];
  nodes: SlideRenderNode[];
}

function stableByZIndex(page: SlidePage, nodes: SlideNode[]) {
  const sourceOrder = new Map(page.nodes.map((node, index) => [node.id, index]));
  return [...nodes].sort((left, right) => left.zIndex - right.zIndex || (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0));
}

/**
 * Flattens group metadata into the visual paint order. Child frames remain in
 * canonical slide coordinates; a group's own z-index orders its whole subtree.
 */
export function orderedSlideNodes(page: SlidePage): Array<Exclude<SlideNode, { type: "group" }>> {
  const byId = new Map(page.nodes.map((node) => [node.id, node]));
  const rendered = new Set<string>();
  const result: Array<Exclude<SlideNode, { type: "group" }>> = [];

  const visit = (node: SlideNode) => {
    if (node.type === "group") {
      for (const child of stableByZIndex(page, node.childIds.map((id) => byId.get(id)).filter((candidate): candidate is SlideNode => Boolean(candidate)))) visit(child);
      return;
    }
    if (!rendered.has(node.id)) {
      rendered.add(node.id);
      result.push(node);
    }
  };

  for (const root of stableByZIndex(page, page.nodes.filter((node) => !node.groupId))) visit(root);
  // Valid documents normally have no leftovers. Keeping this deterministic
  // fallback makes read-only rendering robust to older imported scene graphs.
  for (const node of stableByZIndex(page, page.nodes)) visit(node);
  return result;
}

export function createSlideRenderModel(document: SlideDocument, slideId: string): SlideRenderModel | undefined {
  const page = document.slides.find((candidate) => candidate.id === slideId);
  if (!page) return undefined;
  const { width, height } = document.dimensions;
  return {
    documentId: document.documentId,
    slideId: page.id,
    name: page.name,
    dimensions: structuredClone(document.dimensions),
    nodes: orderedSlideNodes(page).map((node) => ({
      node,
      framePercent: {
        left: node.frame.x / width * 100,
        top: node.frame.y / height * 100,
        width: node.frame.width / width * 100,
        height: node.frame.height / height * 100
      }
    }))
  };
}
