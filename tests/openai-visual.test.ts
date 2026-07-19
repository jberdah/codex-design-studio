import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisualAssetBrief, VisualGenerationRequest } from "@/domain/visual-assets";
import { defaultProject } from "@/domain/defaults";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-openai-visual-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

function image(width = 64, height = 64) {
  const data = new Uint8Array(width * height * 4).fill(255);
  return new Uint8Array(PNG.sync.write({ width, height, data }));
}

function request(projectId: string): VisualGenerationRequest {
  const brief = {
    schemaVersion: 1, id: "brief", title: "Hero", objective: "Launch", audience: "Leaders",
    target: { artifactId: "web", artifactKind: "web", contextId: "hero", role: "hero", context: { type: "web", viewport: { width: 1200, height: 800 }, crop: { width: 64, height: 64 }, fit: "cover" } },
    brandSystemVersionId: "bsv_1", brandDirection: { personality: [], visualStyle: "editorial", lighting: "soft", composition: "clear", palette: [], mustInclude: [], mustAvoid: [] },
    prompt: "A clear choice", inputAssets: [], output: { width: 64, height: 64, quality: "low", encoding: "png", background: "opaque", variants: 1, maxBytes: 100_000 }, createdAt: new Date().toISOString(), createdBy: "codex"
  } satisfies VisualAssetBrief;
  return { runId: "run", projectId, brief, prompts: [brief.prompt], model: "mock", output: brief.output, inputAssets: [] };
}

describe("OpenAI visual generation adapters", () => {
  it("lets Codex author a structured brand-aware brief in a credential-free read-only turn", async () => {
    const { CodexVisualBriefPlanner } = await import("@/server/openai-visual");
    const calls: Array<{ method: string; params: unknown }> = [];
    let listener: (message: { method?: string; params?: Record<string, unknown> }) => void = () => undefined;
    const planned = { title: "Decisive launch", objective: "Create a clear launch hero", audience: "Operations leaders", brandDirection: { personality: ["precise"], visualStyle: "editorial", lighting: "soft directional", composition: "negative space on the left", palette: ["#132238"], mustInclude: ["one focal point"], mustAvoid: ["logos"] }, prompt: "An editorial field scene with one focal point and negative space on the left" };
    const session = {
      async request(method: string, params: unknown) {
        calls.push({ method, params });
        if (method === "thread/start") return { thread: { id: "brief-thread" } };
        if (method === "turn/start") {
          queueMicrotask(() => { listener({ method: "item/agentMessage/delta", params: { delta: JSON.stringify(planned) } }); listener({ method: "turn/completed", params: {} }); });
          return { turn: { id: "brief-turn" } };
        }
        return {};
      }, notify: vi.fn(), onMessage(next: typeof listener) { listener = next; return () => undefined; }, close: vi.fn()
    };
    const planner = new CodexVisualBriefPlanner({ sessionFactory: () => session });
    const result = await planner.plan("brief-project", { ...structuredClone(defaultProject), id: "brief-project" }, { objective: "Create a clear launch hero", target: request("brief-project").brief.target, brandSystemVersionId: "bsv_1", output: request("brief-project").output });
    expect(result).toMatchObject({ ...planned, createdBy: "codex", brandSystemVersionId: "bsv_1" });
    expect(calls.find((call) => call.method === "thread/start")?.params).toMatchObject({ sandbox: "read-only", approvalPolicy: "never" });
    expect(JSON.stringify(calls)).not.toMatch(/apiKey|Bearer|sk-/i);
  });

  it("consumes App Server imageGeneration saved assets under ChatGPT auth without exposing a key", async () => {
    const { CodexAppServerImageAdapter } = await import("@/server/openai-visual");
    const saved = path.join(workspace, "must-not-be-read.png"); await writeFile(saved, new Uint8Array([1, 2, 3]));
    const calls: Array<{ method: string; params: unknown }> = [];
    let listener: (message: { method?: string; params?: Record<string, unknown> }) => void = () => undefined;
    const session = {
      async request(method: string, params: unknown) {
        calls.push({ method, params });
        if (method === "thread/start") return { thread: { id: "thread-1" } };
        if (method === "turn/start") {
          queueMicrotask(() => {
            listener({ method: "item/completed", params: { item: { type: "imageGeneration", id: "img-1", status: "completed", revisedPrompt: "A clearer choice", result: Buffer.from(image()).toString("base64"), savedPath: saved } } });
            listener({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
          });
          return { turn: { id: "turn-1" } };
        }
        return {};
      },
      notify: vi.fn(), onMessage(next: typeof listener) { listener = next; return () => undefined; }, close: vi.fn()
    };
    const adapter = new CodexAppServerImageAdapter({ model: "gpt-test", sessionFactory: () => session });
    const result = await adapter.generate(request("app-server"));

    expect(result[0]).toMatchObject({ providerItemId: "img-1", revisedPrompt: "A clearer choice" });
    expect(result[0].bytes).toEqual(image());
    const thread = calls.find((call) => call.method === "thread/start")?.params;
    expect(thread).toMatchObject({ sandbox: "read-only", approvalPolicy: "never", ephemeral: true });
    expect(JSON.stringify(calls)).not.toMatch(/apiKey|Bearer|sk-/i);
  });

  it("uses keychain-provided BYOK only in the Authorization header and redacts provider failures", async () => {
    const { OpenAIResponsesImageAdapter } = await import("@/server/openai-visual");
    const secret = "sk-test-super-secret-123456";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${secret}`);
      expect(String(init?.body)).not.toContain(secret);
      return new Response(JSON.stringify({ id: "resp-1", output: [{ type: "image_generation_call", id: "img-1", result: Buffer.from(image()).toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new OpenAIResponsesImageAdapter({ getApiKey: async () => secret }, { baseUrl: "https://api.test/v1", model: "gpt-test" });
    expect(await adapter.generate(request("byok"))).toMatchObject([{ providerResponseId: "resp-1", providerItemId: "img-1" }]);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(`credential ${secret}`, { status: 500 })));
    await expect(adapter.generate(request("byok"))).rejects.toThrow("[REDACTED]");
  });

  it("keeps the optional Platform key in the OS keychain contract", async () => {
    const { MacOSOpenAIKeychain } = await import("@/server/openai-keychain");
    const calls: string[][] = [];
    const keychain = new MacOSOpenAIKeychain(async (args) => { calls.push(args); return args[0] === "find-generic-password" ? "sk-test-keychain-123456" : ""; });
    await keychain.setApiKey("sk-test-keychain-123456");
    expect(await keychain.getApiKey()).toBe("sk-test-keychain-123456");
    await keychain.deleteApiKey();
    expect(calls.map((args) => args[0])).toEqual(["add-generic-password", "find-generic-password", "delete-generic-password"]);
  });

  it("normalizes native Codex PNG dimensions and refuses unsupported zero-key encodings", async () => {
    const { normalizeCodexPng } = await import("@/server/openai-visual");
    const normalized = normalizeCodexPng(image(96, 80), request("normalize").output);
    expect(PNG.sync.read(Buffer.from(normalized))).toMatchObject({ width: 64, height: 64 });
    expect(() => normalizeCodexPng(image(), { ...request("normalize").output, encoding: "webp" })).toThrow("currently supports PNG");
  });
});
