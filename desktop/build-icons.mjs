import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const run = promisify(execFile);
const root = process.cwd();
const assets = path.join(root, "desktop", "assets");
const source = path.join(assets, "icon.svg");
const temporary = await mkdtemp(path.join(os.tmpdir(), "codex-studio-icons-"));

async function render(size, destination) {
  await sharp(await readFile(source)).resize(size, size).png().toFile(destination);
}

try {
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoPngs = [];
  for (const size of icoSizes) {
    const destination = path.join(temporary, `icon-${size}.png`);
    await render(size, destination);
    icoPngs.push(destination);
  }
  await writeFile(path.join(assets, "icon.ico"), await pngToIco(icoPngs));

  if (process.platform === "darwin") {
    const iconset = path.join(temporary, "icon.iconset");
    await mkdir(iconset, { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
      await render(size, path.join(iconset, `icon_${size}x${size}.png`));
      await render(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
    }
    await run("iconutil", ["-c", "icns", iconset, "-o", path.join(assets, "icon.icns")]);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log(`Prepared desktop icons for ${process.platform}.`);
