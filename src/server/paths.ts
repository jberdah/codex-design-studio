import path from "node:path";

export const bundleRoot = process.env.CODEX_STUDIO_BUNDLE_DIR ?? process.cwd();
export const workspaceRoot = process.env.CODEX_STUDIO_DATA_DIR ?? process.cwd();
export const projectsRoot = path.join(workspaceRoot, "projects");
export const codexEntrypoint = path.join(bundleRoot, "node_modules", "@openai", "codex", "bin", "codex.js");

export function activeProjectId(request?: Request) {
  const requested = request ? new URL(request.url).searchParams.get("project") : null;
  return requested || process.env.CODEX_STUDIO_PROJECT_ID || "demo";
}

export function projectRoot(projectId = "demo") {
  if (!/^[a-z0-9-]+$/i.test(projectId)) throw new Error("Invalid project id");
  return path.join(projectsRoot, projectId);
}

export function assertInsideProject(projectId: string, candidate: string) {
  const root = projectRoot(projectId);
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Path escapes project workspace");
  }
  return resolved;
}
