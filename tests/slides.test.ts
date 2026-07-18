import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { defaultProject } from "@/domain/defaults";
import { generatePptx } from "@/server/slides";

describe("editable PowerPoint export", () => {
  it("creates a valid three-slide Open XML deck with editable text", async () => {
    const buffer = await generatePptx(structuredClone(defaultProject));
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(buffer.byteLength).toBeGreaterThan(20_000);
    expect(slideFiles).toHaveLength(3);
    const coverXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(coverXml).toContain("Climate intelligence for decisions that matter");
    expect(coverXml).toContain("<a:t>");
  });
});
