import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebDocument, ensureWebNodeAnchors, extractDirectEditStyles, serializeWebDocumentHtml } from "@/domain/artifacts";
import { applyEditTransaction, createArtifactEditSession } from "@/domain/editing";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-web-source-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("web canvas document adaptation", () => {
  it("mirrors unique data-design-id anchors into editable node anchors", () => {
    const html = `<main><h1 data-design-id="hero-title">Title</h1><p data-design-id="hero-copy" data-design-node-id="hero-copy">Copy</p><span data-design-id="hero-title">Duplicate</span></main>`;
    const anchored = ensureWebNodeAnchors(html);
    expect(anchored).toContain(`<h1 data-design-id="hero-title" data-design-node-id="hero-title">`);
    expect(anchored.match(/data-design-node-id="hero-copy"/g)).toHaveLength(1);
    expect(anchored.match(/data-design-node-id="hero-title"/g)).toHaveLength(1);
    expect(() => createWebDocument({ documentId: "test", html: anchored })).not.toThrow();
  });

  it("round-trips direct-edit styles between sessions and preserves instrumentation", () => {
    const source = `<html><head><title>Demo</title></head><body><h1 data-design-id="hero-title">Hello</h1><script>parent.postMessage({type:'design-selection'},'*')</script></body></html>`;
    const { html, code } = extractDirectEditStyles(ensureWebNodeAnchors(source));
    expect(code).toBe("");
    const document = createWebDocument({ documentId: "round-trip", html });
    const session = createArtifactEditSession({ sessionId: "s", artifactId: "web", document });
    const edited = applyEditTransaction(session, {
      id: "tx-1", expectedVersion: session.version, label: "Colour", boundary: "control",
      operations: [{ type: "web.style", nodeIds: ["hero-title"], declarations: { color: "#123456" }, scope: "mobile" }]
    });
    const serialized = serializeWebDocumentHtml(edited.document);
    expect(serialized).toContain(`<style id="studio-direct-edits">`);
    expect(serialized).toContain("@media (max-width:760px)");
    expect(serialized).toContain("design-selection");
    const resumed = extractDirectEditStyles(serialized);
    expect(resumed.code).toContain('[data-design-node-id="hero-title"]{color:#123456}');
    expect(resumed.html).not.toContain("studio-direct-edits");
    const again = serializeWebDocumentHtml(createWebDocument({ documentId: "round-trip-2", html: resumed.html, stylesheets: [{ id: "studio-direct-edits", code: resumed.code }] }));
    expect(again.match(/studio-direct-edits/g)).toHaveLength(1);
  });
});

describe("web source route", () => {
  async function seededProject(projectId: string) {
    const { loadProject, loadLandingHtml } = await import("@/server/store");
    const project = await loadProject(projectId);
    return { project, landingHtml: await loadLandingHtml(projectId) };
  }

  function saveRequest(projectId: string, payload: unknown) {
    return new Request(`http://localhost/api/web-source?project=${projectId}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
    });
  }

  it("persists an edited source through the optimistic transaction", async () => {
    const { project, landingHtml } = await seededProject("web-src-save");
    const route = await import("@/app/api/web-source/route");
    const edited = landingHtml.replace("</head>", `<style id="studio-direct-edits">[data-design-node-id="hero-title"]{color:#123456}</style></head>`);
    const response = await route.POST(saveRequest("web-src-save", { html: edited, expectedProjectVersion: project.version, expectedSourceHash: sha256(landingHtml) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.project.version).toBe(project.version + 1);
    expect(result.project.webCustomized).toBe(true);
    const { loadLandingHtml } = await import("@/server/store");
    expect(await loadLandingHtml("web-src-save")).toBe(edited);
  });

  it("rejects stale saves and edits that strip instrumentation", async () => {
    const { project, landingHtml } = await seededProject("web-src-guard");
    const route = await import("@/app/api/web-source/route");
    const stale = await route.POST(saveRequest("web-src-guard", { html: landingHtml, expectedProjectVersion: project.version, expectedSourceHash: sha256("different") }));
    expect(stale.status).toBe(409);
    const stripped = await route.POST(saveRequest("web-src-guard", { html: "<html><body><h1>bare</h1></body></html>", expectedProjectVersion: project.version, expectedSourceHash: sha256(landingHtml) }));
    expect(stripped.status).toBe(422);
    const malformed = await route.POST(new Request("http://localhost/api/web-source?project=web-src-guard", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" }));
    expect(malformed.status).toBe(400);
  });
});
