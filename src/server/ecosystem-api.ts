import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { BackgroundJob } from "@/domain/background-jobs";
import { HANDOFF_BUNDLE_SCHEMA, type HandoffBundleManifest, type HandoffBundleFile } from "@/domain/handoff";
import { safeProjectPath } from "./paths";
import { ensureProject } from "./store";

const HANDOFF_NAME = /^handoff_([a-f0-9]{24})\.zip$/;
const MAX_HANDOFF_ARCHIVE_BYTES = 128_000_000;
const MAX_MANIFEST_BYTES = 1_000_000;
const HANDOFF_ROLES = new Set<HandoffBundleFile["role"]>([
  "design-intent",
  "implementation-instructions",
  "brand-system",
  "artifact-source",
  "code-reality-map",
  "screenshot",
  "test"
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function validPortablePath(value: unknown) {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) return false;
  const segments = value.split(/[\\/]/);
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}

function validManifest(value: unknown, projectId: string, bundleId: string): value is HandoffBundleManifest {
  const manifest = record(value);
  const brandSystemVersion = record(manifest?.brandSystemVersion);
  if (
    manifest?.schema !== HANDOFF_BUNDLE_SCHEMA ||
    manifest.schemaVersion !== 1 ||
    manifest.projectId !== projectId ||
    manifest.bundleId !== bundleId ||
    typeof manifest.createdAt !== "string" ||
    Number.isNaN(Date.parse(manifest.createdAt)) ||
    typeof brandSystemVersion?.id !== "string" ||
    typeof brandSystemVersion.number !== "number" ||
    !Number.isSafeInteger(brandSystemVersion.number) ||
    typeof brandSystemVersion.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(brandSystemVersion.contentHash) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 1_004
  ) return false;

  return manifest.files.every((candidate) => {
    const file = record(candidate);
    return validPortablePath(file?.path) &&
      HANDOFF_ROLES.has(file?.role as HandoffBundleFile["role"]) &&
      typeof file?.byteLength === "number" && Number.isSafeInteger(file.byteLength) && file.byteLength >= 0 &&
      typeof file.sha256 === "string" && /^[a-f0-9]{64}$/.test(file.sha256) &&
      (file.sourcePath === undefined || validPortablePath(file.sourcePath));
  });
}

export interface HandoffListing {
  manifests: HandoffBundleManifest[];
  /** Invalid arbitrary file names are deliberately not reflected into API responses. */
  rejected: Array<{ bundleId?: string; reason: "invalid-name" | "unsafe-file" | "oversized" | "invalid-archive" | "invalid-manifest" }>;
}

/** Reads only bounded, project-local handoff archives and never returns host paths. */
export async function listHandoffManifests(projectId: string): Promise<HandoffListing> {
  await ensureProject(projectId);
  const directory = await safeProjectPath(projectId, "handoffs");
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { manifests: [], rejected: [] };
    throw error;
  }

  const manifests: HandoffBundleManifest[] = [];
  const rejected: HandoffListing["rejected"] = [];
  for (const name of names.sort()) {
    if (!HANDOFF_NAME.test(name)) { rejected.push({ reason: "invalid-name" }); continue; }
    const bundleId = name.slice(0, -4);
    try {
      const archivePath = await safeProjectPath(projectId, "handoffs", name);
      const handle = await open(archivePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile()) { rejected.push({ bundleId, reason: "unsafe-file" }); continue; }
        if (metadata.size > MAX_HANDOFF_ARCHIVE_BYTES) { rejected.push({ bundleId, reason: "oversized" }); continue; }
        bytes = await handle.readFile();
      } finally { await handle.close(); }
      const archive = await JSZip.loadAsync(bytes);
      const entry = archive.file("manifest.json");
      if (!entry || entry.dir) { rejected.push({ bundleId, reason: "invalid-archive" }); continue; }
      const declaredSize = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
      if (typeof declaredSize !== "number" || !Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > MAX_MANIFEST_BYTES) {
        rejected.push({ bundleId, reason: "invalid-manifest" }); continue;
      }
      const raw = await entry.async("nodebuffer");
      if (raw.byteLength > MAX_MANIFEST_BYTES) { rejected.push({ bundleId, reason: "invalid-manifest" }); continue; }
      const manifest = JSON.parse(raw.toString("utf8")) as unknown;
      if (!validManifest(manifest, projectId, bundleId)) { rejected.push({ bundleId, reason: "invalid-manifest" }); continue; }
      manifests.push(structuredClone(manifest));
    } catch (error) {
      const unsafe = (error as NodeJS.ErrnoException).code === "ELOOP" || (error instanceof Error && /escapes authorized workspace/i.test(error.message));
      rejected.push({ bundleId, reason: unsafe ? "unsafe-file" : "invalid-archive" });
    }
  }
  manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.bundleId.localeCompare(b.bundleId));
  return { manifests, rejected };
}

type PublicJobError = Pick<NonNullable<BackgroundJob["error"]>, "code" | "retryable">;

export interface PublicBackgroundJob {
  schemaVersion: 1;
  id: string;
  projectId: string;
  kind: BackgroundJob["kind"];
  label: string;
  status: BackgroundJob["status"];
  progress: number;
  phase: string;
  priority: number;
  maxAttempts: number;
  attempts: Array<{
    number: number;
    startedAt: string;
    finishedAt?: string;
    status: BackgroundJob["attempts"][number]["status"];
    error?: PublicJobError;
  }>;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancellationRequestedAt?: string;
  error?: PublicJobError;
}

function publicError(error: BackgroundJob["error"]): PublicJobError | undefined {
  return error ? { code: error.code, retryable: error.retryable } : undefined;
}

/** Payloads, results and error messages stay server-side because they may contain user content. */
export function publicBackgroundJob(job: BackgroundJob): PublicBackgroundJob {
  return {
    schemaVersion: 1,
    id: job.id,
    projectId: job.projectId,
    kind: job.kind,
    label: job.label,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    priority: job.priority,
    maxAttempts: job.maxAttempts,
    attempts: job.attempts.map((attempt) => ({
      number: attempt.number,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      status: attempt.status,
      error: publicError(attempt.error)
    })),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    availableAt: job.availableAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    cancellationRequestedAt: job.cancellationRequestedAt,
    error: publicError(job.error)
  };
}
