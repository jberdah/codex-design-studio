import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { ProjectData } from "@/domain/types";
import type { VisualAssetBrief, VisualAssetOutputParameters, VisualAssetTarget, VisualGenerationAdapter, VisualGenerationOutput, VisualGenerationRequest } from "@/domain/visual-assets";
import { bundleRoot, codexEntrypoint, safeProjectRoot } from "./paths";

type RpcMessage = { id?: number; method?: string; result?: unknown; error?: { message?: string }; params?: Record<string, unknown> };

export interface AppServerSession {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  onMessage(listener: (message: RpcMessage) => void): () => void;
  close(): void;
}

class SpawnedAppServerSession implements AppServerSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private requestId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(message: RpcMessage) => void>();

  constructor() {
    this.child = spawn(process.execPath, [codexEntrypoint, "app-server", "--stdio"], { cwd: bundleRoot, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        const message = JSON.parse(line) as RpcMessage;
        if (message.id !== undefined) {
          const pending = this.pending.get(message.id);
          if (pending) {
            this.pending.delete(message.id);
            message.error ? pending.reject(new Error(message.error.message ?? "Codex App Server error")) : pending.resolve(message.result);
          }
        }
        this.listeners.forEach((listener) => listener(message));
      } catch { /* App Server emits JSONL; ignore non-protocol diagnostics. */ }
    });
    this.child.stderr.on("data", () => undefined);
    const stop = (error?: Error) => {
      this.pending.forEach(({ reject }) => reject(error ?? new Error("Codex App Server stopped")));
      this.pending.clear();
    };
    this.child.on("error", stop); this.child.on("close", () => stop());
  }

  request(method: string, params: unknown = {}, timeoutMs = 180_000) {
    const id = ++this.requestId;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  notify(method: string, params: unknown = {}) { this.child.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  onMessage(listener: (message: RpcMessage) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() { this.child.kill(); }
}

interface ImageGenerationItem {
  type: "imageGeneration";
  id: string;
  status: string;
  revisedPrompt: string | null;
  result: string;
  savedPath?: string;
}

const visualBriefSchema = {
  type: "object", additionalProperties: false,
  required: ["title", "objective", "audience", "brandDirection", "prompt"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 }, objective: { type: "string", minLength: 1, maxLength: 500 }, audience: { type: "string", minLength: 1, maxLength: 300 }, prompt: { type: "string", minLength: 1, maxLength: 4_000 },
    brandDirection: {
      type: "object", additionalProperties: false, required: ["personality", "visualStyle", "lighting", "composition", "palette", "mustInclude", "mustAvoid"],
      properties: {
        personality: { type: "array", maxItems: 12, items: { type: "string", maxLength: 100 } }, visualStyle: { type: "string", maxLength: 500 }, lighting: { type: "string", maxLength: 300 }, composition: { type: "string", maxLength: 300 },
        palette: { type: "array", maxItems: 12, items: { type: "string", maxLength: 40 } }, mustInclude: { type: "array", maxItems: 12, items: { type: "string", maxLength: 300 } }, mustAvoid: { type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } }
      }
    }
  }
};

function parseFinalJson<T>(output: string): T {
  const cleaned = output.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const starts = [...cleaned.matchAll(/\{/g)].map((match) => match.index ?? 0).reverse();
  for (const start of starts) { try { return JSON.parse(cleaned.slice(start)) as T; } catch { /* Try the preceding object. */ } }
  throw new Error("Codex returned an invalid structured visual brief.");
}

export class CodexVisualBriefPlanner {
  private readonly model: string;
  private readonly sessionFactory: () => AppServerSession;
  constructor(options: { model?: string; sessionFactory?: () => AppServerSession } = {}) {
    this.model = options.model ?? process.env.CODEX_STUDIO_MODEL ?? "gpt-5.6-sol";
    this.sessionFactory = options.sessionFactory ?? (() => new SpawnedAppServerSession());
  }

  async plan(projectId: string, project: ProjectData, input: { objective: string; target: VisualAssetTarget; brandSystemVersionId: string; output: VisualAssetOutputParameters; inputAssets?: VisualAssetBrief["inputAssets"] }, signal?: AbortSignal): Promise<VisualAssetBrief> {
    if (!input.objective.trim() || input.objective.length > 2_000) throw new Error("A visual objective of at most 2,000 characters is required.");
    const root = await safeProjectRoot(projectId); const session = this.sessionFactory(); let output = ""; let threadId = ""; let turnId = "";
    let finish!: () => void; let fail!: (error: Error) => void;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    const completed = new Promise<void>((resolve, reject) => {
      completionTimer = setTimeout(() => reject(new Error("Codex visual brief planning timed out")), 180_000);
      finish = () => { if (completionTimer) clearTimeout(completionTimer); resolve(); };
      fail = (error) => { if (completionTimer) clearTimeout(completionTimer); reject(error); };
    });
    const off = session.onMessage((message) => {
      if (message.method === "item/agentMessage/delta") output += String(message.params?.delta ?? "");
      if (message.method === "turn/completed") finish();
      if (message.method === "error") fail(new Error(String((message.params?.error as { message?: string } | undefined)?.message ?? "Codex brief planning failed")));
    });
    const abort = () => { if (threadId && turnId) void session.request("turn/interrupt", { threadId, turnId }, 10_000).catch(() => undefined); fail(new DOMException("Brief planning cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await session.request("initialize", { clientInfo: { name: "codex-design-studio", title: "Codex Design Studio", version: "0.3.0" }, capabilities: { experimentalApi: true } }); session.notify("initialized");
      const thread = await session.request("thread/start", { cwd: root, model: this.model, approvalPolicy: "never", sandbox: "read-only", ephemeral: true, developerInstructions: "You are the structured visual brief planner inside Codex Design Studio. Return only the requested JSON. Use the supplied immutable BrandSystem binding. Do not request or expose credentials, call image generation, or write files." }) as { thread: { id: string } }; threadId = thread.thread.id;
      const prompt = `Turn this objective into a production-ready, brand-aware visual brief. Make the prompt concrete about subject, composition, style, light, palette, negative space and forbidden clichés without inventing a logo or trademark.\n${JSON.stringify({ objective: input.objective, target: input.target, brandSystemVersionId: input.brandSystemVersionId, brand: project.brand, tokens: project.tokens, output: input.output })}`;
      const turn = await session.request("turn/start", { threadId, input: [{ type: "text", text: prompt, text_elements: [] }], outputSchema: visualBriefSchema, effort: "medium" }) as { turn: { id: string } }; turnId = turn.turn.id;
      if (signal?.aborted) abort(); await completed;
      const planned = parseFinalJson<Pick<VisualAssetBrief, "title" | "objective" | "audience" | "brandDirection" | "prompt">>(output);
      return { schemaVersion: 1, id: `vab_${crypto.randomUUID()}`, ...planned, target: structuredClone(input.target), brandSystemVersionId: input.brandSystemVersionId, inputAssets: structuredClone(input.inputAssets ?? []), output: structuredClone(input.output), createdAt: new Date().toISOString(), createdBy: "codex" };
    } finally { if (completionTimer) clearTimeout(completionTimer); signal?.removeEventListener("abort", abort); off(); session.close(); }
  }
}

function imageItem(message: RpcMessage): ImageGenerationItem | undefined {
  if (message.method !== "item/completed") return undefined;
  const item = message.params?.item as Partial<ImageGenerationItem> | undefined;
  return item?.type === "imageGeneration" && typeof item.id === "string" && typeof item.result === "string" ? item as ImageGenerationItem : undefined;
}

function decodeImageResult(result: string) {
  const base64 = result.startsWith("data:") ? result.slice(result.indexOf(",") + 1) : result;
  if (!/^[a-z0-9+/=\r\n]+$/i.test(base64)) throw new Error("Codex imageGeneration returned a non-base64 result.");
  return new Uint8Array(Buffer.from(base64, "base64"));
}

async function consumeImageItem(item: ImageGenerationItem, maxBytes: number): Promise<VisualGenerationOutput> {
  // `savedPath` is provider-controlled metadata. The host persists only the
  // protocol result so an image item can never turn into an arbitrary file read.
  const bytes = decodeImageResult(item.result);
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) throw new Error("Codex imageGeneration result violates the generation byte guard.");
  return { bytes, providerItemId: item.id, revisedPrompt: item.revisedPrompt ?? undefined };
}

export class CodexAppServerImageAdapter implements VisualGenerationAdapter {
  readonly id = "codex-app-server" as const;
  readonly credentialMode = "chatgpt" as const;
  readonly model: string;
  private readonly sessionFactory: () => AppServerSession;

  constructor(options: { model?: string; sessionFactory?: () => AppServerSession } = {}) {
    this.model = options.model ?? process.env.CODEX_STUDIO_MODEL ?? "gpt-5.6-sol";
    this.sessionFactory = options.sessionFactory ?? (() => new SpawnedAppServerSession());
  }

  async generate(request: VisualGenerationRequest, signal?: AbortSignal) {
    const root = await safeProjectRoot(request.projectId);
    const session = this.sessionFactory();
    const items: ImageGenerationItem[] = [];
    let threadId = ""; let turnId = "";
    let finished!: () => void; let failed!: (error: Error) => void;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    const completed = new Promise<void>((resolve, reject) => {
      completionTimer = setTimeout(() => reject(new Error("Codex image generation timed out")), 240_000);
      finished = () => { if (completionTimer) clearTimeout(completionTimer); resolve(); };
      failed = (error) => { if (completionTimer) clearTimeout(completionTimer); reject(error); };
    });
    const off = session.onMessage((message) => {
      const item = imageItem(message); if (item) items.push(item);
      if (message.method === "turn/completed") finished();
      if (message.method === "error") failed(new Error(String((message.params?.error as { message?: string } | undefined)?.message ?? message.params?.message ?? "Codex image generation failed")));
    });
    const abort = () => {
      if (threadId && turnId) void session.request("turn/interrupt", { threadId, turnId }, 10_000).catch(() => undefined);
      failed(signal?.reason instanceof Error ? signal.reason : new DOMException("Generation cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await session.request("initialize", { clientInfo: { name: "codex-design-studio", title: "Codex Design Studio", version: "0.3.0" }, capabilities: { experimentalApi: true } });
      session.notify("initialized");
      const thread = await session.request("thread/start", {
        cwd: root, model: this.model, approvalPolicy: "never", sandbox: "read-only", ephemeral: true,
        developerInstructions: "You are the image-generation engine inside Codex Design Studio. Return the requested deliberately distinct visual variants by calling the native image generation capability once per variant. Do not use shell commands, write project files, request credentials, reveal secrets, or merely describe an image. The host application consumes imageGeneration items and owns all durable file writes."
      }) as { thread: { id: string } };
      threadId = thread.thread.id;
      const prompt = `Create exactly ${request.prompts.length} deliberately distinct image variants for this structured visual brief.\n${JSON.stringify({ target: request.brief.target, brandSystemVersionId: request.brief.brandSystemVersionId, prompts: request.prompts, output: request.output })}`;
      const input: Array<Record<string, unknown>> = [{ type: "text", text: prompt, text_elements: [] }];
      for (const asset of request.inputAssets) {
        if (asset.bytes && asset.mediaType) input.push({ type: "image", detail: "high", url: `data:${asset.mediaType};base64,${Buffer.from(asset.bytes).toString("base64")}` });
      }
      const turn = await session.request("turn/start", { threadId, input, effort: "medium" }, 180_000) as { turn: { id: string } };
      turnId = turn.turn.id;
      if (signal?.aborted) abort();
      await completed;
      if (items.length !== request.prompts.length) throw new Error(`Codex completed with ${items.length} imageGeneration items; ${request.prompts.length} were required.`);
      return Promise.all(items.map((item) => consumeImageItem(item, request.output.maxBytes)));
    } finally {
      if (completionTimer) clearTimeout(completionTimer); signal?.removeEventListener("abort", abort); off(); session.close();
    }
  }
}

export interface PlatformApiKeyProvider { getApiKey(): Promise<string | undefined> }

function redact(value: string) { return value.replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]"); }

async function platformFetch(provider: PlatformApiKeyProvider, url: string, init: RequestInit) {
  const apiKey = await provider.getApiKey();
  if (!apiKey) throw new Error("No OpenAI Platform API key is available in the operating-system keychain.");
  const response = await fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(redact(`OpenAI request failed (${response.status}): ${(await response.text()).slice(0, 800)}`));
  return response;
}

function outputFormat(encoding: VisualGenerationRequest["output"]["encoding"]) { return encoding === "jpeg" ? "jpeg" : encoding; }
function size(output: VisualGenerationRequest["output"]) { return `${output.width}x${output.height}`; }

export class OpenAIImageApiAdapter implements VisualGenerationAdapter {
  readonly id = "openai-image-api" as const;
  readonly credentialMode = "platform-keychain" as const;
  readonly model: string;
  constructor(private readonly keyProvider: PlatformApiKeyProvider, options: { model?: string; baseUrl?: string } = {}) {
    this.model = options.model ?? "gpt-image-2"; this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }
  private readonly baseUrl: string;

  async generate(request: VisualGenerationRequest, signal?: AbortSignal) {
    const results: VisualGenerationOutput[] = [];
    for (const prompt of request.prompts) {
      let response: Response;
      const images = request.inputAssets.filter((item) => item.bytes && item.purpose !== "mask");
      if (images.length) {
        const form = new FormData(); form.set("model", this.model); form.set("prompt", prompt); form.set("size", size(request.output)); form.set("quality", request.output.quality); form.set("output_format", outputFormat(request.output.encoding)); form.set("background", request.output.background);
        if (request.output.compression !== undefined) form.set("output_compression", String(request.output.compression));
        images.forEach((image, index) => form.append("image[]", new Blob([Uint8Array.from(image.bytes!).buffer], { type: image.mediaType }), `input-${index}.${outputFormat(request.output.encoding)}`));
        response = await platformFetch(this.keyProvider, `${this.baseUrl}/images/edits`, { method: "POST", body: form, signal });
      } else {
        response = await platformFetch(this.keyProvider, `${this.baseUrl}/images/generations`, { method: "POST", headers: { "content-type": "application/json" }, signal, body: JSON.stringify({ model: this.model, prompt, size: size(request.output), quality: request.output.quality, output_format: outputFormat(request.output.encoding), output_compression: request.output.compression, background: request.output.background, n: 1 }) });
      }
      const body = await response.json() as { data?: Array<{ b64_json?: string; revised_prompt?: string }> };
      const image = body.data?.[0]; if (!image?.b64_json) throw new Error("OpenAI Image API returned no image data.");
      results.push({ bytes: decodeImageResult(image.b64_json), revisedPrompt: image.revised_prompt });
    }
    return results;
  }
}

export class OpenAIResponsesImageAdapter implements VisualGenerationAdapter {
  readonly id = "openai-responses-api" as const;
  readonly credentialMode = "platform-keychain" as const;
  readonly model: string;
  private readonly baseUrl: string;
  constructor(private readonly keyProvider: PlatformApiKeyProvider, options: { model?: string; baseUrl?: string } = {}) {
    this.model = options.model ?? "gpt-5.6"; this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  async generate(request: VisualGenerationRequest, signal?: AbortSignal) {
    const results: VisualGenerationOutput[] = [];
    for (const prompt of request.prompts) {
      const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
      for (const image of request.inputAssets.filter((item) => item.bytes && item.mediaType)) content.push({ type: "input_image", image_url: `data:${image.mediaType};base64,${Buffer.from(image.bytes!).toString("base64")}` });
      const response = await platformFetch(this.keyProvider, `${this.baseUrl}/responses`, { method: "POST", headers: { "content-type": "application/json" }, signal, body: JSON.stringify({ model: this.model, input: [{ role: "user", content }], tools: [{ type: "image_generation", action: request.inputAssets.some((item) => item.purpose === "edit-source") ? "edit" : "generate", size: size(request.output), quality: request.output.quality, output_format: outputFormat(request.output.encoding), background: request.output.background }] }) });
      const body = await response.json() as { id?: string; output?: Array<{ type?: string; id?: string; result?: string; revised_prompt?: string }> };
      const image = body.output?.find((item) => item.type === "image_generation_call" && item.result);
      if (!image?.result) throw new Error("OpenAI Responses API returned no image_generation_call output.");
      results.push({ bytes: decodeImageResult(image.result), providerItemId: image.id, providerResponseId: body.id, revisedPrompt: image.revised_prompt });
    }
    return results;
  }
}

export function createDefaultVisualGenerationAdapter() { return new CodexAppServerImageAdapter(); }
