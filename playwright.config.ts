import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

// The workspace folder must exist before the web server boots; creating it here
// keeps the webServer command free of shell-specific syntax (works on cmd.exe and sh).
const e2eWorkspace = path.resolve(".e2e-workspace");
mkdirSync(e2eWorkspace, { recursive: true });

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "electron-workspace.spec.ts",
  fullyParallel: false,
  // Shared CI runners occasionally stall a single interaction past its
  // timeout; one retry keeps the suite honest locally and stable in CI.
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run build && npm run start",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_CODEX_STUDIO_MODE: "fallback",
      CODEX_STUDIO_DATA_DIR: e2eWorkspace,
      HOSTNAME: "127.0.0.1",
      PORT: "3100"
    }
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
