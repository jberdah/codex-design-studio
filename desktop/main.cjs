const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const { WorkspaceRegistry } = require("./workspace-registry.cjs");
const { registerWorkspaceIpc } = require("./workspace-ipc.cjs");

if (process.platform === "win32") {
  app.setAppUserModelId("com.squirrel.CodexDesignStudio.CodexDesignStudio");
  if (require("electron-squirrel-startup")) app.quit();
}

const HOST = "127.0.0.1";
const PORT = 32145;
let serverProcess;
let mainWindow;
let registry;
let releasePlatformGrant;

function waitForServer(url, timeoutMs = 45_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) return resolve();
        retry();
      });
      request.on("error", retry);
      request.setTimeout(1_000, () => request.destroy());
    };
    const retry = () => Date.now() - startedAt > timeoutMs ? reject(new Error("The embedded Studio server did not start.")) : setTimeout(check, 250);
    check();
  });
}

async function stopEmbeddedServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = undefined;
  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    const abandonTimer = setTimeout(resolve, 7_000);
    child.once("exit", () => { clearTimeout(forceTimer); clearTimeout(abandonTimer); resolve(); });
    child.kill();
  });
}

function beginPlatformGrant(bookmark) {
  releasePlatformGrant?.();
  releasePlatformGrant = undefined;
  if (process.platform === "darwin" && bookmark) {
    releasePlatformGrant = app.startAccessingSecurityScopedResource(bookmark);
  }
}

async function startEmbeddedServer(grant) {
  await stopEmbeddedServer();
  beginPlatformGrant(grant.bookmark);
  const packaged = app.isPackaged;
  const serverRoot = packaged ? path.join(process.resourcesPath, "studio-server") : path.resolve(__dirname, "..");
  const runtimeRoot = packaged ? path.join(process.resourcesPath, "studio-runtime") : serverRoot;
  const entrypoint = packaged
    ? path.join(serverRoot, "server.js")
    : path.join(serverRoot, "node_modules", "next", "dist", "bin", "next");
  const args = packaged ? [entrypoint] : [entrypoint, "dev", "--webpack", "--hostname", HOST, "--port", String(PORT)];
  serverProcess = spawn(process.execPath, args, {
    cwd: serverRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOSTNAME: HOST,
      PORT: String(PORT),
      NEXT_TELEMETRY_DISABLED: "1",
      CODEX_STUDIO_BUNDLE_DIR: runtimeRoot,
      CODEX_STUDIO_DATA_DIR: grant.root,
      CODEX_STUDIO_WORKSPACE_ID: grant.markerId
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProcess.stdout.on("data", (chunk) => console.log(`[studio-server] ${String(chunk).trim()}`));
  serverProcess.stderr.on("data", (chunk) => console.error(`[studio-server] ${String(chunk).trim()}`));
  const url = `http://${HOST}:${PORT}`;
  await waitForServer(url);
  return url;
}

async function selectFolder({ create = false } = {}) {
  const options = {
    title: create ? "Create a portable Studio workspace" : "Choose a Studio workspace",
    buttonLabel: create ? "Create workspace here" : "Open workspace",
    properties: ["openDirectory", ...(create ? ["createDirectory", "promptToCreate"] : [])],
    securityScopedBookmarks: process.platform === "darwin"
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return null;
  const bookmark = result.bookmarks?.[0];
  return { folderPath: result.filePaths[0], bookmark };
}

async function chooseWorkspace(options = {}) {
  const selected = await selectFolder(options);
  if (!selected) return null;
  const grant = await registry.registerSelectedFolder(selected.folderPath, {
    bookmark: selected.bookmark,
    create: options.create,
    migrateFrom: path.join(app.getPath("userData"), "workspace")
  });
  await activateWorkspace(grant);
  return { id: grant.id, migration: grant.migration };
}

async function selectInitialWorkspace() {
  try {
    const active = await registry.active();
    if (active) return active;
  } catch (error) {
    console.warn(`[workspace] ${error instanceof Error ? error.message : String(error)}`);
  }
  const choice = await dialog.showMessageBox({
    type: "info",
    title: "Choose a project workspace",
    message: "Codex Design Studio stores projects in a portable folder you control.",
    detail: "Choose an existing folder or create a new one. Studio metadata and folder grants stay in the app's private user-data directory.",
    buttons: ["Choose folder", "Create folder", "Quit"],
    defaultId: 0,
    cancelId: 2
  });
  if (choice.response === 2) return null;
  const selected = await selectFolder({ create: choice.response === 1 });
  if (!selected) return null;
  return registry.registerSelectedFolder(selected.folderPath, {
    bookmark: selected.bookmark,
    create: choice.response === 1,
    migrateFrom: path.join(app.getPath("userData"), "workspace")
  });
}

async function activateWorkspace(grant) {
  const url = await startEmbeddedServer(grant);
  if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(url);
  return url;
}

function installWorkspaceIpc() {
  ipcMain.handle("studio:runtime-info", () => ({ platform: process.platform, arch: process.arch, packaged: app.isPackaged }));
  registerWorkspaceIpc(ipcMain, {
    choose: (options) => chooseWorkspace(options),
    listRecent: () => registry.listRecent(),
    open: async (id) => {
      const grant = await registry.authorize(id);
      await activateWorkspace(grant);
      return { id: grant.id };
    },
    relink: async (id) => {
      const selected = await selectFolder();
      if (!selected) return null;
      const grant = await registry.relink(id, selected.folderPath, selected.bookmark);
      await activateWorkspace(grant);
      return { id: grant.id };
    },
    revoke: async (id) => {
      const current = await registry.load();
      const wasActive = current.activeWorkspaceId === id;
      const revoked = await registry.revoke(id);
      if (revoked && wasActive) {
        await stopEmbeddedServer();
        releasePlatformGrant?.();
        releasePlatformGrant = undefined;
      }
      return { revoked };
    }
  });
}

async function createWindow() {
  const grant = await selectInitialWorkspace();
  if (!grant) { app.quit(); return; }
  const url = await startEmbeddedServer(grant);
  mainWindow = new BrowserWindow({
    width: 1510,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    title: "Codex Design Studio",
    backgroundColor: "#f3f1f5",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https:\/\//i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== new URL(url).origin) { event.preventDefault(); if (/^https:\/\//i.test(target)) shell.openExternal(target); }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadURL(url);
}

app.whenReady().then(async () => {
  registry = new WorkspaceRegistry(app.getPath("userData"));
  installWorkspaceIpc();
  await createWindow();
}).catch((error) => {
  console.error(error);
  app.quit();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("before-quit", () => { serverProcess?.kill(); releasePlatformGrant?.(); });
