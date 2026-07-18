import type { NavigationSettings, ProjectData, SelectionContext } from "@/domain/types";

export interface RefinementResult {
  project: ProjectData;
  summary: string;
  filesModified: string[];
  source: "codex" | "fallback";
  changed: boolean;
  unsupportedReason?: string;
}

export interface ProjectPatch {
  headline?: string | null;
  subhead?: string | null;
  eyebrow?: string | null;
  finalHeadline?: string | null;
  primaryCta?: string | null;
  colors?: Partial<ProjectData["tokens"]["colors"]> | null;
  visualDirection?: string | null;
  navigation?: NavigationSettings | null;
  unsupportedReason?: string | null;
  summary: string;
}

export function applyProjectPatch(project: ProjectData, patch: ProjectPatch, source: RefinementResult["source"]): RefinementResult {
  const next = structuredClone(project);
  let changed = false;
  const assign = <T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null | undefined) => {
    if (value !== null && value !== undefined && value !== target[key]) {
      target[key] = value;
      changed = true;
    }
  };
  assign(next.landing, "headline", patch.headline);
  assign(next.landing, "subhead", patch.subhead);
  assign(next.landing, "eyebrow", patch.eyebrow);
  assign(next.landing, "finalHeadline", patch.finalHeadline);
  assign(next.landing, "primaryCta", patch.primaryCta);
  if (patch.colors) {
    const colors = { ...next.tokens.colors, ...patch.colors };
    if (JSON.stringify(colors) !== JSON.stringify(next.tokens.colors)) {
      next.tokens.colors = colors;
      changed = true;
    }
  }
  assign(next.brand, "visualDirection", patch.visualDirection);
  if (patch.navigation && JSON.stringify(patch.navigation) !== JSON.stringify(next.landing.navigation)) {
    next.landing.navigation = structuredClone(patch.navigation);
    changed = true;
  }
  if (!changed) {
    return { project: next, summary: patch.summary, unsupportedReason: patch.unsupportedReason ?? undefined, filesModified: [], source, changed: false };
  }
  next.tokens.version = bumpPatch(next.tokens.version);
  next.version += 1;
  next.lastSummary = patch.summary;
  return { project: next, summary: patch.summary, filesModified: ["project.json", "design-system/tokens.json", "design-system/tokens.css", "web/index.html", "slides/deck.json"], source, changed: true };
}

function bumpPatch(version: string) {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

export function fallbackRefinement(project: ProjectData, instruction: string, selection?: SelectionContext): RefinementResult {
  const lower = instruction.toLowerCase();
  const patch: ProjectPatch = { summary: `Updated ${selection?.label ?? "the brand system"} from the contextual instruction.` };
  if (/(add|ajout|mettre|with).*(icon|icône)|(icon|icône).*(menu|navigation)/.test(lower) && (!selection || selection.designId === "navigation")) {
    patch.navigation = {
      showIcons: true,
      items: [
        { label: "Platform", icon: "layers" },
        { label: "Approach", icon: "compass" },
        { label: "Insights", icon: "chart" }
      ]
    };
    patch.summary = "Added accessible monoline icons to the web navigation menu while preserving every text label.";
  } else if (/violet|purple|lavender|prune/.test(lower)) {
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
    patch.subhead = `${project.brand.name} brings quiet precision to the decisions shaping your ${project.brand.industry.toLowerCase()} strategy.`;
    patch.visualDirection = "Quiet luxury, editorial restraint, precise spacing and subtle metallic accents";
    patch.summary = "Elevated the selected hero and shared tokens toward a quieter premium direction.";
  }
  if (/short|shorter|raccour|concis|concise/.test(lower)) {
    if (selection?.designId === "hero-copy") patch.subhead = `${project.brand.name} turns complexity into decisions your teams can act on.`;
    else patch.headline = "See clearly. Act decisively.";
    patch.summary = `Shortened the ${selection?.label ?? "hero message"} while preserving the brand voice.`;
  }
  if (/bold|impact|punch|fort/.test(lower)) {
    patch.headline = `${project.brand.promise.replace(/[.!?]+$/, "")} — impossible to ignore.`;
    patch.summary = "Strengthened the hero headline for a bolder launch narrative.";
  }
  const hasMutation = [patch.headline, patch.subhead, patch.eyebrow, patch.finalHeadline, patch.primaryCta, patch.colors, patch.visualDirection, patch.navigation].some((value) => value !== undefined && value !== null);
  if (!hasMutation) {
    patch.unsupportedReason = "This request cannot yet be represented by the Studio's safe semantic edit contract.";
    patch.summary = "No source change was applied.";
  }
  return applyProjectPatch(project, patch, "fallback");
}
