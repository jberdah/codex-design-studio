import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebDocument } from "@/domain/artifacts";
import type { GoldenBaseline, ReviewEvidence, WebRenderAudit, WebVisualCheckReport } from "@/domain/quality";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-quality-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
});

function evidence(versionId = "av_candidate", brandSystemVersionId = "bsv_brand"): ReviewEvidence[] {
  return [{
    id: "ev_hierarchy", kind: "screenshot", artifactVersionId: versionId, brandSystemVersionId,
    locator: "screenshots/desktop.png", description: "Desktop capture shows the hero hierarchy.", capturedAt: "2026-07-18T12:00:00.000Z"
  }];
}

function render(overrides: Partial<WebRenderAudit> = {}): WebRenderAudit {
  return {
    viewport: { width: 1440, height: 1000 }, screenshot: "reviews/visual/after-desktop.png", horizontalOverflow: false,
    clippedElements: [], brokenAssets: [], contrast: [], focusOrder: { locators: [], positiveTabIndexes: [], duplicateLandmarks: [] },
    landmarks: { main: 1, navigation: 1, header: 1, footer: 1, unlabeledNavigation: 0, h1: 1 },
    structure: { headingCount: 2, interactiveCount: 1, designNodeIds: ["hero"], bodyScrollHeight: 1000 }, pixelDifference: 0.2,
    findings: [{ id: "desktop:overflow", status: "pass", message: "No overflow", evidence: {} }], ...overrides
  };
}

function report(phase: "before" | "after", audit: WebRenderAudit): WebVisualCheckReport {
  return { schemaVersion: 2, phase, file: "web/index.html", renders: { desktop: audit }, summary: { errors: 0, warnings: 0, responsiveStates: ["desktop"] }, generatedAt: "2026-07-18T12:00:00.000Z" };
}

async function approvedArtifact(projectId: string) {
  const brandSystem = await import("@/server/brand-system");
  const artifacts = await import("@/server/artifacts");
  const draft = await brandSystem.createBrandSystemDraft(projectId);
  await brandSystem.publishBrandSystem(projectId, draft.snapshot.id);
  const version = await artifacts.createArtifactVersion(projectId, {
    artifactId: "landing", kind: "web", brandSystemVersionId: draft.snapshot.id,
    document: createWebDocument({ documentId: "landing", html: '<main data-design-node-id="hero"><h1>Clear decisions</h1></main>' })
  });
  return { artifacts, version, brandSystemVersionId: draft.snapshot.id };
}

describe("version-bound review modes", () => {
  it("keeps creative exploration separate from deterministic regression gating", async () => {
    const quality = await import("@/server/quality");
    const exploration = quality.createExplorationReview({
      artifactId: "landing", artifactVersionId: "av_candidate", brandSystemVersionId: "bsv_brand",
      directionId: "human-momentum", intendedDeviations: ["Asymmetric hero"], recommendation: "iterate",
      evidence: evidence(), findings: [{ id: "hierarchy", category: "hierarchy", severity: "suggestion", claim: "The proof enters too late.", evidenceIds: ["ev_hierarchy"] }]
    });
    expect(exploration).toMatchObject({ kind: "exploration", recommendation: "iterate", intendedDeviations: ["Asymmetric hero"] });
    expect(exploration).not.toHaveProperty("status");

    const baseline: GoldenBaseline = {
      schemaVersion: 1, id: "gold_approved", artifactId: "landing", artifactVersionId: "av_approved", brandSystemVersionId: "bsv_brand",
      approval: { status: "approved", approvedAt: "2026-07-18T12:00:00.000Z", approvedBy: "user" }, createdAt: "2026-07-18T12:00:00.000Z",
      captures: [{ id: "desktop", label: "Desktop", width: 1440, height: 1000, source: "screenshots/desktop.png", contentHash: "abc" }],
      structuralInvariants: [{ key: "landmarks.main", value: 1, required: true }]
    };
    const intentional = quality.compareGoldenBaseline(baseline, {
      artifactVersionId: "av_next", structuralInvariants: [{ key: "landmarks.main", value: 1, required: true }], pixelDifferences: { desktop: 0.4 }
    }, { pixelThreshold: 0.01, declaredIntentionalChanges: ["New approved composition"] });
    expect(intentional.pixels[0].status).toBe("warning");
    const regression = quality.createRegressionReview({
      artifactId: "landing", brandSystemVersionId: "bsv_brand", comparison: intentional,
      declaredIntentionalChanges: ["New approved composition"], evidence: evidence("av_next")
    });
    expect(regression).toMatchObject({ kind: "regression", status: "warning", baselineVersionId: "av_approved" });

    const undeclared = quality.compareGoldenBaseline(baseline, {
      artifactVersionId: "av_other", structuralInvariants: [{ key: "landmarks.main", value: 0, required: true }], pixelDifferences: { desktop: 0.4 }
    });
    expect(undeclared.structural[0].status).toBe("error");
    expect(undeclared.pixels[0].status).toBe("error");
  });

  it("rejects critique claims without matching version-bound evidence", async () => {
    const quality = await import("@/server/quality");
    expect(() => quality.createExplorationReview({
      artifactId: "landing", artifactVersionId: "av_candidate", brandSystemVersionId: "bsv_brand",
      directionId: "editorial", intendedDeviations: [], recommendation: "consider", evidence: evidence("av_other"),
      findings: [{ id: "fit", category: "content-fit", severity: "warning", claim: "Copy is dense.", evidenceIds: ["missing"] }]
    })).toThrow(/evidence/i);
  });
});

describe("approved goldens and portable evidence", () => {
  it("creates a golden only after approval and writes a hash-addressed portable evidence bundle", async () => {
    const { artifacts, version, brandSystemVersionId } = await approvedArtifact("golden");
    const quality = await import("@/server/quality");
    const input = {
      captures: [{ id: "desktop", label: "Desktop", width: 1440, height: 1000, source: "screenshots/desktop.png", contentHash: "deadbeef" }],
      structuralInvariants: [{ key: "landmarks.main", value: 1, required: true }]
    };
    await expect(quality.createApprovedGoldenBaseline("golden", version.metadata.versionId, input)).rejects.toThrow(/approved/i);
    await artifacts.approveArtifactVersion("golden", version.metadata.versionId);
    const baseline = await quality.createApprovedGoldenBaseline("golden", version.metadata.versionId, input);
    expect(baseline).toMatchObject({ artifactId: "landing", artifactVersionId: version.metadata.versionId, approval: { status: "approved" } });
    expect(await readFile(path.join(workspace, "projects", "golden", "reviews", "goldens", `${baseline.id}.json`), "utf8")).toContain(version.metadata.versionId);

    const reviewEvidence = evidence(version.metadata.versionId, brandSystemVersionId);
    const review = quality.createExplorationReview({
      artifactId: "landing", artifactVersionId: version.metadata.versionId, brandSystemVersionId,
      directionId: "approved-direction", intendedDeviations: [], recommendation: "consider", evidence: reviewEvidence,
      findings: [{ id: "intent", category: "user-intent", severity: "suggestion", claim: "The approved direction matches the stated intent.", evidenceIds: [reviewEvidence[0].id] }]
    });
    const reviewFile = await quality.persistVersionedReview("golden", review);
    expect(JSON.parse(await readFile(reviewFile, "utf8"))).toMatchObject({ kind: "exploration", artifactVersionId: version.metadata.versionId });

    const bundle = await quality.writeEvidenceBundle("golden", {
      artifactId: "landing", artifactVersionId: version.metadata.versionId, brandSystemVersionId,
      exactCommands: ["npm run typecheck", "npm test -- tests/quality.test.ts"],
      entries: [{ name: "review.json", role: "report", content: JSON.stringify({ baselineId: baseline.id }) }, { name: "desktop.png", role: "screenshot", content: Buffer.from("png evidence") }]
    });
    expect(bundle.manifest.files).toHaveLength(2);
    expect(bundle.manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.contentHash))).toBe(true);
    expect(JSON.parse(await readFile(path.join(bundle.directory, "manifest.json"), "utf8"))).toMatchObject({ artifactVersionId: version.metadata.versionId });
  });
});

describe("source/render proof and transactional rollback", () => {
  it("requires a claimed Web change to alter both source and pixels and ignores pre-existing defects", async () => {
    const quality = await import("@/server/quality");
    const oldError = { id: "desktop:contrast", status: "error" as const, message: "Existing issue", evidence: {} };
    const before = report("before", render({ pixelDifference: undefined, findings: [oldError] }));
    const after = report("after", render({ pixelDifference: 0.15, findings: [oldError] }));
    expect(quality.assessWebMutation({ beforeSource: "old", afterSource: "new", beforeReport: before, report: after, claimedChanged: true })).toMatchObject({ accepted: true, sourceChanged: true, renderedChanged: true });

    const introduced = report("after", render({ pixelDifference: 0.15, horizontalOverflow: true, findings: [oldError, { id: "desktop:overflow", status: "error", message: "New overflow", evidence: {} }] }));
    const rejected = quality.assessWebMutation({ beforeSource: "old", afterSource: "new", beforeReport: before, report: introduced, claimedChanged: true });
    expect(rejected.accepted).toBe(false);
    expect(rejected.deterministicErrors.map((finding) => finding.id)).toEqual(["desktop:overflow"]);
  });

  it("accepts a real contrast improvement even when inconclusive evidence increases", async () => {
    const quality = await import("@/server/quality");
    const violation = (index: number, ratio: number) => ({ locator: `#text-${index}`, ratio, required: 4.5, foreground: "#777", background: "#fff", conclusive: true });
    const inconclusive = (index: number) => ({ locator: `#visual-${index}`, ratio: null, required: 4.5, foreground: "color(srgb .5 .5 .5)", background: "visual", conclusive: false, reason: "pixel sampling" });
    const beforeContrast = Array.from({ length: 7 }, (_, index) => violation(index, 1.13));
    const afterContrast = [...Array.from({ length: 6 }, (_, index) => violation(index, 3.11)), ...Array.from({ length: 3 }, (_, index) => inconclusive(index))];
    const before = report("before", render({ contrast: beforeContrast, findings: [{ id: "desktop:contrast", status: "error", message: "7 failures", evidence: beforeContrast }] }));
    const after = report("after", render({ pixelDifference: 0.2, contrast: afterContrast, findings: [{ id: "desktop:contrast", status: "error", message: "6 failures", evidence: afterContrast }] }));
    const assessed = quality.assessWebMutation({ beforeSource: "old", afterSource: "new", beforeReport: before, report: after, claimedChanged: true });
    expect(assessed.accepted).toBe(true);
    expect(assessed.requiresUserDecision).toBe(true);
    expect(assessed.comparisons.desktop).toMatchObject({ before: { failures: 7, inconclusive: 0 }, after: { failures: 6, inconclusive: 3 }, regressions: [], warnings: ["contrast measurement"] });
  });

  it("rejects a genuine contrast regression using conclusive deficits rather than evidence length", async () => {
    const quality = await import("@/server/quality");
    const contrast = (ratio: number) => [{ locator: "#copy", ratio, required: 4.5, foreground: "#777", background: "#fff", conclusive: true }];
    const before = report("before", render({ contrast: contrast(4), findings: [{ id: "desktop:contrast", status: "error", message: "Existing failure", evidence: contrast(4) }] }));
    const after = report("after", render({ pixelDifference: 0.2, contrast: contrast(2), findings: [{ id: "desktop:contrast", status: "error", message: "Worse failure", evidence: contrast(2) }] }));
    const assessed = quality.assessWebMutation({ beforeSource: "old", afterSource: "new", beforeReport: before, report: after, claimedChanged: true });
    expect(assessed.accepted).toBe(false);
    expect(assessed.comparisons.desktop.regressions).toEqual(["contrast"]);
    expect(assessed.deterministicErrors.map((finding) => finding.id)).toEqual(["desktop:contrast"]);
  });

  it("restores exact prior bytes when validation rejects or mutation throws", async () => {
    const quality = await import("@/server/quality");
    const file = path.join(workspace, "artifact.html");
    await writeFile(file, "approved source", "utf8");
    const rejected = await quality.runFileRollbackTransaction(file, async () => { await writeFile(file, "broken source", "utf8"); return { valid: false }; }, (result) => result.valid);
    expect(rejected.committed).toBe(false);
    expect(await readFile(file, "utf8")).toBe("approved source");

    await expect(quality.runFileRollbackTransaction(file, async () => { await writeFile(file, "partial source", "utf8"); throw new Error("renderer failed"); }, () => true)).rejects.toThrow("renderer failed");
    expect(await readFile(file, "utf8")).toBe("approved source");
  });
});
