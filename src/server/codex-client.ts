import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import readline from "node:readline";
import type { ProjectData, SelectionContext } from "@/domain/types";
import type { ProjectPatch } from "./refine";
import { bundleRoot, codexEntrypoint, projectRoot } from "./paths";

type RpcMessage = { id?: number; method?: string; result?: unknown; error?: { message?: string }; params?: Record<string, unknown> };

export interface VisualCheckReport {
  phase: "before" | "after";
  file: string;
  renders: Record<string, { viewport: { width: number; height: number }; horizontalOverflow: boolean; pixelDifference?: number | null }>;
  generatedAt: string;
}

export interface WebRefinementResult {
  source: "codex";
  summary: string;
  unsupportedReason?: string;
  threadId: string;
  changed: boolean;
  filesModified: string[];
}

const patchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "subhead", "eyebrow", "finalHeadline", "primaryCta", "visualDirection", "colors", "navigation", "unsupportedReason", "summary"],
  properties: {
    headline: { type: ["string", "null"], maxLength: 120 }, subhead: { type: ["string", "null"], maxLength: 300 }, eyebrow: { type: ["string", "null"], maxLength: 80 }, finalHeadline: { type: ["string", "null"], maxLength: 160 }, primaryCta: { type: ["string", "null"], maxLength: 60 }, visualDirection: { type: ["string", "null"], maxLength: 300 }, summary: { type: "string", minLength: 1, maxLength: 400 },
    colors: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["primary", "secondary", "accent", "background", "surface", "text"], properties: { primary: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, secondary: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, accent: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, background: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, surface: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, text: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" } } }] },
    navigation: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["showIcons", "items"], properties: { showIcons: { type: "boolean" }, items: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["label", "icon"], properties: { label: { type: "string", minLength: 1, maxLength: 40 }, icon: { type: "string", enum: ["layers", "compass", "chart", "sparkles", "leaf", "arrow"] } } } } } }] },
    unsupportedReason: { type: ["string", "null"], maxLength: 300 }
  }
};

const artifactResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "filesModified", "visualNotes", "unsupportedReason"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 500 },
    filesModified: { type: "array", maxItems: 8, items: { type: "string", maxLength: 160 } },
    visualNotes: { type: "string", maxLength: 600 },
    unsupportedReason: { type: ["string", "null"], maxLength: 300 }
  }
};

class AppServerConnection {
  private child: ChildProcessWithoutNullStreams;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private listeners = new Set<(message: RpcMessage) => void>();

  constructor() {
    this.child = spawn(process.execPath, [codexEntrypoint, "app-server", "--stdio"], { cwd: bundleRoot, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        const message = JSON.parse(line) as RpcMessage;
        if (message.id !== undefined && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id)!;
          this.pending.delete(message.id);
          message.error ? pending.reject(new Error(message.error.message ?? "Codex App Server error")) : pending.resolve(message.result);
        }
        this.listeners.forEach((listener) => listener(message));
      } catch { /* App Server emits JSONL; ignore non-JSON diagnostics. */ }
    });
    this.child.stderr.on("data", () => undefined);
    this.child.on("error", (error) => {
      this.pending.forEach(({ reject }) => reject(error));
      this.pending.clear();
    });
  }

  request(method: string, params: unknown, timeoutMs = 90_000) {
    const id = ++this.requestId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  notify(method: string, params: unknown = {}) { this.child.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  onMessage(listener: (message: RpcMessage) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() { this.child.kill(); }
}

const studioModel = () => process.env.CODEX_STUDIO_MODEL ?? "gpt-5.6-sol";

export function parseStructuredOutput(output: string): ProjectPatch {
  return parseJsonOutput<ProjectPatch>(output);
}

function parseJsonOutput<T>(output: string): T {
  const cleaned = output.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const starts = [...cleaned.matchAll(/\{/g)].map((match) => match.index ?? 0).reverse();
    for (const start of starts) {
      try {
        return JSON.parse(cleaned.slice(start)) as T;
      } catch {
        // Continue until the final complete top-level JSON object is found.
      }
    }
    throw new Error("Codex returned an invalid structured patch.");
  }
}

export async function codexStatus() {
  const binary = codexEntrypoint;
  let available = false;
  try {
    await access(binary, constants.X_OK);
    available = true;
  } catch {
    // The UI can still use the deterministic fallback when Codex is unavailable.
  }
  return { available, binary, model: studioModel(), cliVersion: "0.144.5" };
}

const digest = (content: string) => createHash("sha256").update(content).digest("hex");

function validEditableLanding(content: string) {
  return content.includes("data-design-id=") && content.includes("design-selection") && content.includes("parent.postMessage");
}

export async function runCodexWebRefinement(project: ProjectData, instruction: string, selection?: SelectionContext): Promise<WebRefinementResult> {
  const root = projectRoot(project.id);
  const landingPath = path.join(root, "web", "index.html");
  const before = await readFile(landingPath, "utf8");
  const connection = new AppServerConnection();
  let output = "";
  try {
    await connection.request("initialize", { clientInfo: { name: "codex-design-studio", title: "Codex Design Studio", version: "0.2.0" }, capabilities: { experimentalApi: true } });
    connection.notify("initialized");
    const skillPath = path.join(bundleRoot, "skills", "web-art-director", "SKILL.md");
    const visualScript = path.join(bundleRoot, "skills", "web-art-director", "scripts", "visual-check.mjs");
    const settings = { cwd: root, model: studioModel(), approvalPolicy: "never", sandbox: "workspace-write", developerInstructions: `You are the Web art-direction engine inside Codex Design Studio. Read and follow ${skillPath}. Work only inside the active project. You must edit the actual artifact; never merely describe an intended change. The Studio host owns the Playwright before/after transaction for this turn, so inspect the existing baseline but do not launch the visual checker yourself.` };
    let threadResponse: { thread: { id: string } };
    if (project.threadId) {
      try { threadResponse = await connection.request("thread/resume", { threadId: project.threadId, ...settings }) as { thread: { id: string } }; }
      catch { threadResponse = await connection.request("thread/start", { ...settings, ephemeral: false }) as { thread: { id: string } }; }
    } else {
      threadResponse = await connection.request("thread/start", { ...settings, ephemeral: false }) as { thread: { id: string } };
    }
    const threadId = threadResponse.thread.id;
    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Codex Web refinement timed out")), 180_000);
      const off = connection.onMessage((message) => {
        if (message.method === "item/agentMessage/delta") output += String(message.params?.delta ?? "");
        if (message.method === "turn/completed") { clearTimeout(timeout); off(); resolve(); }
        if (message.method === "error") { clearTimeout(timeout); off(); reject(new Error(String((message.params?.error as { message?: string } | undefined)?.message ?? "Codex Web refinement failed"))); }
      });
    });
    const prompt = `Modify web/index.html to satisfy this design instruction: ${JSON.stringify(instruction)}.\nSelected context: ${JSON.stringify(selection ?? null)}.\nBrand: ${JSON.stringify(project.brand)}.\nTokens: ${JSON.stringify(project.tokens)}.\nThe baseline screenshots already exist in reviews/visual. Make a real source edit and preserve the selection bridge. Do not run ${visualScript}; the host will render both viewports and reject broken output immediately after this turn. A Web-only edit must not be described as propagating to slides.`;
    await connection.request("turn/start", { threadId, input: [{ type: "text", text: prompt }], outputSchema: artifactResultSchema, effort: "medium" }, 150_000);
    await completed;
    const after = await readFile(landingPath, "utf8");
    if (!validEditableLanding(after)) {
      await writeFile(landingPath, before, "utf8");
      throw new Error("Codex removed required preview instrumentation; the original artifact was restored.");
    }
    const report = parseJsonOutput<{ summary: string; filesModified: string[]; visualNotes: string; unsupportedReason: string | null }>(output);
    const changed = digest(before) !== digest(after);
    return { source: "codex", summary: changed ? report.summary : "No source change was applied.", unsupportedReason: changed ? undefined : report.unsupportedReason ?? "Codex did not change the artifact.", threadId, changed, filesModified: changed ? ["web/index.html"] : [] };
  } catch (error) {
    await writeFile(landingPath, before, "utf8");
    throw error;
  } finally {
    connection.close();
  }
}

export async function runCodexRefinement(project: ProjectData, instruction: string, selection?: SelectionContext): Promise<{ patch: ProjectPatch; threadId: string }> {
  const connection = new AppServerConnection();
  let output = "";
  try {
    await connection.request("initialize", { clientInfo: { name: "codex-design-studio", title: "Codex Design Studio", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    connection.notify("initialized");
    const threadSettings = { cwd: projectRoot(project.id), model: studioModel(), approvalPolicy: "never", sandbox: "read-only", developerInstructions: "You are the brand refinement engine inside Codex Design Studio. Apply the workflow in ../../skills/brand-studio/SKILL.md. Return only the requested structured patch. Never claim a change unless it is represented by a non-null patch field. Use unsupportedReason when the safe contract cannot express the request. Preserve accessibility and specificity." };
    let threadResponse: { thread: { id: string } };
    if (project.threadId) {
      try {
        threadResponse = await connection.request("thread/resume", { threadId: project.threadId, ...threadSettings }) as { thread: { id: string } };
      } catch {
        threadResponse = await connection.request("thread/start", { ...threadSettings, ephemeral: false }) as { thread: { id: string } };
      }
    } else {
      threadResponse = await connection.request("thread/start", { ...threadSettings, ephemeral: false }) as { thread: { id: string } };
    }
    const threadId = threadResponse.thread.id;
    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Codex refinement timed out")), 90_000);
      const off = connection.onMessage((message) => {
        if (message.method === "item/agentMessage/delta") output += String(message.params?.delta ?? "");
        if (message.method === "turn/completed") { clearTimeout(timeout); off(); resolve(); }
        if (message.method === "error") {
          clearTimeout(timeout); off();
          const nested = message.params?.error as { message?: string } | undefined;
          reject(new Error(String(nested?.message ?? message.params?.message ?? "Codex turn failed")));
        }
      });
    });
    const prompt = `Refine the selected branded deliverable from this instruction: ${JSON.stringify(instruction)}.\nSelection: ${JSON.stringify(selection ?? null)}\nCurrent brand: ${JSON.stringify(project.brand)}\nCurrent tokens: ${JSON.stringify(project.tokens)}\nCurrent landing: ${JSON.stringify(project.landing)}\nReturn a minimal patch. Navigation icons are supported through navigation.showIcons and navigation.items. Any colour must be a six-digit hex value. Describe only changes represented in the patch: component-level edits stay local to that deliverable, while shared token changes propagate across formats. If the request cannot be expressed by the schema, leave every mutation field null and provide unsupportedReason.`;
    await connection.request("turn/start", { threadId, input: [{ type: "text", text: prompt }], outputSchema: patchSchema, effort: "medium" });
    await completed;
    return { patch: parseStructuredOutput(output), threadId };
  } finally {
    connection.close();
  }
}
