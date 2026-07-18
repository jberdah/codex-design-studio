import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-ecosystem-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true });
});

describe("provider-neutral optional repository integrations", () => {
  it("declares capabilities and permissions and keeps credentials runtime-only", async () => {
    const requests: Array<{ url: string; authorization?: string }> = [];
    const { GitHubRepositoryProvider, repositoryProviderDeclarations } = await import("@/server/repository-providers");
    const provider = new GitHubRepositoryProvider({
      getAccessToken: async () => "runtime-secret",
      transport: async (request) => {
        requests.push({ url: request.url, authorization: request.headers.Authorization });
        return { status: 200, body: [{ path: "src", type: "dir", sha: "abc" }] };
      }
    });
    const result = await provider.browse({ owner: "studio", repository: "design", ref: "main" }, { projectId: "demo" });

    expect(repositoryProviderDeclarations().map((item) => item.id)).toEqual(["github", "gitlab", "bitbucket"]);
    for (const declaration of repositoryProviderDeclarations()) {
      expect(declaration.optional).toBe(true);
      expect(declaration.capabilities).toEqual(expect.arrayContaining(["repository.browse", "repository.branch.create", "repository.change-request.create"]));
      expect(declaration.permissions.some((permission) => permission.access === "read" && permission.required)).toBe(true);
      expect(declaration.permissions.some((permission) => permission.access === "write" && permission.required)).toBe(true);
    }
    expect(repositoryProviderDeclarations().find((item) => item.id === "github")?.capabilities).toContain("repository.ref.update");
    expect(repositoryProviderDeclarations().filter((item) => item.id !== "github").every((item) => !item.capabilities.includes("repository.ref.update"))).toBe(true);
    expect(result.entries).toEqual([{ path: "src", type: "directory", contentHash: "abc", downloadUrl: undefined, size: undefined }]);
    expect(requests[0]).toMatchObject({ authorization: "Bearer runtime-secret" });
    expect(JSON.stringify(provider)).not.toContain("runtime-secret");
  });

  it("uses provider-correct branch operations and rejects unsupported updates before transport", async () => {
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    const transport = async (request: { method: string; url: string; body?: string }) => {
      requests.push(request);
      return { status: 201, body: {} };
    };
    const { BitbucketRepositoryProvider, GitHubRepositoryProvider, GitLabRepositoryProvider } = await import("@/server/repository-providers");
    const options = { getAccessToken: async () => "runtime-secret", transport };
    const github = new GitHubRepositoryProvider(options);
    const gitlab = new GitLabRepositoryProvider(options);
    const bitbucket = new BitbucketRepositoryProvider(options);
    const locator = { owner: "studio", repository: "design", branch: "feature/icons", revision: "abc123" };

    await expect(github.writeReference({ ...locator, operation: "create" }, { projectId: "demo" })).resolves.toMatchObject({ operation: "created" });
    await expect(github.writeReference({ ...locator, operation: "update", force: true }, { projectId: "demo" })).resolves.toMatchObject({ operation: "updated" });
    await expect(gitlab.writeReference({ ...locator, operation: "create" }, { projectId: "demo" })).resolves.toMatchObject({ operation: "created" });
    await expect(bitbucket.writeReference({ ...locator, operation: "create" }, { projectId: "demo" })).resolves.toMatchObject({ operation: "created" });
    const beforeUnsupported = requests.length;
    await expect(gitlab.writeReference({ ...locator, operation: "update" }, { projectId: "demo" })).rejects.toThrow("does not support updating");
    await expect(bitbucket.writeReference({ ...locator, operation: "create", force: true }, { projectId: "demo" })).rejects.toThrow("Force is only valid");
    expect(requests).toHaveLength(beforeUnsupported);
    expect(requests.map((request) => request.method)).toEqual(["POST", "PATCH", "POST", "POST"]);
    expect(requests[0].body).toContain('"ref":"refs/heads/feature/icons"');
    expect(requests[1].body).toContain('"force":true');
    expect(requests[2].url).toContain("/repository/branches");
    expect(requests[3].url).toContain("/refs/branches");
    expect(requests[3].body).not.toContain("force");
  });
});

describe("reproducible handoff bundles", () => {
  it("contains intent, sources, BrandSystem, Code Reality Map, screenshots, tests and instructions", async () => {
    const brandSystem = await import("@/server/brand-system");
    const draft = await brandSystem.createBrandSystemDraft("handoff");
    const projectRoot = path.join(workspace, "projects", "handoff");
    await mkdir(path.join(projectRoot, "handoff-input"), { recursive: true });
    await Promise.all([
      writeFile(path.join(projectRoot, "handoff-input", "artifact.tsx"), "export const Artifact = () => null;\n"),
      writeFile(path.join(projectRoot, "handoff-input", "code-map.json"), '{"schema":"code-reality-map/v1"}\n'),
      writeFile(path.join(projectRoot, "handoff-input", "desktop.png"), Buffer.from([137, 80, 78, 71])),
      writeFile(path.join(projectRoot, "handoff-input", "artifact.test.ts"), "it('renders', () => {});\n")
    ]);
    const input = {
      designIntent: "# Intent\nKeep the implementation precise.", implementationInstructions: "# Implement\nRun the included test.", brandSystemVersionId: draft.snapshot.id,
      files: [
        { path: "handoff-input/artifact.tsx", role: "artifact-source" as const },
        { path: "handoff-input/code-map.json", role: "code-reality-map" as const },
        { path: "handoff-input/desktop.png", role: "screenshot" as const },
        { path: "handoff-input/artifact.test.ts", role: "test" as const }
      ]
    };
    const { createHandoffBundle } = await import("@/server/handoff");
    const first = await createHandoffBundle("handoff", input);
    const second = await createHandoffBundle("handoff", input);
    const bytes = await readFile(path.join(projectRoot, first.path));
    const zip = await JSZip.loadAsync(bytes);

    expect(second).toMatchObject({ sha256: first.sha256, byteLength: first.byteLength, path: first.path });
    expect(Object.keys(zip.files).sort()).toEqual(["artifacts/artifact.tsx", "brand-system.json", "code-reality/code-map.json", "design-intent.md", "implementation.md", "manifest.json", "screenshots/desktop.png", "tests/artifact.test.ts"]);
    expect(first.manifest.files.map((file) => file.role)).toEqual(expect.arrayContaining(["artifact-source", "brand-system", "code-reality-map", "design-intent", "implementation-instructions", "screenshot", "test"]));
  });

  it("rejects a handoff before reading files when the cumulative source budget is exceeded", async () => {
    const brandSystem = await import("@/server/brand-system");
    const draft = await brandSystem.createBrandSystemDraft("bounded-handoff");
    const projectRoot = path.join(workspace, "projects", "bounded-handoff");
    await mkdir(path.join(projectRoot, "inputs"), { recursive: true });
    await Promise.all(["artifact", "map", "shot", "test"].map((name) => writeFile(path.join(projectRoot, "inputs", name), name)));
    const { createHandoffBundle } = await import("@/server/handoff");
    await expect(createHandoffBundle("bounded-handoff", {
      designIntent: "Intent", implementationInstructions: "Instructions", brandSystemVersionId: draft.snapshot.id,
      files: [
        { path: "inputs/artifact", role: "artifact-source" },
        { path: "inputs/map", role: "code-reality-map" },
        { path: "inputs/shot", role: "screenshot" },
        { path: "inputs/test", role: "test" }
      ]
    }, { maxSourceBytes: 1 })).rejects.toThrow("cumulative source limit");
  });
});

describe("supervised background jobs", () => {
  it("persists work, retries recoverable failures and emits a terminal desktop notification", async () => {
    let time = new Date("2026-01-01T00:00:00.000Z"); let executions = 0; let executionKey = "";
    const notifications: unknown[] = [];
    const { BackgroundQueue } = await import("@/server/background-queue");
    const queue = new BackgroundQueue("jobs", { clock: () => time, retryDelayMs: () => 1_000, notificationSink: { notify: (event) => { notifications.push(event); } } });
    queue.register<{ artifactId: string }, { rendered: string }>("rendering", async (payload, context) => {
      executions += 1; executionKey = context.idempotencyKey; await context.report(50, "rendering preview");
      if (executions === 1) throw new Error("temporary renderer failure");
      return { rendered: payload.artifactId };
    });
    const enqueued = await queue.enqueue({ kind: "rendering", label: "Preview", payload: { artifactId: "hero" }, idempotencyKey: "render:hero:v1", maxAttempts: 2 });
    expect(await queue.enqueue({ kind: "rendering", label: "Duplicate Preview", payload: { artifactId: "hero" }, idempotencyKey: "render:hero:v1", maxAttempts: 2 })).toMatchObject({ id: enqueued.id });
    expect((await queue.runNext())?.status).toBe("retry-wait");
    time = new Date("2026-01-01T00:00:02.000Z");
    expect(await queue.runNext()).toMatchObject({ id: enqueued.id, status: "succeeded", progress: 100, result: { rendered: "hero" } });
    expect((await queue.get(enqueued.id)).attempts).toHaveLength(2);
    expect(executionKey).toBe("render:hero:v1");
    expect(notifications).toEqual([expect.objectContaining({ status: "succeeded", kind: "rendering" })]);

    const cancelled = await queue.enqueue({ kind: "codex", label: "Codex edit", payload: { artifactId: "hero" } });
    expect(await queue.cancel(cancelled.id)).toMatchObject({ status: "cancelled" });
  });

  it("rejects credentials in durable payloads", async () => {
    const { BackgroundQueue } = await import("@/server/background-queue");
    const queue = new BackgroundQueue("secret-job");
    await expect(queue.enqueue({ kind: "export", label: "Unsafe", payload: { access_token: "never-store-this" } })).rejects.toThrow("Credentials must be resolved");
  });

  it("rejects lossy JSON and reuses idempotency keys only for identical work", async () => {
    const { BackgroundQueue } = await import("@/server/background-queue");
    const queue = new BackgroundQueue("portable-job");
    await expect(queue.enqueue({ kind: "export", label: "Date", payload: { at: new Date() } })).rejects.toThrow("plain objects");
    await expect(queue.enqueue({ kind: "export", label: "Undefined", payload: { value: undefined } })).rejects.toThrow("not JSON");
    await expect(queue.enqueue({ kind: "export", label: "NaN", payload: { value: Number.NaN } })).rejects.toThrow("finite numbers");
    await queue.enqueue({ kind: "export", label: "First", payload: { artifact: "hero" }, idempotencyKey: "export:hero" });
    await expect(queue.enqueue({ kind: "export", label: "Changed", payload: { artifact: "footer" }, idempotencyKey: "export:hero" })).rejects.toThrow("cannot be reused");
  });

  it("preserves cancellation and max-attempt policy while recovering interrupted work", async () => {
    const notifications: Array<{ status: string }> = [];
    const { BackgroundQueue } = await import("@/server/background-queue");
    const queue = new BackgroundQueue("recovery", { notificationSink: { notify: (event) => { notifications.push(event); } } });
    const cancelled = await queue.enqueue({ kind: "codex", label: "Cancelled", payload: {}, maxAttempts: 2 });
    const exhausted = await queue.enqueue({ kind: "export", label: "Exhausted", payload: {}, maxAttempts: 1 });
    const retryable = await queue.enqueue({ kind: "rendering", label: "Retryable", payload: {}, maxAttempts: 2 });
    const queueFile = path.join(workspace, "projects", "recovery", "jobs", "queue.json");
    const state = JSON.parse(await readFile(queueFile, "utf8")) as { jobs: Array<Record<string, unknown>> };
    for (const job of state.jobs) {
      job.status = "running"; job.startedAt = "2026-01-01T00:00:00.000Z";
      job.attempts = [{ number: 1, startedAt: "2026-01-01T00:00:00.000Z", status: "running" }];
      if (job.id === cancelled.id) job.cancellationRequestedAt = "2026-01-01T00:00:01.000Z";
    }
    await writeFile(queueFile, `${JSON.stringify(state, null, 2)}\n`);

    expect(await queue.recoverInterrupted()).toBe(3);
    expect(await queue.get(cancelled.id)).toMatchObject({ status: "cancelled", attempts: [{ status: "cancelled" }] });
    expect(await queue.get(exhausted.id)).toMatchObject({ status: "failed", attempts: [{ status: "failed" }] });
    expect(await queue.get(retryable.id)).toMatchObject({ status: "queued", attempts: [{ status: "failed" }] });
    expect(notifications.map((event) => event.status).sort()).toEqual(["cancelled", "failed"]);
  });
});

describe("project-local systems, skills and controlled templates", () => {
  it("supports multiple named systems and requires explicit skill and template approvals", async () => {
    const brandSystem = await import("@/server/brand-system");
    const first = await brandSystem.createBrandSystemDraft("local-ecosystem");
    const ecosystem = await import("@/server/project-ecosystem");
    await ecosystem.addNamedDesignSystem("local-ecosystem", { id: "marketing", name: "Marketing", brandSystemVersionId: first.snapshot.id, makeDefault: true });
    await ecosystem.addNamedDesignSystem("local-ecosystem", { id: "product", name: "Product", brandSystemVersionId: first.snapshot.id });
    const skill = await ecosystem.registerProjectSkill("local-ecosystem", {
      id: "launch-review", name: "Launch review", version: "1.0.0", description: "Checks launch artifacts.", instructions: "Inspect the artifact and report issues.",
      capabilities: ["read-artifacts", "propose-edits"], permissions: [
        { capability: "read-artifacts", reason: "Inspect the selected artifact." },
        { capability: "propose-edits", reason: "Return review suggestions." }
      ]
    });
    expect(skill.enabled).toBe(false);
    expect(await ecosystem.approveProjectSkill("local-ecosystem", skill.id, skill.version, { approvedBy: "owner", capabilities: ["read-artifacts"] })).toMatchObject({ enabled: true, approvedCapabilities: ["read-artifacts"] });
    await expect(ecosystem.assertControlledTemplateAction("local-ecosystem", "tpl.web.launch", "create")).rejects.toThrow("requires a project-local approval");
    await ecosystem.controlTemplate("local-ecosystem", { templateId: "tpl.web.launch", decision: "approved", allowedActions: ["create", "preview"], reason: "Reviewed local starter", decidedBy: "owner" });
    expect(await ecosystem.assertControlledTemplateAction("local-ecosystem", "tpl.web.launch", "create")).toMatchObject({ control: { decision: "approved" } });
    const registry = await ecosystem.loadProjectEcosystem("local-ecosystem");
    expect(registry).toMatchObject({ scope: "project", defaultDesignSystemId: "marketing" });
    expect(registry.designSystems).toHaveLength(2);
    await ecosystem.updateNamedDesignSystem("local-ecosystem", "product", { status: "archived", name: "Marketing" });
    await expect(ecosystem.updateNamedDesignSystem("local-ecosystem", "product", { status: "active" })).rejects.toThrow("names must be unique");
    expect(() => ecosystem.assertProjectScope("organization")).toThrow("Organization-wide governance");
  });
});

describe("opt-in encrypted collaboration", () => {
  it("keeps local-only defaults and separates sync, sharing, roles, audit and conflicts", async () => {
    const collaboration = await import("@/server/collaboration");
    expect(await collaboration.loadCollaborationRegistry("collaboration")).toMatchObject({ mode: "local-only", capabilities: { "encrypted-sync": false, sharing: false, roles: false, "audit-history": false, "conflict-resolution": false } });
    await expect(collaboration.enableCollaborationCapability("collaboration", "sharing", { confirmed: true, actor: "owner" })).rejects.toThrow("encrypted-sync");
    await collaboration.enableCollaborationCapability("collaboration", "encrypted-sync", { confirmed: true, actor: "owner" });
    await collaboration.enableCollaborationCapability("collaboration", "audit-history", { confirmed: true, actor: "owner" });
    await collaboration.enableCollaborationCapability("collaboration", "sharing", { confirmed: true, actor: "owner" });
    await collaboration.enableCollaborationCapability("collaboration", "roles", { confirmed: true, actor: "owner" });
    await collaboration.enableCollaborationCapability("collaboration", "conflict-resolution", { confirmed: true, actor: "owner" });
    const envelope = await collaboration.encryptSyncPayload("collaboration", { artifact: "hero", content: "encrypted" }, "a-runtime-secret-with-32-bytes");
    expect(JSON.stringify(envelope)).not.toContain("encrypted\"");
    expect(collaboration.decryptSyncPayload("collaboration", envelope, "a-runtime-secret-with-32-bytes")).toEqual({ artifact: "hero", content: "encrypted" });
    expect(() => collaboration.decryptSyncPayload("collaboration", { ...envelope, authTag: "AAAA" }, "a-runtime-secret-with-32-bytes")).toThrow("exactly 16 bytes");
    expect(() => collaboration.decryptSyncPayload("collaboration", envelope, "a-runtime-secret-with-32-bytes", { maxCiphertextBytes: 1 })).toThrow("ciphertext exceeds 1 bytes");
    await collaboration.grantCollaborationRole("collaboration", { subjectId: "designer-1", displayName: "Designer", role: "editor", grantedBy: "owner" });
    const conflict = await collaboration.recordCollaborationConflict("collaboration", { artifactId: "hero", baseHash: "base", localHash: "local", remoteHash: "remote" });
    expect(await collaboration.resolveCollaborationConflict("collaboration", conflict.id, { resolution: "merged", mergedHash: "merged", resolvedBy: "designer-1" })).toMatchObject({ status: "resolved", resolvedHash: "merged" });
    expect(await collaboration.verifyCollaborationAudit("collaboration")).toBe(true);
    expect((await collaboration.loadCollaborationRegistry("collaboration")).capabilities).toEqual({ "encrypted-sync": true, sharing: true, roles: true, "audit-history": true, "conflict-resolution": true });
    const disabledRoles = await collaboration.disableCollaborationCapability("collaboration", "roles", { actor: "owner" });
    expect(disabledRoles.members.find((member) => member.subjectId === "designer-1")?.revokedAt).toBeTruthy();
    await collaboration.enableCollaborationCapability("collaboration", "roles", { confirmed: true, actor: "owner" });
    expect((await collaboration.loadCollaborationRegistry("collaboration")).members.filter((member) => !member.revokedAt)).toHaveLength(0);
    expect((await collaboration.disableCollaborationCapability("collaboration", "encrypted-sync", { actor: "owner" })).mode).toBe("local-only");
  });
});
