import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDeliberateVariantPrompts, type VisualAssetBrief, type VisualGenerationAdapter } from "@/domain/visual-assets";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-visual-assets-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

async function publishedBrandSystem(projectId: string) {
  const brandSystem = await import("@/server/brand-system");
  const draft = await brandSystem.createBrandSystemDraft(projectId);
  await brandSystem.publishBrandSystem(projectId, draft.snapshot.id);
  return draft.snapshot.id;
}

function png(width = 1024, height = 1024, red = 20, alpha = 255) {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) { data[index] = red; data[index + 1] = 80; data[index + 2] = 140; data[index + 3] = alpha; }
  return new Uint8Array(PNG.sync.write({ width, height, data }));
}

function brief(brandSystemVersionId: string, variants = 2): VisualAssetBrief {
  return {
    schemaVersion: 1, id: `vab_${Math.random().toString(16).slice(2)}`, title: "Launch hero", objective: "Create a confident launch image", audience: "Operations leaders",
    target: { artifactId: "landing", artifactKind: "web", contextId: "hero-media", role: "hero", context: { type: "web", viewport: { width: 1440, height: 900 }, crop: { width: 800, height: 800 }, fit: "cover" } },
    brandSystemVersionId,
    brandDirection: { personality: ["precise", "human"], visualStyle: "editorial documentary", lighting: "soft directional", composition: "clear negative space", palette: ["#132238", "#36C2A1"], mustInclude: ["room for headline"], mustAvoid: ["stock-photo gestures", "logos"] },
    prompt: "A field team making a clear decision together", inputAssets: [],
    output: { width: 1024, height: 1024, quality: "medium", encoding: "png", background: "opaque", variants, maxBytes: 2_000_000 },
    createdAt: new Date().toISOString(), createdBy: "codex"
  };
}

function adapter(generate: VisualGenerationAdapter["generate"], model = "mock-image-1"): VisualGenerationAdapter {
  return { id: "codex-app-server", credentialMode: "chatgpt", model, generate };
}

describe("visual asset contracts and immutable workflow", () => {
  it("produces deliberately distinct brand-aware prompts instead of seed-only variants", async () => {
    const prompts = buildDeliberateVariantPrompts(brief("bsv_published", 4));
    expect(prompts).toHaveLength(4);
    expect(new Set(prompts).size).toBe(4);
    expect(prompts.every((prompt) => prompt.includes("editorial documentary") && prompt.includes("stock-photo gestures"))).toBe(true);
    expect(prompts.map((prompt) => prompt.match(/Variant \d: ([^.]+)/)?.[1])).toEqual(expect.arrayContaining([expect.stringContaining("architectural"), expect.stringContaining("documentary"), expect.stringContaining("abstract"), expect.stringContaining("product-led")]));
  });

  it("generates, compares, approves, refines, restores and re-places stable version ids", async () => {
    const brandSystemVersionId = await publishedBrandSystem("workflow");
    const visual = await import("@/server/visual-assets");
    const mock = adapter(async (request) => request.prompts.map((_, index) => ({ bytes: png(1024, 1024, 30 + index), providerItemId: `image-${index}`, revisedPrompt: `revised-${index}` })));
    const generated = await visual.generateVisualAsset("workflow", "hero", brief(brandSystemVersionId), mock);

    expect(generated.run).toMatchObject({ adapter: "codex-app-server", credentialMode: "chatgpt", status: "completed", outputVersionIds: [generated.versions[0].versionId, generated.versions[1].versionId] });
    expect(generated.versions.every((version) => version.validations.every((validation) => validation.status === "pass"))).toBe(true);
    expect(generated.versions[0]).toMatchObject({ brandSystemVersionId, model: { adapter: "codex-app-server", name: "mock-image-1" }, lineage: { providerItemId: "image-0" } });
    const compared = await visual.compareVisualAssetVersions("workflow", generated.versions.map((version) => version.versionId));
    expect(compared).toHaveLength(2); expect(compared[0].contentHash).not.toBe(compared[1].contentHash);

    await visual.approveVisualAsset("workflow", generated.versions[0].versionId, { note: "Selected direction" });
    const firstPlacement = await visual.placeVisualAsset("workflow", generated.versions[0].versionId, generated.versions[0].target, { placementId: "hero-slot" });
    const editAdapter = adapter(async (request) => {
      expect(request.inputAssets[0]).toMatchObject({ versionId: generated.versions[0].versionId, purpose: "edit-source", mediaType: "image/png" });
      expect(request.inputAssets[0].bytes?.byteLength).toBeGreaterThan(0);
      return [{ bytes: png(1024, 1024, 210), providerItemId: "edited-image" }];
    });
    const refined = await visual.refineVisualAsset("workflow", generated.versions[0].versionId, "Make the light warmer", editAdapter);
    expect(refined.versions[0].lineage).toMatchObject({ parentVersionId: generated.versions[0].versionId, inputVersionIds: [generated.versions[0].versionId] });
    await visual.approveVisualAsset("workflow", refined.versions[0].versionId);
    const replacement = await visual.placeVisualAsset("workflow", refined.versions[0].versionId, refined.versions[0].target, { placementId: firstPlacement.id });
    expect(replacement).toMatchObject({ id: "hero-slot", versionId: refined.versions[0].versionId });

    const restored = await visual.restoreVisualAsset("workflow", generated.versions[0].versionId);
    expect(restored).toMatchObject({ contentHash: generated.versions[0].contentHash, approval: { status: "pending" }, lineage: { restoredFromVersionId: generated.versions[0].versionId } });
    expect(restored.versionId).not.toBe(generated.versions[0].versionId);
    const registry = await visual.loadVisualAssetRegistry("workflow");
    expect(registry.versions).toHaveLength(4);
    expect(registry.placements).toEqual([replacement]);
  });

  it("blocks approval when encoding, dimensions, transparency, byte budget or rendered crop fails", async () => {
    const brandSystemVersionId = await publishedBrandSystem("validation");
    const visual = await import("@/server/visual-assets");
    const request = brief(brandSystemVersionId, 1);
    request.output.background = "transparent";
    const generated = await visual.generateVisualAsset("validation", "bad-hero", request, adapter(async () => [{ bytes: png(800, 1024) }]));
    const errors = generated.versions[0].validations.filter((item) => item.status === "error").map((item) => item.id);
    expect(errors).toEqual(expect.arrayContaining(["dimensions", "transparency"]));
    await expect(visual.approveVisualAsset("validation", generated.versions[0].versionId)).rejects.toThrow("must pass encoding");
  });

  it("hydrates immutable input versions, rejects unresolved references and revalidates placement crops", async () => {
    const brandSystemVersionId = await publishedBrandSystem("references");
    const visual = await import("@/server/visual-assets");
    const generated = await visual.generateVisualAsset("references", "reference", brief(brandSystemVersionId, 1), adapter(async () => [{ bytes: png() }]));
    await visual.approveVisualAsset("references", generated.versions[0].versionId);

    const withReference = brief(brandSystemVersionId, 1);
    withReference.inputAssets = [{ versionId: generated.versions[0].versionId, contentHash: generated.versions[0].contentHash, purpose: "reference" }];
    await visual.generateVisualAsset("references", "derived", withReference, adapter(async (request) => {
      expect(request.inputAssets[0].bytes?.byteLength).toBeGreaterThan(0);
      expect(request.inputAssets[0].mediaType).toBe("image/png");
      return [{ bytes: png() }];
    }));

    const unresolved = brief(brandSystemVersionId, 1);
    unresolved.inputAssets = [{ uri: "project://sources/logo.png", contentHash: "a".repeat(64), purpose: "reference" }];
    await expect(visual.generateVisualAsset("references", "unresolved", unresolved, adapter(async () => [{ bytes: png() }]))).rejects.toThrow("imported as immutable asset versions");

    const unsafeTarget = structuredClone(generated.versions[0].target);
    if (unsafeTarget.context.type !== "web") throw new Error("Expected a web target.");
    unsafeTarget.context.crop = { width: 10_000, height: 100 };
    await expect(visual.placeVisualAsset("references", generated.versions[0].versionId, unsafeTarget)).rejects.toThrow("requested placement target");
  });

  it("redacts credentials, retains failed provenance and recovers retryable runs within the cost guard", async () => {
    const brandSystemVersionId = await publishedBrandSystem("recovery");
    const visual = await import("@/server/visual-assets");
    let attempt = 0;
    const mock = adapter(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("provider timeout with Bearer sk-live-secret-1234567890");
      return [{ bytes: png() }];
    });
    await expect(visual.generateVisualAsset("recovery", "hero", brief(brandSystemVersionId, 1), mock, { maxAttempts: 2 })).rejects.toThrow("[REDACTED]");
    const failed = (await visual.loadVisualAssetRegistry("recovery")).runs[0];
    expect(failed).toMatchObject({ status: "failed", failure: { retryable: true }, attempts: [{ status: "failed" }] });
    expect(JSON.stringify(failed)).not.toContain("sk-live-secret");

    const versions = await visual.retryVisualAssetGeneration("recovery", failed.id, mock);
    expect(versions).toHaveLength(1);
    const recovered = (await visual.loadVisualAssetRegistry("recovery")).runs[0];
    expect(recovered).toMatchObject({ status: "completed", attempts: [{ status: "failed" }, { status: "completed" }] });
    expect(recovered.outputVersionIds).toEqual([versions[0].versionId]);
  });

  it("cancels an in-flight adapter and records a recoverable terminal run", async () => {
    const brandSystemVersionId = await publishedBrandSystem("cancel");
    const visual = await import("@/server/visual-assets");
    const controller = new AbortController();
    const mock = adapter((_request, signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true })));
    const pending = visual.generateVisualAsset("cancel", "hero", brief(brandSystemVersionId, 1), mock, { signal: controller.signal });
    await vi.waitFor(async () => expect((await visual.loadVisualAssetRegistry("cancel")).runs[0]?.status).toBe("running"), { timeout: 10_000, interval: 50 });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect((await visual.loadVisualAssetRegistry("cancel")).runs[0]).toMatchObject({ status: "cancelled", attempts: [{ status: "cancelled" }] });
  });
});
