import PptxGenJS from "pptxgenjs";
import type { ProjectData, SlideSpec } from "@/domain/types";

const hex = (value: string) => value.replace("#", "").toUpperCase();

function addChrome(slide: PptxGenJS.Slide, project: ProjectData, index: number) {
  const { colors } = project.tokens;
  slide.background = { color: index === 0 ? hex(colors.primary) : hex(colors.background) };
  slide.addText(project.brand.name.toUpperCase(), { x: 0.55, y: 0.32, w: 2.8, h: 0.28, fontFace: project.tokens.typography.body, fontSize: 10, bold: true, color: index === 0 ? "FFFFFF" : hex(colors.primary), charSpacing: 2 });
  slide.addText(`0${index + 1}`, { x: 12.15, y: 0.32, w: 0.55, h: 0.28, align: "right", fontFace: project.tokens.typography.body, fontSize: 9, color: index === 0 ? "FFFFFF" : hex(colors.secondary), transparency: 15 });
}

function addCover(slide: PptxGenJS.Slide, project: ProjectData, spec: SlideSpec) {
  const { colors, typography } = project.tokens;
  slide.addShape("ellipse", { x: 9.3, y: 0.8, w: 4.2, h: 4.2, fill: { color: hex(colors.accent), transparency: 0 }, line: { transparency: 100 } });
  slide.addShape("ellipse", { x: 10.35, y: 1.85, w: 3.1, h: 3.1, fill: { color: hex(colors.secondary), transparency: 8 }, line: { transparency: 100 } });
  slide.addText(spec.eyebrow, { x: 0.72, y: 1.3, w: 5.5, h: 0.3, fontFace: typography.body, fontSize: 11, bold: true, color: hex(colors.accent), charSpacing: 2.2 });
  slide.addText(spec.title, { x: 0.72, y: 1.82, w: 8.25, h: 2.35, fontFace: typography.display, fontSize: 37, bold: false, color: "FFFFFF", breakLine: false, margin: 0.02, valign: "middle" });
  if (spec.body) slide.addText(spec.body, { x: 0.76, y: 4.65, w: 6.6, h: 0.8, fontFace: typography.body, fontSize: 15, color: "E8ECE8", margin: 0, breakLine: false });
  slide.addText("One brand system · Web + Slides", { x: 0.76, y: 6.65, w: 5, h: 0.28, fontFace: typography.body, fontSize: 10, color: "C5D1CD", charSpacing: 1 });
}

function addValue(slide: PptxGenJS.Slide, project: ProjectData, spec: SlideSpec) {
  const { colors, typography } = project.tokens;
  slide.addText(spec.eyebrow, { x: 0.72, y: 1.05, w: 4, h: 0.3, fontFace: typography.body, fontSize: 10, bold: true, color: hex(colors.secondary), charSpacing: 2 });
  slide.addText(spec.title, { x: 0.72, y: 1.55, w: 6.65, h: 1.55, fontFace: typography.display, fontSize: 31, color: hex(colors.primary), margin: 0, breakLine: false });
  (spec.bullets ?? []).forEach((bullet, index) => {
    const y = 3.55 + index * 0.8;
    slide.addShape("ellipse", { x: 0.75, y: y + 0.02, w: 0.28, h: 0.28, fill: { color: hex(colors.accent) }, line: { color: hex(colors.accent) } });
    slide.addText(`0${index + 1}`, { x: 0.77, y: y + 0.07, w: 0.24, h: 0.12, fontFace: typography.body, fontSize: 5.5, bold: true, color: hex(colors.primary), align: "center", margin: 0 });
    slide.addText(bullet, { x: 1.25, y, w: 5.75, h: 0.42, fontFace: typography.body, fontSize: 16, color: hex(colors.text), margin: 0 });
  });
  slide.addShape("roundRect", { x: 8.25, y: 1.2, w: 4.2, h: 4.95, rectRadius: 0.1, fill: { color: hex(colors.primary) }, line: { transparency: 100 } });
  slide.addText("DECISION LOOP", { x: 8.75, y: 1.62, w: 2.2, h: 0.22, fontFace: typography.body, fontSize: 8, bold: true, color: hex(colors.accent), charSpacing: 1.8, margin: 0 });
  slide.addShape("ellipse", { x: 9.05, y: 2.02, w: 2.35, h: 2.35, fill: { color: hex(colors.primary), transparency: 100 }, line: { color: hex(colors.accent), width: 2, transparency: 5 } });
  slide.addShape("ellipse", { x: 9.68, y: 2.65, w: 1.08, h: 1.08, fill: { color: hex(colors.secondary), transparency: 2 }, line: { transparency: 100 } });
  slide.addShape("ellipse", { x: 10.92, y: 2.27, w: 0.28, h: 0.28, fill: { color: hex(colors.accent) }, line: { transparency: 100 } });
  slide.addShape("line", { x: 8.8, y: 4.45, w: 3.05, h: 0, line: { color: "FFFFFF", transparency: 70, width: 1 } });
  slide.addText("From signal\nto action", { x: 8.8, y: 4.7, w: 3.1, h: 0.8, fontFace: typography.display, fontSize: 24, color: "FFFFFF", margin: 0, breakLine: false });
}

function addMetrics(slide: PptxGenJS.Slide, project: ProjectData, spec: SlideSpec) {
  const { colors, typography } = project.tokens;
  slide.addText(spec.eyebrow, { x: 0.72, y: 1.05, w: 4, h: 0.3, fontFace: typography.body, fontSize: 10, bold: true, color: hex(colors.secondary), charSpacing: 2 });
  slide.addText(spec.title, { x: 0.72, y: 1.55, w: 8, h: 1.1, fontFace: typography.display, fontSize: 34, color: hex(colors.primary), margin: 0 });
  (spec.metrics ?? []).forEach((metric, index) => {
    const x = 0.72 + index * 4.05;
    slide.addShape("line", { x, y: 3.25, w: 3.35, h: 0, line: { color: hex(index === 1 ? colors.accent : colors.secondary), width: 2 } });
    slide.addText(metric.value, { x, y: 3.55, w: 3.35, h: 1.05, fontFace: typography.display, fontSize: 42, color: hex(colors.primary), margin: 0 });
    slide.addText(metric.label, { x, y: 4.72, w: 2.8, h: 0.5, fontFace: typography.body, fontSize: 13, color: hex(colors.text), margin: 0 });
  });
  slide.addText("The same source of truth powers every output.", { x: 0.72, y: 6.55, w: 6.5, h: 0.3, fontFace: typography.body, fontSize: 11, color: hex(colors.secondary), charSpacing: 0.6 });
}

export async function generatePptx(project: ProjectData): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Codex Design Studio";
  pptx.subject = `Brand launch deck for ${project.brand.name}`;
  pptx.title = `${project.brand.name} launch narrative`;
  pptx.company = project.brand.name;
  pptx.defineSlideMaster({ title: "BASE", background: { color: hex(project.tokens.colors.background) }, objects: [] });
  project.slides.forEach((spec, index) => {
    const slide = pptx.addSlide("BASE");
    addChrome(slide, project, index);
    if (spec.type === "cover") addCover(slide, project, spec);
    if (spec.type === "value") addValue(slide, project, spec);
    if (spec.type === "metrics") addMetrics(slide, project, spec);
    slide.addNotes(`Generated from design-system/tokens.json version ${project.tokens.version}.`);
  });
  const output = await pptx.write({ outputType: "nodebuffer", compression: true });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}
