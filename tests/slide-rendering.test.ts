import { describe, expect, it } from "vitest";
import { createSlideDocument, SLIDE_DIMENSIONS } from "@/domain/artifacts";
import { applyArtifactEdits } from "@/domain/editing";
import { createSlideRenderModel } from "@/domain/slide-rendering";

describe("scene graph slide rendering model", () => {
  it("uses edited physical frames, text and group-aware z-order", () => {
    const document = createSlideDocument({
      documentId: "render-model",
      dimensions: { ...SLIDE_DIMENSIONS.wide },
      slides: [{
        id: "scene", name: "Scene", nodes: [
          { id: "background", type: "shape", shape: "rectangle", fill: "#ffffff", frame: { x: 0, y: 0, width: 960, height: 540 }, zIndex: 0 },
          { id: "outside", type: "shape", shape: "ellipse", fill: "#00ff00", frame: { x: 300, y: 100, width: 80, height: 80 }, zIndex: 2 },
          { id: "copy", type: "group", childIds: ["headline", "accent"], frame: { x: 40, y: 60, width: 500, height: 200 }, zIndex: 4 },
          { id: "accent", type: "shape", shape: "line", stroke: "#ff0000", groupId: "copy", frame: { x: 40, y: 240, width: 500, height: 0 }, zIndex: 0 },
          { id: "headline", type: "text", text: "Before drag", editable: true, groupId: "copy", frame: { x: 40, y: 60, width: 400, height: 90 }, zIndex: 1, rotation: 8, opacity: 0.7, style: { fontSize: 34 } }
        ]
      }]
    });
    const edited = applyArtifactEdits(document, [
      { type: "slide.move", slideId: "scene", nodeIds: ["headline"], dx: 80, dy: 30 },
      { type: "slide.resize", slideId: "scene", nodeId: "headline", frame: { width: 520, height: 120 } },
      { type: "slide.text", slideId: "scene", nodeId: "headline", text: "After drag and resize" }
    ]).document;

    const model = createSlideRenderModel(edited, "scene")!;
    expect(model.nodes.map((item) => item.node.id)).toEqual(["background", "outside", "accent", "headline"]);
    expect(model.nodes.at(-1)?.node).toMatchObject({ text: "After drag and resize", rotation: 8, opacity: 0.7, frame: { x: 120, y: 90, width: 520, height: 120 } });
    expect(model.nodes.at(-1)?.framePercent).toEqual({ left: 12.5, top: 16.666666666666664, width: 54.166666666666664, height: 22.22222222222222 });
  });
});
