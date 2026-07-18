import { expect, test } from "@playwright/test";

test.afterEach(async ({ request }) => {
  await request.post("/api/project/reset?project=e2e");
});

test("refines a selected landing element and reviews the result", async ({ page }) => {
  await page.goto("/?project=e2e");
  await expect(page.getByText("Codex Design Studio")).toBeVisible();
  await expect(page.getByText("Codex connected")).toBeVisible();

  const preview = page.frameLocator('iframe[title="Generated landing page"]');
  await preview.locator('[data-design-id="hero-title"]').click();
  await expect(page.locator(".context-card")).toContainText("Hero title");

  await page.getByLabel("Refinement instruction").fill("Make this warmer");
  await page.getByLabel("Send instruction").click();
  await expect(page.locator(".messages")).toContainText("terracotta", { timeout: 15_000 });
  await expect(page.locator(".project-crumb")).toContainText("v0.1.1");

  await page.getByRole("button", { name: /Review/ }).click();
  await expect(page.locator(".review-drawer")).toContainText("Ready to ship");
  await expect(page.locator(".review-drawer")).toContainText("100");
});

test("shows the complete three-slide deck", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto("/?project=e2e");
  await page.getByRole("button", { name: /Presentation/ }).click();
  await expect(page.locator(".slide-strip > div")).toHaveCount(3);
  await expect(page.locator(".slides-stage")).toContainText("Climate intelligence for decisions that matter");
  const slide = await page.locator(".slides-stage > .slide-preview").boundingBox();
  const workspace = await page.locator(".workspace").boundingBox();
  expect(slide).not.toBeNull();
  expect(workspace).not.toBeNull();
  expect(slide!.x).toBeGreaterThanOrEqual(workspace!.x);
  expect(slide!.x + slide!.width).toBeLessThanOrEqual(workspace!.x + workspace!.width);
});

test("adds visible icons to the selected navigation", async ({ page }) => {
  await page.goto("/?project=e2e");
  const preview = page.frameLocator('iframe[title="Generated landing page"]');
  await preview.locator('[data-design-id="navigation"]').click();
  await page.getByLabel("Refinement instruction").fill("Add icons to the menu items");
  await page.getByLabel("Send instruction").click();
  await expect(preview.locator("svg.nav-icon")).toHaveCount(3);
  await expect(page.locator(".messages")).toContainText("monoline icons");
});

test("creates and opens an isolated brand project", async ({ page }) => {
  await page.goto("/?project=e2e");
  await page.getByRole("button", { name: /New project/ }).click();
  const dialog = page.getByRole("dialog", { name: "Create a brand workspace" });
  await dialog.getByLabel("Brand name").fill("Orbit E2E");
  await dialog.getByLabel("Industry").fill("Design operations");
  await dialog.getByLabel("Audience").fill("Creative teams");
  await dialog.getByLabel("Brand promise").fill("Turn direction into tested artifacts.");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/project=orbit-e2e/);
  await expect(page.getByLabel("Active project")).toHaveValue(/orbit-e2e/);
  await expect(page.locator("iframe").contentFrame().getByRole("heading", { level: 1 })).toContainText("Turn direction into tested artifacts");
});

test("edits slide scene nodes with keyboard, undo and autosaved source persistence", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?project=e2e");
  await page.getByRole("button", { name: /Presentation/ }).click();
  await page.getByRole("button", { name: "Edit canvas" }).click();

  const canvas = page.getByRole("listbox", { name: /Slide 1 canvas/ });
  const title = page.locator('.artifact-canvas-editor [data-node-id="slide-cover:title"]');
  await title.click();
  await canvas.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(".artifact-edit-feedback")).toContainText("Nudged 1 element");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".artifact-edit-feedback")).toContainText("Undid Nudged 1 element");

  const styleBeforeCaretMove = await title.getAttribute("style");
  await title.locator("span").focus();
  await page.keyboard.press("ArrowRight");
  expect(await title.getAttribute("style")).toBe(styleBeforeCaretMove);

  const save = page.waitForResponse((response) => response.url().includes("/api/project?project=e2e") && response.request().method() === "PUT");
  await title.locator("span").fill("A directly edited launch story");
  await title.locator("span").press("Tab");
  await save;
  await expect(page.locator(".artifact-edit-toolbar")).toContainText("Autosaved");

  await page.reload();
  await page.getByRole("button", { name: /Presentation/ }).click();
  await page.getByRole("button", { name: "Edit canvas" }).click();
  await expect(page.locator('.artifact-canvas-editor [data-node-id="slide-cover:title"]')).toContainText("A directly edited launch story");
});

test("flushes a pending canvas edit when edit mode closes before the debounce", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?project=e2e-fast-exit");
  await page.getByRole("button", { name: /Presentation/ }).click();
  await page.getByRole("button", { name: "Edit canvas" }).click();
  const title = page.locator('[data-node-id="slide-cover:title"] span');
  const expectedTitle = `A fast exit that must still persist ${Date.now()}`;
  await title.fill(expectedTitle);
  const save = page.waitForResponse((response) => response.url().includes("/api/project?project=e2e-fast-exit") && response.request().method() === "PUT" && response.ok());
  await page.getByRole("button", { name: "Done editing" }).click();
  await save;
  await page.reload();
  await page.getByRole("button", { name: /Presentation/ }).click();
  await page.getByRole("button", { name: "Edit canvas" }).click();
  await expect(page.locator('.artifact-canvas-editor [data-node-id="slide-cover:title"]')).toContainText(expectedTitle);
});

test("inline-edits a stable Web design id and preserves it after reload", async ({ page }) => {
  await page.goto("/?project=e2e");
  const preview = page.frameLocator('iframe[title="Generated landing page"]');
  const title = preview.locator('[data-design-id="hero-title"]');
  await title.dblclick();
  const save = page.waitForResponse((response) => response.url().includes("/api/project?project=e2e") && response.request().method() === "PUT");
  await title.fill("A Web headline edited in place");
  await title.press("Tab");
  await save;
  await expect(page.getByText("Inline text saved to source.")).toBeVisible();

  await page.reload();
  await expect(page.frameLocator('iframe[title="Generated landing page"]').locator('[data-design-id="hero-title"]')).toHaveText("A Web headline edited in place");
});
