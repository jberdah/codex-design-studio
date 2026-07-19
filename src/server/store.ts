import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { defaultProject } from "@/domain/defaults";
import type { ProjectData, ProjectSummary } from "@/domain/types";
import { safeProjectPath, safeProjectRoot, safeProjectsRoot } from "./paths";
import { renderLandingHtml, tokensToCss } from "./landing";

const projectMutationQueues = new Map<string, Promise<void>>();

async function serializeProject<T>(projectId: string, operation: () => Promise<T>) {
  const previous = projectMutationQueues.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  projectMutationQueues.set(projectId, queued);
  await previous;
  try { return await operation(); }
  finally { release(); if (projectMutationQueues.get(projectId) === queued) projectMutationQueues.delete(projectId); }
}

export async function writeTextAtomic(filePath: string, contents: string) {
  const temp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, contents, "utf8");
  await rename(temp, filePath);
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
  await writeTextAtomic(await safeProjectPath(projectId, "web", "index.html"), html);
}

export async function activateCustomLanding(projectId: string, input: {
  expectedProjectVersion: number;
  expectedSourceHash: string;
  html: string;
  summary: string;
  threadId?: string;
}) {
  await ensureProject(projectId);
  return serializeProject(projectId, async () => {
    const manifest = await safeProjectPath(projectId, "project.json");
    const landing = await safeProjectPath(projectId, "web", "index.html");
    const project = JSON.parse(await readFile(manifest, "utf8")) as ProjectData;
    if (project.version !== input.expectedProjectVersion) throw new Error(`This candidate is stale because the project advanced from version ${input.expectedProjectVersion} to ${project.version}.`);
    const originalHtml = await readFile(landing, "utf8");
    const currentHash = createHash("sha256").update(originalHtml).digest("hex");
    if (currentHash !== input.expectedSourceHash) throw new Error("This candidate is stale because the active Web source changed.");
    try {
      await writeTextAtomic(landing, input.html);
      project.version += 1;
      project.lastSummary = input.summary;
      project.webCustomized = true;
      if (input.threadId) project.threadId = input.threadId;
      return await saveProjectFiles(project, { renderWeb: false });
    } catch (error) {
      await writeTextAtomic(landing, originalHtml);
      throw error;
    }
  });
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

async function saveProjectFiles(project: ProjectData, options: SaveProjectOptions = {}): Promise<ProjectData> {
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
    writeTextAtomic(tokensCss, `${tokensToCss(project)}\n`),
    writeJsonAtomic(deck, project.slideDocument ?? project.slides)
  ];
  if (renderWeb) writes.push(writeTextAtomic(landing, renderLandingHtml(project)));
  if (writeInitial) writes.push(writeJsonAtomic(initial, project));
  await Promise.all(writes);
  return project;
}

export function saveProject(project: ProjectData, options: SaveProjectOptions = {}): Promise<ProjectData> {
  return serializeProject(project.id, () => saveProjectFiles(project, options));
}

export async function mutateProject(projectId: string, expectedVersion: number, update: (project: ProjectData) => void, options: SaveProjectOptions | ((project: ProjectData) => SaveProjectOptions) = {}) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error("An integer expected project version is required.");
  await ensureProject(projectId);
  return serializeProject(projectId, async () => {
    const manifest = await safeProjectPath(projectId, "project.json");
    const project = JSON.parse(await readFile(manifest, "utf8")) as ProjectData;
    if (project.version !== expectedVersion) throw new Error(`Project version conflict: expected ${expectedVersion}, current version is ${project.version}.`);
    update(project);
    project.version += 1;
    return saveProjectFiles(project, typeof options === "function" ? options(project) : options);
  });
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
  const hiddenBootstrapProject = /^bootstrap-(?:(?:approved|finalizing)-)?[a-f0-9]{24}$/;
  const projects = await Promise.all(entries.filter((entry) => entry.isDirectory() && !hiddenBootstrapProject.test(entry.name)).map(async (entry) => {
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
