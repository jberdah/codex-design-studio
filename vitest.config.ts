import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    // The suite is filesystem-heavy and several tests drive a real Chromium
    // or git subprocess; under parallel workers on slower disks (notably
    // Windows) those legitimately exceed the 5s default by a wide margin.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    coverage: { reporter: ["text", "json"] }
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } }
});
