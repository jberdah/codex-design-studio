import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = process.cwd();
const platform = process.platform;
const architecture = process.arch;
const packageRoot = path.join(root, "out", `Codex Design Studio-${platform}-${architecture}`);
const appRoot = platform === "darwin" ? path.join(packageRoot, "Codex Design Studio.app") : packageRoot;
const executable = platform === "darwin"
  ? path.join(appRoot, "Contents", "MacOS", "codex-design-studio")
  : platform === "win32"
    ? path.join(appRoot, "codex-design-studio.exe")
    : path.join(appRoot, "codex-design-studio");
const resources = platform === "darwin" ? path.join(appRoot, "Contents", "Resources") : path.join(appRoot, "resources");
const runtime = path.join(resources, "studio-runtime");
const server = path.join(resources, "studio-server", "server.js");
const codex = path.join(runtime, "node_modules", "@openai", "codex", "bin", "codex.js");
const browsers = path.join(runtime, "node_modules", "playwright-core", ".local-browsers");

for (const required of [executable, server, codex, browsers]) {
  if (!existsSync(required)) throw new Error(`Missing packaged runtime entry: ${required}`);
}

async function findFile(directory, names) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, names);
      if (nested) return nested;
    } else if (names.has(entry.name)) return candidate;
  }
  return undefined;
}

const browserExecutable = await findFile(browsers, new Set(["headless_shell", "headless_shell.exe"]));
if (!browserExecutable) throw new Error(`No packaged Chromium headless executable found below ${browsers}`);

const codexResult = spawnSync(executable, [codex, "--version"], {
  cwd: runtime,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  encoding: "utf8"
});
if (codexResult.status !== 0 || !/codex/i.test(`${codexResult.stdout}${codexResult.stderr}`)) {
  throw new Error(`Packaged Codex failed: ${codexResult.stderr || codexResult.stdout}`);
}

// Exercise the exact resolution path the embedded server uses at runtime:
// the playwright module shipped inside studio-server plus the browsers
// directory that desktop/main.cjs exposes through PLAYWRIGHT_BROWSERS_PATH.
// Injecting an explicit executablePath here would hide a broken bundle.
process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
const serverNodeModules = path.join(resources, "studio-server", "node_modules");
const playwrightPath = require.resolve("playwright", { paths: [serverNodeModules] });
const playwrightModule = await import(pathToFileURL(playwrightPath).href);
const { chromium } = playwrightModule.default ?? playwrightModule;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent("<main><h1>Codex Design Studio packaged runtime</h1></main>");
if (await page.locator("h1").textContent() !== "Codex Design Studio packaged runtime") {
  throw new Error("Packaged Chromium did not render the diagnostic page.");
}
await browser.close();

console.log(JSON.stringify({ platform, architecture, executable, codex: codexResult.stdout.trim(), browserExecutable }, null, 2));
