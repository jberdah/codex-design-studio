import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrategicCreativeBriefVersion } from "@/domain/bootstrap";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-bootstrap-codex-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

function contentOf(brief: StrategicCreativeBriefVersion) {
  const { id: _id, version: _version, status: _status, createdAt: _createdAt, createdBy: _createdBy, ...content } = brief;
  return content;
}

describe("authenticated Codex bootstrap synthesis", () => {
  it("strictly parses and validates structured briefs and their evidence references", async () => {
    const bootstrap = await import("@/server/bootstrap");
    const codex = await import("@/server/bootstrap-codex");
    const session = await bootstrap.createBootstrapSession({ brandName: "Trace", objective: "Make risk evidence easier to act on", targetDeliverable: "web", audience: "Operations teams" });
    const valid = contentOf(bootstrap.deterministicBootstrapSynthesis(session));
    const parsed = codex.parseCodexBootstrapBrief(JSON.stringify(valid), session);
    expect(parsed).toMatchObject({ createdBy: "codex", facts: expect.arrayContaining([expect.objectContaining({ evidenceIds: ["input:objective"] })]) });

    expect(() => codex.parseCodexBootstrapBrief(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, session)).toThrow("invalid JSON");
    const invented = structuredClone(valid);
    invented.facts[0].evidenceIds = ["evidence:not-allowed"];
    expect(() => codex.parseCodexBootstrapBrief(JSON.stringify(invented), session)).toThrow("unsupported evidence id");
    const tooManyQuestions = structuredClone(valid);
    tooManyQuestions.questions = Array.from({ length: 4 }, (_, index) => ({ id: `q-${index}`, field: "industry" as const, prompt: "Context?", reason: "Changes the work", required: false, options: [] }));
    expect(() => codex.parseCodexBootstrapBrief(JSON.stringify(tooManyQuestions), session)).toThrow("at most three");
  });

  it("uses an ephemeral read-only App Server turn with no tools or credentials", async () => {
    const bootstrap = await import("@/server/bootstrap");
    const { CodexBootstrapSynthesizer } = await import("@/server/bootstrap-codex");
    const session = await bootstrap.createBootstrapSession({
      brandName: "Compass", objective: "Help service teams choose the next action", targetDeliverable: "slides",
      sourceRefs: [{ id: "reference", kind: "url", label: "Reference site", intent: "inspire", locator: "https://example.test" }]
    });
    const planned = contentOf(bootstrap.deterministicBootstrapSynthesis(session));
    const calls: Array<{ method: string; params: unknown }> = [];
    let listener: (message: { method?: string; params?: Record<string, unknown> }) => void = () => undefined;
    const appServer = {
      async request(method: string, params: unknown) {
        calls.push({ method, params });
        if (method === "thread/start") return { thread: { id: "bootstrap-thread" } };
        if (method === "turn/start") {
          queueMicrotask(() => {
            listener({ method: "item/agentMessage/delta", params: { delta: JSON.stringify(planned) } });
            listener({ method: "turn/completed", params: {} });
          });
          return { turn: { id: "bootstrap-turn" } };
        }
        return {};
      },
      notify: vi.fn(),
      onMessage(next: typeof listener) { listener = next; return () => undefined; },
      close: vi.fn()
    };
    const result = await new CodexBootstrapSynthesizer({ model: "gpt-test", timeoutMs: 1_000, sessionFactory: () => appServer }).synthesize(session);
    expect(result.createdBy).toBe("codex");
    expect(calls.find((call) => call.method === "thread/start")?.params).toMatchObject({ model: "gpt-test", sandbox: "read-only", approvalPolicy: "never", ephemeral: true });
    expect(String((calls.find((call) => call.method === "thread/start")?.params as { developerInstructions?: string }).developerInstructions)).toMatch(/do not call tools/i);
    const turn = calls.find((call) => call.method === "turn/start")?.params as { outputSchema?: unknown; input?: Array<{ text?: string }> };
    expect(turn.outputSchema).toBeTruthy();
    expect(turn.input?.[0].text).toContain("immutableOriginalInput");
    expect(turn.input?.[0].text).toContain("Reference sources are linked, but no reviewed evidence values");
    expect(JSON.stringify(calls)).not.toMatch(/apiKey|Bearer|sk-/i);
    expect(appServer.close).toHaveBeenCalled();
  });

  it("falls back transparently on unavailable or invalid Codex output with a redacted warning", async () => {
    const bootstrap = await import("@/server/bootstrap");
    const { synthesizeBootstrapWithCodexFallback } = await import("@/server/bootstrap-codex");
    const started = await bootstrap.createBootstrapSession({ brandName: "Fallback", objective: "Clarify the next decision", targetDeliverable: "web" });
    const outcome = await synthesizeBootstrapWithCodexFallback(started.id, { synthesizer: { async synthesize() { throw new Error("Unauthorized sk-live-secret"); } } });
    expect(outcome).toMatchObject({ session: { status: "review" }, synthesis: { source: "deterministic", warning: "Codex synthesis was unavailable; a deterministic brief was created instead." } });
    expect(outcome.synthesis.warning).not.toContain("sk-live-secret");
    expect(outcome.session.briefs.at(-1)?.createdBy).toBe("system");
    expect(outcome.session.events.map((event) => event.action)).toEqual(expect.arrayContaining(["synthesis.failed", "synthesis.completed"]));
  });

  it("reports Codex as the source when authenticated synthesis succeeds", async () => {
    const bootstrap = await import("@/server/bootstrap");
    const { synthesizeBootstrapWithCodexFallback } = await import("@/server/bootstrap-codex");
    const started = await bootstrap.createBootstrapSession({ brandName: "Success", objective: "Make the product story concrete", targetDeliverable: "slides" });
    const generated = { ...bootstrap.deterministicBootstrapSynthesis(started), createdBy: "codex" as const };
    const outcome = await synthesizeBootstrapWithCodexFallback(started.id, { synthesizer: { async synthesize() { return generated; } } });
    expect(outcome).toMatchObject({ session: { status: "review" }, synthesis: { source: "codex" } });
    expect(outcome.synthesis.warning).toBeUndefined();
    expect(outcome.session.briefs[0].createdBy).toBe("codex");
  });

  const liveIt = process.env.CODEX_STUDIO_LIVE_BOOTSTRAP === "1" ? it : it.skip;
  liveIt("runs the real ChatGPT-authenticated App Server planner when explicitly enabled", async () => {
    const bootstrap = await import("@/server/bootstrap");
    const { CodexBootstrapSynthesizer } = await import("@/server/bootstrap-codex");
    const session = await bootstrap.createBootstrapSession({ brandName: "Live bootstrap", objective: "Create a concise evidence-aware launch direction", targetDeliverable: "web" });
    const brief = await new CodexBootstrapSynthesizer({ timeoutMs: 120_000 }).synthesize(session);
    expect(brief).toMatchObject({ createdBy: "codex", status: "draft" });
    expect(brief.questions.length).toBeLessThanOrEqual(3);
  }, 150_000);
});
