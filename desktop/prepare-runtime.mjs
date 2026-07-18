import { access, cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import runtimePolicy from "./runtime-policy.json" with { type: "json" };

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

const standalone = path.join(root, ".next", "standalone");
const standaloneEntries = new Set(await readdir(standalone));

for (const entry of runtimePolicy.requiredServerEntries) {
  if (!standaloneEntries.has(entry)) {
    throw new Error(`Next standalone output is missing required entry: ${entry}`);
  }
}

// Next can conservatively trace the entire repository when server modules use
// dynamic filesystem paths. Copy only the runtime contract instead of shipping
// source files, Git metadata, Brainclaw memory, local materials, or test output.
await mkdir(serverOutput, { recursive: true });
for (const entry of runtimePolicy.serverEntries) {
  if (standaloneEntries.has(entry)) {
    await copyRequired(path.join(standalone, entry), path.join(serverOutput, entry));
  }
}

await copyRequired(path.join(root, ".next", "static"), path.join(serverOutput, ".next", "static"));

const unexpectedServerEntries = (await readdir(serverOutput)).filter(
  (entry) => !runtimePolicy.serverEntries.includes(entry)
);
if (unexpectedServerEntries.length > 0) {
  throw new Error(`Unexpected desktop server runtime entries: ${unexpectedServerEntries.join(", ")}`);
}

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
