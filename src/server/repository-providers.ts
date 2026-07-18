import type {
  AdapterContext,
  ChangeRequestCreateRequest,
  ChangeRequestResult,
  IntegrationDeclaration,
  RepositoryBrowseRequest,
  RepositoryBrowseResult,
  RepositoryEntry,
  RepositoryProvider,
  RepositoryPushRequest
} from "@/domain/integrations";

export type RepositoryProviderId = "github" | "gitlab" | "bitbucket";

export interface ProviderHttpRequest {
  method: "GET" | "POST" | "PUT" | "PATCH";
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface ProviderHttpResponse {
  status: number;
  headers?: Record<string, string | undefined>;
  body: unknown;
}

export type ProviderTransport = (request: ProviderHttpRequest) => Promise<ProviderHttpResponse>;

export interface RepositoryProviderOptions {
  /** Resolved for each request. Tokens are never placed in adapter declarations or persisted state. */
  getAccessToken: () => Promise<string>;
  transport?: ProviderTransport;
  baseUrl?: string;
}

const declarations: Record<RepositoryProviderId, IntegrationDeclaration> = {
  github: {
    id: "github", displayName: "GitHub", version: "1.0.0", optional: true,
    capabilities: ["repository.browse", "repository.push", "repository.change-request.create"],
    permissions: [
      { id: "contents:read", access: "read", resource: "repository", reason: "Browse repository files and metadata.", required: true },
      { id: "contents:write", access: "write", resource: "repository", reason: "Move an existing branch reference after an explicit push action.", required: true },
      { id: "pull_requests:write", access: "write", resource: "change-request", reason: "Create a pull request when requested.", required: true }
    ]
  },
  gitlab: {
    id: "gitlab", displayName: "GitLab", version: "1.0.0", optional: true,
    capabilities: ["repository.browse", "repository.push", "repository.change-request.create"],
    permissions: [
      { id: "read_repository", access: "read", resource: "repository", reason: "Browse repository files and metadata.", required: true },
      { id: "write_repository", access: "write", resource: "repository", reason: "Move an existing branch reference after an explicit push action.", required: true },
      { id: "api", access: "write", resource: "change-request", reason: "Create a merge request when requested.", required: true }
    ]
  },
  bitbucket: {
    id: "bitbucket", displayName: "Bitbucket", version: "1.0.0", optional: true,
    capabilities: ["repository.browse", "repository.push", "repository.change-request.create"],
    permissions: [
      { id: "repository:read", access: "read", resource: "repository", reason: "Browse repository files and metadata.", required: true },
      { id: "repository:write", access: "write", resource: "repository", reason: "Move an existing branch reference after an explicit push action.", required: true },
      { id: "pullrequest:write", access: "write", resource: "change-request", reason: "Create a pull request when requested.", required: true }
    ]
  }
};

function copyDeclaration(provider: RepositoryProviderId): IntegrationDeclaration {
  return structuredClone(declarations[provider]);
}

function identifier(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9._/-]{0,255}$/i.test(value) || value.includes("..")) throw new Error(`${label} is invalid.`);
  return value;
}

function text(value: string, label: string, max = 10_000) {
  if (!value.trim() || value.length > max) throw new Error(`${label} must be between 1 and ${max} characters.`);
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The repository provider returned an invalid response.");
  return value as Record<string, unknown>;
}

function responseArray(value: unknown) { return Array.isArray(value) ? value : [value]; }

async function defaultTransport(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: request.signal });
  const body = response.status === 204 ? {} : await response.json();
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
}

abstract class HttpRepositoryProvider implements RepositoryProvider {
  readonly declaration: IntegrationDeclaration;
  protected readonly transport: ProviderTransport;
  protected readonly getAccessToken: () => Promise<string>;
  protected readonly baseUrl: string;

  constructor(readonly providerId: RepositoryProviderId, options: RepositoryProviderOptions, defaultBaseUrl: string) {
    this.declaration = copyDeclaration(providerId);
    this.transport = options.transport ?? defaultTransport;
    this.getAccessToken = options.getAccessToken;
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/$/, "");
    if (!/^https:\/\//.test(this.baseUrl)) throw new Error("Repository provider base URLs must use HTTPS.");
  }

  protected abstract authorization(token: string): Record<string, string>;
  protected abstract browseRequest(request: RepositoryBrowseRequest): Omit<ProviderHttpRequest, "headers" | "signal">;
  protected abstract browseResponse(body: unknown, request: RepositoryBrowseRequest): RepositoryBrowseResult;
  protected abstract pushRequest(request: RepositoryPushRequest): Omit<ProviderHttpRequest, "headers" | "signal">;
  protected abstract changeRequest(request: ChangeRequestCreateRequest): Omit<ProviderHttpRequest, "headers" | "signal">;
  protected abstract changeResponse(body: unknown): ChangeRequestResult;

  private async call(request: Omit<ProviderHttpRequest, "headers" | "signal">, context: AdapterContext) {
    const token = await this.getAccessToken();
    if (!token) throw new Error(`${this.declaration.displayName} is not connected.`);
    const response = await this.transport({ ...request, headers: { Accept: "application/json", "Content-Type": "application/json", ...this.authorization(token) }, signal: context.signal });
    if (response.status < 200 || response.status >= 300) throw new Error(`${this.declaration.displayName} request failed with status ${response.status}.`);
    return response.body;
  }

  async browse(request: RepositoryBrowseRequest, context: AdapterContext) {
    validateLocator(request);
    return this.browseResponse(await this.call(this.browseRequest(request), context), request);
  }

  async push(request: RepositoryPushRequest, context: AdapterContext) {
    validateLocator(request); identifier(request.branch, "Branch"); identifier(request.revision, "Revision");
    await this.call(this.pushRequest(request), context);
    return { revision: request.revision };
  }

  async createChangeRequest(request: ChangeRequestCreateRequest, context: AdapterContext) {
    validateLocator(request); text(request.title, "Change request title", 500); text(request.description, "Change request description");
    identifier(request.sourceBranch, "Source branch"); identifier(request.targetBranch, "Target branch");
    return this.changeResponse(await this.call(this.changeRequest(request), context));
  }
}

function validateLocator(request: { owner: string; repository: string }) {
  identifier(request.owner, "Repository owner"); identifier(request.repository, "Repository name");
}

function entry(value: unknown): RepositoryEntry {
  const item = object(value);
  const rawType = String(item.type ?? "file");
  const type: RepositoryEntry["type"] = rawType === "dir" || rawType === "tree" ? "directory" : rawType === "commit" ? "submodule" : rawType === "symlink" ? "symlink" : "file";
  const commit = item.commit && typeof item.commit === "object" && !Array.isArray(item.commit) ? item.commit as Record<string, unknown> : undefined;
  const links = item.links && typeof item.links === "object" && !Array.isArray(item.links) ? item.links as Record<string, unknown> : undefined;
  const self = links?.self && typeof links.self === "object" && !Array.isArray(links.self) ? links.self as Record<string, unknown> : undefined;
  return {
    path: String(item.path ?? item.name ?? ""), type, size: typeof item.size === "number" ? item.size : undefined,
    contentHash: typeof item.sha === "string" ? item.sha : typeof item.id === "string" ? item.id : typeof commit?.hash === "string" ? commit.hash : undefined,
    downloadUrl: typeof item.download_url === "string" ? item.download_url : typeof self?.href === "string" ? self.href : undefined
  };
}

export class GitHubRepositoryProvider extends HttpRepositoryProvider {
  constructor(options: RepositoryProviderOptions) { super("github", options, "https://api.github.com"); }
  protected authorization(token: string) { return { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }; }
  protected browseRequest(r: RepositoryBrowseRequest) { return { method: "GET" as const, url: `${this.baseUrl}/repos/${r.owner}/${r.repository}/contents/${r.path ? encodeURIComponent(r.path).replaceAll("%2F", "/") : ""}?ref=${encodeURIComponent(r.ref ?? "HEAD")}` }; }
  protected browseResponse(body: unknown, r: RepositoryBrowseRequest) { return { ref: r.ref ?? "HEAD", entries: responseArray(body).map(entry) }; }
  protected pushRequest(r: RepositoryPushRequest) { return { method: "PATCH" as const, url: `${this.baseUrl}/repos/${r.owner}/${r.repository}/git/refs/heads/${encodeURIComponent(r.branch)}`, body: JSON.stringify({ sha: r.revision, force: r.force ?? false }) }; }
  protected changeRequest(r: ChangeRequestCreateRequest) { return { method: "POST" as const, url: `${this.baseUrl}/repos/${r.owner}/${r.repository}/pulls`, body: JSON.stringify({ title: r.title, body: r.description, head: r.sourceBranch, base: r.targetBranch, draft: r.draft ?? false }) }; }
  protected changeResponse(body: unknown) { const value = object(body); return { id: String(value.id), number: Number(value.number), webUrl: String(value.html_url), state: value.merged === true || typeof value.merged_at === "string" ? "merged" as const : String(value.state) === "closed" ? "closed" as const : "open" as const }; }
}

export class GitLabRepositoryProvider extends HttpRepositoryProvider {
  constructor(options: RepositoryProviderOptions) { super("gitlab", options, "https://gitlab.com/api/v4"); }
  protected authorization(token: string) { return { Authorization: `Bearer ${token}` }; }
  private project(r: { owner: string; repository: string }) { return encodeURIComponent(`${r.owner}/${r.repository}`); }
  protected browseRequest(r: RepositoryBrowseRequest) { return { method: "GET" as const, url: `${this.baseUrl}/projects/${this.project(r)}/repository/tree?path=${encodeURIComponent(r.path ?? "")}&ref=${encodeURIComponent(r.ref ?? "HEAD")}&per_page=100` }; }
  protected browseResponse(body: unknown, r: RepositoryBrowseRequest) { return { ref: r.ref ?? "HEAD", entries: responseArray(body).map(entry) }; }
  protected pushRequest(r: RepositoryPushRequest) { return { method: "POST" as const, url: `${this.baseUrl}/projects/${this.project(r)}/repository/branches`, body: JSON.stringify({ branch: r.branch, ref: r.revision }) }; }
  protected changeRequest(r: ChangeRequestCreateRequest) { return { method: "POST" as const, url: `${this.baseUrl}/projects/${this.project(r)}/merge_requests`, body: JSON.stringify({ title: r.title, description: r.description, source_branch: r.sourceBranch, target_branch: r.targetBranch, draft: r.draft ?? false }) }; }
  protected changeResponse(body: unknown) { const value = object(body); return { id: String(value.id), number: Number(value.iid), webUrl: String(value.web_url), state: String(value.state) === "merged" ? "merged" as const : String(value.state) === "closed" ? "closed" as const : "open" as const }; }
}

export class BitbucketRepositoryProvider extends HttpRepositoryProvider {
  constructor(options: RepositoryProviderOptions) { super("bitbucket", options, "https://api.bitbucket.org/2.0"); }
  protected authorization(token: string) { return { Authorization: `Bearer ${token}` }; }
  protected browseRequest(r: RepositoryBrowseRequest) { return { method: "GET" as const, url: `${this.baseUrl}/repositories/${r.owner}/${r.repository}/src/${encodeURIComponent(r.ref ?? "HEAD")}/${r.path ? encodeURIComponent(r.path).replaceAll("%2F", "/") : ""}` }; }
  protected browseResponse(body: unknown, r: RepositoryBrowseRequest) { const value = object(body); return { ref: r.ref ?? "HEAD", entries: responseArray(value.values ?? body).map(entry) }; }
  protected pushRequest(r: RepositoryPushRequest) { return { method: "POST" as const, url: `${this.baseUrl}/repositories/${r.owner}/${r.repository}/refs/branches`, body: JSON.stringify({ name: r.branch, target: { hash: r.revision }, force: r.force ?? false }) }; }
  protected changeRequest(r: ChangeRequestCreateRequest) { return { method: "POST" as const, url: `${this.baseUrl}/repositories/${r.owner}/${r.repository}/pullrequests`, body: JSON.stringify({ title: r.title, description: r.description, source: { branch: { name: r.sourceBranch } }, destination: { branch: { name: r.targetBranch } }, draft: r.draft ?? false }) }; }
  protected changeResponse(body: unknown) { const value = object(body); const links = object(value.links); const html = object(links.html); return { id: String(value.id), number: Number(value.id), webUrl: String(html.href), state: String(value.state).toUpperCase() === "MERGED" ? "merged" as const : String(value.state).toUpperCase() === "DECLINED" ? "closed" as const : "open" as const }; }
}

export function repositoryProviderDeclarations(): IntegrationDeclaration[] {
  return (Object.keys(declarations) as RepositoryProviderId[]).map(copyDeclaration);
}
