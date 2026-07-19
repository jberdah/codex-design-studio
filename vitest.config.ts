import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    // The suite is filesystem-heavy; under parallel workers on slower disks
    // (notably Windows) individual tests regularly exceed the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { reporter: ["text", "json"] }
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } }
});
