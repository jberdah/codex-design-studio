import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { WebVisualCheckReport } from "@/domain/quality";

const execute = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("deterministic rendered Web audit", () => {
  it("measures responsive overflow, clipping, assets, contrast, focus order and landmarks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "studio-visual-audit-"));
    directories.push(root);
    const web = path.join(root, "web");
    await mkdir(web);
    const file = path.join(web, "index.html");
    await writeFile(file, `<!doctype html><html><head><style>
      body{margin:0;background:#fff;color:#eee} .wide{width:1600px}
      .clip{width:20px;height:12px;overflow:hidden} button{color:#eee;background:#fff}
    </style></head><body><header></header><main><h1>Invisible headline</h1>
      <div class="wide">Overflow</div><div class="clip">Clipped meaningful content</div>
      <img src="missing.png" alt="missing"><button tabindex="2">Action</button>
    </main><footer></footer></body></html>`, "utf8");
    const script = path.join(process.cwd(), "skills", "web-art-director", "scripts", "visual-check.mjs");
    const { stdout } = await execute(process.execPath, [script, "--file", file, "--phase", "before"], { cwd: root, timeout: 60_000, maxBuffer: 5_000_000 });
    const report = JSON.parse(stdout.trim()) as WebVisualCheckReport;

    expect(report).toMatchObject({ schemaVersion: 2, phase: "before", summary: { responsiveStates: ["desktop", "tablet", "mobile"] } });
    for (const render of Object.values(report.renders)) {
      expect(render.horizontalOverflow).toBe(true);
      expect(render.clippedElements.length).toBeGreaterThan(0);
      expect(render.brokenAssets.length).toBeGreaterThan(0);
      expect(render.contrast.length).toBeGreaterThan(0);
      expect(render.focusOrder.positiveTabIndexes).toEqual([{ locator: "button:nth-child(5)", tabIndex: 2 }]);
      expect(render.landmarks).toMatchObject({ main: 1, header: 1, footer: 1, h1: 1 });
      expect(new Set(render.findings.map((finding) => finding.id.split(":").at(-1)))).toEqual(new Set(["overflow", "clipping", "assets", "contrast", "focus-order", "landmarks"]));
    }
    expect(report.summary.errors).toBeGreaterThanOrEqual(12);
    expect(report.summary.warnings).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it("marks gradient and translucent contrast as inconclusive instead of blocking the transaction", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "studio-visual-gradient-"));
    directories.push(root);
    const web = path.join(root, "web");
    await mkdir(web);
    const file = path.join(web, "index.html");
    await writeFile(file, `<!doctype html><html><head><style>
      body{margin:0;background:#fff;color:#111} main{min-height:100vh}
      .visual{padding:40px;color:#fff;background:linear-gradient(90deg,#111,#777)}
    </style></head><body><header></header><main><h1>Measured heading</h1><section class="visual"><p>Text over a visual background</p></section></main><footer></footer></body></html>`, "utf8");
    const script = path.join(process.cwd(), "skills", "web-art-director", "scripts", "visual-check.mjs");
    const { stdout } = await execute(process.execPath, [script, "--file", file, "--phase", "before"], { cwd: root, timeout: 60_000, maxBuffer: 5_000_000 });
    const report = JSON.parse(stdout.trim()) as WebVisualCheckReport;

    for (const render of Object.values(report.renders)) {
      const contrast = render.findings.find((finding) => finding.id.endsWith(":contrast"));
      expect(contrast?.status).toBe("warning");
      expect(render.contrast.some((item) => !item.conclusive && item.reason?.includes("pixel sampling"))).toBe(true);
    }
    expect(report.summary.errors).toBe(0);
  }, 120_000);

  it("measures CSS Color 4 srgb colors conclusively", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "studio-visual-srgb-"));
    directories.push(root);
    const web = path.join(root, "web");
    await mkdir(web);
    const file = path.join(web, "index.html");
    await writeFile(file, `<!doctype html><html><head><style>
      body{margin:0;background:color(srgb 1 1 1);color:color(srgb .8 .8 .8)} main{min-height:100vh}
    </style></head><body><header></header><main><h1>Low contrast heading</h1></main><footer></footer></body></html>`, "utf8");
    const script = path.join(process.cwd(), "skills", "web-art-director", "scripts", "visual-check.mjs");
    const { stdout } = await execute(process.execPath, [script, "--file", file, "--phase", "before"], { cwd: root, timeout: 60_000, maxBuffer: 5_000_000 });
    const report = JSON.parse(stdout.trim()) as WebVisualCheckReport;

    for (const render of Object.values(report.renders)) {
      expect(render.contrast.some((item) => item.conclusive && typeof item.ratio === "number")).toBe(true);
      expect(render.contrast.some((item) => item.reason === "foreground color syntax is not supported")).toBe(false);
    }
  }, 120_000);
});
