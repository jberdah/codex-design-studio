import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-openai-reference-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

const liveIt = process.env.CODEX_STUDIO_LIVE_REFERENCE === "1" ? it : it.skip;

liveIt("captures openai.com as non-blocking inspiration, synthesizes, approves and preserves provenance", async () => {
  const bootstrap = await import("@/server/bootstrap");
  const reference = await import("@/server/bootstrap-reference");
  const sources = await import("@/server/source-store");
  const store = await import("@/server/store");

  const started = await bootstrap.createBootstrapSession({
    brandName: "OpenAI Inspiration Study",
    audience: "People evaluating a focused AI product",
    objective: "Create a concise AI product launch experience inspired by OpenAI's visual language without copying its assets or text",
    targetDeliverable: "web",
    sourceRefs: [{
      id: "openai-site",
      kind: "url",
      label: "OpenAI",
      locator: "https://openai.com",
      intent: "inspire",
      relationship: "third-party",
      rights: {
        confirmed: false,
        notes: "Public visual inspiration only",
        relationship: "third-party",
        permissions: { analyze: true, inspire: true, reproduceAssets: false, reproduceCopy: false, distribute: false }
      }
    }]
  });

  const outcome = await reference.synthesizeBootstrapWithPreparedReference(started.id);
  const snapshot = outcome.session.referenceSnapshot;
  expect(outcome.reference?.status).toMatch(/ready|partial/);
  expect(snapshot).toMatchObject({
    effectiveIntent: "inspire",
    role: "inspiration",
    warning: { code: "reference_rights_unconfirmed" }
  });
  expect(snapshot?.observations.length).toBeGreaterThan(0);
  expect(snapshot?.observations.every((item) => item.status === "inspiration")).toBe(true);
  expect(snapshot?.observations.every((item) => item.kind !== "copy")).toBe(true);
  expect(outcome.session.briefs.at(-1)?.inferences).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "inference:reference-direction" })
  ]));
  expect(outcome.session.projectDraft?.brand.visualDirection).toContain("non-binding inspiration");

  const approved = await bootstrap.approveBootstrapSession(outcome.session.id, outcome.session.activeBriefVersion);
  const graph = await sources.loadProvenanceGraph(approved.project.id);
  expect(graph.sources).toHaveLength(1);
  expect(graph.sources[0]).toMatchObject({
    kind: "url",
    intent: "inspire",
    role: "inspiration",
    origin: { locator: expect.stringMatching(/^https:\/\/openai\.com\/?/) }
  });
  expect(graph.extractionRuns).toHaveLength(1);
  expect(graph.candidates.length).toBeGreaterThan(0);
  expect((await store.loadProject(approved.project.id)).id).toBe(approved.project.id);
  expect((await store.listProjects()).map((project) => project.id)).toEqual([approved.project.id]);
  await expect(access(path.join(workspace, "projects", reference.bootstrapStagingProjectId(started.id)))).rejects.toMatchObject({ code: "ENOENT" });

  console.info("OPENAI_REFERENCE_RESULT", JSON.stringify({
    projectId: approved.project.id,
    captureStatus: snapshot?.status,
    observations: snapshot?.observations.length,
    observationKinds: [...new Set(snapshot?.observations.map((item) => item.kind))],
    candidates: graph.candidates.length,
    runStatus: graph.extractionRuns[0]?.status,
    warning: snapshot?.warning?.code,
    visualDirection: approved.project.brand.visualDirection
  }));
}, 180_000);
