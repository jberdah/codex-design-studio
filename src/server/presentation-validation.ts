import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { PNG } from "pngjs";
import type { PresentationExportValidation, PresentationRenderCapability } from "@/domain/quality";

const EMU_PER_POINT = 12_700;
const MAX_RENDER_BYTES = 100 * 1024 * 1024;
const digest = (content: Buffer) => createHash("sha256").update(content).digest("hex");

export interface PresentationRenderOutput {
  slide: number;
  file: string;
  width?: number;
  height?: number;
}

export interface PresentationRenderAdapter {
  capability: PresentationRenderCapability;
  render(buffer: Buffer, outputDir: string): Promise<PresentationRenderOutput[]>;
}

async function executable(candidate: string) {
  try { await access(candidate, constants.X_OK); return true; }
  catch { return false; }
}

async function exists(candidate: string) {
  try { await access(candidate); return true; }
  catch { return false; }
}

function run(command: string, args: string[], cwd: string, timeoutMs = 60_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(command)} timed out.`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 100_000) stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 100_000) stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${path.basename(command)} exited with ${code}.`));
    });
  });
}

async function libreOfficeAdapter(binary: string): Promise<PresentationRenderAdapter> {
  const rasterizers = [process.env.PDFTOPPM_PATH, "/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm", "/usr/bin/pdftoppm"].filter((value): value is string => Boolean(value));
  const rasterizer = (await Promise.all(rasterizers.map(async (candidate) => await executable(candidate) ? candidate : null))).find(Boolean) ?? null;
  return {
    capability: {
      adapterId: "libreoffice", installed: true, available: true,
      mode: rasterizer ? "office-raster" : "office-pdf", coverage: "all-slides", requiresUserConsent: false,
      note: rasterizer ? "LibreOffice renders the PPTX to PDF and pdftoppm rasterizes every slide." : "LibreOffice renders every slide to PDF; no rasterizer is installed."
    },
    async render(buffer, outputDir) {
      const input = path.join(outputDir, "validated-export.pptx");
      await writeFile(input, buffer, { flag: "wx" });
      await run(binary, ["--headless", "--convert-to", "pdf", "--outdir", outputDir, input], outputDir, 90_000);
      const pdf = path.join(outputDir, "validated-export.pdf");
      await access(pdf);
      if (!rasterizer) return [{ slide: 0, file: pdf }];
      const prefix = path.join(outputDir, "slide");
      await run(rasterizer, ["-png", "-r", "72", pdf, prefix], outputDir, 90_000);
      const images = (await readdir(outputDir)).filter((name) => /^slide-\d+\.png$/i.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return Promise.all(images.map(async (name, index) => {
        const png = PNG.sync.read(await readFile(path.join(outputDir, name)));
        return { slide: index + 1, file: path.join(outputDir, name), width: png.width, height: png.height };
      }));
    }
  };
}

function quickLookAdapter(binary: string): PresentationRenderAdapter {
  return {
    capability: {
      adapterId: "quicklook", installed: true, available: true, mode: "system-preview", coverage: "first-slide", requiresUserConsent: false,
      note: "macOS Quick Look renders the exported PPTX first slide only; OOXML checks cover the complete deck."
    },
    async render(buffer, outputDir) {
      const input = path.join(outputDir, "validated-export.pptx");
      await writeFile(input, buffer, { flag: "wx" });
      await run(binary, ["-t", "-s", "960", "-o", outputDir, input], outputDir, 60_000);
      const generated = (await readdir(outputDir)).find((name) => name.startsWith("validated-export.pptx") && name.endsWith(".png"));
      if (!generated) throw new Error("Quick Look did not produce a PPTX preview.");
      const source = path.join(outputDir, generated);
      const target = path.join(outputDir, "slide-1.png");
      if (source !== target) await copyFile(source, target);
      const png = PNG.sync.read(await readFile(target));
      return [{ slide: 1, file: target, width: png.width, height: png.height }];
    }
  };
}

export async function detectPresentationRenderAdapters() {
  const adapters: PresentationRenderAdapter[] = [];
  const libreOfficeCandidates = [
    process.env.LIBREOFFICE_PATH,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/libreoffice",
    "/usr/local/bin/libreoffice",
    "/usr/bin/libreoffice"
  ].filter((value): value is string => Boolean(value));
  for (const candidate of libreOfficeCandidates) {
    if (await executable(candidate)) { adapters.push(await libreOfficeAdapter(candidate)); break; }
  }
  if (await executable("/usr/bin/qlmanage")) adapters.push(quickLookAdapter("/usr/bin/qlmanage"));
  return adapters;
}

/** Reports installed macOS editors without silently triggering Apple Events consent. */
export async function detectPresentationCapabilities(): Promise<PresentationRenderCapability[]> {
  const adapters = await detectPresentationRenderAdapters();
  const capabilities = adapters.map((adapter) => adapter.capability);
  if (await exists("/Applications/Microsoft PowerPoint.app")) capabilities.push({
    adapterId: "powerpoint-macos", installed: true, available: false, mode: "office-raster", coverage: "all-slides", requiresUserConsent: true,
    note: "PowerPoint is installed, but automation remains disabled until the user explicitly grants Apple Events access."
  });
  if (await exists("/Applications/Keynote.app")) capabilities.push({
    adapterId: "keynote-macos", installed: true, available: false, mode: "office-raster", coverage: "all-slides", requiresUserConsent: true,
    note: "Keynote is installed, but automation remains disabled until the user explicitly grants Apple Events access."
  });
  capabilities.push({
    adapterId: "ooxml-structural", installed: true, available: true, mode: "structural-only", coverage: "structure-only", requiresUserConsent: false,
    note: "Portable fallback validates the actual PPTX package and canonical dimensions but does not claim to have rendered pixels."
  });
  return capabilities;
}

async function inspectPptx(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presentation) throw new Error("The exported PPTX is missing ppt/presentation.xml.");
  const size = presentation.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (!size) throw new Error("The exported PPTX does not declare canonical slide dimensions.");
  return {
    slideCount: slideFiles.length,
    dimensions: { width: Number((Number(size[1]) / EMU_PER_POINT).toFixed(3)), height: Number((Number(size[2]) / EMU_PER_POINT).toFixed(3)), unit: "pt" as const }
  };
}

export async function validatePresentationExport(buffer: Buffer, options: {
  outputDir: string;
  render?: boolean;
  adapters?: PresentationRenderAdapter[];
  clock?: () => Date;
}): Promise<PresentationExportValidation> {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength < 1_000) throw new Error("Presentation validation requires the actual exported PPTX buffer.");
  await mkdir(options.outputDir, { recursive: true });
  const inspection = await inspectPptx(buffer);
  const checks: PresentationExportValidation["checks"] = [
    { id: "pptx.package", status: "pass", message: `The actual ${buffer.byteLength}-byte PPTX package is readable.` },
    { id: "pptx.slides", status: inspection.slideCount > 0 ? "pass" : "error", message: `${inspection.slideCount} slide(s) are present in the export.` },
    { id: "pptx.dimensions", status: inspection.dimensions.width === 960 && inspection.dimensions.height === 540 ? "pass" : "warning", message: `Canonical slide size is ${inspection.dimensions.width} × ${inspection.dimensions.height} pt.` }
  ];
  let capability: PresentationRenderCapability = {
    adapterId: "ooxml-structural", installed: true, available: true, mode: "structural-only", coverage: "structure-only", requiresUserConsent: false,
    note: "No render adapter ran; validation is limited to the actual OOXML export structure."
  };
  let outputs: PresentationRenderOutput[] = [];
  if (options.render !== false) {
    const adapters = options.adapters ?? await detectPresentationRenderAdapters();
    const adapter = adapters.find((candidate) => candidate.capability.available && !candidate.capability.requiresUserConsent);
    if (adapter) {
      try {
        outputs = await adapter.render(buffer, options.outputDir);
        if (!outputs.length) throw new Error("The presentation renderer produced no evidence files.");
        capability = adapter.capability;
        checks.push({ id: "pptx.render", status: adapter.capability.coverage === "all-slides" ? "pass" : "warning", message: `${adapter.capability.adapterId} rendered ${adapter.capability.coverage === "all-slides" ? "the exported deck" : "a first-slide preview"}.` });
        if (adapter.capability.mode === "office-raster") {
          const rasterOutputs = outputs.filter((output) => output.width !== undefined && output.height !== undefined);
          const complete = adapter.capability.coverage !== "all-slides" || rasterOutputs.length === inspection.slideCount;
          checks.push({ id: "pptx.render-coverage", status: complete ? "pass" : "error", message: complete ? `${rasterOutputs.length} canonical slide render(s) were captured.` : `The office renderer captured ${rasterOutputs.length} of ${inspection.slideCount} slides.` });
          const canonical = rasterOutputs.length > 0 && rasterOutputs.every((output) => Math.abs((output.width ?? 0) - 960) <= 1 && Math.abs((output.height ?? 0) - 540) <= 1);
          checks.push({ id: "pptx.render-dimensions", status: canonical ? "pass" : "error", message: canonical ? "Rendered slides match the canonical 960 × 540 pixel evidence frame at 72 dpi." : "One or more rendered slides do not match the canonical 960 × 540 evidence frame." });
        }
      } catch (error) {
        checks.push({ id: "pptx.render", status: "warning", message: `Rendering was unavailable: ${error instanceof Error ? error.message : "unknown renderer error"}` });
      }
    } else {
      checks.push({ id: "pptx.render", status: "warning", message: "No consent-free presentation renderer is available; pixel validation was not claimed." });
    }
  } else {
    checks.push({ id: "pptx.render", status: "warning", message: "Rendering was explicitly disabled; only OOXML structure was validated." });
  }
  const renderFiles = [] as PresentationExportValidation["renderFiles"];
  for (const output of outputs) {
    const content = await readFile(output.file);
    if (content.byteLength > MAX_RENDER_BYTES) throw new Error("A presentation render evidence file exceeds 100 MB.");
    renderFiles.push({ slide: output.slide, file: path.basename(output.file), width: output.width, height: output.height, contentHash: digest(content) });
  }
  return {
    schemaVersion: 1,
    exportHash: digest(buffer),
    byteLength: buffer.byteLength,
    slideCount: inspection.slideCount,
    dimensions: inspection.dimensions,
    capability,
    rendered: renderFiles.length > 0,
    renderFiles,
    checks,
    generatedAt: (options.clock?.() ?? new Date()).toISOString()
  };
}
