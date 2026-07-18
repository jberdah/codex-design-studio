import { expect, test } from "@playwright/test";

test.afterEach(async ({ request }) => {
  await request.post("/api/project/reset");
});

test("refines a selected landing element and reviews the result", async ({ page }) => {
  await page.goto("/");
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
  await page.goto("/");
  await page.getByRole("button", { name: /Presentation/ }).click();
  await expect(page.locator(".slide-strip > div")).toHaveCount(3);
  await expect(page.locator(".slides-stage")).toContainText("Climate intelligence for decisions that matter");
});
