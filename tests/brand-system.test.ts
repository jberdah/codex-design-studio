import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-brand-system-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true });
});

async function extractedColor(projectId: string, label: string, value: string, confidence: number) {
  const { addSource, updateExtractionRun } = await import("@/server/source-store");
  const added = await addSource(projectId, {
    kind: "document", label, content: Buffer.from(`${label}:${value}`),
    origin: { type: "upload", fileName: `${label}.pdf`, mediaType: "application/pdf" }, intent: "extract"
  });
  await updateExtractionRun(projectId, added.run.id, { status: "succeeded", candidates: [{ kind: "color", value, confidence }] });
  return added;
}

describe("reconciliation and versioned BrandSystems", () => {
  it("merges compatible candidates and exposes conflicts with provenance and human priority", async () => {
    await extractedColor("review", "website", "#112233", 0.78);
    await extractedColor("review", "guidelines", "#112233", 0.94);
    await extractedColor("review", "campaign", "#445566", 0.91);
    const { addManualEvidence } = await import("@/server/source-store");
    await addManualEvidence("review", { kind: "color", value: "#445566", directive: "must-use", rightsNotes: "Approved by brand lead" });
    const { reconcileProjectEvidence } = await import("@/server/brand-system");
    const review = await reconcileProjectEvidence("review");
    const group = review.groups.find((item) => item.kind === "color")!;

    expect(group).toMatchObject({ conflict: true, resolved: false });
    expect(group.options).toHaveLength(2);
    expect(group.options.find((item) => item.value === "#112233")?.sources).toHaveLength(2);
    expect(group.options[0]).toMatchObject({ value: "#445566" });
    expect(group.options[0].sources[0]).toMatchObject({ userAuthored: true, directive: "must-use", confidence: 1 });
    expect(group.conflictExplanation).toContain("user-authored direction has priority");
  });

  it("requires review when an active source both requires and prohibits the same value", async () => {
    await extractedColor("directives", "website", "#112233", 0.9);
    const { addManualEvidence } = await import("@/server/source-store");
    await addManualEvidence("directives", { kind: "color", value: "#112233", directive: "must-avoid" });
    const { reconcileProjectEvidence } = await import("@/server/brand-system");
    const review = await reconcileProjectEvidence("directives");
    expect(review).toMatchObject({ unresolvedConflictCount: 1 });
    expect(review.groups[0]).toMatchObject({ conflict: true, resolved: false });
    expect(review.groups[0].conflictExplanation).toContain("explicitly prohibits");
  });

  it("records accept, override, reject and inspiration decisions without deleting evidence", async () => {
    await extractedColor("decisions", "one", "#111111", 0.8);
    await extractedColor("decisions", "two", "#222222", 0.9);
    const { loadProvenanceGraph } = await import("@/server/source-store");
    const { reconcileProjectEvidence, recordReconciliationDecision } = await import("@/server/brand-system");
    let review = await reconcileProjectEvidence("decisions");
    const group = review.groups[0];
    const originalCandidateCount = (await loadProvenanceGraph("decisions")).candidates.length;

    review = await recordReconciliationDecision("decisions", { groupId: group.id, action: "accept", optionId: group.options[0].id });
    expect(review.groups[0]).toMatchObject({ resolved: true, decision: { action: "accept" } });
    review = await recordReconciliationDecision("decisions", { groupId: group.id, action: "override", overrideValue: "#ABCDEF", note: "Approved replacement" });
    expect(review.groups[0]).toMatchObject({ resolvedValue: "#ABCDEF", decision: { action: "override" } });
    review = await recordReconciliationDecision("decisions", { groupId: group.id, action: "reject" });
    expect(review.groups[0].decision?.action).toBe("reject");
    review = await recordReconciliationDecision("decisions", { groupId: group.id, action: "inspiration", optionId: group.options[1].id });
    expect(review.groups[0].decision?.action).toBe("inspiration");
    expect((await loadProvenanceGraph("decisions")).candidates).toHaveLength(originalCandidateCount);
  });

  it("recomputes active review after source removal while published evidence stays immutable", async () => {
    const first = await extractedColor("removal", "primary", "#111111", 0.9);
    const second = await extractedColor("removal", "alternate", "#222222", 0.8);
    const brandSystem = await import("@/server/brand-system");
    let review = await brandSystem.reconcileProjectEvidence("removal");
    await brandSystem.recordReconciliationDecision("removal", { groupId: review.groups[0].id, action: "accept", optionId: review.groups[0].options[0].id });
    const draft = await brandSystem.createBrandSystemDraft("removal");
    await brandSystem.publishBrandSystem("removal", draft.snapshot.id);
    const snapshotBefore = await readFile(path.join(workspace, "projects", "removal", "design-system", "versions", `${draft.snapshot.id}.json`), "utf8");
    const { removeSource } = await import("@/server/source-store");
    await removeSource("removal", second.source.id);
    review = await brandSystem.reconcileProjectEvidence("removal");

    expect(review.groups[0]).toMatchObject({ conflict: false, resolved: true });
    expect(review.groups[0].options[0].sources.map((source) => source.sourceId)).toContain(first.source.id);
    expect(await readFile(path.join(workspace, "projects", "removal", "design-system", "versions", `${draft.snapshot.id}.json`), "utf8")).toBe(snapshotBefore);
  });

  it("rolls an explicit publish transaction back on failure", async () => {
    const brandSystem = await import("@/server/brand-system");
    const first = await brandSystem.createBrandSystemDraft("transaction");
    await brandSystem.publishBrandSystem("transaction", first.snapshot.id);
    const second = await brandSystem.createBrandSystemDraft("transaction");
    await expect(brandSystem.publishBrandSystem("transaction", second.snapshot.id, { failAfterRegistry: true })).rejects.toThrow("Injected publish failure");
    const registry = await brandSystem.loadBrandSystemRegistry("transaction");

    expect(registry.publishedVersionId).toBe(first.snapshot.id);
    expect(registry.versions.find((item) => item.id === first.snapshot.id)?.status).toBe("published");
    expect(registry.versions.find((item) => item.id === second.snapshot.id)?.status).toBe("draft");
  });

  it("recovers a publication transaction left behind by an interrupted process", async () => {
    const brandSystem = await import("@/server/brand-system");
    const { loadProject } = await import("@/server/store");
    const first = await brandSystem.createBrandSystemDraft("recovery");
    await brandSystem.publishBrandSystem("recovery", first.snapshot.id);
    const priorRegistry = await brandSystem.loadBrandSystemRegistry("recovery");
    const priorProject = await loadProject("recovery");
    const root = path.join(workspace, "projects", "recovery");
    await writeFile(path.join(root, "design-system", "publish-transaction.json"), JSON.stringify({ versionId: "interrupted", startedAt: new Date().toISOString(), priorRegistry, priorProject }));
    await writeFile(path.join(root, "design-system", "registry.json"), JSON.stringify({ ...priorRegistry, publishedVersionId: "broken" }));
    await writeFile(path.join(root, "project.json"), JSON.stringify({ ...priorProject, name: "partially written" }));

    expect((await brandSystem.loadBrandSystemRegistry("recovery")).publishedVersionId).toBe(first.snapshot.id);
    expect((await loadProject("recovery")).name).toBe(priorProject.name);
    await expect(readFile(path.join(root, "design-system", "publish-transaction.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes concurrent drafts and rejects malformed BrandSystem content", async () => {
    const brandSystem = await import("@/server/brand-system");
    const drafts = await Promise.all(Array.from({ length: 6 }, () => brandSystem.createBrandSystemDraft("concurrent")));
    expect(drafts.map((item) => item.snapshot.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await brandSystem.loadBrandSystemRegistry("concurrent")).versions).toHaveLength(6);

    const { loadProject } = await import("@/server/store");
    const project = await loadProject("concurrent");
    const malformed = structuredClone(project.tokens);
    malformed.colors = {} as typeof malformed.colors;
    await expect(brandSystem.createBrandSystemDraft("concurrent", { brand: project.brand, tokens: malformed })).rejects.toThrow("six-digit hex");
  });

  it("previews, upgrades and rolls back bindings without rewriting an independently composed Web artifact", async () => {
    const { loadProject, saveProjectManifest, writeLandingHtml } = await import("@/server/store");
    const project = await loadProject("migration");
    project.webCustomized = true;
    await saveProjectManifest(project);
    const customHtml = "<!doctype html><main data-independent>Hand composed</main>";
    await writeLandingHtml("migration", customHtml);
    const brandSystem = await import("@/server/brand-system");
    const first = await brandSystem.createBrandSystemDraft("migration");
    await brandSystem.publishBrandSystem("migration", first.snapshot.id);

    const changed = structuredClone(project.tokens);
    changed.colors.primary = "#334455";
    const second = await brandSystem.createBrandSystemDraft("migration", { brand: project.brand, tokens: changed });
    await brandSystem.publishBrandSystem("migration", second.snapshot.id);
    let registry = await brandSystem.loadBrandSystemRegistry("migration");
    expect(registry.bindings.find((item) => item.artifactId === "web")).toMatchObject({ brandSystemVersionId: first.snapshot.id, independentlyComposed: true });

    const preview = await brandSystem.previewArtifactUpgrade("migration", "web", second.snapshot.id);
    expect(preview).toMatchObject({ currentVersionId: first.snapshot.id, mutatesArtifact: false });
    await brandSystem.changeArtifactBinding("migration", "web", "upgrade", second.snapshot.id);
    expect(await readFile(path.join(workspace, "projects", "migration", "web", "index.html"), "utf8")).toBe(customHtml);
    await brandSystem.changeArtifactBinding("migration", "web", "rollback", first.snapshot.id);
    registry = await brandSystem.loadBrandSystemRegistry("migration");
    expect(registry.bindings.find((item) => item.artifactId === "web")?.history.map((item) => item.action)).toEqual(["initial", "upgrade", "rollback"]);
    expect(await readFile(path.join(workspace, "projects", "migration", "web", "index.html"), "utf8")).toBe(customHtml);
    expect(registry.bindings.find((item) => item.artifactId === "slides")?.brandSystemVersionId).toBe(first.snapshot.id);
  });
});
