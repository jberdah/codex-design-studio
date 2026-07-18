import PptxGenJS from "pptxgenjs";
import { createSlideDocument, type SlideDocument, type SlideMediaNode, type SlideNode, type SlideShapeNode, type SlideTextNode } from "@/domain/artifacts";
import { orderedSlideNodes } from "@/domain/slide-rendering";
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

function clampedOpacity(value?: number) {
  return Math.max(0, Math.min(1, value ?? 1));
}

function transparency(node: SlideNode) {
  return Math.round((1 - clampedOpacity(node.opacity)) * 100);
}

function color(value: string | undefined, fallback: string) {
  const normalized = (value ?? fallback).trim();
  const short = normalized.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i);
  if (short) return `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const full = normalized.match(/^#?([a-f\d]{6})$/i);
  return (full?.[1] ?? fallback.replace("#", "")).toUpperCase();
}

function sceneFrame(node: SlideNode) {
  return {
    x: node.frame.x / 72,
    y: node.frame.y / 72,
    w: node.frame.width / 72,
    h: node.frame.height / 72,
    rotate: node.rotation,
    objectName: node.name ?? node.id
  };
}

function addSceneText(slide: PptxGenJS.Slide, project: ProjectData, node: SlideTextNode) {
  const style = node.style ?? {};
  slide.addText(node.text, {
    ...sceneFrame(node),
    fontFace: style.fontFamily ?? project.tokens.typography.body,
    fontSize: style.fontSize ?? 18,
    bold: style.fontWeight !== undefined ? style.fontWeight >= 600 : false,
    color: color(style.color, project.tokens.colors.text),
    align: style.align ?? "left",
    lineSpacingMultiple: style.lineHeight,
    charSpacing: style.letterSpacing,
    transparency: transparency(node),
    margin: 0,
    valign: "top",
    fit: "shrink"
  });
}

function addSceneShape(slide: PptxGenJS.Slide, project: ProjectData, node: SlideShapeNode) {
  const alpha = transparency(node);
  const shape = node.shape === "ellipse" ? "ellipse" : node.shape === "line" ? "line" : "rect";
  const fill = node.shape === "line" || !node.fill ? { transparency: 100 } : { color: color(node.fill, project.tokens.colors.background), transparency: alpha };
  const line = node.stroke ? { color: color(node.stroke, project.tokens.colors.text), transparency: alpha, width: 1 } : { transparency: 100 };
  // PptxGenJS cannot round-trip arbitrary SVG path data. Path nodes therefore
  // remain editable frame-preserving rectangles until a native freeform mapper
  // is available; all supported geometry is emitted directly.
  slide.addShape(shape, { ...sceneFrame(node), fill, line });
}

function embeddedImage(uri: string) {
  const match = uri.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z\d+/=]+)$/i);
  return match && uri.length <= 8_000_000 ? `${match[1]};base64,${match[2]}` : undefined;
}

function addSceneMedia(slide: PptxGenJS.Slide, project: ProjectData, node: SlideMediaNode) {
  const frame = sceneFrame(node);
  const data = node.mediaType === "image" ? embeddedImage(node.source.uri) : undefined;
  if (data) {
    slide.addImage({ ...frame, data, altText: node.altText, transparency: transparency(node) });
    return;
  }
  // Portable project:// and asset:// references require a project asset
  // resolver. Until one is supplied, keep their frame and description as
  // editable PowerPoint elements instead of dereferencing untrusted URIs.
  slide.addShape("rect", {
    ...frame,
    fill: { color: color(project.tokens.colors.background, "FFFFFF"), transparency: Math.min(85, transparency(node) + 55) },
    line: { color: color(project.tokens.colors.secondary, "777777"), transparency: transparency(node), width: 1 }
  });
  slide.addText(node.altText || node.mediaType, {
    ...frame,
    objectName: `${node.name ?? node.id} description`,
    fontFace: project.tokens.typography.body,
    fontSize: 10,
    color: color(project.tokens.colors.text, "17161B"),
    transparency: transparency(node),
    align: "center",
    valign: "middle",
    margin: 4,
    fit: "shrink"
  });
}

function addSceneGraphSlides(pptx: PptxGenJS, project: ProjectData, document: SlideDocument) {
  for (const page of document.slides) {
    const slide = pptx.addSlide();
    for (const node of orderedSlideNodes(page)) {
      if (node.type === "text") addSceneText(slide, project, node);
      else if (node.type === "shape") addSceneShape(slide, project, node);
      else addSceneMedia(slide, project, node);
    }
    slide.addNotes(page.notes ?? `Generated from the editable scene graph and design-system/tokens.json version ${project.tokens.version}.`);
  }
}

export async function generatePptx(project: ProjectData): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.author = "Codex Design Studio";
  pptx.subject = `Brand launch deck for ${project.brand.name}`;
  pptx.title = `${project.brand.name} launch narrative`;
  pptx.company = project.brand.name;
  if (project.slideDocument) {
    const document = createSlideDocument(project.slideDocument);
    pptx.defineLayout({ name: "SCENE_GRAPH", width: document.dimensions.width / 72, height: document.dimensions.height / 72 });
    pptx.layout = "SCENE_GRAPH";
    addSceneGraphSlides(pptx, project, document);
    const output = await pptx.write({ outputType: "nodebuffer", compression: true });
    return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
  }
  pptx.layout = "LAYOUT_WIDE";
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
