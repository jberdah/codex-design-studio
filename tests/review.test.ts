import { describe, expect, it } from "vitest";
import { defaultProject } from "@/domain/defaults";
import { contrastRatio, reviewProject, validHexColors } from "@/server/review";

describe("design review", () => {
  it("accepts the reference project as ship-ready", () => {
    const report = reviewProject(structuredClone(defaultProject));
    expect(report.score).toBe(100);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("reports invalid tokens, weak contrast and slide overflow", () => {
    const project = structuredClone(defaultProject);
    project.tokens.colors.accent = "purple";
    project.tokens.colors.text = "#777777";
    project.tokens.colors.background = "#888888";
    project.slides[0].title = "A".repeat(80);
    const report = reviewProject(project);
    expect(validHexColors(project.tokens)).toBe(false);
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(3);
    expect(report.score).toBe(42);
    expect(report.checks.find((check) => check.id === "tokens.colors")?.status).toBe("error");
    expect(report.checks.find((check) => check.id === "slides.overflow")?.status).toBe("warning");
  });
});
