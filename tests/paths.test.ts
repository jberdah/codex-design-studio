import { describe, expect, it } from "vitest";
import path from "node:path";
import { assertInsideProject, projectRoot } from "@/server/paths";

describe("project workspace boundary", () => {
  it("accepts project-local paths", () => {
    expect(assertInsideProject("demo", path.join(projectRoot("demo"), "web", "index.html"))).toContain("projects/demo/web/index.html");
  });

  it("rejects traversal and invalid identifiers", () => {
    expect(() => projectRoot("../outside")).toThrow("Invalid project id");
    expect(() => assertInsideProject("demo", path.join(projectRoot("demo"), "..", "outside.txt"))).toThrow("Path escapes project workspace");
  });
});
