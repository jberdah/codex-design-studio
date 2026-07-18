import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let workspace = "";
const priorDataDir = process.env.CODEX_STUDIO_DATA_DIR;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "studio-ecosystem-api-"));
  process.env.CODEX_STUDIO_DATA_DIR = workspace;
  vi.resetModules();
});

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.CODEX_STUDIO_DATA_DIR;
  else process.env.CODEX_STUDIO_DATA_DIR = priorDataDir;
  await rm(workspace, { recursive: true, force: true });
});

function request(route: string, projectId: string, body?: unknown) {
  return new Request(`http://localhost${route}?project=${projectId}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("project ecosystem API", () => {
  it("exposes capability-honest declarations and project-local explicit controls", async () => {
    const projectId = "ecosystem-api";
    const { createBrandSystemDraft } = await import("@/server/brand-system");
    const draft = await createBrandSystemDraft(projectId);
    const route = await import("@/app/api/ecosystem/route");

    const designSystem = await route.POST(request("/api/ecosystem", projectId, {
      action: "register-design-system",
      scope: "project",
      id: "product",
      name: "Product",
      brandSystemVersionId: draft.snapshot.id,
      makeDefault: true
    }));
    expect(designSystem.status).toBe(201);
    const archived = await route.POST(request("/api/ecosystem", projectId, {
      action: "set-design-system-status",
      id: "product",
      status: "archived"
    }));
    expect(await archived.json()).toMatchObject({ designSystem: { id: "product", status: "archived" } });
    const restored = await route.POST(request("/api/ecosystem", projectId, {
      action: "set-design-system-status",
      id: "product",
      status: "active",
      makeDefault: true
    }));
    expect(await restored.json()).toMatchObject({ designSystem: { id: "product", status: "active" } });

    const template = await route.POST(request("/api/ecosystem", projectId, {
      action: "control-template",
      templateId: "tpl.web.launch",
      decision: "approved",
      allowedActions: ["create", "preview"],
      reason: "Reviewed for this project.",
      decidedBy: "owner"
    }));
    expect(await template.json()).toMatchObject({ control: { templateId: "tpl.web.launch", decision: "approved" } });

    const skill = await route.POST(request("/api/ecosystem", projectId, {
      action: "register-skill",
      id: "accessibility-review",
      name: "Accessibility review",
      version: "1.0.0",
      description: "Reviews an artifact for accessibility issues.",
      instructions: "Inspect the selected artifact and report accessibility issues.",
      capabilities: ["read-artifacts"],
      permissions: [{ capability: "read-artifacts", reason: "Read the selected artifact." }]
    }));
    expect(skill.status).toBe(201);

    const approval = await route.POST(request("/api/ecosystem", projectId, {
      action: "approve-skill",
      id: "accessibility-review",
      version: "1.0.0",
      approvedBy: "owner",
      capabilities: ["read-artifacts"]
    }));
    expect(await approval.json()).toMatchObject({ skill: { enabled: true, approvedCapabilities: ["read-artifacts"] } });

    const unconfirmed = await route.POST(request("/api/ecosystem", projectId, {
      action: "set-collaboration-capability",
      capability: "encrypted-sync",
      enabled: true,
      confirmed: false,
      actor: "owner"
    }));
    expect(unconfirmed.status).toBe(400);
    const enabled = await route.POST(request("/api/ecosystem", projectId, {
      action: "set-collaboration-capability",
      capability: "encrypted-sync",
      enabled: true,
      confirmed: true,
      actor: "owner"
    }));
    expect((await enabled.json()).collaboration.mode).toBe("encrypted-sync");

    const response = await route.GET(request("/api/ecosystem", projectId));
    const payload = await response.json();
    expect(payload.providers.map((provider: { id: string }) => provider.id)).toEqual(["github", "gitlab", "bitbucket"]);
    expect(payload.providers.every((provider: { optional: boolean; connection: { status: string; credentials: string } }) =>
      provider.optional && provider.connection.status === "not-configured" && provider.connection.credentials === "runtime-only"
    )).toBe(true);
    expect(payload.ecosystem).toMatchObject({ scope: "project", defaultDesignSystemId: "product" });
    expect(payload.collaboration.mode).toBe("encrypted-sync");
    expect(JSON.stringify(payload)).not.toMatch(/access[_-]?token|authorization|api[_-]?key|password/i);
  });

  it("rejects organization scope and unsafe actions", async () => {
    const route = await import("@/app/api/ecosystem/route");
    const organization = await route.POST(request("/api/ecosystem", "unsafe-scope", { action: "register-design-system", scope: "organization" }));
    expect(organization.status).toBe(400);
    const unknown = await route.POST(request("/api/ecosystem", "unsafe-scope", { action: "connect-provider", token: "must-not-be-accepted" }));
    expect(unknown.status).toBe(400);
  });
});

describe("handoff API", () => {
  it("creates and safely lists validated project-local handoff manifests", async () => {
    const projectId = "handoff-api";
    const { createBrandSystemDraft } = await import("@/server/brand-system");
    const draft = await createBrandSystemDraft(projectId);
    const inputRoot = path.join(workspace, "projects", projectId, "handoff-input");
    await mkdir(inputRoot, { recursive: true });
    await Promise.all([
      writeFile(path.join(inputRoot, "artifact.tsx"), "export const Artifact = () => null;\n"),
      writeFile(path.join(inputRoot, "code-map.json"), "{\"schema\":\"code-reality-map/v1\"}\n"),
      writeFile(path.join(inputRoot, "desktop.png"), Buffer.from([137, 80, 78, 71])),
      writeFile(path.join(inputRoot, "artifact.test.ts"), "it('renders', () => {});\n")
    ]);
    const route = await import("@/app/api/handoffs/route");
    const response = await route.POST(request("/api/handoffs", projectId, {
      designIntent: "# Intent\nPreserve the approved design.",
      implementationInstructions: "# Implementation\nRun the included test.",
      brandSystemVersionId: draft.snapshot.id,
      files: [
        { path: "handoff-input/artifact.tsx", role: "artifact-source" },
        { path: "handoff-input/code-map.json", role: "code-reality-map" },
        { path: "handoff-input/desktop.png", role: "screenshot" },
        { path: "handoff-input/artifact.test.ts", role: "test" }
      ]
    }));
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.handoff.path).toMatch(/^handoffs\/handoff_[a-f0-9]{24}\.zip$/);
    expect(created.handoff.path).not.toContain(workspace);

    const handoffDirectory = path.join(workspace, "projects", projectId, "handoffs");
    await writeFile(path.join(handoffDirectory, "notes.txt"), "not a handoff");
    await writeFile(path.join(handoffDirectory, "handoff_aaaaaaaaaaaaaaaaaaaaaaaa.zip"), "not a zip");
    const listed = await route.GET(request("/api/handoffs", projectId));
    const payload = await listed.json();
    expect(payload.handoffs).toHaveLength(1);
    expect(payload.handoffs[0]).toMatchObject({ bundleId: created.handoff.manifest.bundleId, projectId });
    expect(payload.rejected).toEqual(expect.arrayContaining([
      { reason: "invalid-name" },
      { bundleId: "handoff_aaaaaaaaaaaaaaaaaaaaaaaa", reason: "invalid-archive" }
    ]));
    expect(JSON.stringify(payload)).not.toContain(workspace);
  });

  it("rejects incomplete and traversal-based handoff requests", async () => {
    const route = await import("@/app/api/handoffs/route");
    const incomplete = await route.POST(request("/api/handoffs", "bad-handoff", {
      designIntent: "Intent",
      implementationInstructions: "Instructions",
      brandSystemVersionId: "missing",
      files: [{ path: "../secret", role: "artifact-source" }]
    }));
    expect(incomplete.status).toBe(400);

    const { createBrandSystemDraft } = await import("@/server/brand-system");
    const draft = await createBrandSystemDraft("bad-handoff");
    const traversal = await route.POST(request("/api/handoffs", "bad-handoff", {
      designIntent: "Intent",
      implementationInstructions: "Instructions",
      brandSystemVersionId: draft.snapshot.id,
      files: [
        { path: "../secret", role: "artifact-source" },
        { path: "missing-code-map.json", role: "code-reality-map" },
        { path: "missing.png", role: "screenshot" },
        { path: "missing.test.ts", role: "test" }
      ]
    }));
    expect(traversal.status).toBe(400);
    expect(await traversal.json()).toMatchObject({ error: expect.stringContaining("traversal-free") });
  });
});

describe("background jobs API", () => {
  it("lists, cancels and retries without exposing payloads, results or error messages", async () => {
    const projectId = "jobs-api";
    const { BackgroundQueue } = await import("@/server/background-queue");
    const queue = new BackgroundQueue(projectId);
    queue.register("codex", async () => { throw new Error("runtime-secret-must-remain-server-side"); });
    const failed = await queue.enqueue({ kind: "codex", label: "Apply design", payload: { artifactId: "private-artifact-payload" }, maxAttempts: 1 });
    await queue.runNext();
    const route = await import("@/app/api/jobs/route");

    const response = await route.GET(request("/api/jobs", projectId));
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain("private-artifact-payload");
    expect(serialized).not.toContain("runtime-secret-must-remain-server-side");
    expect(serialized).not.toContain('"payload"');
    expect(serialized).not.toContain('"result"');

    const retry = await route.POST(request("/api/jobs", projectId, { action: "retry", jobId: failed.id }));
    expect(await retry.json()).toMatchObject({ job: { id: failed.id, status: "queued" } });
    const cancel = await route.POST(request("/api/jobs", projectId, { action: "cancel", jobId: failed.id }));
    expect(await cancel.json()).toMatchObject({ job: { id: failed.id, status: "cancelled" } });
  });

  it("does not expose enqueue without a registered server handler", async () => {
    const route = await import("@/app/api/jobs/route");
    const response = await route.POST(request("/api/jobs", "jobs-no-enqueue", { action: "enqueue", jobId: "job_new", payload: { task: "unsafe" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Only cancel and retry") });
  });
});
