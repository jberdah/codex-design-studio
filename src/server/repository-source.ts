import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  GitRepositoryState,
  RepositoryRemote,
  RepositorySnapshot,
  RepositorySource,
  RepositoryTrustGrant,
  RepositoryWorktree,
  SanitizedRepositorySource,
  TrustedRepositoryOperation
} from "@/domain/repository";

const MAX_GIT_OUTPUT = 10 * 1024 * 1024;
const DISABLED_HOOKS_PATH = path.join(os.tmpdir(), "codex-design-studio-disabled-git-hooks");

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CloneProgress {
  phase: string;
  percent: number | null;
  message: string;
}

export interface CloneRepositoryOptions {
  destination: string;
  signal?: AbortSignal;
  onProgress?: (progress: CloneProgress) => void;
}

function appendBounded(current: string, chunk: Buffer) {
  const next = current + chunk.toString("utf8");
  if (next.length > MAX_GIT_OUTPUT) throw new Error("Git produced more output than the safety limit");
  return next;
}

async function runCommand(command: string, args: string[], options: {
  cwd?: string;
  signal?: AbortSignal;
  onStderr?: (text: string) => void;
} = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason instanceof Error ? options.signal.reason : new Error("Operation cancelled"));
      return;
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        GIT_ALLOW_PROTOCOL: "https:ssh:file",
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "core.fsmonitor",
        GIT_CONFIG_VALUE_0: "false",
        GIT_CONFIG_KEY_1: "core.hooksPath",
        GIT_CONFIG_VALUE_1: DISABLED_HOOKS_PATH
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const abort = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      killTimer.unref();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      try { stdout = appendBounded(stdout, chunk); } catch (error) { child.kill(); reject(error); }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      try {
        const text = chunk.toString("utf8");
        stderr = appendBounded(stderr, chunk);
        options.onStderr?.(text);
      } catch (error) { child.kill(); reject(error); }
    });
    child.once("error", (error) => {
      settled = true;
      reject(error);
    });
    child.once("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      if (options.signal?.aborted) {
        reject(options.signal.reason instanceof Error ? options.signal.reason : new Error("Operation cancelled"));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

async function git(args: string[], cwd?: string) {
  return runCommand("git", cwd ? ["-C", cwd, ...args] : args);
}

function posixRelative(from: string, to: string) {
  return path.relative(from, to).split(path.sep).join("/");
}

function assertContained(root: string, candidate: string, label: string) {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the repository root`);
  }
}

export function sanitizeRemoteUrl(remote: string) {
  const value = remote.trim();
  try {
    const parsed = new URL(value);
    if (["http:", "https:", "ssh:", "git+ssh:", "file:"].includes(parsed.protocol)) {
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }
  } catch { /* SCP-style and local remotes are not URL objects. */ }
  const scp = value.match(/^(?:[^@/:]+@)?([^:/]+):(.+)$/);
  if (scp && !/^[A-Za-z]:[\\/]/.test(value)) {
    return `ssh://${scp[1]}/${scp[2].replace(/^\/+/, "")}`;
  }
  return value.replace(/([?&](?:access_token|auth|key|password|token)=)[^&\s]+/gi, "$1[REDACTED]");
}

export function redactCredentialText(text: string, credentialUrl?: string) {
  let redacted = text;
  if (credentialUrl) redacted = redacted.split(credentialUrl).join(sanitizeRemoteUrl(credentialUrl));
  return redacted
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:access_token|auth|key|password|token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)\S+/gi, "$1[REDACTED]");
}

function sanitizeSource(source: RepositorySource): SanitizedRepositorySource {
  return source.kind === "remote-git" ? { ...source, location: sanitizeRemoteUrl(source.location) } : { ...source };
}

function parseWorktrees(output: string): RepositoryWorktree[] {
  return output.trim().split(/\n\n+/).filter(Boolean).map((record) => {
    const values = new Map<string, string>();
    const flags = new Set<string>();
    for (const line of record.split("\n")) {
      const separator = line.indexOf(" ");
      if (separator === -1) flags.add(line);
      else values.set(line.slice(0, separator), line.slice(separator + 1));
    }
    const branch = values.get("branch");
    return {
      path: values.get("worktree") ?? "",
      commit: values.get("HEAD") ?? null,
      branch: branch ? branch.replace(/^refs\/heads\//, "") : null,
      bare: flags.has("bare"),
      detached: flags.has("detached"),
      locked: flags.has("locked") || values.has("locked"),
      prunable: flags.has("prunable") || values.has("prunable")
    };
  });
}

async function inspectRemotes(root: string): Promise<RepositoryRemote[]> {
  const names = await git(["remote"], root);
  if (names.exitCode !== 0) return [];
  return Promise.all(names.stdout.split(/\r?\n/).filter(Boolean).sort().map(async (name) => {
    const [fetch, push] = await Promise.all([
      git(["remote", "get-url", "--all", name], root),
      git(["remote", "get-url", "--push", "--all", name], root)
    ]);
    const urls = (output: CommandResult) => output.exitCode === 0
      ? [...new Set(output.stdout.split(/\r?\n/).filter(Boolean).map(sanitizeRemoteUrl))]
      : [];
    return { name, fetchUrls: urls(fetch), pushUrls: urls(push) };
  }));
}

function fingerprintSnapshot(snapshot: Omit<RepositorySnapshot, "fingerprint">) {
  return createHash("sha256").update(JSON.stringify({
    source: snapshot.source,
    repositoryRoot: snapshot.repositoryRoot,
    analysisSubdirectory: snapshot.analysisSubdirectory,
    commit: snapshot.git?.commit ?? null,
    dirty: snapshot.git?.dirty ?? null
  })).digest("hex");
}

export async function inspectRepository(source: Exclude<RepositorySource, { kind: "remote-git" }>): Promise<RepositorySnapshot> {
  const selectedRoot = await realpath(path.resolve(source.location));
  if (!(await stat(selectedRoot)).isDirectory()) throw new Error("Repository source must be a directory");
  const detected = await git(["rev-parse", "--show-toplevel"], selectedRoot);
  const isGit = detected.exitCode === 0;
  if (!isGit && source.kind === "local-git") throw new Error("Selected folder is not a Git working tree");
  const repositoryRoot = isGit ? await realpath(detected.stdout.trim()) : selectedRoot;
  if (source.subdirectory && (path.isAbsolute(source.subdirectory) || source.subdirectory.split(/[\\/]/).includes(".."))) {
    throw new Error("Analysis subdirectory must be relative and traversal-free");
  }
  const requestedAnalysisRoot = path.resolve(selectedRoot, source.subdirectory ?? ".");
  assertContained(isGit ? repositoryRoot : selectedRoot, requestedAnalysisRoot, "Analysis subdirectory");
  const analysisRoot = await realpath(requestedAnalysisRoot);
  assertContained(isGit ? repositoryRoot : selectedRoot, analysisRoot, "Analysis subdirectory");
  if (!(await stat(analysisRoot)).isDirectory()) throw new Error("Analysis source must be a directory");

  let state: GitRepositoryState | null = null;
  if (isGit) {
    const [branch, commit, statusResult, worktrees, remotes] = await Promise.all([
      git(["symbolic-ref", "--quiet", "--short", "HEAD"], repositoryRoot),
      git(["rev-parse", "--verify", "HEAD"], repositoryRoot),
      git(["status", "--porcelain=v1", "-z", "--untracked-files=normal"], repositoryRoot),
      git(["worktree", "list", "--porcelain"], repositoryRoot),
      inspectRemotes(repositoryRoot)
    ]);
    if (statusResult.exitCode !== 0) throw new Error("Unable to inspect Git working tree status");
    const statusRecords = statusResult.stdout.split("\0").filter(Boolean);
    let changedFileCount = 0;
    for (let index = 0; index < statusRecords.length; index += 1) {
      changedFileCount += 1;
      if (/[RC]/.test(statusRecords[index].slice(0, 2))) index += 1;
    }
    state = {
      branch: branch.exitCode === 0 ? branch.stdout.trim() || null : null,
      commit: commit.exitCode === 0 ? commit.stdout.trim() || null : null,
      dirty: changedFileCount > 0,
      changedFileCount,
      worktrees: worktrees.exitCode === 0 ? parseWorktrees(worktrees.stdout) : [],
      remotes
    };
  }

  const partial: Omit<RepositorySnapshot, "fingerprint"> = {
    schemaVersion: 1,
    source: sanitizeSource(source),
    repositoryRoot,
    analysisRoot,
    analysisSubdirectory: posixRelative(repositoryRoot, analysisRoot),
    git: state,
    capturedAt: new Date().toISOString()
  };
  return { ...partial, fingerprint: fingerprintSnapshot(partial) };
}

function validateRemote(remote: string) {
  if (!remote || remote.startsWith("-") || /[\0\r\n]/.test(remote) || remote.includes("::")) throw new Error("Invalid Git remote");
  try {
    const parsed = new URL(remote);
    if (["https:", "ssh:", "git+ssh:", "file:"].includes(parsed.protocol)) {
      if (parsed.password || [...parsed.searchParams.keys()].some((key) => /^(?:access_token|auth|key|password|token)$/i.test(key))) {
        throw new Error("Git remotes must not contain embedded credentials; use the system credential or SSH agent instead");
      }
      return;
    }
    throw new Error(`Unsupported Git remote protocol: ${parsed.protocol}`);
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("Unsupported") || error.message.startsWith("Git remotes"))) throw error;
    if (/^(?:[A-Za-z0-9._-]+@)?(?:\[[A-Fa-f0-9:]+\]|[A-Za-z0-9.-]+):[A-Za-z0-9._~\/-]+$/.test(remote) || !remote.includes("://")) return;
    throw new Error("Git remote must use HTTPS, SSH, or a local filesystem path");
  }
}

function progressFromLine(line: string): CloneProgress {
  const clean = line.trim();
  const match = clean.match(/^([^:]+):\s+(?:(\d+)%\s*)?/);
  return {
    phase: match?.[1]?.toLowerCase().replace(/\s+/g, "-") ?? "git",
    percent: match?.[2] ? Number(match[2]) : null,
    message: clean
  };
}

export async function cloneRepository(source: Extract<RepositorySource, { kind: "remote-git" }>, options: CloneRepositoryOptions): Promise<RepositorySnapshot> {
  validateRemote(source.location);
  const destination = path.resolve(options.destination);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await lstat(destination);
    throw new Error("Clone destination already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const args = ["clone", "--progress"];
  if (source.ref) args.push("--branch", source.ref);
  args.push("--", source.location, destination);
  let pending = "";
  const emitProgress = (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/[\r\n]/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const message = redactCredentialText(line, source.location);
      if (message.trim()) options.onProgress?.(progressFromLine(message));
    }
  };
  try {
    const result = await runCommand("git", args, { signal: options.signal, onStderr: emitProgress });
    if (pending.trim()) options.onProgress?.(progressFromLine(redactCredentialText(pending, source.location)));
    if (result.exitCode !== 0) {
      const detail = redactCredentialText(result.stderr, source.location).trim().split(/\r?\n/).at(-1);
      throw new Error(`Git clone failed${detail ? `: ${detail}` : ""}`);
    }
    const local = await inspectRepository({ kind: "local-git", location: destination, subdirectory: source.subdirectory });
    const partial: Omit<RepositorySnapshot, "fingerprint"> = { ...local, source: sanitizeSource(source) };
    return { ...partial, fingerprint: fingerprintSnapshot(partial) };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export function grantRepositoryTrust(snapshot: RepositorySnapshot, input: {
  confirmed: boolean;
  grantedBy: string;
  scopes: TrustedRepositoryOperation[];
}): RepositoryTrustGrant {
  if (!input.confirmed) throw new Error("Repository trust requires explicit user confirmation");
  if (!input.grantedBy.trim()) throw new Error("Repository trust must identify who confirmed it");
  const scopes = [...new Set(input.scopes)];
  if (scopes.length === 0) throw new Error("Repository trust requires at least one operation scope");
  return {
    schemaVersion: 1,
    repositoryFingerprint: snapshot.fingerprint,
    scopes,
    grantedAt: new Date().toISOString(),
    grantedBy: input.grantedBy.trim()
  };
}

export function assertRepositoryTrusted(snapshot: RepositorySnapshot, grant: RepositoryTrustGrant | null | undefined, operation: TrustedRepositoryOperation) {
  if (!grant) throw new Error(`Explicit repository trust is required before ${operation}`);
  if (grant.repositoryFingerprint !== snapshot.fingerprint) throw new Error("Repository changed after trust was granted; confirm trust again");
  if (!grant.scopes.includes(operation)) throw new Error(`Repository trust does not allow ${operation}`);
}
