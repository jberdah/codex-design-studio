const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexStudio", Object.freeze({
  runtimeInfo: () => ipcRenderer.invoke("studio:runtime-info"),
  // Sandboxed preload scripts only receive Electron's restricted require shim,
  // so this bridge must remain self-contained instead of importing a local file.
  workspace: Object.freeze({
    choose: (options = {}) => ipcRenderer.invoke("workspace:choose", { create: options.create === true }),
    listRecent: () => ipcRenderer.invoke("workspace:list-recent"),
    open: (workspaceId) => ipcRenderer.invoke("workspace:open", workspaceId),
    relink: (workspaceId) => ipcRenderer.invoke("workspace:relink", workspaceId),
    revoke: (workspaceId) => ipcRenderer.invoke("workspace:revoke", workspaceId)
  })
}));
