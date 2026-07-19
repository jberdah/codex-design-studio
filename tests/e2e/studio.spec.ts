import { expect, test } from "@playwright/test";

function synthesizedBootstrapBrief() {
  return {
    id: "brief-bootstrap-e2e",
    version: 1,
    status: "draft",
    createdAt: "2026-07-19T00:00:00.000Z",
    createdBy: "codex",
    title: "Orbit E2E strategic launch brief",
    summary: "Make design direction executable for creative teams through a clear presentation narrative.",
    facts: [
      { id: "fact-brand", claim: "The brand name is Orbit E2E.", evidenceIds: [] },
      { id: "fact-objective", claim: "The original objective asks for tested, executable artifacts.", evidenceIds: [] }
    ],
    inferences: [{ id: "inference-clarity", claim: "Creative teams need a visible path from direction to delivery.", evidenceIds: [], confidence: 0.82 }],
    assumptions: [{ id: "assumption-format", claim: "A concise launch narrative is the strongest first artifact.", status: "proposed", evidenceIds: [] }],
    unknowns: ["Competitive positioning remains open."],
    questions: [],
    strategy: {
      audience: "Creative teams",
      objective: "Turn creative direction into decisions a team can execute and verify.",
      positioning: "A design workspace where direction, implementation and proof stay connected.",
      voice: "Precise, confident and collaborative.",
      contentPriorities: ["Executable direction", "Visible evidence", "Team confidence"]
    },
    creative: {
      opportunity: "Make rigor feel creative instead of procedural.",
      designPrinciples: ["Show the decision path", "Separate evidence from inference", "Make approval explicit"],
      avoid: ["Generic AI gradients", "Unsupported claims", "Decorative complexity"]
    },
    brandSeed: {
      name: "Orbit E2E",
      industry: "Design operations",
      audience: "Creative teams",
      promise: "Make design direction executable.",
      personality: ["precise", "inventive"],
      tone: "Clear and assured",
      visualDirection: "Structured editorial systems with purposeful contrast"
    }
  };
}

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

test("lets the user compare and accept a QA-blocked Web candidate", async ({ page, request }) => {
  const initial = await (await request.get("/api/project?project=e2e-candidate-choice")).json();
  const candidateHtml = '<!doctype html><html><body><main data-design-node-id="hero"><h1 data-design-id="hero-title">Candidate direction</h1></main><script>document.addEventListener("click",()=>parent.postMessage({type:"noop"},"*"))</script></body></html>';
  await page.route(/\/api\/refine\?/, async (route) => {
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({
      source: "codex", changed: true, summary: "Created a bolder candidate.", filesModified: ["web/index.html"],
      project: initial.project, landingHtml: initial.landingHtml, candidateHtml,
      candidate: { id: "wrc_00000000-0000-4000-8000-000000000000", summary: "Created a bolder candidate.", assessment: { reasons: ["1 deterministic rendered regression requires review."], comparisons: { desktop: { before: { failures: 1, inconclusive: 0 }, after: { failures: 2, inconclusive: 0 }, regressions: ["contrast"] } } } }
    }) });
  });
  await page.route(/\/api\/refine\/candidate\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidate: { status: "accepted" }, project: { ...initial.project, version: initial.project.version + 1, webCustomized: true }, landingHtml: candidateHtml }) });
  });

  await page.goto("/?project=e2e-candidate-choice");
  await page.getByLabel("Refinement instruction").fill("Try a bolder direction");
  await page.getByLabel("Send instruction").click();
  const dialog = page.getByRole("dialog", { name: "Codex created a proposal" });
  await expect(dialog).toBeVisible();
  await expect(page.frameLocator('iframe[title="Generated landing page"]').getByRole("heading", { level: 1 })).toHaveText("Candidate direction");
  await dialog.getByRole("button", { name: "View original" }).click();
  await expect(page.frameLocator('iframe[title="Generated landing page"]').getByRole("heading", { level: 1 })).toHaveText(initial.project.landing.headline);
  await dialog.getByRole("button", { name: "View candidate" }).click();
  await dialog.getByRole("button", { name: "Accept with warnings" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".messages")).toContainText("now the active Web version");
});

test("creates an isolated project from a reviewed traceable bootstrap brief", async ({ page, request }) => {
  const brief = synthesizedBootstrapBrief();
  let startInput: Record<string, unknown> | undefined;
  let savedBrief: typeof brief | undefined;
  let session = {
    id: "bootstrap_e2e",
    status: "questions",
    questions: [{ id: "question-industry", field: "industry", prompt: "Which operating context should anchor the first story?", reason: "Industry context changes positioning and examples.", required: true, options: ["Design operations", "Creative software"] }],
    answers: [] as Array<{ questionId: string; value: string }>,
    briefs: [] as Array<typeof brief>,
    activeBriefVersion: undefined as number | undefined
  };
  await page.route(/\/api\/bootstrap(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON() as Record<string, unknown> | null;
    if (url.pathname === "/api/bootstrap") {
      startInput = (body?.input ?? {}) as Record<string, unknown>;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ session }) });
    }
    if (url.pathname === "/api/bootstrap/bootstrap_e2e" && route.request().method() === "PATCH") {
      session = { ...session, answers: (body?.answers ?? []) as Array<{ questionId: string; value: string }> };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session }) });
    }
    if (url.pathname.endsWith("/synthesize")) {
      session = { ...session, status: "review", briefs: [brief], activeBriefVersion: 1 };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session }) });
    }
    if (url.pathname.endsWith("/brief")) {
      savedBrief = body?.brief as typeof brief;
      const reviewed = { ...savedBrief, id: "brief-bootstrap-e2e-reviewed", version: 2 };
      session = { ...session, briefs: [brief, reviewed], activeBriefVersion: 2 };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ session }) });
    }
    if (url.pathname.endsWith("/approve")) {
      const approved = savedBrief ?? brief;
      const createdResponse = await request.post("/api/projects", { data: {
        name: "Orbit E2E",
        brandName: approved.brandSeed.name,
        industry: approved.brandSeed.industry,
        audience: approved.brandSeed.audience,
        promise: approved.brandSeed.promise
      } });
      const created = await createdResponse.json();
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ session: { ...session, status: "approved", createdProjectId: created.project.id }, project: created.project }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Unknown bootstrap action" }) });
  });

  await page.goto("/?project=e2e");
  await page.getByRole("button", { name: /New project/ }).click();
  const dialog = page.getByRole("dialog", { name: "Create a brand workspace" });
  await dialog.getByLabel("Brand name").fill("Orbit E2E");
  await dialog.getByLabel("Audience").fill("Creative teams");
  await dialog.getByLabel("What are you trying to achieve?").fill("Turn direction into tested artifacts.");
  await dialog.getByLabel("Presentation").check();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByText("Bring a site, without losing authorship.")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue without reference" }).click();
  await dialog.getByLabel("Which operating context should anchor the first story?").selectOption("Design operations");
  await dialog.getByRole("button", { name: "Synthesize brief" }).click();
  await expect(dialog.getByText("Turn direction into tested artifacts.", { exact: true })).toBeVisible();
  const wordingLock = dialog.locator(".original-wording input");
  await expect(wordingLock).not.toBeChecked();
  await wordingLock.check();
  await expect(dialog.getByText("Locked verbatim")).toBeVisible();
  await wordingLock.uncheck();
  await dialog.getByLabel("Brief summary").fill("A reviewed brief that turns direction into an executable creative system.");
  await dialog.getByRole("button", { name: "Continue to approval" }).click();
  await expect(dialog.getByText("Ready to create, not overwrite.")).toBeVisible();
  await dialog.getByRole("button", { name: "Approve & create project" }).click();

  await expect(page).toHaveURL(/project=orbit-e2e/);
  await expect(page.getByLabel("Active project")).toHaveValue(/orbit-e2e/);
  await expect(page.locator("iframe").contentFrame().getByRole("heading", { level: 1 })).toContainText("Make design direction executable");
  expect(startInput).toMatchObject({ brandName: "Orbit E2E", objective: "Turn direction into tested artifacts.", targetDeliverable: "slides" });
  expect(savedBrief?.summary).toBe("A reviewed brief that turns direction into an executable creative system.");
});

test("warns about reference responsibility without blocking manual recovery", async ({ page }) => {
  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthesis is temporarily unavailable." }) });
  });
  await page.goto("/?project=e2e");
  await page.getByRole("button", { name: /New project/ }).click();
  const dialog = page.getByRole("dialog", { name: "Create a brand workspace" });
  await dialog.getByLabel("Brand name").fill("Recovery E2E");
  await dialog.getByLabel("What are you trying to achieve?").fill("Help a new audience understand the product quickly.");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByLabel("Public reference URL").fill("not a url");
  await expect(dialog.getByRole("button", { name: "Analyze context" })).toBeDisabled();
  await dialog.getByLabel("Public reference URL").fill("https://example.com/reference");
  await dialog.getByLabel("Use as inspiration").check();
  await expect(dialog.getByText("You remain responsible for using references lawfully.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Analyze context" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Analyze context" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Synthesis is temporarily unavailable");
  await dialog.getByRole("button", { name: "Continue manually" }).click();
  await expect(dialog.getByLabel("Brief summary")).toHaveValue(/Recovery E2E should turn its stated ambition/);
  await expect(dialog.getByText("Facts")).toBeVisible();
  await expect(dialog.getByText("Inferences")).toBeVisible();
  await expect(dialog.getByText("Assumptions")).toBeVisible();
});

test("edits slide scene nodes with keyboard, undo and autosaved source persistence", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?project=e2e");
  await page.getByRole("button", { name: /Presentation/ }).click();
  await page.getByRole("button", { name: "Edit canvas" }).click();

  const canvas = page.getByRole("listbox", { name: /Slide 1 canvas/ });
  const title = page.locator('.artifact-canvas-editor [data-node-id="slide-cover:title"]');
  const body = page.locator('.artifact-canvas-editor [data-node-id="slide-cover:body"]');
  const titleBox = await title.boundingBox();
  const bodyBox = await body.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(bodyBox!.y);
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

test("edits the Web canvas directly and persists the transactional save", async ({ page }) => {
  await page.goto("/?project=e2e");
  await page.getByRole("button", { name: "Edit canvas" }).click();

  const canvas = page.frameLocator('iframe[title="Editable Web artifact"]');
  const title = canvas.locator('[data-design-node-id="hero-title"]');
  await title.click();
  await expect(page.locator(".artifact-edit-toolbar strong")).toContainText("Hero title");
  await expect(page.locator(".context-card")).toContainText("Hero title");

  const save = page.waitForResponse((response) => response.url().includes("/api/web-source?project=e2e") && response.ok());
  await title.dblclick();
  await title.fill("A canvas headline saved through the transaction");
  await title.press("Escape");
  await save;
  await expect(page.locator(".artifact-edit-toolbar em")).toContainText("Autosaved");

  await page.reload();
  await expect(page.frameLocator('iframe[title="Generated landing page"]').locator('[data-design-id="hero-title"]')).toHaveText("A canvas headline saved through the transaction");
});
