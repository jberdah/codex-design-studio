function registerWorkspaceIpc(ipcMain, controller) {
  ipcMain.handle("workspace:choose", (_event, options) => controller.choose(options));
  ipcMain.handle("workspace:list-recent", () => controller.listRecent());
  ipcMain.handle("workspace:open", (_event, id) => controller.open(id));
  ipcMain.handle("workspace:relink", (_event, id) => controller.relink(id));
  ipcMain.handle("workspace:revoke", (_event, id) => controller.revoke(id));
}

module.exports = { registerWorkspaceIpc };
