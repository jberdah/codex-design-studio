import { describe, expect, it } from "vitest";
import { defaultProject } from "@/domain/defaults";
import { applyProjectPatch, fallbackRefinement } from "@/server/refine";

describe("brand refinement", () => {
  it("applies a minimal patch and increments project versions", () => {
    const result = applyProjectPatch(structuredClone(defaultProject), {
      headline: "A sharper future.",
      colors: { primary: "#112233" },
      summary: "Sharpened the hero and propagated it to web and slides."
    }, "codex");
    expect(result.project.landing.headline).toBe("A sharper future.");
    expect(result.project.tokens.colors.primary).toBe("#112233");
    expect(result.project.tokens.version).toBe("0.1.1");
    expect(result.project.version).toBe(2);
    expect(result.filesModified).toContain("slides/deck.json");
  });

  it("uses selection context for a deterministic concise refinement", () => {
    const result = fallbackRefinement(structuredClone(defaultProject), "Rends ce texte plus concis", {
      deliverableId: "web",
      designId: "hero-copy",
      label: "Hero description",
      domPath: "p[data-design-id=hero-copy]",
      text: defaultProject.landing.subhead,
      viewport: "desktop"
    });
    expect(result.source).toBe("fallback");
    expect(result.project.landing.subhead).toBe("Turn climate data into decisions your teams can act on.");
    expect(result.project.landing.headline).toBe(defaultProject.landing.headline);
  });

  it("propagates a warmer palette to the shared tokens", () => {
    const result = fallbackRefinement(structuredClone(defaultProject), "Make it warmer");
    expect(result.project.tokens.colors.primary).toBe("#522D26");
    expect(result.summary).toMatch(/terracotta/i);
  });
});
