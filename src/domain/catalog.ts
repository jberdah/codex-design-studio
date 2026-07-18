import type { ArtifactActionCapabilities } from "./artifacts";
import type { ArtifactKind } from "./brand-system";
import type { BrandProfile, DesignTokens } from "./types";

export const TEMPLATE_CATEGORIES = [
  "Slides", "Mobile App", "Wireframe", "Document", "Animation", "UI Mockups", "Resume",
  "3D Object", "Research", "HTML Email", "Color and Type Pairing", "Diagram", "Flyer", "Web"
] as const;

export type TemplateCategory = typeof TEMPLATE_CATEGORIES[number];
export type CatalogOwnership = "builtin" | "project";

export interface CatalogProvenance {
  source: "curated" | "project" | "imported" | "duplicated";
  sourceId?: string;
  author: string;
  createdAt: string;
}

export interface CatalogLicense {
  name: string;
  spdxId?: string;
  url?: string;
}

export interface CatalogThumbnail {
  uri: string;
  alt: string;
}

interface VersionedCatalogManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  name: string;
  description: string;
  ownership: CatalogOwnership;
  provenance: CatalogProvenance;
  license: CatalogLicense;
  thumbnail: CatalogThumbnail;
}

export interface DesignSystemPreset extends VersionedCatalogManifest {
  kind: "design-system-preset";
  seed: { brand: BrandProfile; tokens: DesignTokens };
  tags: string[];
}

export interface TemplateDefinition<TStarter = unknown> extends VersionedCatalogManifest {
  kind: "template";
  category: TemplateCategory;
  artifactKind: ArtifactKind;
  adapterId: string;
  capabilities: ArtifactActionCapabilities;
  tags: string[];
  starter?: TStarter;
}

export interface CatalogFilter {
  query?: string;
  category?: TemplateCategory;
  artifactKind?: ArtifactKind;
  capability?: keyof Omit<ArtifactActionCapabilities, "exportFormats">;
  ownership?: CatalogOwnership;
}

export interface DesignSystemBootstrapInput {
  presetId?: string;
  /** Values produced by the source extraction pipeline before reconciliation. */
  extracted?: { brand?: Partial<BrandProfile>; tokens?: PartialDesignTokens };
  /** Explicit user input wins over preset and extracted values. */
  manual?: { brand?: Partial<BrandProfile>; tokens?: PartialDesignTokens };
}

export interface PartialDesignTokens {
  version?: string;
  colors?: Partial<DesignTokens["colors"]>;
  typography?: { display?: string; body?: string; scale?: Partial<DesignTokens["typography"]["scale"]> };
  spacing?: Partial<DesignTokens["spacing"]>;
  shape?: Partial<DesignTokens["shape"]>;
  media?: Partial<DesignTokens["media"]>;
  voice?: Partial<DesignTokens["voice"]>;
}

export interface PortableCatalogBundle {
  schemaVersion: 1;
  exportedAt: string;
  presets: DesignSystemPreset[];
  templates: TemplateDefinition[];
}
