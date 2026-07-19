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
  vi.doUnmock("@/server/network-policy");
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

describe("portable source and provenance store", () => {
  it("preserves requested reference intent and capabilities while warning about unconfirmed rights", async () => {
    vi.doMock("@/server/network-policy", () => ({
      assertSafeWebUrl: async (input: string) => ({ url: new URL(input), addresses: [{ address: "203.0.113.10", family: 4 }] })
    }));
    const { addBootstrapReferenceSite, getBootstrapReferenceState, loadProvenanceGraph, normalizeSourcePolicy } = await import("@/server/source-store");
    expect((["extract", "inspire", "extract-and-inspire"] as const).map((intent) => normalizeSourcePolicy("url", { intent, relationship: "unknown" }).intent)).toEqual(["extract", "inspire", "extract-and-inspire"]);
    const added = await addBootstrapReferenceSite("bootstrap-safe", {
      url: "https://reference.example/brand",
      intent: "extract-and-inspire",
      role: "constraint",
      relationship: "third-party",
      rightsConfirmed: false,
      permissions: { reproduceAssets: true, reproduceCopy: true, distribute: true }
    });
    expect(added.source).toMatchObject({
      intent: "extract-and-inspire", role: "constraint",
      origin: { context: "project-bootstrap" },
      rights: { relationship: "third-party", permissions: { analyze: true, inspire: true, reproduceAssets: true, reproduceCopy: true, distribute: true } }
    });
    const state = getBootstrapReferenceState(await loadProvenanceGraph("bootstrap-safe"));
    expect(state).toMatchObject({ sourceId: added.source.id, effectiveIntent: "extract-and-inspire", role: "constraint", status: "queued", runStatus: "queued", warning: { code: "reference_rights_unconfirmed" } });
    await expect(addBootstrapReferenceSite("bootstrap-safe", { url: "https://other.example/", relationship: "owned", rightsConfirmed: true })).rejects.toThrow("one active reference website");
  });

  it("honours explicit owned-site extraction while requiring explicit copy and distribution permissions", async () => {
    vi.doMock("@/server/network-policy", () => ({
      assertSafeWebUrl: async (input: string) => ({ url: new URL(input), addresses: [{ address: "203.0.113.11", family: 4 }] })
    }));
    const { addBootstrapReferenceSite, getBootstrapReferenceState, loadProvenanceGraph } = await import("@/server/source-store");
    const result = await addBootstrapReferenceSite("bootstrap-owned", {
      url: "https://owned.example/",
      intent: "extract-and-inspire",
      role: "constraint",
      relationship: "owned",
      rightsConfirmed: true,
      permissions: { reproduceAssets: true, reproduceCopy: false, distribute: true }
    });
    expect(result.source).toMatchObject({
      intent: "extract-and-inspire", role: "constraint",
      rights: { confirmed: true, relationship: "owned", permissions: { analyze: true, inspire: true, reproduceAssets: true, reproduceCopy: false, distribute: true } }
    });
    expect(getBootstrapReferenceState(await loadProvenanceGraph("bootstrap-owned"))?.warning).toBeUndefined();
  });

  it("exposes partial extraction with precise locators without downgrading accepted extract evidence", async () => {
    vi.doMock("@/server/network-policy", () => ({
      assertSafeWebUrl: async (input: string) => ({ url: new URL(input), addresses: [{ address: "203.0.113.12", family: 4 }] })
    }));
    const { addBootstrapReferenceSite, decideCandidate, getBootstrapReferenceState, loadProvenanceGraph, updateExtractionRun } = await import("@/server/source-store");
    const { source, run } = await addBootstrapReferenceSite("bootstrap-partial", { url: "https://third-party.example/", intent: "extract", relationship: "unknown" });
    await updateExtractionRun("bootstrap-partial", run.id, { status: "running", progress: 60, phase: "capturing desktop" });
    await updateExtractionRun("bootstrap-partial", run.id, {
      status: "succeeded", phase: "completed with partial results",
      error: { code: "mobile_timeout", message: "The mobile viewport timed out.", recoverable: true },
      issues: [{ code: "font_blocked", message: "A remote font was blocked.", recoverable: true }],
      candidates: [{ kind: "color", value: { evidenceType: "computed-colors", provenance: { type: "web-capture", finalUrl: "https://third-party.example/landing", viewport: "desktop", selector: "header" }, values: ["#112233"] }, confidence: 0.82 }]
    });
    let graph = await loadProvenanceGraph("bootstrap-partial");
    expect(getBootstrapReferenceState(graph)).toMatchObject({ status: "partial", runStatus: "partial", error: { code: "mobile_timeout" }, issues: [{ code: "font_blocked" }] });
    expect(graph.candidates[0].locator).toMatchObject({ type: "web", requestedUrl: "https://third-party.example/", finalUrl: "https://third-party.example/landing", viewport: "desktop", selector: "header", sourceHash: source.contentHash });
    await decideCandidate("bootstrap-partial", graph.candidates[0].id, "accepted");
    graph = await loadProvenanceGraph("bootstrap-partial");
    expect(graph.candidates[0].status).toBe("accepted");
    expect(graph.evidence[0]).toMatchObject({ intent: "extract", directive: "advisory", locator: { type: "web", viewport: "desktop" }, rights: { permissions: { reproduceAssets: false, reproduceCopy: false, distribute: false } } });
  });

  it("exposes bootstrap source policy through the existing sources API", async () => {
    vi.doMock("@/server/network-policy", () => ({
      assertSafeWebUrl: async (input: string) => ({ url: new URL(input), addresses: [{ address: "203.0.113.13", family: 4 }] })
    }));
    const route = await import("@/app/api/sources/route");
    const response = await route.POST(new Request("http://studio.local/api/sources?project=bootstrap-api", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://reference.example/", bootstrapReference: true, intent: "extract", relationship: "third-party", rightsConfirmed: false })
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ source: { intent: "extract", role: "evidence" }, bootstrapReference: { effectiveIntent: "extract", status: "queued", warning: { code: "reference_rights_unconfirmed" } } });
    const fetched = await route.GET(new Request("http://studio.local/api/sources?project=bootstrap-api"));
    expect(await fetched.json()).toMatchObject({ bootstrapReference: { effectiveIntent: "extract", runStatus: "queued", warning: { code: "reference_rights_unconfirmed" } } });
  });

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
