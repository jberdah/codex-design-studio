import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const [mode = "package", ...arguments_] = process.argv.slice(2);
if (!new Set(["package", "make"]).has(mode)) throw new Error(`Unsupported desktop build mode: ${mode}`);

const architectureArgument = arguments_.find((value) => value.startsWith("--arch="));
const architecture = architectureArgument?.slice("--arch=".length) || process.env.npm_config_arch || process.arch;
if (!new Set(["x64", "arm64"]).has(architecture)) throw new Error(`Unsupported desktop architecture: ${architecture}`);

const npmEntrypoint = process.env.npm_execpath;
if (!npmEntrypoint) throw new Error("Run desktop builds through npm so npm_execpath is available.");
const forgeEntrypoint = require.resolve("@electron-forge/cli/dist/electron-forge.js");

function execute(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${signal || code}).`));
    });
  });
}

await rm(path.join(root, "out"), { recursive: true, force: true });
await rm(path.join(root, "desktop-runtime"), { recursive: true, force: true });
await execute(process.execPath, [npmEntrypoint, "run", "build"], "Next.js build");
await execute(process.execPath, [npmEntrypoint, "run", "desktop:prepare"], "desktop runtime preparation");
// macOS uses our deterministic DMG step below, so a second Forge ZIP would
// duplicate the complete runtime in CI and GitHub Releases.
const forgeMode = mode === "make" && process.platform === "darwin" ? "package" : mode;
await execute(process.execPath, [forgeEntrypoint, forgeMode, "--arch", architecture], `Electron Forge ${forgeMode}`);

if (mode === "make" && process.platform === "darwin") {
  await execute(process.execPath, [path.join(root, "desktop", "make-dmg.mjs"), `--arch=${architecture}`], "DMG creation");
}
if (mode === "make") {
  await execute(process.execPath, [path.join(root, "desktop", "write-checksums.mjs"), `--arch=${architecture}`], "checksum creation");
}
