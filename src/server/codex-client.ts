import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ProjectData, SelectionContext } from "@/domain/types";
import type { ProjectPatch } from "./refine";
import { projectRoot } from "./paths";

type RpcMessage = { id?: number; method?: string; result?: unknown; error?: { message?: string }; params?: Record<string, unknown> };

const patchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "subhead", "eyebrow", "finalHeadline", "primaryCta", "visualDirection", "colors", "summary"],
  properties: {
    headline: { type: ["string", "null"], maxLength: 120 }, subhead: { type: ["string", "null"], maxLength: 300 }, eyebrow: { type: ["string", "null"], maxLength: 80 }, finalHeadline: { type: ["string", "null"], maxLength: 160 }, primaryCta: { type: ["string", "null"], maxLength: 60 }, visualDirection: { type: ["string", "null"], maxLength: 300 }, summary: { type: "string", minLength: 1, maxLength: 400 },
    colors: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["primary", "secondary", "accent", "background", "surface", "text"], properties: { primary: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, secondary: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, accent: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, background: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, surface: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, text: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" } } }] }
  }
};

class AppServerConnection {
  private child: ChildProcessWithoutNullStreams;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private listeners = new Set<(message: RpcMessage) => void>();

  constructor() {
    const binary = path.join(process.cwd(), "node_modules", ".bin", "codex");
    this.child = spawn(binary, ["app-server", "--stdio"], { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
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
  const cleaned = output.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as ProjectPatch;
  } catch {
    const starts = [...cleaned.matchAll(/\{/g)].map((match) => match.index ?? 0).reverse();
    for (const start of starts) {
      try {
        return JSON.parse(cleaned.slice(start)) as ProjectPatch;
      } catch {
        // Continue until the final complete top-level JSON object is found.
      }
    }
    throw new Error("Codex returned an invalid structured patch.");
  }
}

export async function codexStatus() {
  const binary = path.join(process.cwd(), "node_modules", ".bin", "codex");
  let available = false;
  try {
    await access(binary, constants.X_OK);
    available = true;
  } catch {
    // The UI can still use the deterministic fallback when Codex is unavailable.
  }
  return { available, binary, model: studioModel(), cliVersion: "0.144.5" };
}

export async function runCodexRefinement(project: ProjectData, instruction: string, selection?: SelectionContext): Promise<{ patch: ProjectPatch; threadId: string }> {
  const connection = new AppServerConnection();
  let output = "";
  try {
    await connection.request("initialize", { clientInfo: { name: "codex-design-studio", title: "Codex Design Studio", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    connection.notify("initialized");
    const threadSettings = { cwd: projectRoot(project.id), model: studioModel(), approvalPolicy: "never", sandbox: "read-only", developerInstructions: "You are the brand refinement engine inside Codex Design Studio. Apply the workflow in ../../skills/brand-studio/SKILL.md. Return only the requested structured patch. Preserve accessibility, specificity and cross-format consistency." };
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
    const prompt = `Refine the selected branded deliverable from this instruction: ${JSON.stringify(instruction)}.\nSelection: ${JSON.stringify(selection ?? null)}\nCurrent brand: ${JSON.stringify(project.brand)}\nCurrent tokens: ${JSON.stringify(project.tokens)}\nCurrent landing: ${JSON.stringify(project.landing)}\nReturn a minimal patch. Any colour must be a six-digit hex value. The summary must name what changed and that the change propagates to web and slides.`;
    await connection.request("turn/start", { threadId, input: [{ type: "text", text: prompt }], outputSchema: patchSchema, effort: "medium" });
    await completed;
    return { patch: parseStructuredOutput(output), threadId };
  } finally {
    connection.close();
  }
}
