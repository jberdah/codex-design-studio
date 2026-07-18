import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import { describe, expect, it } from "vitest";
import path from "node:path";
import { assertInsideProject, canonicalPathInside, projectRoot, safeProjectPath } from "@/server/paths";

describe("project workspace boundary", () => {
  it("accepts project-local paths", () => {
    expect(assertInsideProject("demo", path.join(projectRoot("demo"), "web", "index.html"))).toContain("projects/demo/web/index.html");
  });

  it("rejects traversal and invalid identifiers", () => {
    expect(() => projectRoot("../outside")).toThrow("Invalid project id");
    expect(() => assertInsideProject("demo", path.join(projectRoot("demo"), "..", "outside.txt"))).toThrow("Path escapes project workspace");
  });

  it("rejects renderer-style absolute project paths", async () => {
    await expect(safeProjectPath("demo", path.resolve("outside.txt"))).rejects.toThrow("relative and traversal-free");
    await expect(safeProjectPath("demo", "..", "outside.txt")).rejects.toThrow("traversal-free");
  });

  it.runIf(process.platform !== "win32")("rejects symlinks that escape a canonical root", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "studio-paths-"));
    const root = path.join(parent, "workspace");
    const outside = path.join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, path.join(root, "escape"));
    try {
      await expect(canonicalPathInside(root, path.join(root, "escape", "new-file"))).rejects.toThrow("escapes authorized workspace");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
