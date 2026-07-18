import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  BackgroundJob,
  BackgroundJobError,
  BackgroundJobHandler,
  BackgroundJobKind,
  BackgroundQueueState,
  DesktopJobNotification,
  DesktopNotificationSink,
  EnqueueBackgroundJob,
  JobExecutionContext
} from "@/domain/background-jobs";
import { safeProjectPath } from "./paths";
import { ensureProject } from "./store";

const mutations = new Map<string, Promise<void>>();
const MAX_PAYLOAD_BYTES = 1_000_000;

export interface BackgroundQueueOptions {
  clock?: () => Date;
  notificationSink?: DesktopNotificationSink;
  retryDelayMs?: (attempt: number) => number;
}

export interface BackgroundQueueSupervisor {
  stop(): Promise<void>;
  readonly running: boolean;
}

function timestamp(clock: () => Date) { return clock().toISOString(); }

function empty(projectId: string): BackgroundQueueState {
  return { schemaVersion: 1, projectId, jobs: [], updatedAt: new Date(0).toISOString() };
}

async function storage(projectId: string) {
  await ensureProject(projectId);
  const root = await safeProjectPath(projectId, "jobs");
  await mkdir(root, { recursive: true });
  return path.join(root, "queue.json");
}

async function load(projectId: string): Promise<BackgroundQueueState> {
  try { return JSON.parse(await readFile(await storage(projectId), "utf8")) as BackgroundQueueState; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return empty(projectId);
  }
}

async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function mutate<T>(projectId: string, operation: (state: BackgroundQueueState) => T | Promise<T>) {
  const prior = mutations.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const active = new Promise<void>((resolve) => { release = resolve; });
  const queued = prior.then(() => active); mutations.set(projectId, queued); await prior;
  try {
    const state = await load(projectId);
    const result = await operation(state);
    await atomicJson(await storage(projectId), state);
    return result;
  } finally {
    release();
    if (mutations.get(projectId) === queued) mutations.delete(projectId);
  }
}

function validatePortablePayload(payload: unknown) {
  let serialized: string;
  try { serialized = JSON.stringify(payload); } catch { throw new Error("Background job payloads must be portable JSON values."); }
  if (serialized === undefined) throw new Error("Background job payloads must be portable JSON values.");
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) throw new Error("Background job payload exceeds 1 MB.");
  if (/(access[_-]?token|authorization|api[_-]?key|password)\s*[":=]/i.test(serialized)) throw new Error("Credentials must be resolved at execution time, not stored in job payloads.");
}

function errorFrom(value: unknown): BackgroundJobError {
  if (value && typeof value === "object" && "retryable" in value && "message" in value) {
    const error = value as { retryable: unknown; message: unknown; code?: unknown };
    return { code: typeof error.code === "string" ? error.code : "job_failed", message: String(error.message).slice(0, 2_000), retryable: error.retryable === true };
  }
  const cancelled = value instanceof DOMException && value.name === "AbortError";
  return { code: cancelled ? "cancelled" : "job_failed", message: value instanceof Error ? value.message.slice(0, 2_000) : "Background job failed.", retryable: !cancelled };
}

export class BackgroundQueue {
  private readonly handlers = new Map<BackgroundJobKind, BackgroundJobHandler>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly clock: () => Date;
  private readonly notificationSink?: DesktopNotificationSink;
  private readonly retryDelayMs: (attempt: number) => number;
  private supervisor?: { running: boolean; promise: Promise<void> };

  constructor(readonly projectId: string, options: BackgroundQueueOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.notificationSink = options.notificationSink;
    this.retryDelayMs = options.retryDelayMs ?? ((attempt) => Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)));
  }

  register<TPayload, TResult>(kind: BackgroundJobKind, handler: BackgroundJobHandler<TPayload, TResult>) {
    if (this.handlers.has(kind)) throw new Error(`A ${kind} background handler is already registered.`);
    this.handlers.set(kind, handler as BackgroundJobHandler);
    return this;
  }

  async list(): Promise<BackgroundJob[]> { return structuredClone((await load(this.projectId)).jobs); }

  async get(jobId: string) {
    const job = (await load(this.projectId)).jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error("Background job not found.");
    return structuredClone(job);
  }

  async enqueue<TPayload>(input: EnqueueBackgroundJob<TPayload>): Promise<BackgroundJob<TPayload>> {
    validatePortablePayload(input.payload);
    if (!input.label.trim() || input.label.length > 300) throw new Error("Background job labels must be between 1 and 300 characters.");
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("Background jobs support between 1 and 10 attempts.");
    const priority = input.priority ?? 0;
    if (!Number.isInteger(priority) || priority < -100 || priority > 100) throw new Error("Background job priority must be an integer from -100 to 100.");
    const at = timestamp(this.clock);
    const job: BackgroundJob<TPayload> = {
      schemaVersion: 1, id: `job_${randomUUID()}`, projectId: this.projectId, kind: input.kind,
      label: input.label.trim(), status: "queued", payload: structuredClone(input.payload), progress: 0, phase: "queued",
      priority, maxAttempts, attempts: [], createdAt: at, updatedAt: at, availableAt: at
    };
    return mutate(this.projectId, (state) => { state.jobs.push(job as BackgroundJob); state.updatedAt = at; return structuredClone(job); });
  }

  async recoverInterrupted(): Promise<number> {
    const at = timestamp(this.clock);
    return mutate(this.projectId, (state) => {
      let count = 0;
      for (const job of state.jobs.filter((candidate) => candidate.status === "running")) {
        const attempt = job.attempts.at(-1);
        if (attempt?.status === "running") {
          attempt.status = "failed"; attempt.finishedAt = at;
          attempt.error = { code: "worker_interrupted", message: "The prior worker stopped before this attempt completed.", retryable: true };
        }
        job.status = "queued"; job.phase = "recovered after worker interruption"; job.availableAt = at; job.updatedAt = at; job.startedAt = undefined; count += 1;
      }
      if (count) state.updatedAt = at;
      return count;
    });
  }

  async cancel(jobId: string) {
    const at = timestamp(this.clock);
    const job = await mutate(this.projectId, (state) => {
      const current = state.jobs.find((candidate) => candidate.id === jobId);
      if (!current) throw new Error("Background job not found.");
      if (["succeeded", "failed", "cancelled"].includes(current.status)) return structuredClone(current);
      current.cancellationRequestedAt = at; current.updatedAt = at;
      if (current.status !== "running") { current.status = "cancelled"; current.phase = "cancelled"; current.finishedAt = at; }
      else current.phase = "cancellation requested";
      state.updatedAt = at;
      return structuredClone(current);
    });
    this.controllers.get(jobId)?.abort(new DOMException("Background job cancelled.", "AbortError"));
    if (job.status === "cancelled") await this.notify(job);
    return job;
  }

  async retry(jobId: string) {
    const at = timestamp(this.clock);
    return mutate(this.projectId, (state) => {
      const job = state.jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error("Background job not found.");
      if (!['failed', 'cancelled'].includes(job.status)) throw new Error("Only failed or cancelled jobs can be retried manually.");
      job.status = "queued"; job.phase = "queued for manual retry"; job.availableAt = at; job.updatedAt = at;
      job.finishedAt = undefined; job.cancellationRequestedAt = undefined; job.error = undefined;
      job.maxAttempts = Math.min(10, Math.max(job.maxAttempts, job.attempts.length + 1));
      state.updatedAt = at;
      return structuredClone(job);
    });
  }

  private async claimNext() {
    const at = timestamp(this.clock);
    return mutate(this.projectId, (state) => {
      const job = state.jobs.filter((candidate) => ["queued", "retry-wait"].includes(candidate.status) && candidate.availableAt <= at)
        .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0];
      if (!job) return undefined;
      if (!this.handlers.has(job.kind)) return undefined;
      const attempt = { number: job.attempts.length + 1, startedAt: at, status: "running" as const };
      job.attempts.push(attempt); job.status = "running"; job.progress = 0; job.phase = "starting";
      job.startedAt = at; job.updatedAt = at; job.error = undefined; state.updatedAt = at;
      return structuredClone(job);
    });
  }

  private async report(jobId: string, progress: number, phase: string) {
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error("Background job progress must be between 0 and 100.");
    if (!phase.trim() || phase.length > 500) throw new Error("Background job phases must be between 1 and 500 characters.");
    const at = timestamp(this.clock);
    await mutate(this.projectId, (state) => {
      const job = state.jobs.find((candidate) => candidate.id === jobId);
      if (!job || job.status !== "running") return;
      job.progress = progress; job.phase = phase.trim(); job.updatedAt = at; state.updatedAt = at;
    });
  }

  async runNext(): Promise<BackgroundJob | undefined> {
    const claimed = await this.claimNext();
    if (!claimed) return undefined;
    const handler = this.handlers.get(claimed.kind)!;
    const controller = new AbortController(); this.controllers.set(claimed.id, controller);
    const context: JobExecutionContext = { projectId: this.projectId, jobId: claimed.id, attempt: claimed.attempts.length, signal: controller.signal, report: (progress, phase) => this.report(claimed.id, progress, phase) };
    try {
      const result = await handler(structuredClone(claimed.payload), context);
      validatePortablePayload(result);
      const at = timestamp(this.clock);
      const completed = await mutate(this.projectId, (state) => {
        const job = state.jobs.find((candidate) => candidate.id === claimed.id)!;
        const attempt = job.attempts.at(-1)!; attempt.finishedAt = at;
        if (job.cancellationRequestedAt || controller.signal.aborted) {
          attempt.status = "cancelled"; job.status = "cancelled"; job.phase = "cancelled";
        } else {
          attempt.status = "succeeded"; job.status = "succeeded"; job.result = result; job.progress = 100; job.phase = "completed";
        }
        job.finishedAt = at; job.updatedAt = at; state.updatedAt = at; return structuredClone(job);
      });
      await this.notify(completed); return completed;
    } catch (value) {
      const failure = errorFrom(value); const at = timestamp(this.clock);
      const completed = await mutate(this.projectId, (state) => {
        const job = state.jobs.find((candidate) => candidate.id === claimed.id)!;
        const attempt = job.attempts.at(-1)!; attempt.finishedAt = at;
        if (job.cancellationRequestedAt || controller.signal.aborted || failure.code === "cancelled") {
          attempt.status = "cancelled"; job.status = "cancelled"; job.phase = "cancelled"; job.finishedAt = at;
        } else {
          attempt.status = "failed"; attempt.error = failure; job.error = failure;
          if (failure.retryable && job.attempts.length < job.maxAttempts) {
            job.status = "retry-wait"; job.phase = "waiting to retry";
            job.availableAt = new Date(this.clock().getTime() + this.retryDelayMs(job.attempts.length)).toISOString();
          } else { job.status = "failed"; job.phase = "failed"; job.finishedAt = at; }
        }
        job.updatedAt = at; state.updatedAt = at; return structuredClone(job);
      });
      if (["failed", "cancelled"].includes(completed.status)) await this.notify(completed);
      return completed;
    } finally { this.controllers.delete(claimed.id); }
  }

  async drain(): Promise<BackgroundJob[]> {
    const completed: BackgroundJob[] = [];
    while (true) { const job = await this.runNext(); if (!job) return completed; completed.push(job); }
  }

  start(options: { pollIntervalMs?: number } = {}): BackgroundQueueSupervisor {
    if (this.supervisor?.running) throw new Error("The background queue supervisor is already running.");
    const poll = Math.max(25, options.pollIntervalMs ?? 500);
    const state = { running: true, promise: Promise.resolve() };
    state.promise = (async () => {
      await this.recoverInterrupted();
      while (state.running) {
        const job = await this.runNext();
        if (!job) await new Promise<void>((resolve) => setTimeout(resolve, poll));
      }
    })();
    this.supervisor = state;
    return { get running() { return state.running; }, stop: async () => { state.running = false; for (const controller of this.controllers.values()) controller.abort(new DOMException("Background supervisor stopped.", "AbortError")); await state.promise; } };
  }

  private async notify(job: BackgroundJob) {
    if (!this.notificationSink || !["succeeded", "failed", "cancelled"].includes(job.status)) return;
    const notification: DesktopJobNotification = {
      jobId: job.id, projectId: job.projectId, kind: job.kind,
      status: job.status as DesktopJobNotification["status"],
      title: job.status === "succeeded" ? `${job.label} completed` : job.status === "cancelled" ? `${job.label} cancelled` : `${job.label} failed`,
      body: job.status === "failed" ? job.error?.message ?? "The background job failed." : job.phase
    };
    try { await this.notificationSink.notify(notification); } catch { /* Notifications never affect durable work state. */ }
  }
}

