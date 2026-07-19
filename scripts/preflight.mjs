import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const failures = [];
const warnings = [];

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  failures.push(`Node 22 LTS is required; found ${process.versions.node}. Use the version pinned in .nvmrc.`);
} else if (nodeMajor > 22) {
  warnings.push(
    `Node ${process.versions.node} is newer than the supported range (>=22 <23, see .nvmrc). ` +
      "The studio should still run, but the verified baseline uses Node 22 LTS.",
  );
}

const codex = path.join(process.cwd(), "node_modules", "@openai", "codex", "bin", "codex.js");
let codexAvailable = true;
try {
  accessSync(codex, constants.R_OK);
} catch {
  codexAvailable = false;
  failures.push("The project-local Codex CLI is missing. Run npm install.");
}

let login = "not checked";
if (codexAvailable) {
  const result = spawnSync(process.execPath, [codex, "login", "status"], { encoding: "utf8" });
  login = `${result.stdout}${result.stderr}`.trim() || `exit ${result.status}`;
  if (result.status !== 0) {
    warnings.push(
      "Codex authentication is not connected. Live agent editing needs `npx codex login`, " +
        "but the deterministic demo path works without it (NEXT_PUBLIC_CODEX_STUDIO_MODE=fallback).",
    );
  }
}

console.log(`Node: ${process.versions.node}`);
console.log(`Codex: ${codex}`);
console.log(`Authentication: ${login}`);

warnings.forEach((warning) => console.warn(`WARNING: ${warning}`));
if (failures.length) {
  failures.forEach((failure) => console.error(`ERROR: ${failure}`));
  process.exit(1);
}
console.log(warnings.length ? "Preflight passed with warnings." : "Preflight passed.");
