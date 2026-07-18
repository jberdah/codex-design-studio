import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const file = path.resolve(args.get("--file") ?? "web/index.html");
const phase = args.get("--phase") ?? "after";
if (!(["before", "after"]).includes(phase)) throw new Error("--phase must be before or after");

await readFile(file, "utf8");
const outputDir = path.resolve(path.dirname(file), "..", "reviews", "visual");
await mkdir(outputDir, { recursive: true });

const viewports = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 }
};
const browser = await chromium.launch({ headless: true });
const report = { phase, file: path.relative(process.cwd(), file), renders: {}, generatedAt: new Date().toISOString() };

try {
  for (const [name, viewport] of Object.entries(viewports)) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.screenshot({ path: path.join(outputDir, `${phase}-${name}.png`), fullPage: false, animations: "disabled" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const entry = { viewport, horizontalOverflow: overflow };
    if (phase === "after") {
      try {
        const before = PNG.sync.read(await readFile(path.join(outputDir, `before-${name}.png`)));
        const after = PNG.sync.read(await readFile(path.join(outputDir, `after-${name}.png`)));
        if (before.width === after.width && before.height === after.height) {
          const diff = new PNG({ width: after.width, height: after.height });
          const pixels = pixelmatch(before.data, after.data, diff.data, after.width, after.height, { threshold: 0.1 });
          await writeFile(path.join(outputDir, `diff-${name}.png`), PNG.sync.write(diff));
          entry.pixelDifference = Number((pixels / (after.width * after.height)).toFixed(6));
        }
      } catch {
        entry.pixelDifference = null;
      }
    }
    report.renders[name] = entry;
    await page.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
