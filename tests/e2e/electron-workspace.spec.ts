import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const markerId = "b6d6c4b7-2f66-4f1f-9a91-bcad370e44f8";
const registryId = "243419e3-8d61-4774-84cc-2c062730ea91";
const electronRuntimeAvailable = Boolean(process.env.CODEX_STUDIO_PACKAGED_APP) || existsSync(path.resolve("node_modules/electron/path.txt"));

test.skip(!electronRuntimeAvailable, "Electron's optional runtime binary is unavailable; the packaged gate supplies CODEX_STUDIO_PACKAGED_APP.");

async function launch(userData: string) {
  const packagedExecutable = process.env.CODEX_STUDIO_PACKAGED_APP;
  // Electron-based hosts (including some IDE/Codex sessions) may export this
  // variable for their own child processes. Passing it through would make the
  // tested Electron executable behave like plain Node instead of launching UI.
  const launchEnvironment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[1] !== undefined)
  );
  return electron.launch({
    ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
    args: [`--user-data-dir=${userData}`, ...(packagedExecutable ? [] : [path.resolve(".")])],
    cwd: path.resolve("."),
    env: launchEnvironment,
    timeout: 120_000
  });
}

async function recentWorkspaces(application: ElectronApplication) {
  const window = await application.firstWindow({ timeout: 120_000 });
  await window.waitForLoadState("domcontentloaded");
  return window.evaluate(() => {
    const bridge = window as unknown as {
      codexStudio: { workspace: { listRecent(): Promise<Array<{ id: string; displayName: string; available: boolean }>> } };
    };
    return bridge.codexStudio.workspace.listRecent();
  });
}

test("portable workspace survives Electron/package relaunch and can be revoked", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-electron-workspace-"));
  const userData = path.join(root, "user-data");
  const workspace = path.join(root, "portfolio");
  await mkdir(path.join(workspace, "projects"), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(workspace, ".codex-design-studio-workspace.json"), `${JSON.stringify({
    owner: "com.codexdesignstudio.workspace",
    schemaVersion: 1,
    workspaceId: markerId,
    createdAt: "2026-07-18T12:00:00.000Z"
  }, null, 2)}\n`);
  await writeFile(path.join(userData, "workspace-registry.json"), `${JSON.stringify({
    schemaVersion: 1,
    activeWorkspaceId: registryId,
    workspaces: [{
      id: registryId,
      markerId,
      displayName: "Portfolio",
      root: await realpath(workspace),
      platformGrant: null,
      createdAt: "2026-07-18T12:00:00.000Z",
      lastOpenedAt: "2026-07-18T12:00:00.000Z",
      revokedAt: null
    }]
  }, null, 2)}\n`);

  let application: ElectronApplication | undefined;
  try {
    application = await launch(userData);
    expect(await recentWorkspaces(application)).toEqual([expect.objectContaining({ id: registryId, displayName: "Portfolio", available: true })]);
    await writeFile(path.join(workspace, "user-note.txt"), "keep me\n");
    await application.close();

    application = await launch(userData);
    expect(await recentWorkspaces(application)).toEqual([expect.objectContaining({ id: registryId, available: true })]);
    expect(await readFile(path.join(workspace, "user-note.txt"), "utf8")).toBe("keep me\n");

    const window = await application.firstWindow();
    const revoked = await window.evaluate((id) => {
      const bridge = window as unknown as { codexStudio: { workspace: { revoke(workspaceId: string): Promise<{ revoked: boolean }> } } };
      return bridge.codexStudio.workspace.revoke(id);
    }, registryId);
    expect(revoked).toEqual({ revoked: true });
    expect(await recentWorkspaces(application)).toEqual([]);
  } finally {
    await application?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
