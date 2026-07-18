import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultProject } from "@/domain/defaults";
import type { ProjectData } from "@/domain/types";
import { projectRoot } from "./paths";
import { renderLandingHtml, tokensToCss } from "./landing";

async function writeJsonAtomic(filePath: string, value: unknown) {
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, filePath);
}

export async function ensureProject(projectId = "demo") {
  const root = projectRoot(projectId);
  await Promise.all([
    mkdir(path.join(root, "brand"), { recursive: true }),
    mkdir(path.join(root, "design-system"), { recursive: true }),
    mkdir(path.join(root, "web"), { recursive: true }),
    mkdir(path.join(root, "slides", "preview"), { recursive: true }),
    mkdir(path.join(root, "reviews"), { recursive: true }),
    mkdir(path.join(root, "exports"), { recursive: true }),
    mkdir(path.join(root, "history"), { recursive: true })
  ]);
  try {
    await readFile(path.join(root, "project.json"), "utf8");
  } catch {
    await saveProject(structuredClone(defaultProject));
  }
  return root;
}

export async function loadProject(projectId = "demo"): Promise<ProjectData> {
  const root = await ensureProject(projectId);
  return JSON.parse(await readFile(path.join(root, "project.json"), "utf8")) as ProjectData;
}

export async function saveProject(project: ProjectData): Promise<ProjectData> {
  const root = projectRoot(project.id);
  await Promise.all([
    mkdir(path.join(root, "brand"), { recursive: true }),
    mkdir(path.join(root, "design-system"), { recursive: true }),
    mkdir(path.join(root, "web"), { recursive: true }),
    mkdir(path.join(root, "slides"), { recursive: true }),
    mkdir(path.join(root, "reviews"), { recursive: true })
  ]);
  project.updatedAt = new Date().toISOString();
  await Promise.all([
    writeJsonAtomic(path.join(root, "project.json"), project),
    writeJsonAtomic(path.join(root, "brand", "brand.json"), project.brand),
    writeJsonAtomic(path.join(root, "design-system", "tokens.json"), project.tokens),
    writeFile(path.join(root, "design-system", "tokens.css"), `${tokensToCss(project)}\n`, "utf8"),
    writeFile(path.join(root, "web", "index.html"), renderLandingHtml(project), "utf8"),
    writeJsonAtomic(path.join(root, "slides", "deck.json"), project.slides)
  ]);
  return project;
}

export async function resetProject(projectId = "demo") {
  const reset = structuredClone(defaultProject);
  reset.id = projectId;
  reset.createdAt = new Date().toISOString();
  reset.version = 1;
  return saveProject(reset);
}
