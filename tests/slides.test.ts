import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createSlideDocument, SLIDE_DIMENSIONS } from "@/domain/artifacts";
import { defaultProject } from "@/domain/defaults";
import { applyArtifactEdits } from "@/domain/editing";
import { generatePptx } from "@/server/slides";

describe("editable PowerPoint export", () => {
  it("creates a valid three-slide Open XML deck with editable text", async () => {
    const buffer = await generatePptx(structuredClone(defaultProject));
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(buffer.byteLength).toBeGreaterThan(20_000);
    expect(slideFiles).toHaveLength(3);
    const coverXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const valueXml = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(coverXml).toContain("Climate intelligence for decisions that matter");
    expect(coverXml).toContain("<a:t>");
    expect(valueXml).toContain("DECISION LOOP");
    expect(valueXml).toContain("From signal");
  });

  it("exports edited scene-graph geometry, type and paint order as editable OOXML", async () => {
    const project = structuredClone(defaultProject);
    const source = createSlideDocument({
      documentId: "edited-deck",
      dimensions: { ...SLIDE_DIMENSIONS.wide },
      slides: [{
        id: "edited", name: "Edited slide", notes: "Scene graph source", nodes: [
          { id: "background", type: "shape", shape: "rectangle", fill: "#fefefe", frame: { x: 0, y: 0, width: 960, height: 540 }, zIndex: 0 },
          { id: "marker", type: "shape", shape: "ellipse", fill: "#00aa88", frame: { x: 90, y: 70, width: 250, height: 120 }, zIndex: 1, name: "Marker behind copy" },
          { id: "copy", type: "group", childIds: ["headline"], frame: { x: 100, y: 70, width: 300, height: 90 }, zIndex: 3 },
          { id: "headline", type: "text", text: "Original export copy", editable: true, groupId: "copy", frame: { x: 100, y: 70, width: 300, height: 90 }, zIndex: 0, rotation: 12, opacity: 0.65, style: { fontFamily: "Arial", fontSize: 28, fontWeight: 700, color: "#123456", align: "center", lineHeight: 1.2, letterSpacing: 1.5 } }
        ]
      }]
    });
    project.slideDocument = applyArtifactEdits(source, [
      { type: "slide.move", slideId: "edited", nodeIds: ["headline"], dx: 23, dy: 17 },
      { type: "slide.resize", slideId: "edited", nodeId: "headline", frame: { width: 456, height: 111 } },
      { type: "slide.text", slideId: "edited", nodeId: "headline", text: "Dragged, resized, exported" }
    ]).document;

    const buffer = await generatePptx(project);
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const presentationXml = await zip.file("ppt/presentation.xml")!.async("string");
    const textShape = slideXml.split("</p:sp>").find((shape) => shape.includes("Dragged, resized, exported")) ?? "";

    expect(slideFiles).toHaveLength(1);
    expect(presentationXml).toContain('cx="12192000" cy="6858000"');
    expect(textShape).toContain("Dragged, resized, exported");
    expect(textShape).toContain('rot="720000"');
    expect(textShape).toContain('<a:off x="1562100" y="1104900"/>');
    expect(textShape).toContain('<a:ext cx="5791200" cy="1409700"/>');
    expect(textShape).toContain('sz="2800"');
    expect(textShape).toContain('val="123456"');
    expect(slideXml.indexOf("Marker behind copy")).toBeLessThan(slideXml.indexOf("Dragged, resized, exported"));
  });
});
