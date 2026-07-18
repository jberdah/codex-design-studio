const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");

const HOST = "127.0.0.1";
const PORT = 32145;
let serverProcess;

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

async function startEmbeddedServer() {
  if (!app.isPackaged) return process.env.CODEX_STUDIO_DEV_URL || "http://127.0.0.1:3000";
  const serverRoot = path.join(process.resourcesPath, "studio-server");
  const runtimeRoot = path.join(process.resourcesPath, "studio-runtime");
  const dataRoot = process.env.CODEX_STUDIO_DATA_DIR || path.join(app.getPath("userData"), "workspace");
  serverProcess = spawn(process.execPath, [path.join(serverRoot, "server.js")], {
    cwd: serverRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOSTNAME: HOST,
      PORT: String(PORT),
      NEXT_TELEMETRY_DISABLED: "1",
      CODEX_STUDIO_BUNDLE_DIR: runtimeRoot,
      CODEX_STUDIO_DATA_DIR: dataRoot
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProcess.stdout.on("data", (chunk) => console.log(`[studio-server] ${String(chunk).trim()}`));
  serverProcess.stderr.on("data", (chunk) => console.error(`[studio-server] ${String(chunk).trim()}`));
  const url = `http://${HOST}:${PORT}`;
  await waitForServer(url);
  return url;
}

async function createWindow() {
  const url = await startEmbeddedServer();
  const window = new BrowserWindow({
    width: 1510,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    title: "Codex Design Studio",
    backgroundColor: "#f3f1f5",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https:\/\//i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) { event.preventDefault(); if (/^https:\/\//i.test(target)) shell.openExternal(target); }
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(url);
}

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  app.quit();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("before-quit", () => { serverProcess?.kill(); });
