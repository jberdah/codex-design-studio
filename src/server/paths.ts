import path from "node:path";

export const workspaceRoot = process.cwd();
export const projectsRoot = path.join(workspaceRoot, "projects");

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
