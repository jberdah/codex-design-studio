import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SelectionContext } from "@/domain/types";
import type { WebVisualCheckReport } from "@/domain/quality";
import type { assessWebMutation } from "./quality";
import { safeProjectPath } from "./paths";
import { activateCustomLanding, loadLandingHtml, loadProject } from "./store";

export type WebMutationAssessment = ReturnType<typeof assessWebMutation>;
export type WebRefinementCandidateStatus = "pending" | "accepted" | "rejected";

export interface WebRefinementCandidate {
  schemaVersion: 1;
  id: string;
  projectId: string;
  status: WebRefinementCandidateStatus;
  instruction: string;
  selection?: SelectionContext;
  summary: string;
  threadId?: string;
  baseProjectVersion: number;
  baseSourceHash: string;
  candidateSourceHash: string;
  assessment: WebMutationAssessment;
  evidenceFiles: string[];
  createdAt: string;
  resolvedAt?: string;
}

const digest = (content: string) => createHash("sha256").update(content).digest("hex");
const candidateQueues = new Map<string, Promise<void>>();

async function serializeCandidate<T>(projectId: string, candidateId: string, operation: () => Promise<T>) {
  const key = `${projectId}:${candidateId}`;
  const previous = candidateQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  candidateQueues.set(key, queued);
  await previous;
  try { return await operation(); }
  finally { release(); if (candidateQueues.get(key) === queued) candidateQueues.delete(key); }
}

function assertCandidateId(id: string) {
  if (!/^wrc_[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid Web refinement candidate id.");
}

async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function candidateDirectory(projectId: string, candidateId: string) {
  assertCandidateId(candidateId);
  return safeProjectPath(projectId, "reviews", "candidates", candidateId);
}

export async function createWebRefinementCandidate(projectId: string, input: {
  instruction: string;
  selection?: SelectionContext;
  summary: string;
  threadId?: string;
  baseProjectVersion: number;
  beforeHtml: string;
  candidateHtml: string;
  assessment: WebMutationAssessment;
  visual: WebVisualCheckReport;
  clock?: () => Date;
}) {
  if (!input.assessment.sourceChanged) throw new Error("An unchanged Web artifact cannot become a candidate.");
  const id = `wrc_${randomUUID()}`;
  const directory = await candidateDirectory(projectId, id);
  await mkdir(directory, { recursive: true });
  const evidenceFiles = ["before.html", "candidate.html", "report.json"];
  await Promise.all([
    writeFile(path.join(directory, "before.html"), input.beforeHtml, { encoding: "utf8", flag: "wx" }),
    writeFile(path.join(directory, "candidate.html"), input.candidateHtml, { encoding: "utf8", flag: "wx" }),
    atomicJson(path.join(directory, "report.json"), input.visual)
  ]);
  for (const viewport of Object.keys(input.visual.renders)) {
    for (const phase of ["before", "after", "diff"] as const) {
      const fileName = `${phase}-${viewport}.png`;
      try {
        await copyFile(await safeProjectPath(projectId, "reviews", "visual", fileName), path.join(directory, fileName));
        evidenceFiles.push(fileName);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  const candidate: WebRefinementCandidate = {
    schemaVersion: 1,
    id,
    projectId,
    status: "pending",
    instruction: input.instruction,
    selection: input.selection ? structuredClone(input.selection) : undefined,
    summary: input.summary,
    threadId: input.threadId,
    baseProjectVersion: input.baseProjectVersion,
    baseSourceHash: digest(input.beforeHtml),
    candidateSourceHash: digest(input.candidateHtml),
    assessment: structuredClone(input.assessment),
    evidenceFiles,
    createdAt: (input.clock?.() ?? new Date()).toISOString()
  };
  await atomicJson(path.join(directory, "candidate.json"), candidate);
  return candidate;
}

export async function loadWebRefinementCandidate(projectId: string, candidateId: string) {
  const directory = await candidateDirectory(projectId, candidateId);
  const candidate = JSON.parse(await readFile(path.join(directory, "candidate.json"), "utf8")) as WebRefinementCandidate;
  if (candidate.projectId !== projectId || candidate.id !== candidateId || candidate.schemaVersion !== 1) throw new Error("Web refinement candidate metadata is invalid.");
  return { candidate, directory };
}

async function resolveCandidate(projectId: string, candidateId: string, status: Exclude<WebRefinementCandidateStatus, "pending">) {
  const loaded = await loadWebRefinementCandidate(projectId, candidateId);
  if (loaded.candidate.status !== "pending") throw new Error(`This Web refinement candidate was already ${loaded.candidate.status}.`);
  loaded.candidate.status = status;
  loaded.candidate.resolvedAt = new Date().toISOString();
  await atomicJson(path.join(loaded.directory, "candidate.json"), loaded.candidate);
  return loaded.candidate;
}

export async function acceptWebRefinementCandidate(projectId: string, candidateId: string) {
  return serializeCandidate(projectId, candidateId, async () => {
    const loaded = await loadWebRefinementCandidate(projectId, candidateId);
    if (loaded.candidate.status !== "pending") throw new Error(`This Web refinement candidate was already ${loaded.candidate.status}.`);
    const html = await readFile(path.join(loaded.directory, "candidate.html"), "utf8");
    if (digest(html) !== loaded.candidate.candidateSourceHash) throw new Error("The stored Web refinement candidate failed its integrity check.");
    const project = await activateCustomLanding(projectId, {
      expectedProjectVersion: loaded.candidate.baseProjectVersion,
      expectedSourceHash: loaded.candidate.baseSourceHash,
      html,
      summary: `${loaded.candidate.summary} Accepted by the user with QA warnings.`,
      threadId: loaded.candidate.threadId
    });
    const candidate = await resolveCandidate(projectId, candidateId, "accepted");
    return { candidate, project, landingHtml: html };
  });
}

export async function rejectWebRefinementCandidate(projectId: string, candidateId: string) {
  return serializeCandidate(projectId, candidateId, async () => {
    const candidate = await resolveCandidate(projectId, candidateId, "rejected");
    return { candidate, project: await loadProject(projectId), landingHtml: await loadLandingHtml(projectId) };
  });
}
