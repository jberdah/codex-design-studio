import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

if (process.platform !== "darwin") process.exit(0);

const run = promisify(execFile);
const root = process.cwd();
const architecture = process.argv.find((value) => value.startsWith("--arch="))?.slice(7) || process.arch;
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const staging = path.join(root, "out", `dmg-staging-${architecture}`);
const application = path.join(root, "out", `Codex Design Studio-darwin-${architecture}`, "Codex Design Studio.app");
const output = path.join(root, "out", "make");
const destination = path.join(output, `Codex-Design-Studio-${manifest.version}-darwin-${architecture}.dmg`);

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await mkdir(output, { recursive: true });
await cp(application, path.join(staging, "Codex Design Studio.app"), { recursive: true });
await symlink("/Applications", path.join(staging, "Applications"));
await run("hdiutil", ["create", "-volname", "Codex Design Studio", "-srcfolder", staging, "-ov", "-format", "UDZO", destination]);
await rm(staging, { recursive: true, force: true });
console.log(`Created ${destination}`);
