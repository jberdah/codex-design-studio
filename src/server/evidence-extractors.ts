import { createHash } from "node:crypto";
import nodePath from "node:path";
import JSZip from "jszip";
import { PNG } from "pngjs";
import type { CaptureManifest, EvidenceCandidateInput, ExtractionIssue, ExtractionResult, PageObservation } from "@/domain/extraction";
import { CODE_REALITY_MAP_SCHEMA, type CodeRealityMap, type SourceEvidence } from "@/domain/repository";

const MAX_TEXT_CHARS = 200_000;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

function sha256(value: Uint8Array | string) { return createHash("sha256").update(value).digest("hex"); }
function compact(value: string, max = 10_000) { return value.replace(/\s+/g, " ").trim().slice(0, max); }
function decodeXml(value: string) {
  return value.replace(/<w:tab\/?\s*>/g, "\t").replace(/<a:br\/?\s*>/g, "\n")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function xmlText(xml: string) {
  return compact(decodeXml([...xml.matchAll(/<(?:w:t|a:t|t)(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:t|a:t|t)>/g)].map((match) => match[1]).join(" ")), MAX_TEXT_CHARS);
}
function colorsIn(value: string) {
  const colors = [...value.matchAll(/(?:#|(?:val|rgb|color)=["'])([0-9a-f]{6,8})\b/gi)].map((match) => `#${(match[1].length === 8 ? match[1].slice(2) : match[1]).toUpperCase()}`);
  return [...new Set(colors)].sort();
}
function numerically(value: string) { return Number.parseFloat(value) || 0; }
function sortedCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.map((item) => compact(item, 300)).filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
function candidate(kind: EvidenceCandidateInput["kind"], value: EvidenceCandidateInput["value"], confidence: number): EvidenceCandidateInput {
  return { kind, value, confidence };
}
function finish(candidates: EvidenceCandidateInput[], issues: ExtractionIssue[]): ExtractionResult {
  const seen = new Set<string>();
  const unique = candidates.filter((item) => {
    const key = `${item.kind}:${JSON.stringify(item.value)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => `${a.kind}:${JSON.stringify(a.value)}`.localeCompare(`${b.kind}:${JSON.stringify(b.value)}`));
  return { candidates: unique, issues: [...issues].sort((a, b) => `${a.code}:${a.provenance ?? ""}`.localeCompare(`${b.code}:${b.provenance ?? ""}`)) };
}

export function extractWebEvidence(input: CaptureManifest | PageObservation): ExtractionResult {
  const captures = "captures" in input ? input.captures : [{ viewport: { name: "desktop" }, finalUrl: "", observation: input, assets: [], issues: [] }];
  const candidates: EvidenceCandidateInput[] = [];
  const issues = captures.flatMap((capture) => capture.issues);
  for (const capture of captures) {
    const observation = capture.observation;
    const provenance = { type: "web-capture", viewport: capture.viewport.name, finalUrl: capture.finalUrl };
    const colors = sortedCounts(observation.elements.flatMap((element) => element.colors)).slice(0, 30);
    if (colors.length) candidates.push(candidate("color", { evidenceType: "computed-colors", provenance, values: colors }, 0.96));
    if (Object.keys(observation.cssVariables).length) candidates.push(candidate("metadata", { evidenceType: "css-variables", provenance, values: observation.cssVariables }, 0.99));
    const typography = sortedCounts(observation.elements.map((element) => `${element.fontFamily}|${element.fontSize}|${element.fontWeight}|${element.lineHeight}|${element.letterSpacing}`)).slice(0, 40);
    if (typography.length) candidates.push(candidate("font", { evidenceType: "computed-typography", provenance, values: typography }, 0.95));
    const spacing = sortedCounts(observation.elements.flatMap((element) => [element.margin, element.padding, element.gap]).filter((value) => value && value !== "0px")).slice(0, 40);
    const radii = sortedCounts(observation.elements.map((element) => element.borderRadius).filter((value) => value && value !== "0px")).slice(0, 20);
    const grids = sortedCounts(observation.elements.filter((element) => element.display.includes("grid")).map((element) => element.gridTemplateColumns)).slice(0, 20);
    candidates.push(candidate("visual", { evidenceType: "layout-system", provenance, spacing, radii, grids }, 0.9));
    const patterns = sortedCounts(observation.elements.map((element) => `${element.tag}|${element.role}|${element.display}|${element.borderRadius}|${element.padding}`)).filter((item) => item.count > 1).slice(0, 30);
    if (patterns.length) candidates.push(candidate("visual", { evidenceType: "recurring-components", provenance, patterns }, 0.82));
    if (observation.logos.length) candidates.push(candidate("visual", { evidenceType: "logo-usage", provenance, logos: observation.logos }, 0.9));
    const assetUsage = sortedCounts(observation.elements.flatMap((element) => element.assetUrls)).slice(0, 100);
    if (assetUsage.length) candidates.push(candidate("metadata", { evidenceType: "asset-usage", provenance, assets: assetUsage }, 0.94));
  }
  return finish(candidates, issues);
}

interface ArchivePart { path: string; text: string; }
interface ArchiveMedia { path: string; bytes: Uint8Array; }
async function archiveParts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const files = Object.values(zip.files).filter((entry) => !entry.dir).sort((a, b) => a.name.localeCompare(b.name));
  if (files.length > MAX_ARCHIVE_ENTRIES) throw new Error(`Archive exceeds ${MAX_ARCHIVE_ENTRIES} entries.`);
  if (files.some((entry) => entry.name.startsWith("/") || entry.name.split("/").includes(".."))) throw new Error("Archive contains an unsafe path.");
  const declaredBytes = files.reduce((total, entry) => total + Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (declaredBytes > MAX_ARCHIVE_BYTES) throw new Error("Archive exceeds the declared uncompressed extraction limit.");
  let total = 0;
  const parts: ArchivePart[] = [];
  for (const entry of files) {
    if (!/\.(?:xml|rels|txt|csv|json)$/i.test(entry.name)) continue;
    const text = await entry.async("string");
    total += Buffer.byteLength(text);
    if (total > MAX_ARCHIVE_BYTES) throw new Error("Archive exceeds the uncompressed extraction limit.");
    parts.push({ path: entry.name, text });
  }
  const media: ArchiveMedia[] = [];
  for (const entry of files.filter((item) => /\/(?:media|embeddings)\/.*\.(?:png|jpe?g|gif|webp|svg)$/i.test(item.name))) {
    media.push({ path: entry.name, bytes: await entry.async("uint8array") });
  }
  return { parts, media, files: files.map((entry) => entry.name) };
}

function provenanceRecord(format: string, part: ArchivePart, index?: number) {
  return { type: "document", format, part: part.path, ...(index === undefined ? {} : { index }) };
}
function logicalPartIndex(format: string, part: ArchivePart) {
  if (format === "pptx") return Number(part.path.match(/(?:slide|notesSlide)(\d+)\.xml$/)?.[1]) || undefined;
  if (format === "xlsx") return Number(part.path.match(/sheet(\d+)\.xml$/)?.[1]) || undefined;
  return undefined;
}
function relationshipSource(relPath: string) {
  const match = relPath.match(/^(.*)\/_rels\/([^/]+)\.rels$/);
  return match ? `${match[1]}/${match[2]}` : relPath;
}
function mediaProvenance(format: string, mediaPath: string, parts: ArchivePart[]) {
  for (const relations of parts.filter((part) => part.path.endsWith(".rels"))) {
    const source = relationshipSource(relations.path);
    const directory = nodePath.posix.dirname(source);
    const targets = [...relations.text.matchAll(/<Relationship\b[^>]*Target=["']([^"']+)/g)].map((match) => nodePath.posix.normalize(nodePath.posix.join(directory, decodeXml(match[1]))));
    if (targets.includes(mediaPath)) return { type: "document", format, part: source, index: logicalPartIndex(format, { path: source, text: "" }) };
  }
  return { type: "document", format, part: mediaPath };
}

export async function extractDocumentEvidence(bytes: Uint8Array, fileName = "source"): Promise<ExtractionResult> {
  const candidates: EvidenceCandidateInput[] = [];
  const issues: ExtractionIssue[] = [];
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  try {
    if (bytes.byteLength > MAX_ARCHIVE_BYTES * 2) throw new Error("Document exceeds the input limit.");
    if (["docx", "pptx", "xlsx"].includes(extension) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      const archive = await archiveParts(bytes);
      const format = extension || (archive.files.some((path) => path.startsWith("word/")) ? "docx" : archive.files.some((path) => path.startsWith("ppt/")) ? "pptx" : "xlsx");
      const relevant = archive.parts.filter((part) => format === "docx" ? /^word\/(?:document|header|footer)/.test(part.path) : format === "pptx" ? /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(part.path) : /^xl\/(?:worksheets\/sheet\d+|sharedStrings|styles)\.xml$/.test(part.path));
      let sharedStrings: string[] = [];
      if (format === "xlsx") {
        const shared = archive.parts.find((part) => part.path === "xl/sharedStrings.xml");
        sharedStrings = shared ? [...shared.text.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1])) : [];
      }
      for (const part of relevant) {
        const provenance = provenanceRecord(format, part, logicalPartIndex(format, part));
        let text = xmlText(part.text);
        if (format === "xlsx" && /worksheets\/sheet/.test(part.path)) {
          const cells = [...part.text.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].slice(0, 20_000).flatMap((match) => {
            const cell = match[1].match(/\br=["']([^"']+)/)?.[1];
            const raw = match[2].match(/<v>([^<]*)<\/v>/)?.[1];
            if (!cell || raw === undefined) return [];
            const type = match[1].match(/\bt=["']([^"']+)/)?.[1];
            return [{ cell, value: type === "s" ? sharedStrings[Number(raw)] ?? "" : decodeXml(raw) }];
          });
          text = compact(cells.map((cell) => `${cell.cell}: ${cell.value}`).join("\n"), MAX_TEXT_CHARS);
          if (cells.length) candidates.push(candidate("metadata", { evidenceType: "spreadsheet-layout", provenance, cells, untrustedText: true }, 0.94));
        }
        if (text) candidates.push(candidate("copy", { evidenceType: "document-text", provenance, text, untrustedText: true }, 0.96));
        const boxes = [...part.text.matchAll(/<(?:a:off|a:ext|wp:extent)\b([^>]*)\/?\s*>/g)].slice(0, 2_000).map((match) => Object.fromEntries([...match[1].matchAll(/\b(x|y|cx|cy)=["'](\d+)/g)].map((attribute) => [attribute[1], Number(attribute[2])]))).filter((box) => Object.keys(box).length);
        const layout = { paragraphs: (part.text.match(/<(?:w:p|a:p)\b/g) ?? []).length, tables: (part.text.match(/<(?:w:tbl|a:tbl)\b/g) ?? []).length, boxes };
        if (layout.paragraphs || layout.tables || layout.boxes.length) candidates.push(candidate("visual", { evidenceType: "document-layout", provenance, ...layout }, 0.88));
        const colors = colorsIn(part.text);
        if (colors.length) candidates.push(candidate("color", { evidenceType: "document-palette", provenance, values: colors }, 0.91));
        const fonts = [...new Set([...part.text.matchAll(/(?:typeface|w:ascii|w:hAnsi)=["']([^"']+)|<(?:name|a:latin)\b[^>]*(?:val|typeface)=["']([^"']+)/g)].map((match) => decodeXml(match[1] ?? match[2])))].sort();
        const sizes = [...new Set([...part.text.matchAll(/(?:font-size)=["']([\d.]+)|<(?:sz|w:sz)\b[^>]*val=["']([\d.]+)/g)].map((match) => match[1] ?? match[2]))].sort((a, b) => numerically(a) - numerically(b));
        if (fonts.length || sizes.length) candidates.push(candidate("font", { evidenceType: "document-typography", provenance, families: fonts, sizes }, 0.9));
      }
      if (archive.media.length) {
        candidates.push(candidate("visual", { evidenceType: "embedded-assets", provenance: { type: "document", format }, paths: archive.media.map((item) => item.path) }, 0.99));
        for (const media of archive.media) {
          const analysis = analyzeImageAsset(media.bytes, nodePath.posix.basename(media.path));
          issues.push(...analysis.issues.map((issue) => ({ ...issue, provenance: media.path })));
          for (const item of analysis.candidates) {
            candidates.push(candidate(item.kind, { evidenceType: "document-image-analysis", provenance: mediaProvenance(format, media.path, archive.parts), embeddedPath: media.path, analysis: item.value }, item.confidence));
          }
        }
      }
    } else if (extension === "pdf" || Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-") {
      const raw = Buffer.from(bytes).toString("latin1");
      const pages = raw.split(/\/Type\s*\/Page\b/).slice(1);
      pages.forEach((page, index) => {
        const provenance = { type: "document", format: "pdf", page: index + 1 };
        const text = compact([...page.matchAll(/\(([^()]*)\)\s*Tj|\[([\s\S]*?)\]\s*TJ/g)].flatMap((match) => match[1] ?? [...(match[2] ?? "").matchAll(/\(([^()]*)\)/g)].map((part) => part[1])).join(" "), 30_000);
        if (text) candidates.push(candidate("copy", { evidenceType: "document-text", provenance, text, untrustedText: true }, 0.65));
        const images = [...page.matchAll(/\/Subtype\s*\/Image[\s\S]{0,500}?\/Width\s+(\d+)[\s\S]{0,200}?\/Height\s+(\d+)/g)].slice(0, 1_000).map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));
        if (images.length) candidates.push(candidate("visual", { evidenceType: "document-images", provenance, images }, 0.78));
        const mediaBox = page.match(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/)?.slice(1).map(Number);
        if (mediaBox) candidates.push(candidate("visual", { evidenceType: "document-layout", provenance, mediaBox }, 0.8));
        const fonts = [...new Set([...page.matchAll(/\/(?:BaseFont|FontName)\s*\/([^\s/<>\[\]()]+)/g)].map((match) => match[1].replace(/^.*\+/, "")))].sort();
        if (fonts.length) candidates.push(candidate("font", { evidenceType: "document-typography", provenance, families: fonts }, 0.72));
        const operatorColors = [...page.matchAll(/(^|\s)([01]?(?:\.\d+)?)\s+([01]?(?:\.\d+)?)\s+([01]?(?:\.\d+)?)\s+(?:rg|RG)\b/g)].map((match) => `#${[match[2], match[3], match[4]].map((channel) => Math.round(Math.max(0, Math.min(1, Number(channel))) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`);
        if (operatorColors.length) candidates.push(candidate("color", { evidenceType: "document-palette", provenance, values: [...new Set(operatorColors)].sort() }, 0.75));
      });
      const colors = colorsIn(raw);
      if (colors.length) candidates.push(candidate("color", { evidenceType: "document-palette", provenance: { type: "document", format: "pdf" }, values: colors }, 0.65));
      if (!candidates.length) issues.push({ code: "pdf_partial", message: "The PDF contains no safely extractable text; image or compressed content was preserved but skipped.", recoverable: true });
    } else {
      const text = compact(Buffer.from(bytes).toString("utf8"), MAX_TEXT_CHARS);
      if (text) candidates.push(candidate("copy", { evidenceType: "document-text", provenance: { type: "document", format: extension || "text" }, text, untrustedText: true }, 0.75));
      const colors = colorsIn(text);
      if (colors.length) candidates.push(candidate("color", { evidenceType: "document-palette", provenance: { type: "document", format: extension || "text" }, values: colors }, 0.8));
    }
  } catch (error) {
    issues.push({ code: "malformed_document", message: error instanceof Error ? error.message : "The document could not be parsed.", recoverable: true });
  }
  return finish(candidates, issues);
}

function jpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3) return { width: (bytes[offset + 7] << 8) + bytes[offset + 8], height: (bytes[offset + 5] << 8) + bytes[offset + 6] };
    if (length < 2) break;
    offset += length + 2;
  }
  return undefined;
}

export function analyzeImageAsset(bytes: Uint8Array, fileName = "asset", mediaType = "application/octet-stream"): ExtractionResult {
  const candidates: EvidenceCandidateInput[] = [];
  const issues: ExtractionIssue[] = [];
  const original = { sha256: sha256(bytes), byteLength: bytes.byteLength, fileName: fileName.slice(0, 500), mediaType, preservation: "original-bytes", vectorized: false, licenseChanged: false };
  try {
    let width = 0; let height = 0; let transparent = false; let format = mediaType.split("/")[1] || fileName.split(".").pop() || "unknown"; const palette: string[] = [];
    if (bytes[0] === 0x89 && Buffer.from(bytes.subarray(1, 4)).toString() === "PNG") {
      format = "png";
      const png = PNG.sync.read(Buffer.from(bytes), { skipRescale: true });
      width = png.width; height = png.height;
      const counts = new Map<string, number>();
      const step = Math.max(1, Math.floor((png.width * png.height) / 50_000));
      for (let pixel = 0; pixel < png.width * png.height; pixel += step) {
        const index = pixel * 4; const alpha = png.data[index + 3];
        if (alpha < 255) transparent = true;
        if (alpha < 24) continue;
        const color = `#${[png.data[index], png.data[index + 1], png.data[index + 2]].map((channel) => (channel & 0xf0).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
        counts.set(color, (counts.get(color) ?? 0) + 1);
      }
      palette.push(...[...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([color]) => color));
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      format = "jpeg"; const dimensions = jpegDimensions(bytes); width = dimensions?.width ?? 0; height = dimensions?.height ?? 0;
    } else if (/svg/i.test(mediaType) || /\.svg$/i.test(fileName)) {
      format = "svg"; const svg = Buffer.from(bytes).toString("utf8", 0, Math.min(bytes.byteLength, 2 * 1024 * 1024));
      width = numerically(svg.match(/<svg[^>]*\bwidth=["']([^"']+)/i)?.[1] ?? "0"); height = numerically(svg.match(/<svg[^>]*\bheight=["']([^"']+)/i)?.[1] ?? "0");
      const viewBox = svg.match(/\bviewBox=["'][^"']*?([\d.]+)[ ,]+([\d.]+)["']/i); if ((!width || !height) && viewBox) { width ||= numerically(viewBox[1]); height ||= numerically(viewBox[2]); }
      palette.push(...colorsIn(svg).slice(0, 20)); transparent = !/<(?:rect|path)[^>]*(?:fill=["'](?:#fff(?:fff)?|white)["'])/i.test(svg);
    }
    candidates.push(candidate("metadata", { evidenceType: "original-asset", original, analysis: { format, width, height, aspectRatio: width && height ? Number((width / height).toFixed(6)) : null, transparent } }, 0.99));
    if (palette.length) candidates.push(candidate("color", { evidenceType: "image-dominant-colors", provenance: { type: "original-asset", sha256: original.sha256 }, values: palette }, 0.88));
    candidates.push(candidate("visual", { evidenceType: "image-variant", provenance: { type: "original-asset", sha256: original.sha256 }, variant: { fileName: original.fileName, width, height, transparent, format } }, 0.97));
  } catch (error) {
    candidates.push(candidate("metadata", { evidenceType: "original-asset", original, analysis: { status: "preserved-unparsed" } }, 0.99));
    issues.push({ code: "malformed_image", message: error instanceof Error ? error.message : "Image analysis failed.", recoverable: true, provenance: original.sha256 });
  }
  return finish(candidates, issues);
}

export interface CodeRealityMapEntry {
  path: string;
  category?: string;
  component?: string;
  selectors?: string[];
  tokens?: Record<string, string | number>;
  assets?: string[];
  route?: string;
  notes?: string;
  sourceEvidence?: SourceEvidence;
}

function isCodeRealityMap(input: unknown): input is CodeRealityMap {
  if (!input || typeof input !== "object") return false;
  const value = input as { schema?: unknown; inventory?: unknown };
  return value.schema === CODE_REALITY_MAP_SCHEMA && Boolean(value.inventory && typeof value.inventory === "object");
}

function factEvidence(value: unknown): SourceEvidence | undefined {
  if (!value || typeof value !== "object") return undefined;
  const evidence = (value as { evidence?: unknown }).evidence;
  if (!evidence || typeof evidence !== "object") return undefined;
  const item = evidence as Partial<SourceEvidence>;
  if (typeof item.path !== "string" || typeof item.startLine !== "number" || typeof item.endLine !== "number") return undefined;
  return {
    path: item.path.slice(0, 1_000),
    startLine: Math.max(1, Math.floor(item.startLine)),
    endLine: Math.max(1, Math.floor(item.endLine)),
    commit: typeof item.commit === "string" ? item.commit.slice(0, 200) : null
  };
}

function inventoryEntries(map: CodeRealityMap): CodeRealityMapEntry[] {
  const entries: CodeRealityMapEntry[] = [];
  const add = (category: string, fact: unknown, details: Omit<CodeRealityMapEntry, "path" | "category" | "sourceEvidence"> = {}) => {
    const sourceEvidence = factEvidence(fact);
    if (!sourceEvidence) return;
    entries.push({ path: sourceEvidence.path, category, sourceEvidence, ...details });
  };
  const text = (value: unknown, max = 500) => typeof value === "string" ? value.slice(0, max) : "";
  for (const fact of map.inventory.packageManagers ?? []) add("package-manager", fact, { notes: `${text(fact.name)}${fact.version ? `@${text(fact.version)}` : ""}` });
  for (const fact of map.inventory.frameworks ?? []) add("framework", fact, { notes: `${text(fact.name)}${fact.version ? `@${text(fact.version)}` : ""}` });
  for (const fact of map.inventory.cssVariables ?? []) {
    const name = text(fact.name);
    if (name) add("css-variable", fact, { tokens: { [name]: text(fact.value, 2_000) }, notes: fact.theme ? `theme:${text(fact.theme)}` : undefined });
  }
  for (const fact of map.inventory.tokenFiles ?? []) add("token-file", fact, { notes: text(fact.name) });
  for (const fact of map.inventory.tailwindFiles ?? []) add("tailwind-file", fact, { notes: text(fact.name) });
  for (const fact of map.inventory.themes ?? []) add("theme", fact, { selectors: fact.selector ? [text(fact.selector, 1_000)] : undefined, notes: text(fact.name) });
  for (const fact of map.inventory.fonts ?? []) add("font", fact, { notes: `${text(fact.family)} (${text(fact.source)})` });
  for (const fact of map.inventory.assets ?? []) add("asset", fact, { assets: [text(fact.name, 1_000)] });
  for (const fact of map.inventory.components ?? []) add("component", fact, { component: text(fact.exportName), notes: text(fact.name) });
  for (const fact of map.inventory.stories ?? []) add("story", fact, { notes: text(fact.name) });
  for (const fact of map.inventory.routes ?? []) add("route", fact, { route: text(fact.route, 1_000), notes: `${text(fact.kind)}${fact.framework ? `:${text(fact.framework)}` : ""}` });
  return entries;
}

export function extractCodeRealityEvidence(input: unknown, web?: ExtractionResult, mapPath?: string): ExtractionResult {
  const issues: ExtractionIssue[] = [];
  const inventory = isCodeRealityMap(input) ? inventoryEntries(input) : [];
  const rawEntries = inventory.length ? inventory : Array.isArray(input) ? input : input && typeof input === "object" && Array.isArray((input as { entries?: unknown }).entries) ? (input as { entries: unknown[] }).entries : [];
  const entries: CodeRealityMapEntry[] = rawEntries.slice(0, 10_000).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || typeof (entry as CodeRealityMapEntry).path !== "string") return [];
    const item = entry as CodeRealityMapEntry;
    const sourceEvidence = factEvidence({ evidence: item.sourceEvidence });
    const tokens = item.tokens && typeof item.tokens === "object" ? Object.fromEntries(Object.entries(item.tokens).slice(0, 500).map(([name, value]) => [name.slice(0, 500), typeof value === "number" ? value : String(value).slice(0, 2_000)])) : undefined;
    return [{
      path: item.path.slice(0, 1_000), category: item.category?.slice(0, 100), component: item.component?.slice(0, 500),
      selectors: item.selectors?.map(String).map((value) => value.slice(0, 1_000)).sort().slice(0, 500), tokens,
      assets: item.assets?.map(String).map((value) => value.slice(0, 1_000)).sort().slice(0, 500), route: item.route?.slice(0, 1_000),
      notes: item.notes?.slice(0, 2_000), sourceEvidence
    }];
  }).sort((a, b) => a.path.localeCompare(b.path) || (a.category ?? "").localeCompare(b.category ?? "") || (a.component ?? "").localeCompare(b.component ?? ""));
  if (!entries.length) issues.push({ code: "empty_code_reality_map", message: "No valid Code Reality Map entries were found.", recoverable: true });
  const candidates = entries.map((entry) => candidate("metadata", {
    evidenceType: "code-reality-map",
    provenance: {
      type: "implementation-source", path: entry.path,
      ...(entry.sourceEvidence ? { startLine: entry.sourceEvidence.startLine, endLine: entry.sourceEvidence.endLine, commit: entry.sourceEvidence.commit } : {}),
      ...(mapPath ? { mapPath: mapPath.slice(0, 1_000) } : {})
    },
    entry, untrustedText: true
  }, 0.98));
  if (web && entries.length) {
    const serializedWeb = JSON.stringify(web.candidates);
    const reconciled = entries.map((entry) => ({ path: entry.path, observedSelectors: (entry.selectors ?? []).filter((selector) => serializedWeb.includes(selector)), observedAssets: (entry.assets ?? []).filter((asset) => serializedWeb.includes(asset)) }));
    candidates.push(candidate("metadata", { evidenceType: "capture-code-reconciliation", entries: reconciled }, 0.85));
  }
  return finish(candidates, issues);
}

export async function extractCodeRealityMapSource(bytes: Uint8Array, web?: ExtractionResult): Promise<ExtractionResult> {
  try { return extractCodeRealityEvidence(JSON.parse(Buffer.from(bytes).toString("utf8")), web); }
  catch {
    try {
      const archive = await archiveParts(bytes);
      const maps = archive.parts.filter((part) => /(?:code[-_. ]?reality|reality[-_. ]?map|code[-_. ]?map).*\.json$/i.test(part.path));
      if (!maps.length) return { candidates: [], issues: [{ code: "missing_code_reality_map", message: "The archive contains no Code Reality Map JSON file.", recoverable: true }] };
      const results = maps.map((part) => {
        try {
          const value = JSON.parse(part.text) as unknown;
          return extractCodeRealityEvidence(value, web, part.path);
        } catch { return { candidates: [], issues: [{ code: "malformed_code_reality_map", message: `Code Reality Map ${part.path} is not valid JSON.`, recoverable: true, provenance: part.path }] }; }
      });
      return finish(results.flatMap((result) => result.candidates), results.flatMap((result) => result.issues));
    } catch (error) {
      return { candidates: [], issues: [{ code: "malformed_code_reality_map", message: error instanceof Error ? error.message : "Code Reality Map input must be valid JSON or a bounded archive.", recoverable: true }] };
    }
  }
}
