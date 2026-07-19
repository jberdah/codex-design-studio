import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-api-validation-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

function malformedRequest(route: string, method: string) {
  return new Request(`http://localhost${route}?project=validation`, {
    method,
    headers: { "content-type": "application/json" },
    body: "{not valid json"
  });
}

describe("API request body validation", () => {
  it("returns 400 for a malformed refine body", async () => {
    const route = await import("@/app/api/refine/route");
    const response = await route.POST(malformedRequest("/api/refine", "POST"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("JSON");
  });

  it("returns 400 for a malformed project mutation body", async () => {
    const route = await import("@/app/api/project/route");
    const response = await route.PUT(malformedRequest("/api/project", "PUT"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("JSON");
  });

  it("returns 400 for a malformed platform key body", async () => {
    const route = await import("@/app/api/openai-key/route");
    const response = await route.POST(malformedRequest("/api/openai-key", "POST"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("API key");
  });

  it("returns 400 for a non-object JSON body", async () => {
    const route = await import("@/app/api/refine/route");
    const response = await route.POST(new Request("http://localhost/api/refine?project=validation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify("just a string")
    }));
    expect(response.status).toBe(400);
  });
});
