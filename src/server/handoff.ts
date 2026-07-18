import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { HANDOFF_BUNDLE_SCHEMA, type HandoffBundleFile, type HandoffBundleInput, type HandoffBundleManifest, type HandoffBundleResult, type HandoffFileRole } from "@/domain/handoff";
import { loadBrandSystemVersion } from "./brand-system";
import { safeProjectPath } from "./paths";
import { ensureProject } from "./store";

const ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");
const roleDirectory: Record<HandoffFileRole, string> = {
  "artifact-source": "artifacts",
  "code-reality-map": "code-reality",
  screenshot: "screenshots",
  test: "tests"
};

function sha256(bytes: Uint8Array | string) { return createHash("sha256").update(bytes).digest("hex"); }

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function json(value: unknown) { return `${JSON.stringify(stable(value), null, 2)}\n`; }

function portableName(value: string) {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || !/^[a-z0-9][a-z0-9._@()+ -]{0,199}$/i.test(value)) throw new Error("Handoff file names must be portable basenames.");
  return value;
}

function markdown(value: string, label: string) {
  const normalized = value.replaceAll("\r\n", "\n").trim();
  if (!normalized || normalized.length > 250_000) throw new Error(`${label} must contain between 1 and 250000 characters.`);
  return `${normalized}\n`;
}

function assertComplete(input: HandoffBundleInput) {
  const roles = new Set(input.files.map((file) => file.role));
  for (const role of ["artifact-source", "code-reality-map", "screenshot", "test"] as const) {
    if (!roles.has(role)) throw new Error(`A reproducible handoff requires at least one ${role} file.`);
  }
  if (input.files.length > 1_000) throw new Error("A handoff bundle supports at most 1000 source files.");
}

interface BundleEntry { path: string; role: HandoffBundleFile["role"]; bytes: Uint8Array; sourcePath?: string }

/** Creates a byte-for-byte reproducible, project-local implementation handoff ZIP. */
export async function createHandoffBundle(projectId: string, input: HandoffBundleInput): Promise<HandoffBundleResult> {
  await ensureProject(projectId);
  assertComplete(input);
  const snapshot = await loadBrandSystemVersion(projectId, input.brandSystemVersionId);
  const entries: BundleEntry[] = [
    { path: "design-intent.md", role: "design-intent", bytes: Buffer.from(markdown(input.designIntent, "Design intent")) },
    { path: "implementation.md", role: "implementation-instructions", bytes: Buffer.from(markdown(input.implementationInstructions, "Implementation instructions")) },
    { path: "brand-system.json", role: "brand-system", bytes: Buffer.from(json(snapshot)) }
  ];
  const destinations = new Set(entries.map((entry) => entry.path));
  for (const file of input.files) {
    if (path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes("..")) throw new Error("Handoff source paths must be project-relative and traversal-free.");
    const source = await safeProjectPath(projectId, ...file.path.split(/[\\/]/).filter(Boolean));
    const name = portableName(file.name ?? path.basename(file.path));
    const destination = `${roleDirectory[file.role]}/${name}`;
    if (destinations.has(destination)) throw new Error(`Duplicate handoff destination ${destination}.`);
    destinations.add(destination);
    const bytes = new Uint8Array(await readFile(source));
    if (bytes.byteLength > 100_000_000) throw new Error(`Handoff source ${file.path} exceeds 100 MB.`);
    entries.push({ path: destination, role: file.role, bytes, sourcePath: file.path.replaceAll("\\", "/") });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const files: HandoffBundleFile[] = entries.map((entry) => ({ path: entry.path, role: entry.role, byteLength: entry.bytes.byteLength, sha256: sha256(entry.bytes), sourcePath: entry.sourcePath }));
  const identity = {
    schema: HANDOFF_BUNDLE_SCHEMA, schemaVersion: 1 as const, projectId,
    brandSystemVersion: { id: snapshot.id, number: snapshot.number, contentHash: snapshot.contentHash },
    createdAt: snapshot.createdAt, files
  };
  const bundleId = `handoff_${sha256(json(identity)).slice(0, 24)}`;
  const manifest: HandoffBundleManifest = { ...identity, bundleId };
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.path, entry.bytes, { date: ZIP_DATE, createFolders: false, unixPermissions: 0o100644 });
  zip.file("manifest.json", json(manifest), { date: ZIP_DATE, createFolders: false, unixPermissions: 0o100644 });
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE", platform: "UNIX", streamFiles: false });
  const outputDirectory = await safeProjectPath(projectId, "handoffs");
  await mkdir(outputDirectory, { recursive: true });
  const output = path.join(outputDirectory, `${bundleId}.zip`);
  await writeFile(output, bytes);
  return { manifest, path: path.relative(await safeProjectPath(projectId), output).replaceAll("\\", "/"), byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

