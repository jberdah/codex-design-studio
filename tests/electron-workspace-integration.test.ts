import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createWorkspaceApi } = require("../desktop/preload-api.cjs") as {
  createWorkspaceApi: (invoke: (channel: string, ...args: unknown[]) => Promise<unknown>) => Record<string, (...args: never[]) => Promise<unknown>>;
};
const { registerWorkspaceIpc } = require("../desktop/workspace-ipc.cjs") as {
  registerWorkspaceIpc: (
    ipcMain: { handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void },
    controller: Record<string, (...args: unknown[]) => unknown>
  ) => void;
};

describe("context-isolated workspace IPC", () => {
  it("exposes only narrow operations and strips renderer-supplied paths", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const controller = {
      choose: vi.fn(async (options) => ({ id: "opaque-id", options })),
      listRecent: vi.fn(async () => [{ id: "opaque-id", displayName: "Portfolio", available: true }]),
      open: vi.fn(async (id) => ({ id })),
      relink: vi.fn(async (id) => ({ id })),
      revoke: vi.fn(async () => ({ revoked: true }))
    };
    registerWorkspaceIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, controller);
    const api = createWorkspaceApi(async (channel, ...args) => handlers.get(channel)!({}, ...args));

    expect(Object.keys(api)).toEqual(["choose", "listRecent", "open", "relink", "revoke"]);
    await api.choose({ create: true, path: "/renderer/attempt" } as never);
    await api.open("opaque-id" as never);

    expect(controller.choose).toHaveBeenCalledWith({ create: true });
    expect(controller.open).toHaveBeenCalledWith("opaque-id");
    expect(await api.listRecent()).toEqual([{ id: "opaque-id", displayName: "Portfolio", available: true }]);
  });
});
