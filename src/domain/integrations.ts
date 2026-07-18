/** Provider-neutral contracts for optional integrations. Core local workflows never depend on these. */
export type IntegrationCapability =
  | "source.read"
  | "export.write"
  | "repository.browse"
  | "repository.push"
  | "repository.change-request.create";

export type IntegrationPermissionAccess = "read" | "write";

export interface IntegrationPermission {
  /** Stable provider permission or OAuth scope. */
  id: string;
  access: IntegrationPermissionAccess;
  resource: "content" | "metadata" | "repository" | "change-request";
  reason: string;
  required: boolean;
}

export interface IntegrationDeclaration {
  id: string;
  displayName: string;
  version: string;
  optional: true;
  capabilities: IntegrationCapability[];
  permissions: IntegrationPermission[];
}

export interface AdapterContext {
  projectId: string;
  signal?: AbortSignal;
}

export interface SourceReadRequest {
  locator: string;
  ref?: string;
}

export interface SourceReadResult {
  bytes: Uint8Array;
  mediaType: string;
  fileName?: string;
  etag?: string;
}

export interface SourceAdapter {
  readonly declaration: IntegrationDeclaration;
  read(request: SourceReadRequest, context: AdapterContext): Promise<SourceReadResult>;
}

export interface ExportWriteRequest {
  locator: string;
  bytes: Uint8Array;
  mediaType: string;
  overwrite?: boolean;
}

export interface ExportWriteResult {
  locator: string;
  revision?: string;
  webUrl?: string;
}

export interface ExportAdapter {
  readonly declaration: IntegrationDeclaration;
  write(request: ExportWriteRequest, context: AdapterContext): Promise<ExportWriteResult>;
}

export interface RepositoryLocator {
  owner: string;
  repository: string;
}

export interface RepositoryEntry {
  path: string;
  type: "file" | "directory" | "symlink" | "submodule";
  size?: number;
  contentHash?: string;
  downloadUrl?: string;
}

export interface RepositoryBrowseRequest extends RepositoryLocator {
  ref?: string;
  path?: string;
}

export interface RepositoryBrowseResult {
  ref: string;
  entries: RepositoryEntry[];
}

export interface RepositoryPushRequest extends RepositoryLocator {
  branch: string;
  /** Provider-visible commit or changeset already uploaded by a trusted Git transport. */
  revision: string;
  force?: boolean;
}

export interface ChangeRequestCreateRequest extends RepositoryLocator {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  draft?: boolean;
}

export interface ChangeRequestResult {
  id: string;
  number?: number;
  webUrl: string;
  state: "open" | "closed" | "merged";
}

export interface RepositoryProvider {
  readonly declaration: IntegrationDeclaration;
  browse(request: RepositoryBrowseRequest, context: AdapterContext): Promise<RepositoryBrowseResult>;
  push(request: RepositoryPushRequest, context: AdapterContext): Promise<{ revision: string }>;
  createChangeRequest(request: ChangeRequestCreateRequest, context: AdapterContext): Promise<ChangeRequestResult>;
}

export function permissionsFor(
  declaration: IntegrationDeclaration,
  capability: IntegrationCapability
): IntegrationPermission[] {
  if (!declaration.capabilities.includes(capability)) throw new Error(`${declaration.id} does not declare ${capability}.`);
  const access: IntegrationPermissionAccess = capability === "source.read" || capability === "repository.browse" ? "read" : "write";
  const permissions = declaration.permissions.filter((permission) => permission.access === access && permission.required);
  if (!permissions.length) throw new Error(`${declaration.id} must declare a required ${access} permission for ${capability}.`);
  return permissions.map((permission) => ({ ...permission }));
}

