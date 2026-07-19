import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const root = process.cwd();
const output = path.join(root, "media", "devpost");
const raw = path.join(output, ".raw");
const port = 3300;
const baseURL = `http://127.0.0.1:${port}`;
const npmEntrypoint = process.env.npm_execpath;
if (!npmEntrypoint) throw new Error("Run this generator through npm so npm_execpath is available.");

await mkdir(raw, { recursive: true });

const server = spawn(process.execPath, [npmEntrypoint, "run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    CODEX_STUDIO_DATA_DIR: root,
    CODEX_STUDIO_PROJECT_ID: "demo",
    NEXT_PUBLIC_CODEX_STUDIO_MODE: "fallback",
    NEXT_TELEMETRY_DISABLED: "1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-8_000); });
server.stderr.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-8_000); });

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Submission media server did not start.\n${serverLog}`);
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function lines(value, maximum = 29) {
  const words = value.split(/\s+/);
  const result = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > maximum && line) {
      result.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) result.push(line);
  return result;
}

function textBlock(value, x, y, size, lineHeight, attributes = "", maximum = 29) {
  return `<text x="${x}" y="${y}" ${attributes}>${lines(value, maximum).map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

async function compose({ number, title, body, source, accent = "#7657F6", proof = "" }) {
  const width = 1800;
  const height = 1200;
  const screenshotWidth = 1180;
  const screenshotHeight = 750;
  const screenshot = await sharp(source)
    .resize(screenshotWidth, screenshotHeight, { fit: "cover", position: "top" })
    .composite([{ input: Buffer.from(`<svg width="${screenshotWidth}" height="${screenshotHeight}"><rect width="100%" height="100%" rx="28" fill="white"/></svg>`), blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(1520 130) rotate(135) scale(720)"><stop stop-color="${accent}" stop-opacity=".32"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="28" stdDeviation="32" flood-color="#17151F" flood-opacity=".17"/></filter>
    </defs>
    <rect width="1800" height="1200" fill="#F4F1EA"/>
    <rect width="1800" height="1200" fill="url(#glow)"/>
    <circle cx="118" cy="92" r="25" fill="#17151F"/><path d="M118 77l4.5 10.5L133 92l-10.5 4.5L118 107l-4.5-10.5L103 92l10.5-4.5L118 77Z" fill="white"/>
    <text x="160" y="103" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#17151F">Codex Design Studio</text>
    <text x="105" y="230" font-family="Arial, sans-serif" font-size="15" letter-spacing="4" font-weight="700" fill="${accent}">0${number} / OPENAI BUILD WEEK</text>
    ${textBlock(title, 105, 305, 44, 51, 'font-family="Georgia, serif" font-size="44" font-weight="700" fill="#17151F"', 14)}
    ${textBlock(body, 105, 565, 25, 37, 'font-family="Arial, sans-serif" font-size="25" fill="#514D57"')}
    <rect x="485" y="210" width="1250" height="820" rx="38" fill="white" filter="url(#shadow)"/>
    <rect x="508" y="233" width="1204" height="774" rx="32" fill="#E8E5EC"/>
    <rect x="105" y="980" width="310" height="2" fill="${accent}"/>
    <text x="105" y="1025" font-family="Arial, sans-serif" font-size="17" letter-spacing="2" font-weight="700" fill="#17151F">${escapeXml(proof || "REAL ARTIFACT · REAL EVIDENCE")}</text>
    <text x="105" y="1100" font-family="Arial, sans-serif" font-size="18" fill="#6B6670">GPT-5.6 reasons · Codex acts · Studio verifies · You decide</text>
  </svg>`);

  await sharp(background)
    .composite([{ input: screenshot, left: 520, top: 245 }])
    .png({ compressionLevel: 9, palette: true, quality: 92 })
    .toFile(path.join(output, `${String(number).padStart(2, "0")}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}.png`));
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1510, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route("**/api/account", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: { type: "chatgpt", email: null, planType: "ChatGPT" }, requiresOpenaiAuth: false }) });
  });
  await page.goto(`${baseURL}/?project=demo`, { waitUntil: "networkidle" });
  await page.getByText("Codex Design Studio").waitFor();
  await page.screenshot({ path: path.join(raw, "landing.png") });

  await page.getByRole("button", { name: /New project/ }).click();
  const bootstrap = page.getByRole("dialog", { name: "Create a brand workspace" });
  await bootstrap.getByLabel("Brand name").fill("Northstar Atelier");
  await bootstrap.getByLabel("Audience").fill("Independent product teams");
  await bootstrap.getByLabel("What are you trying to achieve?").fill("Turn one trusted brand direction into every launch asset.");
  await bootstrap.getByRole("button", { name: "Continue" }).click();
  await bootstrap.getByLabel("Public reference URL").fill("https://reference.example.com");
  await bootstrap.getByLabel("Use as inspiration").check();
  await page.screenshot({ path: path.join(raw, "bootstrap.png") });
  await bootstrap.getByLabel("Close").click();

  await page.getByRole("button", { name: "Design system" }).click();
  await page.screenshot({ path: path.join(raw, "system.png") });

  await page.getByRole("button", { name: "Landing page" }).click();
  await page.getByRole("button", { name: /Review/ }).click();
  await page.locator(".review-drawer").waitFor();
  await page.screenshot({ path: path.join(raw, "review.png") });
  await page.locator(".review-drawer button").click();

  const initial = await (await page.request.get(`${baseURL}/api/project?project=demo`)).json();
  await page.route(/\/api\/refine\?/, async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        source: "codex",
        changed: true,
        summary: "Created a more distinctive editorial direction.",
        filesModified: ["web/index.html"],
        project: initial.project,
        landingHtml: initial.landingHtml,
        candidateHtml: initial.landingHtml,
        candidate: {
          id: "wrc_media-demo",
          summary: "Created a more distinctive editorial direction.",
          assessment: {
            reasons: ["One conservative contrast check requires human review."],
            comparisons: {
              desktop: { before: { failures: 0, inconclusive: 1 }, after: { failures: 1, inconclusive: 0 }, regressions: ["contrast"] },
              mobile: { before: { failures: 0, inconclusive: 0 }, after: { failures: 0, inconclusive: 0 }, regressions: [] }
            }
          }
        }
      })
    });
  });
  const preview = page.frameLocator('iframe[title="Generated landing page"]');
  await preview.locator('[data-design-id="hero"]').click();
  await page.getByLabel("Refinement instruction").fill("Make the hero more distinctive and editorial.");
  await page.getByLabel("Send instruction").click();
  await page.getByRole("dialog", { name: "Codex created a proposal" }).waitFor();
  await page.screenshot({ path: path.join(raw, "candidate.png") });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Presentation" }).click();
  await page.screenshot({ path: path.join(raw, "slides.png") });

  await compose({ number: 1, title: "One brand. Every future asset.", body: "Turn scattered evidence into an executable Design System powered by GPT-5.6 and Codex.", source: path.join(raw, "landing.png"), accent: "#7657F6", proof: "LOCAL-FIRST CREATIVE WORKSPACE" });
  await compose({ number: 2, title: "From raw inputs to reviewed direction.", body: "Facts, inferences, assumptions, and source intent stay visible before a project is created.", source: path.join(raw, "bootstrap.png"), accent: "#C15C3B", proof: "EVIDENCE-AWARE BOOTSTRAP" });
  await compose({ number: 3, title: "Evidence becomes an executable system.", body: "Provenance, reconciliation, and versioned tokens keep every deliverable aligned.", source: path.join(raw, "system.png"), accent: "#587A67", proof: "VERSIONED BRAND SYSTEM" });
  await compose({ number: 4, title: "Codex edits the real artifact.", body: "Composition-level HTML, CSS, and SVG changes happen inside the project—not in a detached mockup.", source: path.join(raw, "landing.png"), accent: "#7657F6", proof: "REAL CODE · RESPONSIVE PREVIEW" });
  await compose({ number: 5, title: "Proof before promotion.", body: "Responsive rendering and deterministic checks keep every candidate reviewable. The user decides.", source: path.join(raw, "candidate.png"), accent: "#D68B32", proof: "TRANSACTIONAL VISUAL QA" });
  await compose({ number: 6, title: "One system. Several editable outputs.", body: "Responsive Web, editable slides, visual assets, and exports share the same brand truth.", source: path.join(raw, "slides.png"), accent: "#587A67", proof: "164 TESTS · 9 BROWSER JOURNEYS" });
} finally {
  await browser?.close().catch(() => undefined);
  server.kill("SIGTERM");
  await rm(raw, { recursive: true, force: true });
}

console.log(`Generated Devpost media in ${output}`);
