import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-export-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

function exportRequest(projectId: string, type: string) {
  const request = new Request(`http://localhost/api/export/${type}?project=${projectId}`);
  return { request, context: { params: Promise.resolve({ type }) } };
}

describe("export route", () => {
  it("exports the landing page as a self-contained ZIP", async () => {
    const projectId = "export-web";
    const { loadProject } = await import("@/server/store");
    const project = await loadProject(projectId);
    const route = await import("@/app/api/export/[type]/route");

    const { request, context } = exportRequest(projectId, "web");
    const response = await route.GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain(".zip");

    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(["README.txt", "design-system/", "design-system/tokens.css", "design-system/tokens.json", "index.html"].sort());
    const html = await zip.file("index.html")!.async("string");
    const { safeProjectPath } = await import("@/server/paths");
    expect(html).toBe(await readFile(await safeProjectPath(projectId, "web", "index.html"), "utf8"));
    const tokens = JSON.parse(await zip.file("design-system/tokens.json")!.async("string"));
    expect(tokens.colors).toEqual(project.tokens.colors);
    expect(await zip.file("README.txt")!.async("string")).toContain(project.brand.name);
  });

  it("exports design tokens as attached JSON", async () => {
    const projectId = "export-tokens";
    const { loadProject } = await import("@/server/store");
    const project = await loadProject(projectId);
    const route = await import("@/app/api/export/[type]/route");

    const { request, context } = exportRequest(projectId, "tokens");
    const response = await route.GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("design-system.json");
    expect(await response.json()).toEqual(project.tokens);
  });

  it("exports an OOXML deck with validation evidence", async () => {
    const projectId = "export-pptx";
    const { loadProject } = await import("@/server/store");
    await loadProject(projectId);
    const route = await import("@/app/api/export/[type]/route");

    const { request, context } = exportRequest(projectId, "pptx");
    const response = await route.GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(response.headers.get("x-codex-validation-mode")).toBeTruthy();

    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    const deck = await JSZip.loadAsync(buffer);
    expect(deck.file("ppt/presentation.xml")).toBeTruthy();

    const { safeProjectPath } = await import("@/server/paths");
    const latest = await safeProjectPath(projectId, "reviews", "presentation", "latest.json");
    await expect(access(latest)).resolves.toBeUndefined();
    const report = JSON.parse(await readFile(latest, "utf8"));
    expect(report.capability?.mode).toBeTruthy();
  });

  it("rejects unknown export types", async () => {
    const projectId = "export-unknown";
    const { loadProject } = await import("@/server/store");
    await loadProject(projectId);
    const route = await import("@/app/api/export/[type]/route");

    const { request, context } = exportRequest(projectId, "svg");
    const response = await route.GET(request, context);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Unknown export type.");
  });
});
