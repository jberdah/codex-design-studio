import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-bootstrap-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

describe("resumable project bootstrap", () => {
  it("persists immutable intake and provenance links without creating a project", async () => {
    const { createBootstrapSession, loadBootstrapSession } = await import("@/server/bootstrap");
    const input = {
      projectName: "Northstar launch",
      brandName: "Northstar",
      objective: "Help procurement teams compare operational risk clearly",
      targetDeliverable: "web" as const,
      colors: { primary: "#123456" },
      sourceRefs: [{
        id: "reference-site", kind: "url" as const, label: "Existing site", locator: "https://example.test",
        intent: "inspire" as const, sourceId: "src_reference", runId: "run_reference", role: "inspiration" as const,
        relationship: "third-party" as const, rights: { confirmed: false, notes: "No copying", relationship: "third-party" as const }
      }],
      evidenceSnapshot: { id: "evs_1", contentHash: "abc123", evidenceIds: ["ev_manual"] }
    };
    const session = await createBootstrapSession(input);
    input.brandName = "Mutated outside";
    input.sourceRefs[0].label = "Mutated outside";
    const reloaded = await loadBootstrapSession(session.id);

    expect(reloaded).toMatchObject({ status: "ready", originalInput: { brandName: "Northstar", objective: "Help procurement teams compare operational risk clearly", targetDeliverable: "web" }, evidenceSnapshot: { id: "evs_1" } });
    expect(reloaded.sourceRefs[0]).toMatchObject({ sourceId: "src_reference", runId: "run_reference", intent: "inspire", role: "inspiration", rights: { confirmed: false } });
    expect(reloaded.inputHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(access(path.join(workspace, "projects"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("asks at most three blocking questions, keeps answers separate and synthesizes evidence-honest transformed copy", async () => {
    const { answerBootstrapQuestions, createBootstrapSession, synthesizeBootstrapSession } = await import("@/server/bootstrap");
    const started = await createBootstrapSession({ audience: "Independent operations leaders" });
    expect(started.questions.map((question) => question.field)).toEqual(["brandName", "objective", "targetDeliverable"]);
    expect(started.questions).toHaveLength(3);

    const ready = await answerBootstrapQuestions(started.id, [
      { questionId: "question:brandName", value: "Fieldnote" },
      { questionId: "question:objective", value: "Make complex field evidence easier to act on" },
      { questionId: "question:targetDeliverable", value: "slides" }
    ]);
    expect(ready).toMatchObject({ status: "ready", originalInput: { audience: "Independent operations leaders" }, answers: expect.any(Array) });
    expect(ready.originalInput.brandName).toBeUndefined();

    const reviewed = await synthesizeBootstrapSession(started.id);
    const brief = reviewed.briefs[0];
    expect(reviewed.status).toBe("review");
    expect(brief.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "fact:brandName", evidenceIds: ["answer:question:brandName"] }),
      expect.objectContaining({ id: "fact:objective", evidenceIds: ["answer:question:objective"] }),
      expect.objectContaining({ id: "fact:targetDeliverable", claim: "The first requested deliverable is slides." })
    ]));
    expect(brief.unknowns).toEqual(expect.arrayContaining(["industry has not been confirmed."]));
    expect(brief.assumptions[0]).toMatchObject({ status: "proposed", evidenceIds: [] });
    expect(reviewed.projectDraft?.landing.headline).toBe("Make complex field evidence easier to act on.");
    expect(JSON.stringify(reviewed.projectDraft)).not.toContain("42%");
    expect(JSON.stringify(reviewed.projectDraft)).not.toContain("3.4×");
    expect(reviewed.projectDraft?.slides[1]).toMatchObject({ type: "value", eyebrow: "STRATEGIC PRIORITIES" });
    await expect(access(path.join(workspace, "projects"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers failed synthesis and versions user brief revisions optimistically", async () => {
    const { createBootstrapSession, loadBootstrapSession, reviseBootstrapBrief, synthesizeBootstrapSession } = await import("@/server/bootstrap");
    const started = await createBootstrapSession({ brandName: "Relay", objective: "Align distributed teams around the next action", targetDeliverable: "web" });
    await expect(synthesizeBootstrapSession(started.id, async () => { throw new Error("Adapter temporarily unavailable"); })).rejects.toThrow("temporarily unavailable");
    expect(await loadBootstrapSession(started.id)).toMatchObject({ status: "failed", error: { recoverable: true } });

    const recovered = await synthesizeBootstrapSession(started.id);
    const edited = structuredClone(recovered.briefs[0]);
    edited.summary = "A reviewed summary that keeps the original objective while sharpening the creative opportunity.";
    const revised = await reviseBootstrapBrief(started.id, 1, edited);
    expect(revised).toMatchObject({ status: "review", activeBriefVersion: 2 });
    expect(revised.briefs.map((brief) => brief.status)).toEqual(["superseded", "draft"]);
    expect(revised.briefs[1]).toMatchObject({ createdBy: "user", summary: edited.summary });
    await expect(reviseBootstrapBrief(started.id, 1, edited)).rejects.toThrow("conflict");
  });

  it("creates the transformed project only after approval and keeps approval idempotent", async () => {
    const { approveBootstrapSession, createBootstrapSession, synthesizeBootstrapSession } = await import("@/server/bootstrap");
    const started = await createBootstrapSession({
      projectName: "Lumen decision system", brandName: "Lumen", objective: "Give service teams one clear operational next step", targetDeliverable: "web",
      audience: "Service operations teams", colors: { primary: "#223344", accent: "#FFCC44" }
    });
    await expect(approveBootstrapSession(started.id)).rejects.toThrow("before approval");
    await expect(access(path.join(workspace, "projects"))).rejects.toMatchObject({ code: "ENOENT" });

    const reviewed = await synthesizeBootstrapSession(started.id);
    const approved = await approveBootstrapSession(started.id, reviewed.activeBriefVersion);
    expect(approved.session).toMatchObject({ status: "approved", createdProjectId: approved.project.id });
    expect(approved.session.briefs.at(-1)?.status).toBe("approved");
    expect(approved.project).toMatchObject({ name: "Lumen decision system", brand: { name: "Lumen", audience: "Service operations teams" }, tokens: { colors: { primary: "#223344", accent: "#FFCC44" } } });
    expect(approved.project.landing.headline).toBe("Give service teams one clear operational next step.");
    const initial = JSON.parse(await readFile(path.join(workspace, "projects", approved.project.id, "history", "initial.json"), "utf8"));
    expect(initial.landing.headline).toBe(approved.project.landing.headline);

    const repeated = await approveBootstrapSession(started.id);
    expect(repeated.project.id).toBe(approved.project.id);
  });

  it("exposes start, resume, synthesize and approval through REST handlers", async () => {
    const root = await import("@/app/api/bootstrap/route");
    const detail = await import("@/app/api/bootstrap/[sessionId]/route");
    const synthesis = await import("@/app/api/bootstrap/[sessionId]/synthesize/route");
    const approval = await import("@/app/api/bootstrap/[sessionId]/approve/route");
    const startedResponse = await root.POST(new Request("http://studio.test/api/bootstrap", { method: "POST", body: JSON.stringify({ input: { brandName: "API brand", objective: "Explain the next decision", targetDeliverable: "slides" } }) }));
    const started = await startedResponse.json();
    expect(startedResponse.status).toBe(201);
    const context = { params: Promise.resolve({ sessionId: started.session.id as string }) };
    expect((await (await detail.GET(new Request("http://studio.test"), context)).json()).session.status).toBe("ready");
    expect((await (await synthesis.POST(new Request("http://studio.test", { method: "POST" }), context)).json()).session.status).toBe("review");
    const approvedResponse = await approval.POST(new Request("http://studio.test", { method: "POST", body: "{}" }), context);
    expect(approvedResponse.status).toBe(201);
    expect((await approvedResponse.json()).project.brand.name).toBe("API brand");
  });
});
