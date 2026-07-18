import type { DesignTokens, ProjectData, ReviewCheck, ReviewReport } from "@/domain/types";

function luminance(hex: string) {
  const values = hex.replace("#", "").match(/.{2}/g)?.map((part) => parseInt(part, 16) / 255) ?? [0, 0, 0];
  const linear = values.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export function validHexColors(tokens: DesignTokens) {
  return Object.values(tokens.colors).every((color) => /^#[0-9a-f]{6}$/i.test(color));
}

export function reviewProject(project: ProjectData): ReviewReport {
  const checks: ReviewCheck[] = [];
  checks.push({ id: "tokens.colors", label: "Token colours", status: validHexColors(project.tokens) ? "pass" : "error", message: validHexColors(project.tokens) ? "All colour tokens are valid hex values." : "One or more colour tokens are invalid.", action: "Use six-digit hex values." });
  const bodyContrast = contrastRatio(project.tokens.colors.text, project.tokens.colors.background);
  checks.push({ id: "accessibility.contrast", label: "Text contrast", status: bodyContrast >= 4.5 ? "pass" : bodyContrast >= 3 ? "warning" : "error", message: `Body contrast ratio is ${bodyContrast.toFixed(2)}:1.`, action: bodyContrast < 4.5 ? "Darken the text token or lighten the background." : undefined });
  const sectionsPresent = project.landing.benefits.length >= 3 && project.landing.proof.length >= 3 && Boolean(project.landing.finalHeadline);
  checks.push({ id: "web.structure", label: "Landing structure", status: sectionsPresent ? "pass" : "error", message: sectionsPresent ? "Hero, benefits, proof and final CTA are present." : "Required landing sections are incomplete." });
  const slideTypes = new Set(project.slides.map((slide) => slide.type));
  checks.push({ id: "slides.structure", label: "Slide structure", status: project.slides.length === 3 && slideTypes.size === 3 ? "pass" : "error", message: project.slides.length === 3 && slideTypes.size === 3 ? "Cover, value and metrics slides are present." : "The deck must contain exactly three distinct slide types." });
  const overflowRisk = project.slides.some((slide) => slide.title.length > 72 || (slide.body?.length ?? 0) > 180 || (slide.bullets ?? []).some((bullet) => bullet.length > 90));
  checks.push({ id: "slides.overflow", label: "Slide overflow risk", status: overflowRisk ? "warning" : "pass", message: overflowRisk ? "Long slide copy may overflow the template." : "All slide copy fits the template limits.", action: overflowRisk ? "Shorten the highlighted copy." : undefined });
  const failures = checks.filter((check) => check.status === "error").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  return { score: Math.max(0, 100 - failures * 25 - warnings * 8), checks, generatedAt: new Date().toISOString() };
}
