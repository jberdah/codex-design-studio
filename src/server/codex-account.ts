import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { bundleRoot, codexEntrypoint } from "./paths";

type Account = { type: "apiKey" } | { type: "chatgpt"; email: string | null; planType: string } | { type: "amazonBedrock"; credentialSource: unknown };
type AccountResponse = { account: Account | null; requiresOpenaiAuth: boolean };
type LoginResponse = { type: "apiKey" } | { type: "chatgpt"; loginId: string; authUrl: string } | { type: "chatgptDeviceCode"; loginId: string; verificationUrl: string; userCode: string };
type RpcMessage = { id?: number; result?: unknown; error?: { message?: string } };

class CodexAccountService {
  private child?: ChildProcessWithoutNullStreams;
  private initialized?: Promise<void>;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private start() {
    this.child = spawn(process.execPath, [codexEntrypoint, "app-server", "--stdio"], { cwd: bundleRoot, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        const message = JSON.parse(line) as RpcMessage;
        if (message.id === undefined) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error.message ?? "Codex account error")) : pending.resolve(message.result);
      } catch { /* App Server uses JSONL; ignore diagnostics. */ }
    });
    this.child.stderr.on("data", () => undefined);
    const stop = (error?: Error) => {
      this.pending.forEach(({ reject }) => reject(error ?? new Error("Codex account service stopped")));
      this.pending.clear(); this.child = undefined; this.initialized = undefined;
    };
    this.child.on("error", stop);
    this.child.on("close", () => stop());
  }

  private request(method: string, params: unknown = {}, timeoutMs = 120_000) {
    if (!this.child) this.start();
    const id = ++this.requestId;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
      this.child!.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  private async initialize() {
    if (!this.initialized) {
      this.initialized = (async () => {
        await this.request("initialize", { clientInfo: { name: "codex-design-studio", title: "Codex Design Studio", version: "0.2.0" }, capabilities: { experimentalApi: true } });
        this.child!.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
      })();
    }
    return this.initialized;
  }

  async account() {
    await this.initialize();
    return this.request("account/read", { refreshToken: false }) as Promise<AccountResponse>;
  }

  async loginWithChatGPT() {
    await this.initialize();
    return this.request("account/login/start", { type: "chatgpt", codexStreamlinedLogin: true, useHostedLoginSuccessPage: true, appBrand: "codex" }) as Promise<LoginResponse>;
  }

  async loginWithApiKey(apiKey: string) {
    await this.initialize();
    return this.request("account/login/start", { type: "apiKey", apiKey }) as Promise<LoginResponse>;
  }

  async logout() {
    await this.initialize();
    await this.request("account/logout");
  }
}

declare global { var __codexDesignStudioAccount: CodexAccountService | undefined; }

export const codexAccount = globalThis.__codexDesignStudioAccount ?? new CodexAccountService();
if (process.env.NODE_ENV !== "production") globalThis.__codexDesignStudioAccount = codexAccount;
