import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "electron-workspace.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "NEXT_PUBLIC_CODEX_STUDIO_MODE=fallback npm run build && mkdir -p .e2e-workspace && CODEX_STUDIO_DATA_DIR=$PWD/.e2e-workspace HOSTNAME=127.0.0.1 PORT=3100 npm run start",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
