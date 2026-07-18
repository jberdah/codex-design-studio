import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const failures = [];
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 22) failures.push(`Node 22 is required; found ${process.versions.node}.`);

const codex = path.join(process.cwd(), "node_modules", ".bin", "codex");
try {
  accessSync(codex, constants.X_OK);
} catch {
  failures.push("The project-local Codex CLI is missing. Run npm install.");
}

let login = "not checked";
if (!failures.some((failure) => failure.includes("Codex CLI"))) {
  const result = spawnSync(codex, ["login", "status"], { encoding: "utf8" });
  login = `${result.stdout}${result.stderr}`.trim() || `exit ${result.status}`;
  if (result.status !== 0) failures.push("Codex authentication is unavailable. Run npx codex login.");
}

console.log(`Node: ${process.versions.node}`);
console.log(`Codex: ${codex}`);
console.log(`Authentication: ${login}`);

if (failures.length) {
  failures.forEach((failure) => console.error(`ERROR: ${failure}`));
  process.exit(1);
}
console.log("Preflight passed.");
