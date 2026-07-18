export type BackgroundJobKind = "extraction" | "rendering" | "codex" | "export";
export type BackgroundJobStatus = "queued" | "running" | "retry-wait" | "succeeded" | "failed" | "cancelled";

export interface BackgroundJobError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface BackgroundJobAttempt {
  number: number;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  error?: BackgroundJobError;
}

export interface BackgroundJob<TPayload = unknown, TResult = unknown> {
  schemaVersion: 1;
  id: string;
  projectId: string;
  kind: BackgroundJobKind;
  label: string;
  status: BackgroundJobStatus;
  payload: TPayload;
  result?: TResult;
  progress: number;
  phase: string;
  priority: number;
  maxAttempts: number;
  attempts: BackgroundJobAttempt[];
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancellationRequestedAt?: string;
  error?: BackgroundJobError;
}

export interface BackgroundQueueState {
  schemaVersion: 1;
  projectId: string;
  jobs: BackgroundJob[];
  updatedAt: string;
}

export interface EnqueueBackgroundJob<TPayload = unknown> {
  kind: BackgroundJobKind;
  label: string;
  payload: TPayload;
  priority?: number;
  maxAttempts?: number;
}

export interface JobExecutionContext {
  projectId: string;
  jobId: string;
  attempt: number;
  signal: AbortSignal;
  report(progress: number, phase: string): Promise<void>;
}

export type BackgroundJobHandler<TPayload = unknown, TResult = unknown> =
  (payload: TPayload, context: JobExecutionContext) => Promise<TResult>;

export interface DesktopJobNotification {
  jobId: string;
  projectId: string;
  kind: BackgroundJobKind;
  status: Extract<BackgroundJobStatus, "succeeded" | "failed" | "cancelled">;
  title: string;
  body: string;
}

export interface DesktopNotificationSink {
  notify(notification: DesktopJobNotification): Promise<void> | void;
}

