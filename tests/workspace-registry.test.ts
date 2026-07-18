import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  APP_OWNER,
  MARKER_FILE,
  WorkspaceRegistry,
  ensurePortableWorkspace
} = require("../desktop/workspace-registry.cjs") as {
  APP_OWNER: string;
  MARKER_FILE: string;
  WorkspaceRegistry: new (userDataPath: string) => {
    registerSelectedFolder(folderPath: string, options?: Record<string, unknown>): Promise<{ id: string; markerId: string; migration: Array<{ project: string; status: string }> }>;
    listRecent(): Promise<Array<{ id: string; displayName: string; available: boolean }>>;
    authorize(id: string): Promise<{ id: string; root: string }>;
    relink(id: string, folderPath: string): Promise<{ id: string; root: string }>;
    revoke(id: string): Promise<boolean>;
  };
  ensurePortableWorkspace(folderPath: string, options?: { create?: boolean }): Promise<{ root: string; marker: { owner: string; schemaVersion: number; workspaceId: string } }>;
};

const temporaryRoots: string[] = [];
const registryId = "243419e3-8d61-4774-84cc-2c062730ea91";

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-workspace-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portable workspace registry", () => {
  it("initializes empty folders without mixing registry metadata into project content", async () => {
    const root = await temporaryRoot();
    const userData = path.join(root, "user-data");
    const workspace = path.join(root, "portable");
    await mkdir(workspace);
    const registry = new WorkspaceRegistry(userData);

    const registered = await registry.registerSelectedFolder(workspace, { bookmark: "platform-grant" });
    const marker = JSON.parse(await readFile(path.join(workspace, MARKER_FILE), "utf8"));
    const registryJson = await readFile(path.join(userData, "workspace-registry.json"), "utf8");

    expect(marker).toMatchObject({ owner: APP_OWNER, schemaVersion: 1 });
    expect(registered.markerId).toBe(marker.workspaceId);
    expect(registryJson).toContain("platform-grant");
    expect(await readFile(path.join(workspace, MARKER_FILE), "utf8")).not.toContain("platform-grant");
    expect(registered.id).not.toBe(marker.workspaceId);
  });

  it("preserves existing repository files and authorization across relaunch", async () => {
    const root = await temporaryRoot();
    const userData = path.join(root, "user-data");
    const workspace = path.join(root, "repository");
    await mkdir(path.join(workspace, ".git"), { recursive: true });
    await writeFile(path.join(workspace, "README.md"), "user-owned\n");

    const firstLaunch = new WorkspaceRegistry(userData);
    const { id } = await firstLaunch.registerSelectedFolder(workspace);
    const secondLaunch = new WorkspaceRegistry(userData);

    expect((await secondLaunch.authorize(id)).root).toBe(await realpath(workspace));
    expect(await readFile(path.join(workspace, "README.md"), "utf8")).toBe("user-owned\n");
    expect(await secondLaunch.listRecent()).toEqual([expect.objectContaining({ id, available: true })]);
  });

  it("relinks a moved workspace only when its ownership marker matches", async () => {
    const root = await temporaryRoot();
    const registry = new WorkspaceRegistry(path.join(root, "user-data"));
    const original = path.join(root, "original");
    const moved = path.join(root, "moved");
    await mkdir(original);
    const { id } = await registry.registerSelectedFolder(original);
    await rename(original, moved);

    expect((await registry.listRecent())[0]).toMatchObject({ id, available: false });
    expect((await registry.relink(id, moved)).root).toBe(await realpath(moved));

    const other = path.join(root, "other");
    await mkdir(other);
    await ensurePortableWorkspace(other);
    await expect(registry.relink(id, other)).rejects.toThrow("different workspace");
  });

  it("revokes the private path and platform grant", async () => {
    const root = await temporaryRoot();
    const userData = path.join(root, "user-data");
    const workspace = path.join(root, "portable");
    await mkdir(workspace);
    const registry = new WorkspaceRegistry(userData);
    const { id } = await registry.registerSelectedFolder(workspace, { bookmark: "secret-grant" });

    expect(await registry.revoke(id)).toBe(true);
    await expect(registry.authorize(id)).rejects.toThrow("not authorized");
    const persisted = await readFile(path.join(userData, "workspace-registry.json"), "utf8");
    expect(persisted).not.toContain(workspace);
    expect(persisted).not.toContain("secret-grant");
  });

  it("copies legacy projects without overwriting destination projects", async () => {
    const root = await temporaryRoot();
    const legacy = path.join(root, "legacy");
    const workspace = path.join(root, "portable");
    await mkdir(path.join(legacy, "projects", "alpha"), { recursive: true });
    await writeFile(path.join(legacy, "projects", "alpha", "project.json"), "legacy-alpha");
    await mkdir(path.join(legacy, "projects", "keep"), { recursive: true });
    await writeFile(path.join(legacy, "projects", "keep", "project.json"), "legacy-keep");
    await mkdir(path.join(workspace, "projects", "keep"), { recursive: true });
    await writeFile(path.join(workspace, "projects", "keep", "project.json"), "user-keep");
    const registry = new WorkspaceRegistry(path.join(root, "user-data"));

    const result = await registry.registerSelectedFolder(workspace, { migrateFrom: legacy });

    expect(result.migration).toEqual(expect.arrayContaining([
      { project: "alpha", status: "copied" },
      { project: "keep", status: "skipped", reason: "destination-exists" }
    ]));
    expect(await readFile(path.join(workspace, "projects", "alpha", "project.json"), "utf8")).toBe("legacy-alpha");
    expect(await readFile(path.join(workspace, "projects", "keep", "project.json"), "utf8")).toBe("user-keep");
  });

  it("migrates the legacy registry schema on the next authorized write", async () => {
    const root = await temporaryRoot();
    const userData = path.join(root, "user-data");
    const workspace = path.join(root, "portable");
    await mkdir(workspace);
    const portable = await ensurePortableWorkspace(workspace);
    await mkdir(userData);
    await writeFile(path.join(userData, "workspace-registry.json"), JSON.stringify({
      schemaVersion: 0,
      activeId: registryId,
      entries: [{
        id: registryId,
        markerId: portable.marker.workspaceId,
        displayName: "Legacy portfolio",
        root: portable.root,
        platformGrant: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastOpenedAt: "2026-01-01T00:00:00.000Z",
        revokedAt: null
      }]
    }));

    await new WorkspaceRegistry(userData).authorize(registryId);
    const migrated = JSON.parse(await readFile(path.join(userData, "workspace-registry.json"), "utf8"));
    expect(migrated).toMatchObject({ schemaVersion: 1, activeWorkspaceId: registryId });
    expect(migrated.workspaces).toHaveLength(1);
    expect(migrated.entries).toBeUndefined();
  });

  it("rejects markers owned by another application", async () => {
    const root = await temporaryRoot();
    const workspace = path.join(root, "foreign");
    await mkdir(workspace);
    await writeFile(path.join(workspace, MARKER_FILE), JSON.stringify({
      owner: "foreign.app",
      schemaVersion: 1,
      workspaceId: "12345678-1234-1234-1234-123456789abc"
    }));
    await expect(ensurePortableWorkspace(workspace)).rejects.toThrow("not owned");
  });

  it.runIf(process.platform !== "win32")("rejects a projects symlink before migration can write outside", async () => {
    const root = await temporaryRoot();
    const workspace = path.join(root, "portable");
    const outside = path.join(root, "outside");
    await mkdir(workspace);
    await mkdir(outside);
    await symlink(outside, path.join(workspace, "projects"));

    await expect(ensurePortableWorkspace(workspace)).rejects.toThrow("escapes the selected folder");
  });
});
