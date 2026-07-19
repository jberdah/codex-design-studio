import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-extractor-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

describe("durable extraction worker", () => {
  it("processes an immutable logo blob into deterministic proposed evidence", async () => {
    const { addSource, loadProvenanceGraph } = await import("@/server/source-store");
    const { processExtractionRun } = await import("@/server/extraction-worker");
    const png = PNG.sync.write({ width: 2, height: 1, data: new Uint8Array([18, 52, 86, 255, 18, 52, 86, 0]) });
    const added = await addSource("worker", {
      kind: "logo", label: "Primary logo", content: png,
      origin: { type: "upload", fileName: "logo.png", mediaType: "image/png" },
      rightsConfirmed: true, rightsNotes: "Client-owned original"
    });
    await processExtractionRun("worker", added.run.id);
    const graph = await loadProvenanceGraph("worker");
    expect(graph.sources[0]).toMatchObject({ status: "ready", contentHash: added.source.contentHash });
    expect(graph.extractionRuns[0]).toMatchObject({ status: "succeeded", progress: 100 });
    expect(graph.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "metadata", value: expect.objectContaining({ evidenceType: "original-asset", original: expect.objectContaining({ preservation: "original-bytes" }) }) }),
      expect.objectContaining({ kind: "visual", value: expect.objectContaining({ evidenceType: "image-variant" }) })
    ]));
  });
});
