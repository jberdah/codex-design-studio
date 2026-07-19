import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SLIDE_DIMENSIONS,
  createSlideDocument,
  createWebDocument,
  generateCreativeDirections,
  type SlideDocument,
  type WebDocument
} from "@/domain/artifacts";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-artifacts-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

function webDocument(id: string, headline = "A clear decision") {
  const html = `<!doctype html>\n<main data-design-node-id="hero"><h1 data-design-node-id="headline">${headline}</h1></main>`;
  return createWebDocument({
    documentId: id,
    html,
    stylesheets: [{ id: "page", code: "main { display: grid; }" }],
    semanticTokens: { foreground: { path: "colors.text", fallback: "#111111" } }
  });
}

function slideDocument(id: string): SlideDocument {
  return createSlideDocument({
    documentId: id,
    dimensions: { ...SLIDE_DIMENSIONS.wide },
    slides: [{
      id: "cover", name: "Cover", notes: "Opening thesis",
      nodes: [
        { id: "copy", type: "group", frame: { x: 40, y: 60, width: 500, height: 300 }, zIndex: 1, childIds: ["headline"] },
        {
          id: "headline", type: "text", text: "A clear decision", editable: true, groupId: "copy",
          frame: { x: 40, y: 60, width: 500, height: 120 }, zIndex: 2,
          semanticTokens: { color: { path: "colors.primary" }, font: { path: "typography.display" } }
        },
        {
          id: "portrait", type: "media", mediaType: "image", source: { uri: "asset://portrait" }, altText: "A customer in the field", fit: "cover",
          frame: { x: 650, y: 40, width: 270, height: 460 }, zIndex: 3
        }
      ]
    }]
  });
}

async function publishedBrandSystem(projectId: string) {
  const brandSystem = await import("@/server/brand-system");
  const draft = await brandSystem.createBrandSystemDraft(projectId);
  await brandSystem.publishBrandSystem(projectId, draft.snapshot.id);
  return draft.snapshot.id;
}

describe("artifact document adapters", () => {
  it("preserves code-native HTML exactly while indexing stable design node identities", () => {
    const source = "<!doctype html>\n<section data-design-node-id='hero'>\n  <h1 data-design-node-id=\"title\">Hello</h1>\n</section>";
    const document = createWebDocument({ documentId: "landing", html: source });

    expect(document.html).toBe(source);
    expect(document.model).toBe("code-native-html");
    expect(document.designNodes.map((node) => node.id)).toEqual(["hero", "title"]);
    expect(document.designNodes.every((node) => !("frame" in node))).toBe(true);
    expect(() => createWebDocument({ documentId: "bad", html: '<div data-design-node-id="same"><p data-design-node-id="same"></p></div>' })).toThrow("duplicated");
    expect(createWebDocument({ documentId: "unquoted", html: "<main data-design-node-id=hero></main>" }).designNodes[0].id).toBe("hero");
  });

  it("models slides in canonical physical units with groups, editable text, media and token references", () => {
    const document = slideDocument("pitch");

    expect(document).toMatchObject({ model: "physical-scene-graph", dimensions: { width: 960, height: 540, unit: "pt" } });
    expect(document.slides[0].nodes.find((node) => node.id === "headline")).toMatchObject({ type: "text", editable: true, groupId: "copy" });
    expect(document.slides[0].nodes.find((node) => node.id === "portrait")).toMatchObject({ type: "media", altText: "A customer in the field" });
    expect(() => createSlideDocument({
      documentId: "invalid", dimensions: { ...SLIDE_DIMENSIONS.wide },
      slides: [{ id: "one", name: "One", nodes: [{ id: "orphan", type: "text", text: "No", editable: true, groupId: "missing", frame: { x: 0, y: 0, width: 10, height: 10 }, zIndex: 1 }] }]
    })).toThrow("invalid group");
    expect(() => createSlideDocument({
      documentId: "cycle", dimensions: { ...SLIDE_DIMENSIONS.wide },
      slides: [{ id: "one", name: "One", nodes: [
        { id: "a", type: "group", groupId: "b", childIds: ["b"], frame: { x: 0, y: 0, width: 10, height: 10 }, zIndex: 1 },
        { id: "b", type: "group", groupId: "a", childIds: ["a"], frame: { x: 0, y: 0, width: 10, height: 10 }, zIndex: 2 }
      ] }]
    })).toThrow("cyclic group");
  });

  it("generates three structurally distinct directions with named theses and host contracts", () => {
    const directions = generateCreativeDirections({ id: "brief-1", title: "Launch", summary: "Make a complex choice clear.", goals: ["Explain", "Convert"] }, "web", "bsv_approved");

    expect(directions.map((direction) => direction.name)).toEqual(["Signal & Structure", "Human Momentum", "Editorial Contrast"]);
    expect(new Set(directions.map((direction) => JSON.stringify(direction.divergence))).size).toBe(3);
    expect(directions.every((direction) => direction.designThesis.includes("Launch") && direction.intendedDeviations.length >= 3)).toBe(true);
    expect(directions.every((direction) => direction.hostContract.output.documentModel === "code-native-html" && direction.hostContract.output.preserveStableNodeIds)).toBe(true);
  });
});

describe("artifact version graph and creative workflow", () => {
  it("keeps branch ancestry inspectable and enforces approval, rejection and promotion transitions", async () => {
    const brandSystemVersionId = await publishedBrandSystem("graph");
    const artifacts = await import("@/server/artifacts");
    const first = await artifacts.createArtifactVersion("graph", {
      artifactId: "landing", kind: "web", brandSystemVersionId, document: webDocument("landing-v1"),
      designThesis: "Make the evidence scannable", intendedDeviations: ["Denser evidence"]
    });
    const second = await artifacts.createArtifactVersion("graph", {
      artifactId: "landing", kind: "web", brandSystemVersionId, document: webDocument("landing-v2", "Evidence before claims"),
      branchId: first.metadata.branchId, parentVersionId: first.metadata.versionId,
      designThesis: "Lead with proof", intendedDeviations: ["Proof-first order"]
    });
    const branch = await artifacts.branchArtifactVersion("graph", first.metadata.versionId, "human-story");
    await artifacts.addArtifactComment("graph", branch.metadata.versionId, { id: "comment-1", author: "user", body: "Keep this pacing", createdAt: new Date().toISOString(), target: { nodeId: "headline" } });
    await artifacts.recordArtifactValidation("graph", branch.metadata.versionId, { id: "a11y", validator: "accessibility", status: "pass", message: "Named media and readable contrast", checkedAt: new Date().toISOString() });
    await artifacts.recordArtifactExport("graph", branch.metadata.versionId, { id: "preview", format: "html", uri: "artifact://preview/index.html", createdAt: new Date().toISOString() });
    await artifacts.approveArtifactVersion("graph", branch.metadata.versionId, { note: "Chosen direction" });
    const promoted = await artifacts.promoteArtifactVersion("graph", branch.metadata.versionId);
    await artifacts.rejectArtifactVersion("graph", second.metadata.versionId, { note: "Too dense" });

    expect(branch.metadata.parentVersionId).toBe(first.metadata.versionId);
    expect(branch.metadata.branchId).not.toBe(first.metadata.branchId);
    expect(promoted.registry.promotedVersionIds.landing).toBe(branch.metadata.versionId);
    expect(promoted.version.metadata).toMatchObject({ comments: [{ id: "comment-1" }], validations: [{ id: "a11y", status: "pass" }], exports: [{ id: "preview" }] });
    await artifacts.requestArtifactChanges("graph", branch.metadata.versionId, { note: "Tighten the ending" });
    expect((await artifacts.loadArtifactRegistry("graph")).promotedVersionIds.landing).toBeUndefined();
    await artifacts.approveArtifactVersion("graph", branch.metadata.versionId, { note: "Ending tightened" });
    await artifacts.promoteArtifactVersion("graph", branch.metadata.versionId);
    await expect(artifacts.approveArtifactVersion("graph", second.metadata.versionId)).rejects.toThrow("rejected to approved");
    expect((await artifacts.loadArtifactVersion("graph", second.metadata.versionId)).metadata.approval).toMatchObject({ status: "rejected", events: [{ to: "rejected", note: "Too dense" }] });
    const comparison = await artifacts.compareArtifactVersions("graph", second.metadata.versionId, branch.metadata.versionId);
    expect(comparison).toMatchObject({ commonAncestorVersionId: first.metadata.versionId, sameContent: false });
  });

  it("restores historical content as a new descendant without erasing intervening history", async () => {
    const brandSystemVersionId = await publishedBrandSystem("restore");
    const artifacts = await import("@/server/artifacts");
    const first = await artifacts.createArtifactVersion("restore", { artifactId: "deck", kind: "slides", brandSystemVersionId, document: slideDocument("deck-v1") });
    const changedDocument = slideDocument("deck-v2");
    (changedDocument.slides[0].nodes.find((node) => node.type === "text") as Extract<SlideDocument["slides"][number]["nodes"][number], { type: "text" }>).text = "A bolder second version";
    const second = await artifacts.createArtifactVersion("restore", {
      artifactId: "deck", kind: "slides", brandSystemVersionId, document: changedDocument,
      branchId: first.metadata.branchId, parentVersionId: first.metadata.versionId
    });
    const restored = await artifacts.restoreArtifactVersion("restore", first.metadata.versionId);

    expect(restored.metadata.versionId).not.toBe(first.metadata.versionId);
    expect(restored.metadata.parentVersionId).toBe(second.metadata.versionId);
    expect(restored.contentHash).toBe(first.contentHash);
    expect(restored.metadata.provenance[0]).toMatchObject({ action: "restored", sourceVersionId: first.metadata.versionId });
    expect((await artifacts.loadArtifactRegistry("restore")).versions.map((version) => version.versionId)).toEqual([first.metadata.versionId, second.metadata.versionId, restored.metadata.versionId]);
  });

  it("isolates concurrent artifacts and projects while retaining each document model", async () => {
    const [brandA, brandB] = await Promise.all([publishedBrandSystem("isolation-a"), publishedBrandSystem("isolation-b")]);
    const artifacts = await import("@/server/artifacts");
    const [webA, slidesA, webB] = await Promise.all([
      artifacts.createArtifactVersion("isolation-a", { artifactId: "site", kind: "web", brandSystemVersionId: brandA, document: webDocument("site-a", "Project A") }),
      artifacts.createArtifactVersion("isolation-a", { artifactId: "deck", kind: "slides", brandSystemVersionId: brandA, document: slideDocument("deck-a") }),
      artifacts.createArtifactVersion("isolation-b", { artifactId: "site", kind: "web", brandSystemVersionId: brandB, document: webDocument("site-b", "Project B") })
    ]);

    const registryA = await artifacts.loadArtifactRegistry("isolation-a");
    const registryB = await artifacts.loadArtifactRegistry("isolation-b");
    expect(registryA.versions).toHaveLength(2);
    expect(registryB.versions).toHaveLength(1);
    expect(new Set(registryA.versions.map((version) => version.artifactId))).toEqual(new Set(["site", "deck"]));
    expect((await artifacts.loadArtifactVersion<WebDocument>("isolation-a", webA.metadata.versionId)).document.html).toContain("Project A");
    expect((await artifacts.loadArtifactVersion<SlideDocument>("isolation-a", slidesA.metadata.versionId)).document.kind).toBe("slides");
    expect((await artifacts.loadArtifactVersion<WebDocument>("isolation-b", webB.metadata.versionId)).document.html).toContain("Project B");
  });

  it("builds comparable desktop/mobile and slide sheets with visible version identifiers", async () => {
    const artifacts = await import("@/server/artifacts");
    const webSheet = artifacts.createWebContactSheet("Web directions", [
      { versionId: "av_direction_a", directionName: "Signal & Structure", desktop: "/a-desktop.png", mobile: "/a-mobile.png" },
      { versionId: "av_direction_b", directionName: "Human Momentum", desktop: "/b-desktop.png", mobile: "/b-mobile.png" }
    ]);
    const slideSheet = artifacts.createSlideSheet("Deck directions", [{
      versionId: "av_deck_a", directionName: "Editorial Contrast", slides: [{ slideId: "cover", source: "/cover.png" }, { slideId: "proof", source: "/proof.png" }]
    }]);
    const html = artifacts.renderComparisonSheetHtml(webSheet);

    expect(webSheet.variants[0].frames.map((frame) => [frame.label, frame.width, frame.height])).toEqual([["Desktop", 1440, 900], ["Mobile", 390, 844]]);
    expect(slideSheet.variants[0].frames.every((frame) => frame.width === 960 && frame.height === 540)).toBe(true);
    expect(html).toContain("Signal &amp; Structure");
    expect(html.match(/av_direction_a/g)?.length).toBeGreaterThanOrEqual(3);
    const unsafe = structuredClone(webSheet);
    unsafe.variants[0].frames[0].source = "https://tracker.example/screenshot.png";
    expect(() => artifacts.renderComparisonSheetHtml(unsafe)).toThrow("project-relative");
  });

  it("registers new artifact kinds without closing the built-in registry", async () => {
    const artifacts = await import("@/server/artifacts");
    await artifacts.registerArtifactKind("extensible", {
      kind: "motion", label: "Motion study", documentModel: "timed-scene-graph", capabilities: ["media", "semantic-tokens"]
    });
    const registry = await artifacts.loadArtifactRegistry("extensible");

    expect(registry.kinds.map((entry) => entry.kind)).toEqual(["motion", "slides", "web"]);
    await expect(artifacts.registerArtifactKind("extensible", {
      kind: "motion", label: "Duplicate", documentModel: "other", capabilities: []
    })).rejects.toThrow("already registered");
  });
});
