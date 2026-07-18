import { spawn } from "node:child_process";
import type { PlatformApiKeyProvider } from "./openai-visual";

type KeychainCommand = (args: string[]) => Promise<string>;

function securityCommand(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Operating-system keychain request failed (${code}): ${stderr.trim().replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "[REDACTED]").slice(0, 300)}`)));
  });
}

/** macOS Keychain-backed optional BYOK provider. ChatGPT auth remains the default path. */
export class MacOSOpenAIKeychain implements PlatformApiKeyProvider {
  constructor(private readonly command: KeychainCommand = securityCommand, private readonly service = "com.codexdesignstudio.openai-platform", private readonly account = "OpenAI Platform API key") {}

  async getApiKey() {
    if (process.platform !== "darwin" && this.command === securityCommand) return undefined;
    try { return (await this.command(["find-generic-password", "-s", this.service, "-a", this.account, "-w"])) || undefined; }
    catch { return undefined; }
  }

  async setApiKey(apiKey: string) {
    if (!/^sk-[A-Za-z0-9_-]{8,500}$/.test(apiKey)) throw new Error("A valid OpenAI Platform API key is required.");
    if (process.platform !== "darwin" && this.command === securityCommand) throw new Error("Operating-system keychain BYOK is unavailable on this platform.");
    await this.command(["add-generic-password", "-s", this.service, "-a", this.account, "-U", "-w", apiKey]);
  }

  async deleteApiKey() {
    if (process.platform !== "darwin" && this.command === securityCommand) return;
    await this.command(["delete-generic-password", "-s", this.service, "-a", this.account]);
  }
}
