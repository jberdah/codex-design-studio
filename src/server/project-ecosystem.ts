import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactAction } from "@/domain/artifacts";
import type { NamedDesignSystem, ProjectEcosystemRegistry, ProjectSkill, ProjectSkillCapability } from "@/domain/project-ecosystem";
import { getTemplate } from "./catalog";
import { loadBrandSystemVersion } from "./brand-system";
import { safeProjectPath } from "./paths";
import { ensureProject } from "./store";

const mutations = new Map<string, Promise<void>>();
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i;
const skillCapabilities: ProjectSkillCapability[] = ["read-artifacts", "propose-edits", "render", "export"];
const artifactActions: ArtifactAction[] = ["create", "edit", "preview", "animate", "export"];

function at(clock?: () => Date) { return (clock?.() ?? new Date()).toISOString(); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function identifier(value: string, label: string) { if (!IDENTIFIER.test(value)) throw new Error(`${label} must be a stable lowercase identifier.`); }
function text(value: string, label: string, max: number) { if (!value.trim() || value.length > max) throw new Error(`${label} must be between 1 and ${max} characters.`); }

async function file(projectId: string) {
  await ensureProject(projectId);
  const root = await safeProjectPath(projectId, "ecosystem"); await mkdir(root, { recursive: true });
  return path.join(root, "registry.json");
}

function empty(projectId: string): ProjectEcosystemRegistry {
  return { schemaVersion: 1, scope: "project", projectId, designSystems: [], skills: [], templates: [], updatedAt: new Date(0).toISOString() };
}

export async function loadProjectEcosystem(projectId: string): Promise<ProjectEcosystemRegistry> {
  try {
    const registry = JSON.parse(await readFile(await file(projectId), "utf8")) as ProjectEcosystemRegistry;
    if (registry.scope !== "project" || registry.projectId !== projectId) throw new Error("Invalid project ecosystem registry scope.");
    return registry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return empty(projectId);
  }
}

async function atomicJson(target: string, value: unknown) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temporary, target);
}

async function mutate<T>(projectId: string, operation: (registry: ProjectEcosystemRegistry) => T | Promise<T>) {
  const prior = mutations.get(projectId) ?? Promise.resolve(); let release!: () => void;
  const active = new Promise<void>((resolve) => { release = resolve; }); const queued = prior.then(() => active);
  mutations.set(projectId, queued); await prior;
  try { const registry = await loadProjectEcosystem(projectId); const result = await operation(registry); await atomicJson(await file(projectId), registry); return result; }
  finally { release(); if (mutations.get(projectId) === queued) mutations.delete(projectId); }
}

export async function addNamedDesignSystem(projectId: string, input: { id: string; name: string; brandSystemVersionId: string; makeDefault?: boolean }, options: { clock?: () => Date } = {}): Promise<NamedDesignSystem> {
  identifier(input.id, "Named design-system id"); text(input.name, "Named design-system name", 200);
  await loadBrandSystemVersion(projectId, input.brandSystemVersionId);
  const timestamp = at(options.clock);
  return mutate(projectId, (registry) => {
    if (registry.designSystems.some((item) => item.id === input.id)) throw new Error(`Named design system ${input.id} already exists.`);
    if (registry.designSystems.some((item) => item.status === "active" && item.name.toLocaleLowerCase() === input.name.trim().toLocaleLowerCase())) throw new Error("Active design-system names must be unique within a project.");
    const designSystem: NamedDesignSystem = { id: input.id, name: input.name.trim(), brandSystemVersionId: input.brandSystemVersionId, status: "active", createdAt: timestamp, updatedAt: timestamp };
    registry.designSystems.push(designSystem); registry.designSystems.sort((a, b) => a.name.localeCompare(b.name));
    if (input.makeDefault || !registry.defaultDesignSystemId) registry.defaultDesignSystemId = designSystem.id;
    registry.updatedAt = timestamp; return structuredClone(designSystem);
  });
}

export async function updateNamedDesignSystem(projectId: string, id: string, input: { name?: string; brandSystemVersionId?: string; status?: "active" | "archived"; makeDefault?: boolean }, options: { clock?: () => Date } = {}) {
  if (input.brandSystemVersionId) await loadBrandSystemVersion(projectId, input.brandSystemVersionId);
  if (input.name !== undefined) text(input.name, "Named design-system name", 200);
  const timestamp = at(options.clock);
  return mutate(projectId, (registry) => {
    const designSystem = registry.designSystems.find((item) => item.id === id); if (!designSystem) throw new Error("Named design system not found.");
    const nextName = input.name?.trim() ?? designSystem.name;
    const nextStatus = input.status ?? designSystem.status;
    if (nextStatus === "active" && registry.designSystems.some((item) => item.id !== id && item.status === "active" && item.name.toLocaleLowerCase() === nextName.toLocaleLowerCase())) throw new Error("Active design-system names must be unique within a project.");
    if (input.name) designSystem.name = input.name.trim(); if (input.brandSystemVersionId) designSystem.brandSystemVersionId = input.brandSystemVersionId;
    if (input.status) designSystem.status = input.status;
    if (input.makeDefault) { if (designSystem.status !== "active") throw new Error("An archived design system cannot be the project default."); registry.defaultDesignSystemId = id; }
    if (designSystem.status === "archived" && registry.defaultDesignSystemId === id) registry.defaultDesignSystemId = registry.designSystems.find((item) => item.id !== id && item.status === "active")?.id;
    designSystem.updatedAt = timestamp; registry.updatedAt = timestamp; return structuredClone(designSystem);
  });
}

export async function registerProjectSkill(projectId: string, input: { id: string; name: string; version: string; description: string; instructions: string; capabilities: ProjectSkillCapability[]; permissions: Array<{ capability: ProjectSkillCapability; reason: string }> }, options: { clock?: () => Date } = {}): Promise<ProjectSkill> {
  identifier(input.id, "Project skill id"); text(input.name, "Project skill name", 200); text(input.description, "Project skill description", 2_000); text(input.instructions, "Project skill instructions", 250_000);
  if (!SEMVER.test(input.version)) throw new Error("Project skill versions must use semantic versioning.");
  if (new Set(input.capabilities).size !== input.capabilities.length || input.capabilities.some((capability) => !skillCapabilities.includes(capability))) throw new Error("Project skill capabilities are invalid or duplicated.");
  const permissionCapabilities = new Set(input.permissions.map((permission) => permission.capability));
  if (input.permissions.some((permission) => !skillCapabilities.includes(permission.capability) || !permission.reason.trim() || permission.reason.length > 1_000) || input.capabilities.some((capability) => !permissionCapabilities.has(capability))) throw new Error("Every requested project skill capability requires an explicit permission reason.");
  const timestamp = at(options.clock); const normalized = `${input.instructions.replaceAll("\r\n", "\n").trim()}\n`;
  const skill: ProjectSkill = { id: input.id, name: input.name.trim(), version: input.version, description: input.description.trim(), instructions: normalized, instructionsHash: hash(normalized), requestedCapabilities: [...input.capabilities], approvedCapabilities: [], permissions: structuredClone(input.permissions), enabled: false, createdAt: timestamp };
  return mutate(projectId, (registry) => {
    if (registry.skills.some((item) => item.id === skill.id && item.version === skill.version)) throw new Error(`Project skill ${skill.id}@${skill.version} already exists.`);
    registry.skills.push(skill); registry.skills.sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version)); registry.updatedAt = timestamp; return structuredClone(skill);
  });
}

export async function approveProjectSkill(projectId: string, id: string, version: string, input: { approvedBy: string; capabilities: ProjectSkillCapability[] }, options: { clock?: () => Date } = {}) {
  text(input.approvedBy, "Project skill approver", 200); const timestamp = at(options.clock);
  return mutate(projectId, (registry) => {
    const skill = registry.skills.find((item) => item.id === id && item.version === version); if (!skill) throw new Error("Project skill not found.");
    if (new Set(input.capabilities).size !== input.capabilities.length || input.capabilities.some((capability) => !skill.requestedCapabilities.includes(capability))) throw new Error("Approved capabilities must be a unique subset of requested capabilities.");
    skill.approvedCapabilities = [...input.capabilities]; skill.enabled = true; skill.approvedBy = input.approvedBy.trim(); skill.approvedAt = timestamp; registry.updatedAt = timestamp;
    return structuredClone(skill);
  });
}

export async function disableProjectSkill(projectId: string, id: string, version: string, options: { clock?: () => Date } = {}) {
  const timestamp = at(options.clock);
  return mutate(projectId, (registry) => { const skill = registry.skills.find((item) => item.id === id && item.version === version); if (!skill) throw new Error("Project skill not found."); skill.enabled = false; registry.updatedAt = timestamp; return structuredClone(skill); });
}

export async function controlTemplate(projectId: string, input: { templateId: string; decision: "approved" | "blocked"; allowedActions: ArtifactAction[]; reason: string; decidedBy: string }, options: { clock?: () => Date } = {}) {
  const template = await getTemplate(projectId, input.templateId); text(input.reason, "Template decision reason", 2_000); text(input.decidedBy, "Template decision maker", 200);
  if (new Set(input.allowedActions).size !== input.allowedActions.length || input.allowedActions.some((action) => !artifactActions.includes(action))) throw new Error("Controlled template actions are invalid or duplicated.");
  for (const action of input.allowedActions) if (!template.capabilities[action]) throw new Error(`Template ${template.id} does not support ${action}.`);
  if (input.decision === "blocked" && input.allowedActions.length) throw new Error("Blocked templates cannot allow actions.");
  const timestamp = at(options.clock); const control = { templateId: template.id, templateVersion: template.version, decision: input.decision, allowedActions: [...input.allowedActions], reason: input.reason.trim(), decidedBy: input.decidedBy.trim(), decidedAt: timestamp };
  return mutate(projectId, (registry) => { registry.templates = registry.templates.filter((item) => !(item.templateId === template.id && item.templateVersion === template.version)); registry.templates.push(control); registry.updatedAt = timestamp; return structuredClone(control); });
}

export async function assertControlledTemplateAction(projectId: string, templateId: string, action: ArtifactAction) {
  const template = await getTemplate(projectId, templateId); const registry = await loadProjectEcosystem(projectId);
  const control = registry.templates.find((item) => item.templateId === template.id && item.templateVersion === template.version);
  if (!control) throw new Error(`Template ${template.id}@${template.version} requires a project-local approval.`);
  if (control.decision === "blocked") throw new Error(`Template ${template.id}@${template.version} is blocked: ${control.reason}`);
  if (!control.allowedActions.includes(action)) throw new Error(`Template ${template.id}@${template.version} is not approved for ${action}.`);
  return { template, control: structuredClone(control) };
}

export function assertProjectScope(scope: string): asserts scope is "project" {
  if (scope !== "project") throw new Error("Organization-wide governance is not part of the project-local ecosystem capability.");
}
