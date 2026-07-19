import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebRenderAudit, WebVisualCheckReport } from "@/domain/quality";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-web-candidate-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true });
});

function audit(overflow: boolean, phase: "before" | "after"): WebRenderAudit {
  return {
    viewport: { width: 1440, height: 1000 }, screenshot: `reviews/visual/${phase}-desktop.png`, horizontalOverflow: overflow,
    clippedElements: [], brokenAssets: [], contrast: [], focusOrder: { locators: [], positiveTabIndexes: [], duplicateLandmarks: [] },
    landmarks: { main: 1, navigation: 1, header: 1, footer: 1, unlabeledNavigation: 0, h1: 1 },
    structure: { headingCount: 1, interactiveCount: 0, designNodeIds: ["hero"], bodyScrollHeight: 1000 }, pixelDifference: phase === "after" ? 0.2 : undefined,
    findings: [{ id: "desktop:overflow", status: overflow ? "error" : "pass", message: overflow ? "New overflow" : "No overflow", evidence: { overflow } }]
  };
}

function report(phase: "before" | "after", render: WebRenderAudit): WebVisualCheckReport {
  return { schemaVersion: 2, phase, file: "web/index.html", renders: { desktop: render }, summary: { errors: render.horizontalOverflow ? 1 : 0, warnings: 0, responsiveStates: ["desktop"] }, generatedAt: "2026-07-19T00:00:00.000Z" };
}

async function fixture(projectId: string) {
  const store = await import("@/server/store");
  const quality = await import("@/server/quality");
  const candidates = await import("@/server/web-candidates");
  const project = await store.loadProject(projectId);
  const beforeHtml = await store.loadLandingHtml(projectId);
  const candidateHtml = beforeHtml.replace("</body>", '<div style="width:200vw">candidate</div></body>');
  const before = report("before", audit(false, "before"));
  const after = report("after", audit(true, "after"));
  const assessment = quality.assessWebMutation({ beforeSource: beforeHtml, afterSource: candidateHtml, beforeReport: before, report: after, claimedChanged: true });
  const candidate = await candidates.createWebRefinementCandidate(projectId, {
    instruction: "Make it wider", summary: "Created an intentionally wide direction.", baseProjectVersion: project.version,
    beforeHtml, candidateHtml, assessment, visual: after, clock: () => new Date("2026-07-19T00:00:00.000Z")
  });
  return { store, candidates, project, beforeHtml, candidateHtml, candidate };
}

describe("Web refinement candidate lifecycle", () => {
  it("preserves evidence and activates an explicitly accepted candidate with warnings", async () => {
    const { store, candidates, project, beforeHtml, candidateHtml, candidate } = await fixture("accept-candidate");
    expect(await store.loadLandingHtml(project.id)).toBe(beforeHtml);
    expect(candidate).toMatchObject({ status: "pending", baseProjectVersion: project.version, assessment: { accepted: false } });
    const evidenceRoot = path.join(workspace, "projects", project.id, "reviews", "candidates", candidate.id);
    expect(await readFile(path.join(evidenceRoot, "before.html"), "utf8")).toBe(beforeHtml);
    expect(await readFile(path.join(evidenceRoot, "candidate.html"), "utf8")).toBe(candidateHtml);

    const accepted = await candidates.acceptWebRefinementCandidate(project.id, candidate.id);
    expect(accepted.candidate.status).toBe("accepted");
    expect(accepted.project).toMatchObject({ version: project.version + 1, webCustomized: true });
    expect(await store.loadLandingHtml(project.id)).toBe(candidateHtml);
    await expect(candidates.acceptWebRefinementCandidate(project.id, candidate.id)).rejects.toThrow(/already accepted/i);
  });

  it("keeps the active source when rejected and refuses stale acceptance", async () => {
    const rejectedFixture = await fixture("reject-candidate");
    const rejected = await rejectedFixture.candidates.rejectWebRefinementCandidate(rejectedFixture.project.id, rejectedFixture.candidate.id);
    expect(rejected.candidate.status).toBe("rejected");
    expect(await rejectedFixture.store.loadLandingHtml(rejectedFixture.project.id)).toBe(rejectedFixture.beforeHtml);

    const staleFixture = await fixture("stale-candidate");
    await staleFixture.store.mutateProject(staleFixture.project.id, staleFixture.project.version, (project) => { project.lastSummary = "A later edit won."; }, { renderWeb: false });
    await expect(staleFixture.candidates.acceptWebRefinementCandidate(staleFixture.project.id, staleFixture.candidate.id)).rejects.toThrow(/stale/i);
    expect(await staleFixture.store.loadLandingHtml(staleFixture.project.id)).toBe(staleFixture.beforeHtml);
  });
});
