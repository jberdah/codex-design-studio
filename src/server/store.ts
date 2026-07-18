import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { defaultProject } from "@/domain/defaults";
import type { ProjectData, ProjectSummary } from "@/domain/types";
import { safeProjectPath, safeProjectRoot, safeProjectsRoot } from "./paths";
import { renderLandingHtml, tokensToCss } from "./landing";

async function writeJsonAtomic(filePath: string, value: unknown) {
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, filePath);
}

export async function ensureProject(projectId = "demo") {
  const root = await safeProjectRoot(projectId);
  const directories = await Promise.all([
    safeProjectPath(projectId, "brand"),
    safeProjectPath(projectId, "design-system"),
    safeProjectPath(projectId, "web"),
    safeProjectPath(projectId, "slides", "preview"),
    safeProjectPath(projectId, "reviews"),
    safeProjectPath(projectId, "exports"),
    safeProjectPath(projectId, "history")
  ]);
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));
  try {
    await readFile(await safeProjectPath(projectId, "project.json"), "utf8");
  } catch {
    const initial = structuredClone(defaultProject);
    initial.id = projectId;
    if (projectId !== "demo") initial.name = projectId;
    await saveProject(initial, { touch: false, writeInitial: true });
  }
  return root;
}

export async function loadProject(projectId = "demo"): Promise<ProjectData> {
  await ensureProject(projectId);
  const project = JSON.parse(await readFile(await safeProjectPath(projectId, "project.json"), "utf8")) as ProjectData;
  if (!project.landing.navigation) {
    const priorIntent = `${project.lastSummary ?? ""} ${project.brand.visualDirection}`;
    project.landing.navigation = structuredClone(defaultProject.landing.navigation);
    project.landing.navigation.showIcons = /icons?.*(menu|navigation)|(menu|navigation).*icons?/i.test(priorIntent);
    await saveProject(project, { touch: false });
  }
  return project;
}

export async function loadLandingHtml(projectId = "demo") {
  await ensureProject(projectId);
  return readFile(await safeProjectPath(projectId, "web", "index.html"), "utf8");
}

export async function writeLandingHtml(projectId: string, html: string) {
  await ensureProject(projectId);
  await writeFile(await safeProjectPath(projectId, "web", "index.html"), html, "utf8");
}

export async function saveProjectManifest(project: ProjectData, touch = true) {
  await ensureProject(project.id);
  if (touch) project.updatedAt = new Date().toISOString();
  await writeJsonAtomic(await safeProjectPath(project.id, "project.json"), project);
  return project;
}

interface SaveProjectOptions {
  touch?: boolean;
  renderWeb?: boolean;
  writeInitial?: boolean;
}

export async function saveProject(project: ProjectData, options: SaveProjectOptions = {}): Promise<ProjectData> {
  const { touch = true, renderWeb = true, writeInitial = false } = options;
  const directories = await Promise.all([
    safeProjectPath(project.id, "brand"),
    safeProjectPath(project.id, "design-system"),
    safeProjectPath(project.id, "web"),
    safeProjectPath(project.id, "slides"),
    safeProjectPath(project.id, "reviews"),
    safeProjectPath(project.id, "history")
  ]);
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));
  if (touch) project.updatedAt = new Date().toISOString();
  const [manifest, brand, tokensJson, tokensCss, deck, landing, initial] = await Promise.all([
    safeProjectPath(project.id, "project.json"),
    safeProjectPath(project.id, "brand", "brand.json"),
    safeProjectPath(project.id, "design-system", "tokens.json"),
    safeProjectPath(project.id, "design-system", "tokens.css"),
    safeProjectPath(project.id, "slides", "deck.json"),
    safeProjectPath(project.id, "web", "index.html"),
    safeProjectPath(project.id, "history", "initial.json")
  ]);
  const writes: Array<Promise<unknown>> = [
    writeJsonAtomic(manifest, project),
    writeJsonAtomic(brand, project.brand),
    writeJsonAtomic(tokensJson, project.tokens),
    writeFile(tokensCss, `${tokensToCss(project)}\n`, "utf8"),
    writeJsonAtomic(deck, project.slides)
  ];
  if (renderWeb) writes.push(writeFile(landing, renderLandingHtml(project), "utf8"));
  if (writeInitial) writes.push(writeJsonAtomic(initial, project));
  await Promise.all(writes);
  return project;
}

export async function resetProject(projectId = "demo") {
  await ensureProject(projectId);
  let reset: ProjectData;
  try {
    reset = JSON.parse(await readFile(await safeProjectPath(projectId, "history", "initial.json"), "utf8")) as ProjectData;
  } catch {
    reset = structuredClone(defaultProject);
    reset.id = projectId;
  }
  reset.version = 1;
  reset.threadId = undefined;
  reset.webCustomized = false;
  reset.lastSummary = "Project restored to its initial design.";
  return saveProject(reset);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const root = await safeProjectsRoot();
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const projects = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try {
      const project = JSON.parse(await readFile(await safeProjectPath(entry.name, "project.json"), "utf8")) as ProjectData;
      return { id: project.id, name: project.name, brandName: project.brand.name, industry: project.brand.industry, updatedAt: project.updatedAt, version: project.version } satisfies ProjectSummary;
    } catch { return null; }
  }));
  return projects.filter((project): project is ProjectSummary => Boolean(project)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createProject(input: { name?: string; brandName: string; industry: string; audience: string; promise: string }) {
  await mkdir(await safeProjectsRoot(), { recursive: true });
  const base = input.brandName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "project";
  let id = base;
  try {
    await readFile(await safeProjectPath(id, "project.json"), "utf8");
    id = `${base}-${randomBytes(2).toString("hex")}`;
  } catch { /* The readable slug is available. */ }
  const now = new Date().toISOString();
  const project = structuredClone(defaultProject);
  project.id = id;
  project.name = input.name?.trim() || `${input.brandName.trim()} Launch`;
  project.createdAt = now;
  project.updatedAt = now;
  project.version = 1;
  project.brand.name = input.brandName.trim();
  project.brand.industry = input.industry.trim();
  project.brand.audience = input.audience.trim();
  project.brand.promise = input.promise.trim();
  const promise = project.brand.promise.replace(/[.!?]+$/, "");
  const audience = project.brand.audience.charAt(0).toLowerCase() + project.brand.audience.slice(1);
  const industry = project.brand.industry.charAt(0).toUpperCase() + project.brand.industry.slice(1);
  project.landing.eyebrow = `${industry}, made clear`;
  project.landing.headline = `${promise}.`;
  project.landing.subhead = `${project.brand.name} gives ${audience} a clearer way to decide, align, and move forward.`;
  project.landing.finalHeadline = `Make the next ${project.brand.industry.toLowerCase()} decision clear.`;
  project.slides[0].eyebrow = `${project.brand.name.toUpperCase()} / 2026`;
  project.slides[0].title = `${promise}.`;
  project.slides[0].body = `A launch narrative for ${audience}, powered by one executable brand system.`;
  project.slides[1].title = `Built for ${audience}`;
  project.slides[1].bullets = [project.brand.promise, "Create one shared source of truth", "Move from direction to measurable action"];
  project.threadId = undefined;
  project.lastSummary = "Created a new brand project.";
  return saveProject(project, { writeInitial: true });
}
