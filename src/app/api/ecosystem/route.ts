import { NextResponse } from "next/server";
import type { ArtifactAction } from "@/domain/artifacts";
import type { CollaborationCapability } from "@/domain/collaboration";
import type { ProjectSkillCapability } from "@/domain/project-ecosystem";
import { BackgroundQueue } from "@/server/background-queue";
import { disableCollaborationCapability, enableCollaborationCapability, loadCollaborationRegistry } from "@/server/collaboration";
import { publicBackgroundJob } from "@/server/ecosystem-api";
import { activeProjectId } from "@/server/paths";
import {
  addNamedDesignSystem,
  approveProjectSkill,
  assertProjectScope,
  controlTemplate,
  disableProjectSkill,
  loadProjectEcosystem,
  registerProjectSkill,
  updateNamedDesignSystem
} from "@/server/project-ecosystem";
import { repositoryProviderDeclarations } from "@/server/repository-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const collaborationCapabilities = new Set<CollaborationCapability>(["encrypted-sync", "sharing", "roles", "audit-history", "conflict-resolution"]);

function failure(error: unknown, status?: number) {
  const message = error instanceof Error ? error.message : "Ecosystem operation failed.";
  const inferred = /not found/i.test(message) ? 404 : /already exists|unique|cannot|requires|does not support|not enabled/i.test(message) ? 409 : 400;
  return NextResponse.json({ error: message }, { status: status ?? inferred });
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required.");
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  return value;
}

export async function GET(request: Request) {
  try {
    const projectId = activeProjectId(request);
    const [ecosystem, collaboration, jobs] = await Promise.all([
      loadProjectEcosystem(projectId),
      loadCollaborationRegistry(projectId),
      new BackgroundQueue(projectId).list()
    ]);
    return NextResponse.json({
      providers: repositoryProviderDeclarations().map((declaration) => ({
        ...declaration,
        connection: { status: "not-configured" as const, credentials: "runtime-only" as const }
      })),
      ecosystem,
      collaboration,
      jobs: jobs.map(publicBackgroundJob)
    });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const projectId = activeProjectId(request);
    const body = bodyRecord(await request.json());
    assertProjectScope(body.scope === undefined ? "project" : string(body.scope, "Scope"));

    if (body.action === "register-design-system") {
      return NextResponse.json({ designSystem: await addNamedDesignSystem(projectId, {
        id: string(body.id, "Design-system id"),
        name: string(body.name, "Design-system name"),
        brandSystemVersionId: string(body.brandSystemVersionId, "BrandSystem version id"),
        makeDefault: body.makeDefault === true
      }) }, { status: 201 });
    }
    if (body.action === "set-design-system-status") {
      if (body.status !== "active" && body.status !== "archived") throw new Error("Design-system status must be active or archived.");
      return NextResponse.json({ designSystem: await updateNamedDesignSystem(projectId, string(body.id, "Design-system id"), {
        status: body.status,
        makeDefault: body.makeDefault === true
      }) });
    }
    if (body.action === "register-skill") {
      return NextResponse.json({ skill: await registerProjectSkill(projectId, {
        id: string(body.id, "Skill id"),
        name: string(body.name, "Skill name"),
        version: string(body.version, "Skill version"),
        description: string(body.description, "Skill description"),
        instructions: string(body.instructions, "Skill instructions"),
        capabilities: Array.isArray(body.capabilities) ? body.capabilities as ProjectSkillCapability[] : [],
        permissions: Array.isArray(body.permissions) ? body.permissions as Array<{ capability: ProjectSkillCapability; reason: string }> : []
      }) }, { status: 201 });
    }
    if (body.action === "approve-skill") {
      return NextResponse.json({ skill: await approveProjectSkill(
        projectId,
        string(body.id, "Skill id"),
        string(body.version, "Skill version"),
        {
          approvedBy: string(body.approvedBy, "Skill approver"),
          capabilities: Array.isArray(body.capabilities) ? body.capabilities as ProjectSkillCapability[] : []
        }
      ) });
    }
    if (body.action === "disable-skill") {
      return NextResponse.json({ skill: await disableProjectSkill(projectId, string(body.id, "Skill id"), string(body.version, "Skill version")) });
    }
    if (body.action === "control-template") {
      if (body.decision !== "approved" && body.decision !== "blocked") throw new Error("Template decision must be approved or blocked.");
      return NextResponse.json({ control: await controlTemplate(projectId, {
        templateId: string(body.templateId, "Template id"),
        decision: body.decision,
        allowedActions: Array.isArray(body.allowedActions) ? body.allowedActions as ArtifactAction[] : [],
        reason: string(body.reason, "Template decision reason"),
        decidedBy: string(body.decidedBy, "Template decision maker")
      }) });
    }
    if (body.action === "set-collaboration-capability") {
      const capability = string(body.capability, "Collaboration capability") as CollaborationCapability;
      if (!collaborationCapabilities.has(capability)) throw new Error("Unknown collaboration capability.");
      if (body.enabled !== true && body.enabled !== false) throw new Error("Collaboration capability enabled must be a boolean.");
      if (body.confirmed !== true) return failure(new Error("Changing a collaboration capability requires explicit confirmation."), 400);
      const actor = string(body.actor, "Collaboration actor");
      const collaboration = body.enabled
        ? await enableCollaborationCapability(projectId, capability, { confirmed: true, actor })
        : await disableCollaborationCapability(projectId, capability, { actor });
      return NextResponse.json({ collaboration });
    }
    return failure(new Error("Unknown or unsafe ecosystem action."), 400);
  } catch (error) { return failure(error); }
}
