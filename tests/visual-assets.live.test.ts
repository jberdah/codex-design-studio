import { describe, expect, it } from "vitest";
import type { VisualAssetBrief } from "@/domain/visual-assets";
import { OpenAIImageApiAdapter } from "@/server/openai-visual";

const enabled = process.env.OPENAI_VISUAL_LIVE === "1" && Boolean(process.env.OPENAI_API_KEY);

describe.runIf(enabled)("OpenAI visual live smoke", () => {
  it("generates one low-quality 1024px PNG behind an explicit cost guard", async () => {
    const adapter = new OpenAIImageApiAdapter({ getApiKey: async () => process.env.OPENAI_API_KEY });
    const brief = {
      schemaVersion: 1, id: "live-smoke", title: "Live smoke", objective: "Verify image generation", audience: "test operator",
      target: { artifactId: "smoke", artifactKind: "web", contextId: "smoke", role: "test", context: { type: "web", viewport: { width: 1024, height: 1024 }, crop: { width: 1024, height: 1024 }, fit: "contain" } },
      brandSystemVersionId: "live-smoke", brandDirection: { personality: ["minimal"], visualStyle: "flat geometric", lighting: "even", composition: "centered", palette: ["#132238"], mustInclude: [], mustAvoid: ["text", "logos"] },
      prompt: "A single navy circle on an off-white background, no text", inputAssets: [], output: { width: 1024, height: 1024, quality: "low", encoding: "png", background: "opaque", variants: 1, maxBytes: 5_000_000 }, createdAt: new Date().toISOString(), createdBy: "user"
    } satisfies VisualAssetBrief;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const outputs = await adapter.generate({ runId: "live", projectId: "live", brief, prompts: [brief.prompt], model: adapter.model, output: brief.output, inputAssets: [] }, controller.signal);
      expect(outputs).toHaveLength(1); expect(outputs[0].bytes.byteLength).toBeGreaterThan(1_000); expect(outputs[0].bytes.byteLength).toBeLessThanOrEqual(brief.output.maxBytes);
    } finally { clearTimeout(timeout); }
  }, 130_000);
});
