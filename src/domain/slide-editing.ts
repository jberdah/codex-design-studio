import { createSlideDocument, SLIDE_DIMENSIONS, type SlideDocument, type SlideTextNode } from "./artifacts";
import type { ProjectData, SlideSpec } from "./types";

function text(id: string, value: string, x: number, y: number, width: number, height: number, zIndex: number, style: SlideTextNode["style"] = {}): SlideTextNode {
  return { id, type: "text", text: value, editable: true, frame: { x, y, width, height }, zIndex, style };
}

/** Adapts the structured presentation source into the physical scene graph used by direct manipulation. */
export function projectSlideDocument(project: ProjectData): SlideDocument {
  if (project.slideDocument) return createSlideDocument(project.slideDocument);
  return createSlideDocument({
    documentId: `${project.id}-deck`, dimensions: { ...SLIDE_DIMENSIONS.wide }, slides: project.slides.map((slide, index) => ({
      id: slide.id, name: `Slide ${index + 1}`, nodes: [
        { id: `${slide.id}:background`, type: "shape", shape: "rectangle", fill: project.tokens.colors.background, frame: { x: 0, y: 0, width: 960, height: 540 }, zIndex: 0 },
        text(`${slide.id}:brand`, project.brand.name.toUpperCase(), 44, 28, 300, 20, 1, { fontFamily: project.tokens.typography.body, fontSize: 12, fontWeight: 700, color: project.tokens.colors.primary }),
        text(`${slide.id}:eyebrow`, slide.eyebrow, 72, 128, 620, 24, 2, { fontFamily: project.tokens.typography.body, fontSize: 13, fontWeight: 700, color: project.tokens.colors.secondary, letterSpacing: 2 }),
        text(`${slide.id}:title`, slide.title, 72, 164, slide.type === "cover" ? 680 : 760, 165, 3, { fontFamily: project.tokens.typography.display, fontSize: slide.type === "cover" ? 50 : 42, fontWeight: 700, lineHeight: 1.02, color: project.tokens.colors.text }),
        ...(slide.body ? [text(`${slide.id}:body`, slide.body, 74, 340, 600, 75, 4, { fontFamily: project.tokens.typography.body, fontSize: 18, lineHeight: 1.35, color: project.tokens.colors.text })] : []),
        ...(slide.bullets ? [text(`${slide.id}:bullets`, slide.bullets.map((item) => `• ${item}`).join("\n"), 74, 326, 690, 130, 4, { fontFamily: project.tokens.typography.body, fontSize: 18, lineHeight: 1.55, color: project.tokens.colors.text })] : []),
        ...(slide.metrics ?? []).flatMap((metric, metricIndex) => [
          text(`${slide.id}:metric:${metricIndex}:value`, metric.value, 72 + metricIndex * 270, 340, 230, 60, 4, { fontFamily: project.tokens.typography.display, fontSize: 42, fontWeight: 700, color: project.tokens.colors.primary }),
          text(`${slide.id}:metric:${metricIndex}:label`, metric.label, 72 + metricIndex * 270, 405, 230, 36, 5, { fontFamily: project.tokens.typography.body, fontSize: 15, color: project.tokens.colors.text })
        ])
      ]
    }))
  });
}

/** Synchronizes edited scene text back to structured slide source used by PPTX export. */
export function projectWithSlideDocument(project: ProjectData, document: SlideDocument): ProjectData {
  const next = structuredClone(project);
  next.slideDocument = createSlideDocument(document);
  const values = new Map(document.slides.flatMap((page) => page.nodes.filter((node): node is SlideTextNode => node.type === "text").map((node) => [node.id, node.text])));
  next.slides = next.slides.map((slide): SlideSpec => {
    const updated = { ...slide, eyebrow: values.get(`${slide.id}:eyebrow`) ?? slide.eyebrow, title: values.get(`${slide.id}:title`) ?? slide.title };
    if (updated.body !== undefined) updated.body = values.get(`${slide.id}:body`) ?? updated.body;
    if (updated.bullets) updated.bullets = (values.get(`${slide.id}:bullets`) ?? updated.bullets.join("\n")).split("\n").map((item) => item.replace(/^\s*•\s*/, "")).filter(Boolean);
    if (updated.metrics) updated.metrics = updated.metrics.map((metric, index) => ({ value: values.get(`${slide.id}:metric:${index}:value`) ?? metric.value, label: values.get(`${slide.id}:metric:${index}:label`) ?? metric.label }));
    return updated;
  });
  return next;
}
