import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CaptureManifest, ExtractionResult } from "@/domain/extraction";
import type { Source } from "@/domain/sources";
import { safeProjectPath } from "./paths";
import { loadProvenanceGraph, updateExtractionRun } from "./source-store";
import { analyzeImageAsset, extractCodeRealityEvidence, extractCodeRealityMapSource, extractDocumentEvidence, extractWebEvidence, type CodeRealityMapEntry } from "./evidence-extractors";
import { captureFileName, captureReferencePage, type CaptureOptions } from "./web-capture";

export interface ExtractionWorkerOptions {
  capture?: CaptureOptions;
}

function withIssues(result: ExtractionResult) {
  if (!result.issues.length) return result.candidates;
  return [...result.candidates, {
    kind: "metadata" as const,
    value: { evidenceType: "extraction-issues", issues: result.issues },
    confidence: 1
  }];
}

async function persistCapture(projectId: string, source: Source, runId: string, capture: CaptureManifest) {
  const root = await safeProjectPath(projectId, "sources", "captures", source.id, runId);
  const assetRoot = path.join(root, "assets");
  await mkdir(assetRoot, { recursive: true });
  const serializable = {
    schemaVersion: capture.schemaVersion, requestedUrl: capture.requestedUrl, startedAt: capture.startedAt, finishedAt: capture.finishedAt,
    captures: [] as Array<Record<string, unknown>>
  };
  for (const artifact of capture.captures) {
    const screenshotName = captureFileName(artifact, "png");
    const domName = captureFileName(artifact, "html");
    const observationName = captureFileName(artifact, "json");
    await Promise.all([
      writeFile(path.join(root, screenshotName), artifact.screenshot),
      writeFile(path.join(root, domName), artifact.dom, "utf8"),
      writeFile(path.join(root, observationName), `${JSON.stringify(artifact.observation, null, 2)}\n`, "utf8")
    ]);
    for (const asset of artifact.assets) {
      if (asset.body) await writeFile(path.join(assetRoot, asset.sha256), asset.body, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    }
    serializable.captures.push({
      viewport: artifact.viewport, finalUrl: artifact.finalUrl, capturedAt: artifact.capturedAt,
      screenshot: screenshotName, dom: domName, observation: observationName, issues: artifact.issues,
      assets: artifact.assets.map(({ body: _body, ...asset }) => ({ ...asset, blobPath: `assets/${asset.sha256}` }))
    });
  }
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(serializable, null, 2)}\n`, "utf8");
  return path.relative(await safeProjectPath(projectId), manifestPath);
}

async function runSource(projectId: string, source: Source, runId: string, bytes: Uint8Array, options: ExtractionWorkerOptions, existingWeb: ExtractionResult, codeEntries: CodeRealityMapEntry[]) {
  if (source.kind === "url") {
    const url = Buffer.from(bytes).toString("utf8").trim();
    const capture = await captureReferencePage(url, options.capture);
    const result = extractWebEvidence(capture);
    if (codeEntries.length) {
      const reconciliation = extractCodeRealityEvidence({ entries: codeEntries }, result).candidates.find((item) => (item.value as { evidenceType?: string }).evidenceType === "capture-code-reconciliation");
      if (reconciliation) result.candidates.push(reconciliation);
    }
    const manifestPath = await persistCapture(projectId, source, runId, capture);
    result.candidates.push({ kind: "metadata", value: { evidenceType: "capture-manifest", manifestPath, finalUrls: capture.captures.map((item) => item.finalUrl) }, confidence: 1 });
    return result;
  }
  if (["logo", "image", "screenshot"].includes(source.kind)) {
    return analyzeImageAsset(bytes, source.origin.fileName ?? source.label, source.origin.mediaType);
  }
  if (["document", "deck", "spreadsheet"].includes(source.kind)) {
    return extractDocumentEvidence(bytes, source.origin.fileName ?? source.label);
  }
  if (source.kind === "codebase") {
    return extractCodeRealityMapSource(bytes, existingWeb);
  }
  return { candidates: [], issues: [{ code: "unsupported_source", message: `No extraction worker is needed for ${source.kind} sources.`, recoverable: true }] };
}

/** Processes one already-queued durable run. Source text is always treated as untrusted data. */
export async function processExtractionRun(projectId: string, runId: string, options: ExtractionWorkerOptions = {}) {
  const graph = await loadProvenanceGraph(projectId);
  const run = graph.extractionRuns.find((item) => item.id === runId);
  if (!run) throw new Error("Extraction run not found.");
  const source = graph.sources.find((item) => item.id === run.sourceId && item.status !== "deleted");
  if (!source) throw new Error("Source not found.");
  await updateExtractionRun(projectId, runId, { status: "running", progress: 5, phase: "validating source" });
  try {
    const blobPath = await safeProjectPath(projectId, ...source.storage.blobPath.split("/"));
    const bytes = new Uint8Array(await readFile(blobPath));
    const existingWeb: ExtractionResult = { candidates: graph.candidates.filter((item) => {
      const type = item.value && typeof item.value === "object" && !Array.isArray(item.value) ? (item.value as { evidenceType?: string }).evidenceType : undefined;
      return ["computed-colors", "computed-typography", "css-variables", "asset-usage", "logo-usage", "layout-system", "recurring-components"].includes(type ?? "");
    }).map(({ kind, value, confidence }) => ({ kind, value, confidence })), issues: [] };
    const codeEntries = graph.candidates.flatMap((item) => item.value && typeof item.value === "object" && !Array.isArray(item.value) && (item.value as { evidenceType?: string }).evidenceType === "code-reality-map" ? [(item.value as unknown as { entry: CodeRealityMapEntry }).entry] : []);
    const result = await runSource(projectId, source, runId, bytes, options, existingWeb, codeEntries);
    return updateExtractionRun(projectId, runId, { status: "succeeded", progress: 100, phase: result.issues.length ? "completed with partial results" : "completed", candidates: withIssues(result) });
  } catch (error) {
    return updateExtractionRun(projectId, runId, {
      status: "failed", phase: "extraction failed",
      error: { code: "extraction_failed", message: error instanceof Error ? error.message : "Extraction failed.", recoverable: true }
    });
  }
}
