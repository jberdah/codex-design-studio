import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "desktop-runtime");
const serverOutput = path.join(output, "studio-server");
const runtimeOutput = path.join(output, "studio-runtime");

async function copyRequired(source, destination) {
  await access(source);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await copyRequired(path.join(root, ".next", "standalone"), serverOutput);
await copyRequired(path.join(root, ".next", "static"), path.join(serverOutput, ".next", "static"));

// Next's conservative file tracing can retain the development Electron package
// in the standalone server. The desktop shell already provides Electron, while
// the embedded Next server runs with ELECTRON_RUN_AS_NODE and never imports it.
// Removing the duplicate saves hundreds of megabytes from every packaged app.
await rm(path.join(serverOutput, "node_modules", "electron"), { recursive: true, force: true });

await copyRequired(path.join(root, "skills"), path.join(runtimeOutput, "skills"));

for (const dependency of ["@openai", "playwright", "playwright-core", "pixelmatch", "pngjs"]) {
  await copyRequired(path.join(root, "node_modules", dependency), path.join(runtimeOutput, "node_modules", dependency));
}

const localBrowsers = path.join(runtimeOutput, "node_modules", "playwright-core", ".local-browsers");
await access(path.join(localBrowsers, "chromium_headless_shell-1193"));
await rm(path.join(localBrowsers, "chromium-1193"), { recursive: true, force: true });
await rm(path.join(localBrowsers, "ffmpeg-1011"), { recursive: true, force: true });

console.log(`Prepared desktop runtime at ${output}`);
