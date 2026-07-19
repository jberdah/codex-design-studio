import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const architecture = process.argv.find((value) => value.startsWith("--arch="))?.slice(7) || process.arch;
const makeRoot = path.join(root, "out", "make");
const releaseRoot = path.join(root, "out", "release");
const platform = process.platform;

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(candidate));
    else if (!entry.name.startsWith("SHA256SUMS-")) files.push(candidate);
  }
  return files;
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });

function releaseName(file) {
  const name = path.basename(file);
  if (name === "Setup.exe") return `Codex-Design-Studio-${platform}-${architecture}-Setup.exe`;
  if (name === "RELEASES") return `RELEASES-${platform}-${architecture}`;
  return name;
}

const sourceFiles = (await filesBelow(makeRoot)).filter((file) => {
  if (platform === "darwin") return file.endsWith(".dmg");
  if (platform === "win32") return path.basename(file) === "Setup.exe";
  return true;
}).sort();
if (sourceFiles.length === 0) throw new Error(`No primary ${platform}-${architecture} release asset was produced.`);
const names = new Set();
for (const source of sourceFiles) {
  const name = releaseName(source);
  if (names.has(name)) throw new Error(`Release asset name collision: ${name}`);
  names.add(name);
  await copyFile(source, path.join(releaseRoot, name));
}

const files = (await filesBelow(releaseRoot)).sort();
const lines = [];
for (const file of files) lines.push(`${await digest(file)}  ${path.basename(file)}`);
const destination = path.join(releaseRoot, `SHA256SUMS-${platform}-${architecture}.txt`);
await writeFile(destination, `${lines.join("\n")}\n`);
console.log(`Staged ${files.length} release asset(s) and created ${destination}`);
