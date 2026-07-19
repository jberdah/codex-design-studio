import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// One-off seeding utility executed against the repository's own dev workspace
// (CODEX_STUDIO_SEED_DEMO=1) to materialize the demo project's provenance and
// review evidence through the real server APIs. Skipped in normal runs.
const enabled = process.env.CODEX_STUDIO_SEED_DEMO === "1";

describe.skipIf(!enabled)("demo workspace seeding", () => {
  it("seeds Asteria provenance and review evidence through real APIs", async () => {
    const { addManualEvidence, loadProvenanceGraph } = await import("@/server/source-store");
    const graph = await loadProvenanceGraph("demo");
    if (!graph.evidence.length) {
      await addManualEvidence("demo", {
        kind: "color",
        value: "#1C3D38 is the Asteria primary; reserve #D8FF72 lime strictly for accents on dark or neutral surfaces.",
        directive: "must-use",
        intent: "extract",
        rightsNotes: "Brand palette owned by the Asteria demo project."
      });
      await addManualEvidence("demo", {
        kind: "tone",
        value: "Voice stays precise and evidence-led; never use the forbidden patterns 'game-changing' or 'revolutionary'.",
        directive: "must-avoid",
        intent: "extract",
        rightsNotes: "Editorial rule authored by the brand owner."
      });
      await addManualEvidence("demo", {
        kind: "accessibility",
        value: "All body copy must meet WCAG AA contrast against the parchment background (#F3F1E9).",
        directive: "must-use",
        intent: "extract",
        rightsNotes: "Accessibility constraint set by the design owner."
      });
    }
    const seeded = await loadProvenanceGraph("demo");
    expect(seeded.evidence.length).toBeGreaterThanOrEqual(3);
    expect(seeded.audit.length).toBeGreaterThan(0);

    const { loadProject } = await import("@/server/store");
    const { reviewProject } = await import("@/server/review");
    const { safeProjectPath } = await import("@/server/paths");
    const project = await loadProject("demo");
    const report = reviewProject(project);
    await writeFile(await safeProjectPath("demo", "reviews", "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    expect(report.score).toBeGreaterThan(0);
  });
});
