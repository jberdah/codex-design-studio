import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CollaborationAuditEvent, CollaborationCapability, CollaborationConflict, CollaborationRegistry, CollaborationRole, EncryptedSyncEnvelope } from "@/domain/collaboration";
import { safeProjectPath } from "./paths";
import { ensureProject } from "./store";
import { renameWithRetry } from "./fs-atomic";

const mutations = new Map<string, Promise<void>>();
const capabilities: CollaborationCapability[] = ["encrypted-sync", "sharing", "roles", "audit-history", "conflict-resolution"];
const roles: CollaborationRole[] = ["owner", "editor", "commenter", "viewer"];
const MAX_SYNC_PLAINTEXT_BYTES = 100_000_000;
const MAX_SYNC_SECRET_BYTES = 4_096;
const dependencies: Partial<Record<CollaborationCapability, CollaborationCapability[]>> = {
  sharing: ["encrypted-sync"], roles: ["sharing"], "conflict-resolution": ["encrypted-sync"]
};

function now(clock?: () => Date) { return (clock?.() ?? new Date()).toISOString(); }
function digest(value: string | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function serialize(value: unknown) {
  const serialized = JSON.stringify(stable(value));
  if (serialized === undefined) throw new Error("Encrypted sync payloads must be JSON values.");
  return serialized;
}

function empty(projectId: string): CollaborationRegistry {
  return {
    schemaVersion: 1, projectId, mode: "local-only",
    capabilities: { "encrypted-sync": false, sharing: false, roles: false, "audit-history": false, "conflict-resolution": false },
    members: [], audit: [], conflicts: [], updatedAt: new Date(0).toISOString()
  };
}

async function file(projectId: string) {
  await ensureProject(projectId); const root = await safeProjectPath(projectId, "collaboration"); await mkdir(root, { recursive: true }); return path.join(root, "registry.json");
}

export async function loadCollaborationRegistry(projectId: string): Promise<CollaborationRegistry> {
  try {
    const registry = JSON.parse(await readFile(await file(projectId), "utf8")) as CollaborationRegistry;
    if (registry.projectId !== projectId || registry.schemaVersion !== 1) throw new Error("Invalid collaboration registry.");
    return registry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return empty(projectId);
  }
}

async function atomicJson(target: string, value: unknown) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await renameWithRetry(temporary, target);
}

async function mutate<T>(projectId: string, operation: (registry: CollaborationRegistry) => T | Promise<T>) {
  const prior = mutations.get(projectId) ?? Promise.resolve(); let release!: () => void;
  const active = new Promise<void>((resolve) => { release = resolve; }); const queued = prior.then(() => active); mutations.set(projectId, queued); await prior;
  try { const registry = await loadCollaborationRegistry(projectId); const result = await operation(registry); await atomicJson(await file(projectId), registry); return result; }
  finally { release(); if (mutations.get(projectId) === queued) mutations.delete(projectId); }
}

function text(value: string, label: string, max = 500) { if (!value.trim() || value.length > max) throw new Error(`${label} must be between 1 and ${max} characters.`); return value.trim(); }

function appendAudit(registry: CollaborationRegistry, actor: string, action: string, detail: Record<string, string | number | boolean>, at: string) {
  if (!registry.capabilities["audit-history"]) return;
  const prior = registry.audit.at(-1); const event = { id: `audit_${randomUUID()}`, sequence: (prior?.sequence ?? 0) + 1, at, actor, action, detail, previousHash: prior?.hash ?? null };
  const complete: CollaborationAuditEvent = { ...event, hash: digest(serialize(event)) }; registry.audit.push(complete);
}

function requireCapability(registry: CollaborationRegistry, capability: CollaborationCapability) {
  if (!registry.capabilities[capability]) throw new Error(`Collaboration capability ${capability} is not enabled for this project.`);
}

/** Every capability requires a separate explicit opt-in. Enabling sync never enables sharing. */
export async function enableCollaborationCapability(projectId: string, capability: CollaborationCapability, input: { confirmed: boolean; actor: string }, options: { clock?: () => Date } = {}) {
  if (!capabilities.includes(capability)) throw new Error("Unknown collaboration capability.");
  if (!input.confirmed) throw new Error(`Enabling ${capability} requires explicit confirmation.`);
  const actor = text(input.actor, "Collaboration actor"); const timestamp = now(options.clock);
  return mutate(projectId, (registry) => {
    for (const dependency of dependencies[capability] ?? []) requireCapability(registry, dependency);
    registry.capabilities[capability] = true;
    if (capability === "encrypted-sync") registry.mode = "encrypted-sync";
    registry.updatedAt = timestamp; appendAudit(registry, actor, "capability.enabled", { capability }, timestamp); return structuredClone(registry);
  });
}

export async function disableCollaborationCapability(projectId: string, capability: CollaborationCapability, input: { actor: string }, options: { clock?: () => Date } = {}) {
  if (!capabilities.includes(capability)) throw new Error("Unknown collaboration capability.");
  const actor = text(input.actor, "Collaboration actor"); const timestamp = now(options.clock);
  return mutate(projectId, (registry) => {
    const revokesMemberships = capability === "encrypted-sync" || capability === "sharing" || capability === "roles";
    let revokedMembers = 0;
    if (revokesMemberships) {
      for (const member of registry.members) {
        if (!member.revokedAt) { member.revokedAt = timestamp; revokedMembers += 1; }
      }
    }
    if (capability === "audit-history") appendAudit(registry, actor, "capability.disabled", { capability, revokedMembers }, timestamp);
    registry.capabilities[capability] = false;
    if (capability === "encrypted-sync") {
      registry.mode = "local-only"; registry.capabilities.sharing = false; registry.capabilities.roles = false; registry.capabilities["conflict-resolution"] = false;
    }
    if (capability === "sharing") registry.capabilities.roles = false;
    if (capability !== "audit-history") appendAudit(registry, actor, "capability.disabled", { capability, revokedMembers }, timestamp);
    registry.updatedAt = timestamp; return structuredClone(registry);
  });
}

function encryptionKey(secret: string | Uint8Array, salt: Uint8Array) {
  const bytes = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret);
  if (bytes.byteLength < 16) throw new Error("Encrypted sync keys must contain at least 16 bytes.");
  if (bytes.byteLength > MAX_SYNC_SECRET_BYTES) throw new Error(`Encrypted sync keys cannot exceed ${MAX_SYNC_SECRET_BYTES} bytes.`);
  return scryptSync(bytes, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function decodeCanonicalBase64(value: unknown, label: string, maximumBytes: number, exactBytes?: number) {
  if (typeof value !== "string" || !value.length) throw new Error(`Encrypted sync envelope ${label} is not canonical base64.`);
  if (value.length > Math.ceil(maximumBytes / 3) * 4) throw new Error(`Encrypted sync envelope ${label} exceeds ${maximumBytes} bytes.`);
  if (value.length % 4 !== 0 || !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(value)) {
    throw new Error(`Encrypted sync envelope ${label} is not canonical base64.`);
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedLength = value.length / 4 * 3 - padding;
  if (decodedLength > maximumBytes) throw new Error(`Encrypted sync envelope ${label} exceeds ${maximumBytes} bytes.`);
  if (exactBytes !== undefined && decodedLength !== exactBytes) throw new Error(`Encrypted sync envelope ${label} must contain exactly ${exactBytes} bytes.`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(`Encrypted sync envelope ${label} is not canonical base64.`);
  return decoded;
}

export interface DecryptSyncOptions {
  /** Constrained callers may lower, but never raise, the hard ciphertext limit. */
  maxCiphertextBytes?: number;
}

/** Produces an opaque authenticated envelope; the caller owns transport and runtime key custody. */
export async function encryptSyncPayload(projectId: string, payload: unknown, secret: string | Uint8Array, options: { clock?: () => Date } = {}): Promise<EncryptedSyncEnvelope> {
  const registry = await loadCollaborationRegistry(projectId); requireCapability(registry, "encrypted-sync");
  const plaintext = Buffer.from(serialize(payload), "utf8"); if (plaintext.byteLength > MAX_SYNC_PLAINTEXT_BYTES) throw new Error("Encrypted sync payload exceeds 100 MB.");
  const salt = randomBytes(16); const iv = randomBytes(12); const key = encryptionKey(secret, salt); const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`codex-design-sync/v1:${projectId}`, "utf8")); const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { schemaVersion: 1, projectId, cipher: "aes-256-gcm", kdf: "scrypt", salt: salt.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"), plaintextHash: digest(plaintext), createdAt: now(options.clock) };
}

export function decryptSyncPayload<T = unknown>(projectId: string, envelope: EncryptedSyncEnvelope, secret: string | Uint8Array, options: DecryptSyncOptions = {}): T {
  if (envelope.schemaVersion !== 1 || envelope.projectId !== projectId || envelope.cipher !== "aes-256-gcm" || envelope.kdf !== "scrypt") throw new Error("Encrypted sync envelope does not belong to this project or schema.");
  const maxCiphertextBytes = options.maxCiphertextBytes ?? MAX_SYNC_PLAINTEXT_BYTES;
  if (!Number.isSafeInteger(maxCiphertextBytes) || maxCiphertextBytes < 1 || maxCiphertextBytes > MAX_SYNC_PLAINTEXT_BYTES) throw new Error(`Encrypted sync ciphertext limit must be between 1 and ${MAX_SYNC_PLAINTEXT_BYTES} bytes.`);
  const salt = decodeCanonicalBase64(envelope.salt, "salt", 16, 16);
  const iv = decodeCanonicalBase64(envelope.iv, "iv", 12, 12);
  const authTag = decodeCanonicalBase64(envelope.authTag, "authentication tag", 16, 16);
  if (typeof envelope.plaintextHash !== "string" || !/^[0-9a-f]{64}$/i.test(envelope.plaintextHash)) throw new Error("Encrypted sync envelope plaintext hash is invalid.");
  const ciphertext = decodeCanonicalBase64(envelope.ciphertext, "ciphertext", maxCiphertextBytes);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret, salt), iv); decipher.setAAD(Buffer.from(`codex-design-sync/v1:${projectId}`, "utf8")); decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]); const expected = Buffer.from(envelope.plaintextHash, "hex"); const actual = Buffer.from(digest(plaintext), "hex");
  if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) throw new Error("Encrypted sync payload hash does not match.");
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export async function grantCollaborationRole(projectId: string, input: { subjectId: string; displayName: string; role: CollaborationRole; grantedBy: string }, options: { clock?: () => Date } = {}) {
  const subjectId = text(input.subjectId, "Collaboration subject id"); const displayName = text(input.displayName, "Collaboration display name"); const grantedBy = text(input.grantedBy, "Collaboration grantor");
  if (!roles.includes(input.role)) throw new Error("Unknown collaboration role."); const timestamp = now(options.clock);
  return mutate(projectId, (registry) => {
    requireCapability(registry, "sharing"); requireCapability(registry, "roles");
    const prior = registry.members.find((member) => member.subjectId === subjectId && !member.revokedAt); if (prior) prior.revokedAt = timestamp;
    const member = { subjectId, displayName, role: input.role, grantedBy, grantedAt: timestamp }; registry.members.push(member); registry.updatedAt = timestamp;
    appendAudit(registry, grantedBy, "role.granted", { subjectId, role: input.role }, timestamp); return structuredClone(member);
  });
}

export async function revokeCollaborationRole(projectId: string, subjectId: string, input: { actor: string }, options: { clock?: () => Date } = {}) {
  const actor = text(input.actor, "Collaboration actor"); const timestamp = now(options.clock);
  return mutate(projectId, (registry) => {
    requireCapability(registry, "sharing"); requireCapability(registry, "roles"); const member = registry.members.find((item) => item.subjectId === subjectId && !item.revokedAt); if (!member) throw new Error("Active collaboration member not found.");
    member.revokedAt = timestamp; registry.updatedAt = timestamp; appendAudit(registry, actor, "role.revoked", { subjectId }, timestamp); return structuredClone(member);
  });
}

export async function recordCollaborationConflict(projectId: string, input: { artifactId: string; baseHash: string; localHash: string; remoteHash: string }, options: { clock?: () => Date } = {}): Promise<CollaborationConflict> {
  for (const [label, value] of Object.entries(input)) text(value, label, 500); const timestamp = now(options.clock);
  return mutate(projectId, (registry) => {
    requireCapability(registry, "conflict-resolution");
    if (input.localHash === input.remoteHash) throw new Error("Equal revisions do not create a collaboration conflict.");
    const conflict: CollaborationConflict = { id: `conflict_${randomUUID()}`, ...input, status: "open", createdAt: timestamp }; registry.conflicts.push(conflict); registry.updatedAt = timestamp;
    appendAudit(registry, "system", "conflict.recorded", { conflictId: conflict.id, artifactId: input.artifactId }, timestamp); return structuredClone(conflict);
  });
}

export async function resolveCollaborationConflict(projectId: string, conflictId: string, input: { resolution: "local" | "remote" | "merged"; mergedHash?: string; resolvedBy: string }, options: { clock?: () => Date } = {}) {
  const resolvedBy = text(input.resolvedBy, "Conflict resolver"); const timestamp = now(options.clock);
  return mutate(projectId, (registry) => {
    requireCapability(registry, "conflict-resolution"); const conflict = registry.conflicts.find((item) => item.id === conflictId); if (!conflict || conflict.status !== "open") throw new Error("Open collaboration conflict not found.");
    if (input.resolution === "merged" && !input.mergedHash) throw new Error("Merged conflict resolution requires a merged content hash.");
    conflict.status = "resolved"; conflict.resolution = input.resolution; conflict.resolvedHash = input.resolution === "local" ? conflict.localHash : input.resolution === "remote" ? conflict.remoteHash : text(input.mergedHash!, "Merged content hash"); conflict.resolvedBy = resolvedBy; conflict.resolvedAt = timestamp;
    registry.updatedAt = timestamp; appendAudit(registry, resolvedBy, "conflict.resolved", { conflictId, resolution: input.resolution, resolvedHash: conflict.resolvedHash }, timestamp); return structuredClone(conflict);
  });
}

export async function verifyCollaborationAudit(projectId: string) {
  const registry = await loadCollaborationRegistry(projectId); requireCapability(registry, "audit-history"); let previousHash: string | null = null;
  for (let index = 0; index < registry.audit.length; index += 1) {
    const event = registry.audit[index]; const { hash, ...identity } = event;
    if (event.sequence !== index + 1 || event.previousHash !== previousHash || digest(serialize(identity)) !== hash) return false;
    previousHash = hash;
  }
  return true;
}
