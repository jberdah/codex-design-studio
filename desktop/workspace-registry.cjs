const { randomUUID } = require("node:crypto");
const { constants } = require("node:fs");
const { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");

const APP_OWNER = "com.codexdesignstudio.workspace";
const WORKSPACE_SCHEMA_VERSION = 1;
const REGISTRY_SCHEMA_VERSION = 1;
const MARKER_FILE = ".codex-design-studio-workspace.json";
const REGISTRY_FILE = "workspace-registry.json";

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

function parseMarker(value) {
  if (!value || value.owner !== APP_OWNER || value.schemaVersion !== WORKSPACE_SCHEMA_VERSION ||
      typeof value.workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.workspaceId)) {
    throw new Error("The selected folder is not owned by Codex Design Studio or uses an unsupported workspace schema.");
  }
  return value;
}

async function readMarker(root) {
  const markerPath = path.join(root, MARKER_FILE);
  const markerStat = await lstat(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new Error("The workspace ownership marker must be a regular file inside the selected folder.");
  }
  return parseMarker(JSON.parse(await readFile(markerPath, "utf8")));
}

function assertCanonicalChild(root, candidate) {
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error("Workspace content escapes the selected folder through a symlink.");
  return candidate;
}

async function ensureProjectsDirectory(root) {
  const projects = path.join(root, "projects");
  await mkdir(projects, { recursive: true });
  return assertCanonicalChild(root, await realpath(projects));
}

async function ensurePortableWorkspace(folderPath, options = {}) {
  if (!path.isAbsolute(folderPath)) throw new Error("Workspace folders must be absolute paths selected by the operating system.");
  if (options.create) {
    await mkdir(folderPath, { recursive: true });
  } else if (!(await stat(folderPath)).isDirectory()) {
    throw new Error("The selected workspace is not a folder.");
  }
  const root = await realpath(folderPath);
  const markerPath = path.join(root, MARKER_FILE);
  try {
    const marker = await readMarker(root);
    await ensureProjectsDirectory(root);
    return { root, marker, created: false };
  } catch (error) {
    try {
      await access(markerPath, constants.F_OK);
    } catch (accessError) {
      if (!accessError || accessError.code !== "ENOENT") throw accessError;
      const now = new Date().toISOString();
      const marker = {
        owner: APP_OWNER,
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        workspaceId: randomUUID(),
        createdAt: now
      };
      await ensureProjectsDirectory(root);
      await writeJsonAtomic(markerPath, marker);
      return { root, marker, created: true };
    }
    throw error;
  }
}

function emptyRegistry() {
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, activeWorkspaceId: null, workspaces: [] };
}

function migrateRegistry(value) {
  if (!value || typeof value !== "object") return emptyRegistry();
  if (value.schemaVersion === REGISTRY_SCHEMA_VERSION && Array.isArray(value.workspaces)) return value;
  if (value.schemaVersion === 0 && Array.isArray(value.entries)) {
    return { schemaVersion: 1, activeWorkspaceId: value.activeId ?? null, workspaces: value.entries };
  }
  throw new Error("The workspace registry uses a newer unsupported schema.");
}

async function copyLegacyProjects(legacyWorkspaceRoot, portableRoot) {
  const source = path.join(legacyWorkspaceRoot, "projects");
  const diagnostics = [];
  try {
    const canonicalPortableRoot = await realpath(portableRoot);
    const canonicalLegacyRoot = await realpath(legacyWorkspaceRoot);
    const canonicalSource = assertCanonicalChild(canonicalLegacyRoot, await realpath(source));
    const canonicalDestination = await ensureProjectsDirectory(canonicalPortableRoot);
    const entries = await readdir(canonicalSource, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const from = path.join(canonicalSource, entry.name);
      const to = path.join(canonicalDestination, entry.name);
      try {
        await access(to, constants.F_OK);
        diagnostics.push({ project: entry.name, status: "skipped", reason: "destination-exists" });
      } catch {
        try {
          await cp(from, to, { recursive: true, errorOnExist: true, force: false, dereference: false });
          diagnostics.push({ project: entry.name, status: "copied" });
        } catch (error) {
          diagnostics.push({ project: entry.name, status: "failed", reason: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  return diagnostics;
}

class WorkspaceRegistry {
  constructor(userDataPath) {
    if (!path.isAbsolute(userDataPath)) throw new Error("userData must be an absolute path.");
    this.userDataPath = userDataPath;
    this.registryPath = path.join(userDataPath, REGISTRY_FILE);
  }

  async load() {
    try {
      return migrateRegistry(JSON.parse(await readFile(this.registryPath, "utf8")));
    } catch (error) {
      if (error && error.code === "ENOENT") return emptyRegistry();
      throw error;
    }
  }

  async save(registry) {
    await writeJsonAtomic(this.registryPath, registry);
  }

  async registerSelectedFolder(folderPath, { bookmark, displayName, create = false, migrateFrom } = {}) {
    const portable = await ensurePortableWorkspace(folderPath, { create });
    const registry = await this.load();
    const now = new Date().toISOString();
    let entry = registry.workspaces.find((candidate) => candidate.markerId === portable.marker.workspaceId);
    if (entry) {
      entry.root = portable.root;
      entry.displayName = displayName || path.basename(portable.root);
      entry.platformGrant = bookmark || entry.platformGrant || null;
      entry.lastOpenedAt = now;
      entry.revokedAt = null;
    } else {
      entry = {
        id: randomUUID(),
        markerId: portable.marker.workspaceId,
        displayName: displayName || path.basename(portable.root),
        root: portable.root,
        platformGrant: bookmark || null,
        createdAt: now,
        lastOpenedAt: now,
        revokedAt: null
      };
      registry.workspaces.push(entry);
    }
    registry.activeWorkspaceId = entry.id;
    await this.save(registry);
    const migration = migrateFrom ? await copyLegacyProjects(migrateFrom, portable.root) : [];
    return { id: entry.id, root: portable.root, markerId: entry.markerId, bookmark: entry.platformGrant, migration };
  }

  async listRecent() {
    const registry = await this.load();
    const recent = await Promise.all(registry.workspaces.filter((entry) => !entry.revokedAt).map(async (entry) => {
      let available = true;
      try {
        const canonical = await realpath(entry.root);
        const marker = await readMarker(canonical);
        available = marker.workspaceId === entry.markerId;
      } catch { available = false; }
      return { id: entry.id, displayName: entry.displayName, lastOpenedAt: entry.lastOpenedAt, available };
    }));
    return recent.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
  }

  async authorize(id) {
    if (typeof id !== "string") throw new Error("Invalid workspace id.");
    const registry = await this.load();
    const entry = registry.workspaces.find((candidate) => candidate.id === id && !candidate.revokedAt);
    if (!entry) throw new Error("Workspace access is not authorized.");
    const root = await realpath(entry.root);
    const marker = await readMarker(root);
    if (marker.workspaceId !== entry.markerId) throw new Error("Workspace ownership marker does not match the saved grant.");
    entry.root = root;
    entry.lastOpenedAt = new Date().toISOString();
    registry.activeWorkspaceId = id;
    await this.save(registry);
    return { id, root, markerId: entry.markerId, bookmark: entry.platformGrant };
  }

  async active() {
    const registry = await this.load();
    return registry.activeWorkspaceId ? this.authorize(registry.activeWorkspaceId) : null;
  }

  async relink(id, folderPath, bookmark) {
    const registry = await this.load();
    const entry = registry.workspaces.find((candidate) => candidate.id === id && !candidate.revokedAt);
    if (!entry) throw new Error("Workspace access is not authorized.");
    const root = await realpath(folderPath);
    const marker = await readMarker(root);
    if (marker.workspaceId !== entry.markerId) throw new Error("The selected folder belongs to a different workspace.");
    entry.root = root;
    entry.platformGrant = bookmark || entry.platformGrant || null;
    entry.lastOpenedAt = new Date().toISOString();
    registry.activeWorkspaceId = id;
    await this.save(registry);
    return { id, root, markerId: entry.markerId, bookmark: entry.platformGrant };
  }

  async revoke(id) {
    const registry = await this.load();
    const entry = registry.workspaces.find((candidate) => candidate.id === id && !candidate.revokedAt);
    if (!entry) return false;
    entry.root = null;
    entry.platformGrant = null;
    entry.revokedAt = new Date().toISOString();
    if (registry.activeWorkspaceId === id) registry.activeWorkspaceId = null;
    await this.save(registry);
    return true;
  }

  async diagnostics() {
    const registry = await this.load();
    const recent = await this.listRecent();
    return {
      registrySchemaVersion: registry.schemaVersion,
      registryPath: this.registryPath,
      activeWorkspaceId: registry.activeWorkspaceId,
      workspaces: recent
    };
  }
}

module.exports = {
  APP_OWNER,
  MARKER_FILE,
  REGISTRY_SCHEMA_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceRegistry,
  copyLegacyProjects,
  ensurePortableWorkspace,
  parseMarker,
  readMarker
};
