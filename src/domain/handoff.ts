export const HANDOFF_BUNDLE_SCHEMA = "codex-design-handoff/v1" as const;

export type HandoffFileRole = "artifact-source" | "code-reality-map" | "screenshot" | "test";

export interface HandoffSourceFile {
  /** Project-relative path. Absolute paths and traversal are rejected. */
  path: string;
  role: HandoffFileRole;
  /** Optional portable name inside the role directory. */
  name?: string;
}

export interface HandoffBundleInput {
  designIntent: string;
  implementationInstructions: string;
  brandSystemVersionId: string;
  files: HandoffSourceFile[];
}

export interface HandoffBundleFile {
  path: string;
  role: "design-intent" | "implementation-instructions" | "brand-system" | HandoffFileRole;
  byteLength: number;
  sha256: string;
  sourcePath?: string;
}

export interface HandoffBundleManifest {
  schema: typeof HANDOFF_BUNDLE_SCHEMA;
  schemaVersion: 1;
  bundleId: string;
  projectId: string;
  brandSystemVersion: { id: string; number: number; contentHash: string };
  /** Stable source timestamp. ZIP metadata is fixed so equal inputs produce equal bytes. */
  createdAt: string;
  files: HandoffBundleFile[];
}

export interface HandoffBundleResult {
  manifest: HandoffBundleManifest;
  path: string;
  byteLength: number;
  sha256: string;
}

