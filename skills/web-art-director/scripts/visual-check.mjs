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
if (!["before", "after"].includes(phase)) throw new Error("--phase must be before or after");

await readFile(file, "utf8");
const outputDir = path.resolve(path.dirname(file), "..", "reviews", "visual");
await mkdir(outputDir, { recursive: true });

const viewports = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 }
};
const browser = await chromium.launch({ headless: true });
const report = { schemaVersion: 2, phase, file: path.relative(process.cwd(), file), renders: {}, summary: { errors: 0, warnings: 0, responsiveStates: Object.keys(viewports) }, generatedAt: new Date().toISOString() };

try {
  for (const [name, viewport] of Object.entries(viewports)) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const requestFailures = [];
    page.on("requestfailed", (request) => requestFailures.push({ locator: "network", source: request.url(), reason: request.failure()?.errorText ?? "request failed" }));
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const screenshotFile = path.join(outputDir, `${phase}-${name}.png`);
    await page.screenshot({ path: screenshotFile, fullPage: false, animations: "disabled" });
    const audit = await page.evaluate(() => {
      const locator = (element) => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        for (const attribute of ["data-design-node-id", "data-design-id", "name"]) {
          const value = element.getAttribute(attribute);
          if (value) return `${element.tagName.toLowerCase()}[${attribute}="${CSS.escape(value)}"]`;
        }
        const parent = element.parentElement;
        if (!parent) return element.tagName.toLowerCase();
        return `${element.tagName.toLowerCase()}:nth-child(${[...parent.children].indexOf(element) + 1})`;
      };
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      };
      const parseColor = (value) => {
        const match = value.match(/rgba?\((\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)(?:[, /]+(\d+(?:\.\d+)?))?\)/i);
        return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) } : null;
      };
      const background = (element) => {
        let current = element;
        while (current) {
          const style = getComputedStyle(current);
          if (style.backgroundImage !== "none" || (style.mixBlendMode && style.mixBlendMode !== "normal") || (style.backdropFilter && style.backdropFilter !== "none")) {
            return { color: null, conclusive: false, reason: `visual background on ${locator(current)} requires pixel sampling` };
          }
          const color = parseColor(style.backgroundColor);
          if (color && color.a > 0.01) {
            if (color.a < 0.995) return { color, conclusive: false, reason: `translucent background on ${locator(current)} requires compositing` };
            return { color, conclusive: true };
          }
          current = current.parentElement;
        }
        return { color: { r: 255, g: 255, b: 255, a: 1 }, conclusive: true };
      };
      const luminance = ({ r, g, b }) => {
        const values = [r, g, b].map((value) => {
          const normalized = value / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
      };
      const ratio = (foreground, backgroundColor) => {
        const foregroundLuminance = luminance(foreground);
        const backgroundLuminance = luminance(backgroundColor);
        return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      };

      const elements = [...document.body.querySelectorAll("*")].filter(visible);
      const clippedElements = [];
      for (const element of elements) {
        const hasMeaningfulContent = element.matches("a,button,input,select,textarea,[role=button]") || [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        if (!hasMeaningfulContent) continue;
        const ownOverflow = getComputedStyle(element);
        if ([ownOverflow.overflowX, ownOverflow.overflowY].some((value) => value === "hidden" || value === "clip") && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)) {
          clippedElements.push({ locator: locator(element), reason: "scrollable content is suppressed by overflow clipping" });
          if (clippedElements.length >= 50) break;
          continue;
        }
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== document.body) {
          const overflow = getComputedStyle(ancestor);
          if ([overflow.overflowX, overflow.overflowY].some((value) => value === "hidden" || value === "clip")) {
            const childRect = element.getBoundingClientRect();
            const ancestorRect = ancestor.getBoundingClientRect();
            if (childRect.left < ancestorRect.left - 1 || childRect.right > ancestorRect.right + 1 || childRect.top < ancestorRect.top - 1 || childRect.bottom > ancestorRect.bottom + 1) {
              clippedElements.push({ locator: locator(element), reason: `content extends outside ${locator(ancestor)}` });
              break;
            }
          }
          ancestor = ancestor.parentElement;
        }
        if (clippedElements.length >= 50) break;
      }

      const brokenAssets = [...document.querySelectorAll("img")]
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => ({ locator: locator(image), source: image.currentSrc || image.src, reason: "image did not decode" }));

      const contrast = [];
      const textElements = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (node) => node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
      while (walker.nextNode()) if (walker.currentNode.parentElement) textElements.add(walker.currentNode.parentElement);
      for (const element of [...textElements].filter(visible)) {
        const style = getComputedStyle(element);
        const foreground = parseColor(style.color);
        const fontSize = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseInt(style.fontWeight, 10) || (style.fontWeight === "bold" ? 700 : 400);
        const required = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
        const backgroundResult = background(element);
        const conclusive = Boolean(foreground && foreground.a >= 0.995 && backgroundResult.conclusive && backgroundResult.color);
        if (!conclusive) {
          contrast.push({
            locator: locator(element), ratio: null, required, foreground: style.color,
            background: backgroundResult.color ? `rgba(${backgroundResult.color.r}, ${backgroundResult.color.g}, ${backgroundResult.color.b}, ${backgroundResult.color.a})` : "visual",
            conclusive: false,
            reason: !foreground ? "foreground color syntax is not supported" : foreground.a < 0.995 ? "translucent foreground requires compositing" : backgroundResult.reason
          });
        } else {
          const backgroundColor = backgroundResult.color;
          const measured = ratio(foreground, backgroundColor);
          if (measured + 0.005 < required) contrast.push({ locator: locator(element), ratio: Number(measured.toFixed(2)), required, foreground: style.color, background: `rgb(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b})`, conclusive: true });
        }
        if (contrast.length >= 100) break;
      }

      const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((element) => visible(element) && !element.hasAttribute("disabled"));
      const positiveTabIndexes = focusables.map((element) => ({ locator: locator(element), tabIndex: element.tabIndex })).filter((item) => item.tabIndex > 0);
      const landmarks = {
        main: document.querySelectorAll("main,[role=main]").length,
        navigation: document.querySelectorAll("nav,[role=navigation]").length,
        header: document.querySelectorAll("header,[role=banner]").length,
        footer: document.querySelectorAll("footer,[role=contentinfo]").length,
        unlabeledNavigation: [...document.querySelectorAll("nav,[role=navigation]")].filter((element) => !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby")).length,
        h1: document.querySelectorAll("h1").length
      };
      const duplicateLandmarks = [];
      if (landmarks.main > 1) duplicateLandmarks.push("main");
      if (landmarks.header > 1) duplicateLandmarks.push("banner");
      if (landmarks.footer > 1) duplicateLandmarks.push("contentinfo");
      return {
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        clippedElements,
        brokenAssets,
        contrast,
        focusOrder: { locators: focusables.map(locator), positiveTabIndexes, duplicateLandmarks },
        landmarks,
        structure: {
          headingCount: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
          interactiveCount: focusables.length,
          designNodeIds: [...document.querySelectorAll("[data-design-node-id]")].map((element) => element.getAttribute("data-design-node-id")).filter(Boolean).sort(),
          bodyScrollHeight: document.documentElement.scrollHeight
        }
      };
    });
    audit.brokenAssets.push(...requestFailures);
    const findings = [];
    const finding = (id, status, message, evidence) => findings.push({ id: `${name}:${id}`, status, message, evidence });
    finding("overflow", audit.horizontalOverflow ? "error" : "pass", audit.horizontalOverflow ? "Page content exceeds the viewport width." : "No horizontal overflow measured.", { scrollWidthChecked: true });
    finding("clipping", audit.clippedElements.length ? "error" : "pass", audit.clippedElements.length ? `${audit.clippedElements.length} meaningful element(s) are clipped.` : "No meaningful clipped content measured.", audit.clippedElements);
    finding("assets", audit.brokenAssets.length ? "error" : "pass", audit.brokenAssets.length ? `${audit.brokenAssets.length} asset request(s) failed.` : "All observed assets loaded and decoded.", audit.brokenAssets);
    const contrastErrors = audit.contrast.filter((item) => item.conclusive);
    const inconclusiveContrast = audit.contrast.filter((item) => !item.conclusive);
    finding("contrast", contrastErrors.length ? "error" : inconclusiveContrast.length ? "warning" : "pass",
      contrastErrors.length ? `${contrastErrors.length} visible text element(s) miss WCAG contrast thresholds.` : inconclusiveContrast.length ? `${inconclusiveContrast.length} text contrast measurement(s) require rendered pixel sampling.` : "Visible text meets deterministic WCAG contrast thresholds.", audit.contrast);
    const focusWarnings = audit.focusOrder.positiveTabIndexes.length + audit.focusOrder.duplicateLandmarks.length;
    finding("focus-order", focusWarnings ? "warning" : "pass", focusWarnings ? "Positive tabindex or duplicate landmarks may create an unexpected focus path." : "Focus order follows DOM order without duplicate primary landmarks.", audit.focusOrder);
    const landmarkErrors = Number(audit.landmarks.main !== 1) + Number(audit.landmarks.h1 !== 1);
    const landmarkWarnings = audit.landmarks.unlabeledNavigation;
    finding("landmarks", landmarkErrors ? "error" : landmarkWarnings ? "warning" : "pass", landmarkErrors ? "The page requires exactly one main landmark and one h1." : landmarkWarnings ? "Navigation landmarks should have accessible labels." : "Primary landmark structure is valid.", audit.landmarks);
    let pixelDifference;
    if (phase === "after") {
      try {
        const before = PNG.sync.read(await readFile(path.join(outputDir, `before-${name}.png`)));
        const after = PNG.sync.read(await readFile(screenshotFile));
        if (before.width === after.width && before.height === after.height) {
          const diff = new PNG({ width: after.width, height: after.height });
          const pixels = pixelmatch(before.data, after.data, diff.data, after.width, after.height, { threshold: 0.1 });
          await writeFile(path.join(outputDir, `diff-${name}.png`), PNG.sync.write(diff));
          pixelDifference = Number((pixels / (after.width * after.height)).toFixed(6));
        } else pixelDifference = null;
      } catch {
        pixelDifference = null;
      }
    }
    report.renders[name] = { viewport, screenshot: path.relative(process.cwd(), screenshotFile), ...audit, pixelDifference, findings };
    report.summary.errors += findings.filter((item) => item.status === "error").length;
    report.summary.warnings += findings.filter((item) => item.status === "warning").length;
    await page.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
