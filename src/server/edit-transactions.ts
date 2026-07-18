import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyEditTransaction,
  createArtifactEditSession,
  markEditAutosaved,
  markEditCommitted,
  recoverArtifactEditSession,
  redoEditTransaction,
  undoEditTransaction,
  type ArtifactEditSession,
  type EditTransactionInput,
  type EditableArtifactDocument
} from "@/domain/editing";
import { assertArtifactAction, createArtifactVersion, loadArtifactRegistry, loadArtifactVersion } from "./artifacts";
import { ensureProject } from "./store";
import { safeProjectPath } from "./paths";

interface PendingCommit {
  requestId: string;
  startedAt: string;
}

export interface StoredEditSession<TDocument extends EditableArtifactDocument = EditableArtifactDocument> {
  schemaVersion: 1;
  projectId: string;
  kind: "web" | "slides";
  brandSystemVersionId: string;
  branchId: string;
  session: ArtifactEditSession<TDocument>;
  pendingCommit?: PendingCommit;
}

const queues = new Map<string, Promise<void>>();

async function serialize<T>(key: string, operation: () => Promise<T>) {
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  queues.set(key, queued);
  await previous;
  try { return await operation(); }
  finally { release(); if (queues.get(key) === queued) queues.delete(key); }
}

function identifier(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) throw new Error(`${label} contains unsupported characters.`);
}

async function files(projectId: string, sessionId: string) {
  identifier(sessionId, "Edit session id");
  await ensureProject(projectId);
  const directory = await safeProjectPath(projectId, "artifacts", "edit-sessions");
  await mkdir(directory, { recursive: true });
  return {
    current: path.join(directory, `${sessionId}.json`),
    recovery: path.join(directory, `${sessionId}.recovery.json`)
  };
}

async function atomic(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function validateStored(value: unknown): StoredEditSession {
  const stored = value as StoredEditSession;
  if (stored?.schemaVersion !== 1 || !stored.projectId?.trim() || !["web", "slides"].includes(stored.kind) || !stored.brandSystemVersionId?.trim() || !stored.branchId?.trim()) throw new Error("The persisted edit session is invalid.");
  stored.session = recoverArtifactEditSession(stored.session);
  if (stored.session.document.kind !== stored.kind) throw new Error("The edit session document kind does not match its adapter.");
  return stored;
}

async function save(stored: StoredEditSession) {
  const location = await files(stored.projectId, stored.session.sessionId);
  // The recovery journal is deliberately written first. A crash during replacement
  // leaves the last complete snapshot available even if the primary is damaged.
  await atomic(location.recovery, stored);
  await atomic(location.current, stored);
  return stored;
}

async function readJson(file: string) { return JSON.parse(await readFile(file, "utf8")) as unknown; }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

async function reconcilePendingCommit(stored: StoredEditSession) {
  if (!stored.pendingCommit) return stored;
  const registry = await loadArtifactRegistry(stored.projectId);
  const branch = registry.branches.find((candidate) => candidate.id === stored.branchId && candidate.artifactId === stored.session.artifactId);
  if (!branch?.headVersionId || branch.headVersionId === stored.session.baseArtifactVersionId) return stored;
  const head = await loadArtifactVersion<EditableArtifactDocument>(stored.projectId, branch.headVersionId);
  if (JSON.stringify(canonical(head.document)) !== JSON.stringify(canonical(stored.session.document))) return stored;
  stored.session = markEditCommitted(stored.session, stored.session.version, head.metadata.versionId);
  stored.pendingCommit = undefined;
  return save(stored);
}

export async function loadEditSession(projectId: string, sessionId: string): Promise<StoredEditSession> {
  const location = await files(projectId, sessionId);
  let stored: StoredEditSession;
  try { stored = validateStored(await readJson(location.current)); }
  catch (primaryError) {
    try { stored = validateStored(await readJson(location.recovery)); }
    catch { throw primaryError; }
  }
  if (stored.projectId !== projectId) throw new Error("Edit session belongs to another project.");
  return reconcilePendingCommit(stored);
}

export async function startEditSession<TDocument extends EditableArtifactDocument>(projectId: string, input: {
  sessionId?: string;
  artifactId: string;
  baseArtifactVersionId: string;
  document?: TDocument;
}) {
  identifier(input.artifactId, "Artifact id");
  const base = await loadArtifactVersion<TDocument>(projectId, input.baseArtifactVersionId);
  if (base.metadata.artifactId !== input.artifactId) throw new Error("The base version belongs to another artifact.");
  if (base.metadata.kind !== "web" && base.metadata.kind !== "slides") throw new Error("Only Web and slide artifacts support direct editing.");
  await assertArtifactAction(projectId, base.metadata.kind, "edit");
  const sessionId = input.sessionId ?? `edit_${randomUUID()}`;
  const session = createArtifactEditSession({ sessionId, artifactId: input.artifactId, baseArtifactVersionId: base.metadata.versionId, document: input.document ?? base.document });
  const stored: StoredEditSession<TDocument> = { schemaVersion: 1, projectId, kind: base.metadata.kind, brandSystemVersionId: base.metadata.brandSystemVersionId, branchId: base.metadata.branchId, session };
  return serialize(`${projectId}:${sessionId}`, () => save(stored) as Promise<StoredEditSession<TDocument>>);
}

export async function applyStoredEditTransaction(projectId: string, sessionId: string, input: EditTransactionInput) {
  return serialize(`${projectId}:${sessionId}`, async () => {
    const stored = await loadEditSession(projectId, sessionId);
    stored.session = applyEditTransaction(stored.session, input);
    return save(stored);
  });
}

export async function undoStoredEdit(projectId: string, sessionId: string, expectedVersion: number) {
  return serialize(`${projectId}:${sessionId}`, async () => {
    const stored = await loadEditSession(projectId, sessionId);
    stored.session = undoEditTransaction(stored.session, expectedVersion);
    return save(stored);
  });
}

export async function redoStoredEdit(projectId: string, sessionId: string, expectedVersion: number) {
  return serialize(`${projectId}:${sessionId}`, async () => {
    const stored = await loadEditSession(projectId, sessionId);
    stored.session = redoEditTransaction(stored.session, expectedVersion);
    return save(stored);
  });
}

export async function autosaveStoredEdit(projectId: string, sessionId: string, expectedVersion: number, at?: string) {
  return serialize(`${projectId}:${sessionId}`, async () => {
    const stored = await loadEditSession(projectId, sessionId);
    stored.session = markEditAutosaved(stored.session, expectedVersion, at);
    return save(stored);
  });
}

export async function commitStoredEdit(projectId: string, sessionId: string, expectedVersion: number, requestId: string = randomUUID()) {
  return serialize(`${projectId}:${sessionId}`, async () => {
    const stored = await loadEditSession(projectId, sessionId);
    if (stored.session.version !== expectedVersion) throw new Error(`Edit version conflict: expected ${expectedVersion}, current version is ${stored.session.version}.`);
    if (!stored.session.dirty) return stored;
    stored.pendingCommit = { requestId, startedAt: new Date().toISOString() };
    await save(stored);
    const version = await createArtifactVersion(projectId, {
      artifactId: stored.session.artifactId,
      kind: stored.kind,
      brandSystemVersionId: stored.brandSystemVersionId,
      branchId: stored.branchId,
      parentVersionId: stored.session.baseArtifactVersionId,
      createdBy: "user",
      document: stored.session.document,
      provenance: [{ id: `prov_${randomUUID()}`, action: "edited", actor: "user", at: new Date().toISOString(), sourceVersionId: stored.session.baseArtifactVersionId, note: `Direct edit transaction ${requestId}` }]
    });
    stored.session = markEditCommitted(stored.session, expectedVersion, version.metadata.versionId);
    stored.pendingCommit = undefined;
    return save(stored);
  });
}
