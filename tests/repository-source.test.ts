import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildCodeRealityMap, materializeCodeRealityMap } from "@/server/code-reality";
import {
  assertRepositoryTrusted,
  cloneRepository,
  grantRepositoryTrust,
  inspectRepository,
  redactCredentialText,
  sanitizeRemoteUrl
} from "@/server/repository-source";

const execFileAsync = promisify(execFile);
const fixtureRoot = path.resolve(import.meta.dirname, "fixtures", "repositories");
const temporaryRoots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-reality-"));
  temporaryRoots.push(root);
  return root;
}

async function copyFixture(name: string, destination: string) {
  await cp(path.join(fixtureRoot, name), destination, { recursive: true });
}

async function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

async function committedFixture(name: string) {
  const root = await temporaryRoot();
  const repository = path.join(root, "repository");
  await copyFixture(name, repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "Fixture Author");
  await git(repository, "config", "user.email", "fixture@example.test");
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "fixture");
  return { root, repository };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository sources", () => {
  it("inspects a plain non-Git folder without changing it", async () => {
    const root = await temporaryRoot();
    const folder = path.join(root, "plain");
    await copyFixture("plain-folder", folder);
    const snapshot = await inspectRepository({ kind: "directory", location: folder });

    expect(snapshot.git).toBeNull();
    expect(snapshot.repositoryRoot).toBe(await import("node:fs/promises").then(({ realpath }) => realpath(folder)));
    expect(snapshot.analysisSubdirectory).toBe("");
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects traversal and symlink escapes from an analysis subdirectory", async () => {
    const root = await temporaryRoot();
    const folder = path.join(root, "plain");
    await copyFixture("plain-folder", folder);
    await expect(inspectRepository({ kind: "directory", location: folder, subdirectory: "../" })).rejects.toThrow("traversal-free");
    if (process.platform !== "win32") {
      await symlink(root, path.join(folder, "escape"));
      await expect(inspectRepository({ kind: "directory", location: folder, subdirectory: "escape" })).rejects.toThrow("escapes");
    }
  });

  it("detects a monorepo subdirectory, commit, dirty state, worktrees, and sanitized remotes", async () => {
    const { root, repository } = await committedFixture("monorepo");
    const secondWorktree = path.join(root, "preview-worktree");
    await git(repository, "worktree", "add", "-b", "preview", secondWorktree);
    await git(repository, "remote", "add", "origin", "https://oauth2:secret-token@example.test/org/repo.git?token=also-secret");
    await writeFile(path.join(repository, "dirty.txt"), "dirty\n", "utf8");

    const snapshot = await inspectRepository({ kind: "local-git", location: path.join(repository, "apps", "web") });

    expect(snapshot.repositoryRoot).toBe(await import("node:fs/promises").then(({ realpath }) => realpath(repository)));
    expect(snapshot.analysisSubdirectory).toBe("apps/web");
    expect(snapshot.git).toMatchObject({ branch: "main", dirty: true, changedFileCount: 1 });
    expect(snapshot.git?.commit).toMatch(/^[a-f0-9]{40,64}$/);
    expect(snapshot.git?.worktrees).toHaveLength(2);
    expect(snapshot.git?.remotes[0].fetchUrls[0]).toBe("https://example.test/org/repo.git");
    expect(JSON.stringify(snapshot)).not.toContain("secret-token");
    expect(JSON.stringify(snapshot)).not.toContain("also-secret");
  });

  it("clones a provider-independent local bare remote and reports progress", async () => {
    const { root, repository } = await committedFixture("generic-local-bare-remote-seed");
    const bare = path.join(root, "generic.git");
    await execFileAsync("git", ["init", "--bare", bare]);
    await git(repository, "remote", "add", "bare", bare);
    await git(repository, "push", "bare", "main");
    await execFileAsync("git", ["--git-dir", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);
    const progress: string[] = [];

    const snapshot = await cloneRepository(
      { kind: "remote-git", location: bare },
      { destination: path.join(root, "clone"), onProgress: (event) => progress.push(event.message) }
    );
    const map = await buildCodeRealityMap(snapshot);

    expect(snapshot.source).toEqual({ kind: "remote-git", location: bare });
    expect(snapshot.git?.commit).toMatch(/^[a-f0-9]{40,64}$/);
    expect(progress.join("\n")).toContain("Cloning into");
    expect(map.inventory.frameworks.map((fact) => fact.name)).toContain("Astro");
    expect(map.inventory.routes.map((fact) => fact.route)).toContain("/");
    expect(map.inventory.routes[0].evidence.commit).toBe(snapshot.git?.commit);
  });

  it("honors cancellation before clone and does not leave a destination", async () => {
    const root = await temporaryRoot();
    const controller = new AbortController();
    controller.abort(new Error("cancelled by test"));
    const destination = path.join(root, "cancelled-clone");

    await expect(cloneRepository(
      { kind: "remote-git", location: "ssh://git@example.test/project.git" },
      { destination, signal: controller.signal }
    )).rejects.toThrow("cancelled by test");
    await expect(import("node:fs/promises").then(({ stat }) => stat(destination))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("sanitizes common remote and process-output credential forms", () => {
    expect(sanitizeRemoteUrl("https://user:pass@example.test/a.git?token=x")).toBe("https://example.test/a.git");
    expect(sanitizeRemoteUrl("git@example.test:team/a.git")).toBe("ssh://example.test/team/a.git");
    expect(redactCredentialText("fatal https://user:pass@example.test/a.git?token=x Authorization: Bearer abc"))
      .not.toMatch(/user|pass|token=x|Bearer abc/);
  });

  it("rejects insecure remote protocols", async () => {
    const root = await temporaryRoot();
    await expect(cloneRepository(
      { kind: "remote-git", location: "http://example.test/project.git" },
      { destination: path.join(root, "clone") }
    )).rejects.toThrow("Unsupported Git remote protocol");
    await expect(cloneRepository(
      { kind: "remote-git", location: "ext::sh -c touch /tmp/never" },
      { destination: path.join(root, "ext-clone") }
    )).rejects.toThrow("Invalid Git remote");
    await expect(cloneRepository(
      { kind: "remote-git", location: "https://user:secret@example.test/project.git" },
      { destination: path.join(root, "credential-clone") }
    )).rejects.toThrow("system credential or SSH agent");
  });
});

describe("code reality map", () => {
  it("inventories a plain application with source evidence", async () => {
    const root = await temporaryRoot();
    const folder = path.join(root, "plain");
    await copyFixture("plain-folder", folder);
    if (process.platform !== "win32") await symlink(root, path.join(folder, "linked-outside"));
    const snapshot = await inspectRepository({ kind: "directory", location: folder });
    const map = await buildCodeRealityMap(snapshot);

    expect(map.schema).toBe("code-reality-map/v1");
    expect(map.analyzedCommit).toBeNull();
    expect(map.inventory.packageManagers.map((fact) => fact.name)).toContain("npm");
    expect(map.inventory.frameworks.map((fact) => fact.name)).toEqual(expect.arrayContaining(["React", "Vite"]));
    expect(map.inventory.cssVariables.map((fact) => fact.name)).toContain("--color-brand");
    expect(map.inventory.themes.map((fact) => fact.name)).toContain("night");
    expect(map.inventory.fonts.map((fact) => fact.family)).toContain("Fixture Sans");
    expect(map.inventory.assets.map((fact) => fact.name)).toContain("logo.svg");
    expect(map.inventory.components.map((fact) => fact.exportName)).toContain("Button");
    expect(map.inventory.stories.map((fact) => fact.name)).toContain("Button.stories.tsx");
    expect(map.inventory.routes.map((fact) => fact.route)).toContain("/");
    expect(map.diagnostics.skippedSymlinkCount).toBe(process.platform === "win32" ? 0 : 1);
    for (const fact of [...map.inventory.cssVariables, ...map.inventory.components, ...map.inventory.routes]) {
      expect(fact.evidence).toMatchObject({ commit: null, startLine: expect.any(Number), endLine: expect.any(Number) });
      expect(path.isAbsolute(fact.evidence.path)).toBe(false);
    }
  });

  it("limits a monorepo map to the selected package and materializes versioned JSON", async () => {
    const root = await temporaryRoot();
    const repository = path.join(root, "monorepo");
    await copyFixture("monorepo", repository);
    const snapshot = await inspectRepository({ kind: "directory", location: repository, subdirectory: "apps/web" });
    const output = path.join(root, "artifacts", "code-reality-map.json");
    const map = await materializeCodeRealityMap(snapshot, output);
    const persisted = JSON.parse(await readFile(output, "utf8")) as typeof map;

    expect(map.repository.analysisSubdirectory).toBe("apps/web");
    expect(map.repository).toMatchObject({ root: ".", source: { location: "." } });
    expect(JSON.stringify(map)).not.toContain(root);
    expect(map.inventory.packageManagers.map((fact) => fact.name)).toContain("pnpm");
    expect(map.inventory.frameworks.map((fact) => fact.name)).toEqual(expect.arrayContaining(["Next.js", "Tailwind CSS"]));
    expect(map.inventory.tailwindFiles).toHaveLength(1);
    expect(map.inventory.tokenFiles).toHaveLength(1);
    expect(map.inventory.cssVariables.map((fact) => fact.name)).toEqual(expect.arrayContaining(["themes.light.color.surface", "themes.dark.color.surface", "spacing.small"]));
    expect(map.inventory.routes.map((fact) => fact.route)).toContain("/dashboard/:team");
    expect(map.inventory.components).toHaveLength(0);
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.repositoryFingerprint).toBe(snapshot.fingerprint);
  });
});

describe("repository trust gate", () => {
  it("requires explicit, fingerprint-bound scopes before install or execution", async () => {
    const root = await temporaryRoot();
    const folder = path.join(root, "plain");
    await copyFixture("plain-folder", folder);
    const snapshot = await inspectRepository({ kind: "directory", location: folder });

    expect(() => grantRepositoryTrust(snapshot, { confirmed: false, grantedBy: "user", scopes: ["dependency-install"] })).toThrow("explicit");
    expect(() => assertRepositoryTrusted(snapshot, null, "application-execution")).toThrow("Explicit repository trust");
    const grant = grantRepositoryTrust(snapshot, { confirmed: true, grantedBy: "user", scopes: ["dependency-install"] });
    expect(() => assertRepositoryTrusted(snapshot, grant, "dependency-install")).not.toThrow();
    expect(() => assertRepositoryTrusted(snapshot, grant, "application-execution")).toThrow("does not allow");
    expect(() => assertRepositoryTrusted({ ...snapshot, fingerprint: "changed" }, grant, "dependency-install")).toThrow("changed after trust");
  });
});
