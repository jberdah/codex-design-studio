import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const output = path.join(root, "media", "video");
const raw = path.join(output, ".raw");
const destination = path.join(output, "codex-design-studio-demo-draft.webm");
const port = 3301;
const baseURL = `http://127.0.0.1:${port}`;
const npmEntrypoint = process.env.npm_execpath;
if (!npmEntrypoint) throw new Error("Run this recorder through npm so npm_execpath is available.");

await rm(raw, { recursive: true, force: true });
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
  throw new Error(`Demo recorder server did not start.\n${serverLog}`);
}

const hold = (page, milliseconds = 2_000) => page.waitForTimeout(milliseconds);
let browser;
let context;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: raw, size: { width: 1920, height: 1080 } }
  });
  const page = await context.newPage();
  await page.route("**/api/account", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ account: { type: "chatgpt", email: null, planType: "ChatGPT" }, requiresOpenaiAuth: false })
    });
  });

  await page.goto(`${baseURL}/?project=demo`, { waitUntil: "networkidle" });
  await page.getByText("Codex Design Studio").waitFor();
  await hold(page, 6_000);

  await page.getByRole("button", { name: /New project/ }).click();
  const bootstrap = page.getByRole("dialog", { name: "Create a brand workspace" });
  await bootstrap.getByLabel("Brand name").fill("Northstar Atelier");
  await bootstrap.getByLabel("Audience").fill("Independent product teams");
  await bootstrap.getByLabel("What are you trying to achieve?").fill("Turn one trusted brand direction into every launch asset.");
  await hold(page, 7_000);
  await bootstrap.getByRole("button", { name: "Continue" }).click();
  await bootstrap.getByLabel("Public reference URL").fill("https://reference.example.com");
  await bootstrap.getByLabel("Use as inspiration").check();
  await hold(page, 7_000);
  await bootstrap.getByLabel("Close").click();

  await page.getByRole("button", { name: "Design system" }).click();
  await hold(page, 8_000);
  await page.getByRole("button", { name: "Landing page" }).click();
  await hold(page, 4_500);

  await page.getByRole("button", { name: "Edit canvas" }).click();
  const editablePreview = page.frameLocator('iframe[title="Editable Web artifact"]');
  await editablePreview.locator('[data-design-node-id="hero-title"]').click();
  await page.locator(".artifact-edit-toolbar strong").filter({ hasText: "Hero title" }).waitFor();
  await hold(page, 7_500);
  await page.getByRole("button", { name: "Done editing" }).click();

  const project = await (await page.request.get(`${baseURL}/api/project?project=demo`)).json();
  await page.route(/\/api\/refine\?/, async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        source: "codex",
        changed: true,
        summary: "Created a more distinctive editorial direction.",
        filesModified: ["web/index.html"],
        project: project.project,
        landingHtml: project.landingHtml,
        candidateHtml: project.landingHtml,
        candidate: {
          id: "wrc_video-demo",
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
  await hold(page, 4_000);
  await page.getByLabel("Send instruction").click();
  await page.getByRole("dialog", { name: "Codex created a proposal" }).waitFor();
  await hold(page, 9_000);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Review/ }).click();
  await page.locator(".review-drawer").waitFor();
  await hold(page, 6_500);
  await page.locator(".review-drawer button").click();
  await page.getByRole("button", { name: "Presentation" }).click();
  await hold(page, 7_000);
  await page.getByRole("button", { name: "Edit canvas" }).click();
  await page.locator('.artifact-canvas-editor [data-node-id="slide-cover:title"]').click();
  await hold(page, 6_500);
  await page.getByRole("button", { name: "Done editing" }).click();
  await page.locator(".export-menu").hover();
  await page.getByRole("link", { name: "Editable PPTX" }).waitFor();
  await hold(page, 6_500);

  const video = page.video();
  await page.close();
  await context.close();
  if (!video) throw new Error("Playwright did not create a demo recording.");
  await video.saveAs(destination);
  console.log(`Recorded deterministic demo draft at ${destination}`);
} finally {
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  server.kill("SIGTERM");
  await rm(raw, { recursive: true, force: true });
}
