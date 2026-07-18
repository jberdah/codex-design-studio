function createWorkspaceApi(invoke) {
  return Object.freeze({
    choose: (options = {}) => invoke("workspace:choose", { create: options.create === true }),
    listRecent: () => invoke("workspace:list-recent"),
    open: (workspaceId) => invoke("workspace:open", workspaceId),
    relink: (workspaceId) => invoke("workspace:relink", workspaceId),
    revoke: (workspaceId) => invoke("workspace:revoke", workspaceId)
  });
}

module.exports = { createWorkspaceApi };
