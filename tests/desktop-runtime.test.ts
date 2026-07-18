import { describe, expect, it } from "vitest";

import runtimePolicy from "../desktop/runtime-policy.json";

const sensitiveOrDevelopmentEntries = [
  ".agents",
  ".brainclaw",
  ".git",
  ".github",
  ".local-project-materials",
  "docs",
  "src",
  "tests"
];

describe("desktop server runtime policy", () => {
  it("contains the complete standalone server contract", () => {
    expect(runtimePolicy.requiredServerEntries).toEqual(
      expect.arrayContaining([".next", "node_modules", "package.json", "server.js"])
    );
    expect(runtimePolicy.serverEntries).toEqual(
      expect.arrayContaining(runtimePolicy.requiredServerEntries)
    );
  });

  it("does not package repository or development state", () => {
    expect(runtimePolicy.serverEntries).not.toEqual(
      expect.arrayContaining(sensitiveOrDevelopmentEntries)
    );
  });
});
