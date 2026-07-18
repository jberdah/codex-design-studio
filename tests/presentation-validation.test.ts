import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { defaultProject } from "@/domain/defaults";
import type { PresentationRenderAdapter } from "@/server/presentation-validation";
import { detectPresentationCapabilities, validatePresentationExport } from "@/server/presentation-validation";
import { generatePptx } from "@/server/slides";

let outputDir = "";

beforeEach(async () => {
  outputDir = await mkdtemp(path.join(os.tmpdir(), "studio-pptx-validation-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe("actual PowerPoint export validation", () => {
  it("validates the generated PPTX package at canonical physical dimensions with an honest structural fallback", async () => {
    const buffer = await generatePptx(structuredClone(defaultProject));
    const report = await validatePresentationExport(buffer, { outputDir, render: false, clock: () => new Date("2026-07-18T12:00:00.000Z") });

    expect(report).toMatchObject({
      byteLength: buffer.byteLength,
      slideCount: 3,
      dimensions: { width: 960, height: 540, unit: "pt" },
      rendered: false,
      capability: { adapterId: "ooxml-structural", mode: "structural-only", coverage: "structure-only" }
    });
    expect(report.exportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.checks.find((check) => check.id === "pptx.render")).toMatchObject({ status: "warning" });
  });

  it("passes the actual exported buffer through an injected office renderer and records pixel evidence", async () => {
    const buffer = await generatePptx(structuredClone(defaultProject));
    let received: Buffer | undefined;
    const adapter: PresentationRenderAdapter = {
      capability: {
        adapterId: "libreoffice", installed: true, available: true, mode: "office-raster", coverage: "all-slides", requiresUserConsent: false,
        note: "Mocked headless office engine for deterministic testing."
      },
      async render(actual, directory) {
        received = actual;
        return Promise.all([1, 2, 3].map(async (slide) => {
          const png = { width: 960, height: 540, data: Buffer.alloc(960 * 540 * 4, 255) };
          const file = path.join(directory, `slide-${slide}.png`);
          await writeFile(file, PNG.sync.write(png));
          return { slide, file, width: 960, height: 540 };
        }));
      }
    };
    const report = await validatePresentationExport(buffer, { outputDir, adapters: [adapter] });

    expect(received?.equals(buffer)).toBe(true);
    expect(report).toMatchObject({ rendered: true, capability: { adapterId: "libreoffice", mode: "office-raster" } });
    expect(report.renderFiles).toHaveLength(3);
    expect(report.renderFiles[0]).toMatchObject({ slide: 1, width: 960, height: 540 });
    expect((await readFile(path.join(outputDir, report.renderFiles[0].file))).byteLength).toBeGreaterThan(1_000);
    expect(report.checks.find((check) => check.id === "pptx.render")).toMatchObject({ status: "pass" });
    expect(report.checks.find((check) => check.id === "pptx.render-coverage")).toMatchObject({ status: "pass" });
    expect(report.checks.find((check) => check.id === "pptx.render-dimensions")).toMatchObject({ status: "pass" });
  });

  it("falls back without claiming a render when an installed adapter fails", async () => {
    const buffer = await generatePptx(structuredClone(defaultProject));
    const adapter: PresentationRenderAdapter = {
      capability: {
        adapterId: "quicklook", installed: true, available: true, mode: "system-preview", coverage: "first-slide", requiresUserConsent: false,
        note: "Mocked failing renderer."
      },
      async render() { throw new Error("preview permission denied"); }
    };
    const report = await validatePresentationExport(buffer, { outputDir, adapters: [adapter] });
    expect(report.rendered).toBe(false);
    expect(report.capability.adapterId).toBe("ooxml-structural");
    expect(report.checks.find((check) => check.id === "pptx.render")?.message).toMatch(/permission denied/i);
  });

  it("never presents PowerPoint or Keynote automation as available before explicit Apple Events consent", async () => {
    const capabilities = await detectPresentationCapabilities();
    expect(capabilities.at(-1)).toMatchObject({ adapterId: "ooxml-structural", available: true, mode: "structural-only" });
    for (const capability of capabilities.filter((item) => item.adapterId === "powerpoint-macos" || item.adapterId === "keynote-macos")) {
      expect(capability).toMatchObject({ installed: true, available: false, requiresUserConsent: true });
    }
  });
});
