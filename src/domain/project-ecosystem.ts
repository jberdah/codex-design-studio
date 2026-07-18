import type { ArtifactAction } from "./artifacts";

export type ProjectSkillCapability = "read-artifacts" | "propose-edits" | "render" | "export";

export interface NamedDesignSystem {
  id: string;
  name: string;
  brandSystemVersionId: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSkillPermission {
  capability: ProjectSkillCapability;
  reason: string;
}

export interface ProjectSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  instructions: string;
  instructionsHash: string;
  requestedCapabilities: ProjectSkillCapability[];
  approvedCapabilities: ProjectSkillCapability[];
  permissions: ProjectSkillPermission[];
  enabled: boolean;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

export interface ControlledTemplate {
  templateId: string;
  templateVersion: string;
  decision: "approved" | "blocked";
  allowedActions: ArtifactAction[];
  reason: string;
  decidedBy: string;
  decidedAt: string;
}

export interface ProjectEcosystemRegistry {
  schemaVersion: 1;
  /** Deliberately project-only. Organization governance is a future, separate layer. */
  scope: "project";
  projectId: string;
  designSystems: NamedDesignSystem[];
  defaultDesignSystemId?: string;
  skills: ProjectSkill[];
  templates: ControlledTemplate[];
  updatedAt: string;
}

