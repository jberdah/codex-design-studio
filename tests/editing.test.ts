import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSlideDocument, createWebDocument, SLIDE_DIMENSIONS, type SlideDocument, type WebDocument } from "@/domain/artifacts";
import { defaultProject } from "@/domain/defaults";
import { projectSlideDocument, projectWithSlideDocument } from "@/domain/slide-editing";
import {
  GENERATED_ARTIFACT_CONTROLS,
  applyArtifactEdits,
  applyEditTransaction,
  createArtifactEditSession,
  redoEditTransaction,
  undoEditTransaction
} from "@/domain/editing";

function slides(): SlideDocument {
  return createSlideDocument({
    documentId: "deck",
    dimensions: { ...SLIDE_DIMENSIONS.wide },
    slides: [{
      id: "slide-1", name: "One", nodes: [
        { id: "a", type: "text", text: "Alpha", editable: true, frame: { x: 10, y: 10, width: 100, height: 30 }, zIndex: 0, style: { fontSize: 20 } },
        { id: "b", type: "text", text: "Beta", editable: true, frame: { x: 180, y: 80, width: 100, height: 30 }, zIndex: 1 },
        { id: "c", type: "shape", shape: "rectangle", frame: { x: 400, y: 160, width: 80, height: 80 }, zIndex: 2 }
      ]
    }]
  });
}

describe("artifact direct editing", () => {
  it("round-trips structured project slides through the editable scene graph", () => {
    const project = structuredClone(defaultProject);
    const document = projectSlideDocument(project);
    const edited = applyArtifactEdits(document, [
      { type: "slide.move", slideId: "slide-cover", nodeIds: ["slide-cover:title"], dx: 20, dy: 10 },
      { type: "slide.text", slideId: "slide-cover", nodeId: "slide-cover:title", text: "Edited once, exported everywhere" }
    ]).document;
    const updated = projectWithSlideDocument(project, edited);
    expect(updated.slides[0].title).toBe("Edited once, exported everywhere");
    expect(updated.slideDocument?.slides[0].nodes.find((node) => node.id === "slide-cover:title")?.frame.x).toBe(92);
  });

  it("treats a gesture as one optimistic undo/redo transaction", () => {
    const session = createArtifactEditSession({ sessionId: "edit-one", artifactId: "deck", document: slides() });
    const edited = applyEditTransaction(session, {
      id: "gesture-1", expectedVersion: 0, label: "Move and resize", boundary: "gesture",
      operations: [
        { type: "slide.move", slideId: "slide-1", nodeIds: ["a", "b"], dx: 15, dy: -5 },
        { type: "slide.resize", slideId: "slide-1", nodeId: "a", frame: { width: 140 } }
      ]
    });

    expect(edited.document.slides[0].nodes[0].frame).toMatchObject({ x: 25, y: 5, width: 140 });
    expect(edited).toMatchObject({ version: 1, dirty: true });
    expect(edited.undoStack).toHaveLength(1);
    expect(() => applyEditTransaction(edited, { id: "stale", expectedVersion: 0, label: "Stale", boundary: "keyboard", operations: [{ type: "slide.move", slideId: "slide-1", nodeIds: ["a"], dx: 1, dy: 0 }] })).toThrow("version conflict");
    const undone = undoEditTransaction(edited, 1);
    expect(undone.document.slides[0].nodes[0].frame).toMatchObject({ x: 10, width: 100 });
    expect(redoEditTransaction(undone, 2).document.slides[0].nodes[0].frame.x).toBe(25);
  });

  it("aligns, distributes, groups, ungroups and changes z-order on scene graph nodes", () => {
    const grouped = applyArtifactEdits(slides(), [
      { type: "slide.align", slideId: "slide-1", nodeIds: ["a", "b"], alignment: "top" },
      { type: "slide.distribute", slideId: "slide-1", nodeIds: ["a", "b", "c"], axis: "horizontal" },
      { type: "slide.group", slideId: "slide-1", nodeIds: ["a", "b"], groupId: "copy" },
      { type: "slide.z-order", slideId: "slide-1", nodeIds: ["copy"], direction: "front" }
    ]).document;
    const page = grouped.slides[0];
    expect(page.nodes.find((node) => node.id === "a")).toMatchObject({ groupId: "copy", frame: { y: 10 } });
    expect(page.nodes.find((node) => node.id === "copy")).toMatchObject({ type: "group", childIds: ["a", "b"], zIndex: 3 });
    const ungrouped = applyArtifactEdits(grouped, [{ type: "slide.ungroup", slideId: "slide-1", groupId: "copy" }]).document;
    expect(ungrouped.slides[0].nodes.some((node) => node.id === "copy")).toBe(false);
    expect(ungrouped.slides[0].nodes.find((node) => node.id === "a")?.groupId).toBeUndefined();
  });

  it("reports inline text overflow and constrains typography and generated controls", () => {
    const result = applyArtifactEdits(slides(), [{
      type: "slide.text", slideId: "slide-1", nodeId: "a", text: "A very long title that cannot fit inside this deliberately short frame", selection: { anchor: 0, focus: 4 }, typography: { fontSize: 32, lineHeight: 1.3 }
    }]);
    expect(result.feedback[0]).toMatchObject({ code: "text-overflow", nodeId: "a", level: "warning" });
    expect(GENERATED_ARTIFACT_CONTROLS.map((control) => control.category)).toEqual(expect.arrayContaining(["spacing", "color", "typography", "density", "layout"]));
    expect(() => applyArtifactEdits(slides(), [{ type: "slide.control", slideId: "slide-1", nodeIds: ["a"], control: "typography.size", value: 500, scope: "selection" }])).toThrow("safe range");
    expect(() => applyArtifactEdits(slides(), [{ type: "slide.text", slideId: "slide-1", nodeId: "a", text: "short", selection: { anchor: 0, focus: 20 } }])).toThrow("outside");
  });

  it("patches only stable Web nodes and models shared versus breakpoint overrides", () => {
    const source = createWebDocument({
      documentId: "landing",
      html: '<main data-design-node-id="hero"><h1 data-design-node-id="title">Original</h1></main>'
    });
    const result = applyArtifactEdits(source, [
      { type: "web.text", nodeId: "title", text: "A safer <headline>" },
      { type: "web.style", nodeIds: ["hero"], declarations: { padding: "24px", "grid-template-columns": "1fr 1fr" }, scope: "shared" },
      { type: "web.style", nodeIds: ["title"], declarations: { "font-size": "42px" }, scope: "mobile" }
    ]);
    expect(result.document.html).toContain("A safer &lt;headline&gt;");
    expect(result.document.html).toContain('<main data-design-node-id="hero">');
    expect(result.document.stylesheets.at(-1)?.code).toContain('@media (max-width:760px){[data-design-node-id="title"]{font-size:42px}}');
    expect(result.feedback.map((item) => item.scope)).toEqual(["shared", "mobile"]);
    expect(() => applyArtifactEdits(source, [{ type: "web.style", nodeIds: ["hero"], declarations: { position: "fixed" }, scope: "shared" }])).toThrow("not editable");
    expect(() => applyArtifactEdits(source, [{ type: "web.text", nodeId: "hero", text: "Replace nested markup" }])).toThrow("text-only");
  });
});

let workspace = "";
const previousDataDirectory = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-editing-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (previousDataDirectory === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = previousDataDirectory;
  await rm(workspace, { recursive: true, force: true });
});

describe("persisted edit transactions", () => {
  it("rejects stale project autosaves before changing slide source", async () => {
    const store = await import("@/server/store");
    const route = await import("@/app/api/project/route");
    const project = await store.loadProject("optimistic-project");
    const stale = await route.PUT(new Request("http://studio.local/api/project?project=optimistic-project", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: project.version + 1, slides: project.slides }) }));
    expect(stale.status).toBe(409);
    expect((await store.loadProject("optimistic-project")).version).toBe(project.version);
    const current = await route.PUT(new Request("http://studio.local/api/project?project=optimistic-project", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: project.version, slides: project.slides }) }));
    expect(current.status).toBe(200);
    expect((await current.json()).project.version).toBe(project.version + 1);
  });

  it("recovers an autosave journal and commits source as a new immutable artifact version", async () => {
    const brandSystems = await import("@/server/brand-system");
    const artifacts = await import("@/server/artifacts");
    const transactions = await import("@/server/edit-transactions");
    const draft = await brandSystems.createBrandSystemDraft("edit-project");
    await brandSystems.publishBrandSystem("edit-project", draft.snapshot.id);
    const base = await artifacts.createArtifactVersion("edit-project", { artifactId: "deck", kind: "slides", brandSystemVersionId: draft.snapshot.id, document: slides() });
    const stored = await transactions.startEditSession("edit-project", { sessionId: "edit-session", artifactId: "deck", baseArtifactVersionId: base.metadata.versionId });
    const edited = await transactions.applyStoredEditTransaction("edit-project", "edit-session", {
      id: "key-1", expectedVersion: 0, label: "Nudge right", boundary: "keyboard", operations: [{ type: "slide.move", slideId: "slide-1", nodeIds: ["a"], dx: 1, dy: 0 }]
    });
    await transactions.autosaveStoredEdit("edit-project", "edit-session", edited.session.version, "2026-07-18T12:00:00.000Z");
    const primary = path.join(workspace, "projects", "edit-project", "artifacts", "edit-sessions", "edit-session.json");
    await writeFile(primary, "{broken", "utf8");
    const recovered = await transactions.loadEditSession("edit-project", "edit-session");
    expect(recovered.session).toMatchObject({ version: 1, lastAutosavedAt: "2026-07-18T12:00:00.000Z" });
    const committed = await transactions.commitStoredEdit("edit-project", "edit-session", 1, "commit-one");
    expect(committed.session.dirty).toBe(false);
    const version = await artifacts.loadArtifactVersion<SlideDocument>("edit-project", committed.session.baseArtifactVersionId!);
    expect(version.metadata).toMatchObject({ parentVersionId: base.metadata.versionId, createdBy: "user" });
    expect(version.document.slides[0].nodes[0].frame.x).toBe(11);
    expect(await readFile(primary, "utf8")).toContain('"dirty": false');
  });

  it("persists constrained Web text and mobile overrides without replacing authored source", async () => {
    const brandSystems = await import("@/server/brand-system");
    const artifacts = await import("@/server/artifacts");
    const transactions = await import("@/server/edit-transactions");
    const draft = await brandSystems.createBrandSystemDraft("web-edit-project");
    await brandSystems.publishBrandSystem("web-edit-project", draft.snapshot.id);
    const source = createWebDocument({ documentId: "site", html: '<main data-design-node-id="hero"><h1 data-design-node-id="title">Keep this structure</h1></main>', stylesheets: [{ id: "authored", code: "main{display:grid}" }] });
    const base = await artifacts.createArtifactVersion("web-edit-project", { artifactId: "site", kind: "web", brandSystemVersionId: draft.snapshot.id, document: source });
    await transactions.startEditSession("web-edit-project", { sessionId: "web-session", artifactId: "site", baseArtifactVersionId: base.metadata.versionId });
    const edited = await transactions.applyStoredEditTransaction("web-edit-project", "web-session", {
      id: "web-edit", expectedVersion: 0, label: "Edit mobile heading", boundary: "inline-edit", operations: [
        { type: "web.text", nodeId: "title", text: "A responsive source" },
        { type: "web.style", nodeIds: ["title"], declarations: { "font-size": "40px", color: "#123456" }, scope: "mobile" }
      ]
    });
    const committed = await transactions.commitStoredEdit("web-edit-project", "web-session", edited.session.version, "commit-web");
    const persisted = await artifacts.loadArtifactVersion<WebDocument>("web-edit-project", committed.session.baseArtifactVersionId!);
    expect(persisted.document.html).toBe('<main data-design-node-id="hero"><h1 data-design-node-id="title">A responsive source</h1></main>');
    expect(persisted.document.stylesheets[0]).toEqual(source.stylesheets[0]);
    expect(persisted.document.stylesheets[1].code).toContain('@media (max-width:760px)');
  });
});
