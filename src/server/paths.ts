import { readFileSync, realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";

export const bundleRoot = process.env.CODEX_STUDIO_BUNDLE_DIR ?? process.cwd();
const configuredRoot = process.env.CODEX_STUDIO_DATA_DIR ?? process.cwd();
if (!path.isAbsolute(configuredRoot)) throw new Error("CODEX_STUDIO_DATA_DIR must be an absolute authorized workspace path.");
export const workspaceRoot = realpathSync(configuredRoot);
export const projectsRoot = path.join(workspaceRoot, "projects");
export const codexEntrypoint = path.join(bundleRoot, "node_modules", "@openai", "codex", "bin", "codex.js");

const expectedWorkspaceId = process.env.CODEX_STUDIO_WORKSPACE_ID;
if (expectedWorkspaceId) {
  const marker = JSON.parse(readFileSync(path.join(workspaceRoot, ".codex-design-studio-workspace.json"), "utf8")) as {
    owner?: unknown;
    schemaVersion?: unknown;
    workspaceId?: unknown;
  };
  if (marker.owner !== "com.codexdesignstudio.workspace" || marker.schemaVersion !== 1 || marker.workspaceId !== expectedWorkspaceId) {
    throw new Error("Workspace ownership marker does not match the desktop authorization.");
  }
}

export function activeProjectId(request?: Request) {
  const requested = request ? new URL(request.url).searchParams.get("project") : null;
  return requested || process.env.CODEX_STUDIO_PROJECT_ID || "demo";
}

export function projectRoot(projectId = "demo") {
  if (!/^[a-z0-9-]+$/i.test(projectId)) throw new Error("Invalid project id");
  return path.join(projectsRoot, projectId);
}

function assertInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path escapes authorized workspace");
  }
  return candidate;
}

export async function canonicalPathInside(root: string, candidate: string) {
  const canonicalRoot = await realpath(root);
  const lexical = path.resolve(candidate);
  assertInside(canonicalRoot, lexical);
  let cursor = lexical;
  const missing: string[] = [];
  while (true) {
    try {
      const existing = await realpath(cursor);
      return assertInside(canonicalRoot, path.join(existing, ...missing.reverse()));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

export async function safeProjectsRoot() {
  return canonicalPathInside(workspaceRoot, projectsRoot);
}

export async function safeProjectRoot(projectId = "demo") {
  return canonicalPathInside(workspaceRoot, projectRoot(projectId));
}

export async function safeProjectPath(projectId: string, ...segments: string[]) {
  if (segments.some((segment) => path.isAbsolute(segment) || segment === ".." || segment.includes(`..${path.sep}`))) {
    throw new Error("Project paths must be relative and traversal-free");
  }
  return canonicalPathInside(workspaceRoot, path.join(projectRoot(projectId), ...segments));
}

export function assertInsideProject(projectId: string, candidate: string) {
  const root = projectRoot(projectId);
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path escapes project workspace");
  }
  return resolved;
}
