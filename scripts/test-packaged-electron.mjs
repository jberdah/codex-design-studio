import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const platform = process.platform;
const architecture = process.arch;
const packageRoot = path.join(root, "out", `Codex Design Studio-${platform}-${architecture}`);
const executable = platform === "darwin"
  ? path.join(packageRoot, "Codex Design Studio.app", "Contents", "MacOS", "codex-design-studio")
  : platform === "win32"
    ? path.join(packageRoot, "codex-design-studio.exe")
    : path.join(packageRoot, "codex-design-studio");

if (!existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);
const playwright = require.resolve("@playwright/test/cli");
const env = { ...process.env, CODEX_STUDIO_PACKAGED_APP: executable };

const child = spawn(process.execPath, [playwright, "test", "--config", "playwright.electron.config.ts"], {
  cwd: root,
  env,
  stdio: "inherit"
});
child.once("error", (error) => { throw error; });
child.once("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
