import type { ProjectData, SelectionContext } from "@/domain/types";

export interface RefinementResult {
  project: ProjectData;
  summary: string;
  filesModified: string[];
  source: "codex" | "fallback";
}

export interface ProjectPatch {
  headline?: string | null;
  subhead?: string | null;
  eyebrow?: string | null;
  finalHeadline?: string | null;
  primaryCta?: string | null;
  colors?: Partial<ProjectData["tokens"]["colors"]> | null;
  visualDirection?: string | null;
  summary: string;
}

export function applyProjectPatch(project: ProjectData, patch: ProjectPatch, source: RefinementResult["source"]): RefinementResult {
  const next = structuredClone(project);
  if (patch.headline) next.landing.headline = patch.headline;
  if (patch.subhead) next.landing.subhead = patch.subhead;
  if (patch.eyebrow) next.landing.eyebrow = patch.eyebrow;
  if (patch.finalHeadline) next.landing.finalHeadline = patch.finalHeadline;
  if (patch.primaryCta) next.landing.primaryCta = patch.primaryCta;
  if (patch.colors) next.tokens.colors = { ...next.tokens.colors, ...patch.colors };
  if (patch.visualDirection) next.brand.visualDirection = patch.visualDirection;
  next.tokens.version = bumpPatch(next.tokens.version);
  next.version += 1;
  next.lastSummary = patch.summary;
  return { project: next, summary: patch.summary, filesModified: ["project.json", "design-system/tokens.json", "design-system/tokens.css", "web/index.html", "slides/deck.json"], source };
}

function bumpPatch(version: string) {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

export function fallbackRefinement(project: ProjectData, instruction: string, selection?: SelectionContext): RefinementResult {
  const lower = instruction.toLowerCase();
  const patch: ProjectPatch = { summary: `Updated ${selection?.label ?? "the brand system"} from the contextual instruction.` };
  if (/violet|purple|lavender|prune/.test(lower)) {
    patch.colors = { primary: "#35245F", secondary: "#806AA6", accent: "#F3D36B", background: "#F5F1F7", text: "#211A2D" };
    patch.visualDirection = "Premium editorial composition with violet depth and restrained gold accents";
    patch.summary = "Shifted the shared brand palette to premium violet and gold across web and slides.";
  } else if (/warm|warmer|chaleur|chaud|terracotta/.test(lower)) {
    patch.colors = { primary: "#522D26", secondary: "#A2634F", accent: "#F5C96A", background: "#F6EFE7", text: "#291C18" };
    patch.visualDirection = "Warm editorial composition with terracotta and soft daylight";
    patch.summary = "Warmed the shared brand direction with terracotta and amber tones.";
  } else if (/premium|luxury|élégant|elegant|sophisticat/.test(lower)) {
    patch.colors = { primary: "#20222C", secondary: "#777165", accent: "#DCCB9A", background: "#F5F2EA", text: "#181A20" };
    patch.headline = "Clarity, elevated.";
    patch.subhead = "Asteria brings quiet precision to the decisions shaping your climate strategy.";
    patch.visualDirection = "Quiet luxury, editorial restraint, precise spacing and subtle metallic accents";
    patch.summary = "Elevated the selected hero and shared tokens toward a quieter premium direction.";
  }
  if (/short|shorter|raccour|concis|concise/.test(lower)) {
    if (selection?.designId === "hero-copy") patch.subhead = "Turn climate data into decisions your teams can act on.";
    else patch.headline = "See clearly. Act decisively.";
    patch.summary = `Shortened the ${selection?.label ?? "hero message"} while preserving the brand voice.`;
  }
  if (/bold|impact|punch|fort/.test(lower)) {
    patch.headline = "Make climate progress impossible to ignore.";
    patch.summary = "Strengthened the hero headline for a bolder launch narrative.";
  }
  return applyProjectPatch(project, patch, "fallback");
}
