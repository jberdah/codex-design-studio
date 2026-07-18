import type { EvidenceKind } from "./sources";

export interface EvidenceCandidateInput {
  kind: EvidenceKind;
  value: string | number | boolean | string[] | Record<string, unknown>;
  confidence: number;
}

export interface ExtractionIssue {
  code: string;
  message: string;
  recoverable: boolean;
  provenance?: string;
}

export interface ExtractionResult {
  candidates: EvidenceCandidateInput[];
  issues: ExtractionIssue[];
}

export interface CaptureLimits {
  navigationTimeoutMs: number;
  maxRedirects: number;
  maxRequests: number;
  maxAssetBytes: number;
  maxTotalBytes: number;
  maxDomBytes: number;
  maxScreenshotBytes: number;
}

export interface CaptureViewport {
  name: "desktop" | "mobile";
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
}

export interface CapturedAsset {
  url: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  body?: Uint8Array;
}

export interface ElementObservation {
  tag: string;
  role: string;
  text: string;
  path: string;
  colors: string[];
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  margin: string;
  padding: string;
  gap: string;
  borderRadius: string;
  display: string;
  gridTemplateColumns: string;
  width: number;
  height: number;
  assetUrls: string[];
}

export interface PageObservation {
  title: string;
  lang: string;
  cssVariables: Record<string, string>;
  elements: ElementObservation[];
  logos: Array<{ path: string; url?: string; text?: string; width: number; height: number }>;
}

export interface CaptureArtifact {
  viewport: CaptureViewport;
  finalUrl: string;
  capturedAt: string;
  screenshot: Uint8Array;
  dom: string;
  assets: CapturedAsset[];
  observation: PageObservation;
  issues: ExtractionIssue[];
}

export interface CaptureManifest {
  schemaVersion: 1;
  requestedUrl: string;
  startedAt: string;
  finishedAt: string;
  captures: CaptureArtifact[];
}

export const DEFAULT_CAPTURE_LIMITS: CaptureLimits = Object.freeze({
  navigationTimeoutMs: 15_000,
  maxRedirects: 5,
  maxRequests: 150,
  maxAssetBytes: 5 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
  maxDomBytes: 2 * 1024 * 1024,
  maxScreenshotBytes: 12 * 1024 * 1024
});

export const DEFAULT_CAPTURE_VIEWPORTS: readonly CaptureViewport[] = Object.freeze([
  { name: "desktop", width: 1440, height: 1000, deviceScaleFactor: 1, isMobile: false },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1, isMobile: true }
]);
