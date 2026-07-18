export * from "./repository";
export * from "./visual-assets";

import type { SlideDocument } from "./artifacts";

export type DeliverableType = "web" | "slides";

export interface BrandProfile {
  name: string;
  industry: string;
  audience: string;
  promise: string;
  personality: string[];
  tone: string;
  visualDirection: string;
}

export interface DesignTokens {
  version: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
  };
  typography: {
    display: string;
    body: string;
    scale: { h1: number; h2: number; body: number; caption: number };
  };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  shape: { radiusSm: number; radiusCard: number; radiusButton: number };
  media: { style: string; lighting: string; composition: string };
  voice: { attributes: string[]; forbiddenPatterns: string[] };
}

export type NavigationIcon = "layers" | "compass" | "chart" | "sparkles" | "leaf" | "arrow";

export interface NavigationSettings {
  showIcons: boolean;
  items: Array<{ label: string; icon: NavigationIcon }>;
}

export interface LandingContent {
  navigation: NavigationSettings;
  eyebrow: string;
  headline: string;
  subhead: string;
  primaryCta: string;
  secondaryCta: string;
  benefits: Array<{ title: string; body: string }>;
  proof: Array<{ value: string; label: string }>;
  finalHeadline: string;
}

export interface SlideSpec {
  id: string;
  type: "cover" | "value" | "metrics";
  eyebrow: string;
  title: string;
  body?: string;
  bullets?: string[];
  metrics?: Array<{ value: string; label: string }>;
}

export interface SelectionContext {
  deliverableId: string;
  designId: string;
  label: string;
  domPath: string;
  text: string;
  viewport: "desktop" | "mobile";
}

export interface ReviewCheck {
  id: string;
  label: string;
  status: "pass" | "warning" | "error";
  message: string;
  action?: string;
}

export interface ReviewReport {
  score: number;
  checks: ReviewCheck[];
  generatedAt: string;
}

export interface ProjectData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  brand: BrandProfile;
  tokens: DesignTokens;
  landing: LandingContent;
  slides: SlideSpec[];
  /** Canonical scene graph for direct manipulation; structured slides remain export-compatible. */
  slideDocument?: SlideDocument;
  threadId?: string;
  version: number;
  lastSummary?: string;
  /** True when Codex has edited the Web artifact beyond the structured template. */
  webCustomized?: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  brandName: string;
  industry: string;
  updatedAt: string;
  version: number;
}
