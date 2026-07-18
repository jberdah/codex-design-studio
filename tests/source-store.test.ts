import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvenanceGraph, Source } from "@/domain/sources";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-sources-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true });
});

describe("portable source and provenance store", () => {
  it("accepts mixed sources and deduplicates identical originals by content hash", async () => {
    const { addManualEvidence, addSource, loadProvenanceGraph, queueExtraction } = await import("@/server/source-store");
    const original = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const first = await addSource("mixed", {
      kind: "logo",
      label: "Primary logo",
      content: original,
      origin: { type: "upload", fileName: "logo.png", mediaType: "image/png" },
      intent: "extract-and-inspire",
      rightsNotes: "Client owned",
      rightsConfirmed: true
    });
    const duplicate = await addSource("mixed", {
      kind: "image",
      label: "The same bytes again",
      content: original,
      origin: { type: "upload", fileName: "copy.png", mediaType: "image/png" }
    });
    const website = await addSource("mixed", {
      kind: "url",
      label: "Brand site",
      content: Buffer.from("https://example.test/brand"),
      origin: { type: "url", locator: "https://example.test/brand", mediaType: "text/uri-list" },
      intent: "extract"
    });
    await queueExtraction("mixed", website.source.id, "refresh");
    await addManualEvidence("mixed", { kind: "accessibility", value: "Text must meet WCAG AA", directive: "must-use" });

    const graph = await loadProvenanceGraph("mixed");
    expect(duplicate).toMatchObject({ deduplicated: true, source: { id: first.source.id } });
    expect(graph.sources).toHaveLength(3);
    expect(graph.evidence).toEqual([expect.objectContaining({ kind: "accessibility", directive: "must-use", confidence: { score: 1, method: "manual" } })]);
    expect(await readdir(path.join(workspace, "projects", "mixed", "sources", "blobs"))).toHaveLength(3);
    expect(graph.sources[0]).toHaveProperty("rights.notes");
    expect(graph.sources[0]).toHaveProperty("intent");
    expect(graph.audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: "source.refreshed", sourceId: website.source.id })]));
  });

  it("soft-deletes a source while preserving its original and published system", async () => {
    const { addSource, loadProvenanceGraph, removeSource } = await import("@/server/source-store");
    const added = await addSource("deleted", {
      kind: "document",
      label: "Guidelines",
      content: Buffer.from("immutable brand guideline"),
      origin: { type: "upload", fileName: "guidelines.pdf", mediaType: "application/pdf" }
    });
    const projectPath = path.join(workspace, "projects", "deleted", "project.json");
    const publishedBefore = await readFile(projectPath, "utf8");
    const blobPath = path.join(workspace, "projects", "deleted", added.source.storage.blobPath);

    await removeSource("deleted", added.source.id);
    const graph = await loadProvenanceGraph("deleted");

    expect(graph.sources[0]).toMatchObject({ status: "deleted" });
    expect(graph.sources[0].removedAt).toBeTruthy();
    expect(await readFile(blobPath, "utf8")).toBe("immutable brand guideline");
    expect(await readFile(projectPath, "utf8")).toBe(publishedBefore);

    const restored = await addSource("deleted", {
      kind: "document",
      label: "Guidelines restored",
      content: Buffer.from("immutable brand guideline"),
      origin: { type: "upload", fileName: "guidelines.pdf", mediaType: "application/pdf" }
    });
    expect(restored).toMatchObject({ deduplicated: true, source: { id: added.source.id, status: "queued" } });
    expect((await loadProvenanceGraph("deleted")).sources).toHaveLength(1);
  });

  it("persists recoverable failures, retries, progress, candidates and cancellation", async () => {
    const { addSource, cancelExtraction, decideCandidate, loadProvenanceGraph, queueExtraction, updateExtractionRun } = await import("@/server/source-store");
    const { source, run } = await addSource("recovery", {
      kind: "spreadsheet",
      label: "Palette inventory",
      content: Buffer.from("name,hex\nprimary,#112233"),
      origin: { type: "upload", fileName: "colors.csv", mediaType: "text/csv" }
    });
    await updateExtractionRun("recovery", run.id, { status: "running", progress: 35, phase: "reading rows" });
    await updateExtractionRun("recovery", run.id, { status: "failed", progress: 35, phase: "parse failed", error: { code: "bad_row", message: "A row is malformed", recoverable: true } });
    const retry = await queueExtraction("recovery", source.id, "retry");
    await updateExtractionRun("recovery", retry.id, { status: "running", progress: 70, phase: "normalizing" });
    await updateExtractionRun("recovery", retry.id, { status: "succeeded", candidates: [{ kind: "color", value: "#112233", confidence: 0.94 }] });
    let graph = await loadProvenanceGraph("recovery");
    await decideCandidate("recovery", graph.candidates[0].id, "accepted");
    const reprocess = await queueExtraction("recovery", source.id, "reprocess");
    await cancelExtraction("recovery", reprocess.id);
    graph = await loadProvenanceGraph("recovery");

    expect(graph.extractionRuns.find((item) => item.id === run.id)?.error).toMatchObject({ recoverable: true, code: "bad_row" });
    expect(graph.extractionRuns.find((item) => item.id === retry.id)).toMatchObject({ status: "succeeded", progress: 100, attempt: 2 });
    expect(graph.extractionRuns.find((item) => item.id === reprocess.id)).toMatchObject({ status: "cancelled" });
    expect(graph.candidates[0]).toMatchObject({ status: "accepted", confidence: 0.94 });
    expect(graph.evidence[0]).toMatchObject({ candidateId: graph.candidates[0].id, confidence: { score: 0.94, method: "extracted" } });
    expect(graph.audit.map((event) => event.action)).toEqual(expect.arrayContaining(["run.failed", "run.succeeded", "run.cancelled", "candidate.decided"]));
    expect(JSON.parse(await readFile(path.join(workspace, "projects", "recovery", "sources", "runs", `${retry.id}.json`), "utf8"))).toMatchObject({ status: "succeeded", progress: 100 });
  });

  it("serializes provenance deterministically regardless of insertion order", async () => {
    const { deterministicProvenanceJson } = await import("@/server/source-store");
    const base: Omit<ProvenanceGraph, "sources"> = {
      schemaVersion: 1,
      projectId: "stable",
      updatedAt: "2026-07-18T00:00:00.000Z",
      evidence: [], candidates: [], extractionRuns: [], audit: []
    };
    const alpha: Source = { id: "src_a", kind: "url", label: "A", contentHash: "aaa", origin: { importedAt: "2026-07-18T00:00:00.000Z", type: "url", locator: "https://a.test" }, intent: "extract", rights: { confirmed: true, notes: "owned" }, status: "ready", storage: { byteLength: 1, blobPath: "sources/blobs/aaa" }, createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z" };
    const beta: Source = { ...alpha, id: "src_b", label: "B", contentHash: "bbb", storage: { byteLength: 1, blobPath: "sources/blobs/bbb" } };
    const one: ProvenanceGraph = { ...base, sources: [beta, alpha] };
    const two: ProvenanceGraph = { ...base, sources: [alpha, beta] };

    expect(deterministicProvenanceJson(one)).toBe(deterministicProvenanceJson(two));
    expect(deterministicProvenanceJson(one).indexOf("src_a")).toBeLessThan(deterministicProvenanceJson(one).indexOf("src_b"));
  });
});
