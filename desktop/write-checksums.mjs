import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const architecture = process.argv.find((value) => value.startsWith("--arch="))?.slice(7) || process.arch;
const makeRoot = path.join(root, "out", "make");
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

const files = (await filesBelow(makeRoot)).sort();
const lines = [];
for (const file of files) lines.push(`${await digest(file)}  ${path.relative(makeRoot, file).split(path.sep).join("/")}`);
const destination = path.join(makeRoot, `SHA256SUMS-${platform}-${architecture}.txt`);
await writeFile(destination, `${lines.join("\n")}\n`);
console.log(`Created ${destination}`);
