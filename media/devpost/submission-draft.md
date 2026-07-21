# OpenAI Build Week — Devpost submission draft

## Submission fields

- **Project name:** Codex Design Studio
- **Tagline:** One trusted brand direction. Every future asset.
- **Recommended track:** Work and Productivity
- **Repository:** https://github.com/jberdah/codex-design-studio
- **Release:** https://github.com/jberdah/codex-design-studio/releases/tag/v0.1.1
- **Public YouTube demo:** https://youtu.be/UNe7df9nIf4
- **Codex Session ID for `/feedback`:** `019f753a-8158-7d83-96ee-c879df7866ce`
- **Built with tags:** GPT-5.6, Codex, TypeScript, Next.js, Electron, Playwright
- **Describe your contribution:** I am the sole contributor. I defined the product and creative direction, then designed, built, tested, and packaged the application. This was my first Electron app for macOS and Windows; Codex and GPT-5.6 made it possible to learn the desktop stack while building and shipping a real, cross-platform product.
- **Final video file:** `codex-design-studio-build-week-extended-disclosed.mp4`
- **Final video SHA-256:** `8216afe3acfb395588a5dffaa625e88358d5e4ef93692243f4a4a56acd84c008`
- **Voice disclosure:** `Voice-over is AI-generated (OpenAI)` appears from 0:00:00.7 to 0:00:05.5.
- **Main Devpost thumbnail:** `media/devpost/00-codex-design-studio-cover.png` — upload via **Edit thumbnail**; it is separate from the gallery.

## Devpost project story

### Inspiration

Building a brand should not mean rebuilding the same context for every new asset.

Founders, marketers, and designers often start with scattered references: a few screenshots, a logo, a moodboard, a landing page, and a lot of intuition. The real challenge is turning that material into a coherent identity that can grow across a website, a deck, social assets, and future campaigns.

Without a shared source of truth, each new asset starts from scratch. The result is slow production, inconsistent decisions, and a brand that loses its character as it grows.

![One trusted brand direction. Every future asset.](https://raw.githubusercontent.com/jberdah/codex-design-studio/v0.1.1/media/devpost/01-one-brand-every-future-asset.png)

### What it does

I built Codex Design Studio as a desktop workspace for turning an early idea, a set of references, or an existing brand into a coherent Design System.

It gives a founder, marketer, or designer one place to bring together inspiration, visual references, and intent; establish a clear creative direction; create professional visual assets; and turn that direction into editable Web pages, presentations, and design assets. Codex and GPT-5.6 make that workflow accessible from the desktop application rather than requiring someone to assemble disconnected tools and prompts.

The goal is not to generate a one-off mockup. It is to give a growing brand a trusted creative foundation that makes every future asset more consistent, faster to produce, and still editable.

I also built the project to demonstrate a broader possibility: Codex can help carry a design direction through Design System work, professional visual assets, editable artifacts, and presentations—instead of stopping at code suggestions or a static mockup.

![From raw brand references to a reviewed creative direction.](https://raw.githubusercontent.com/jberdah/codex-design-studio/v0.1.1/media/devpost/02-from-raw-inputs-to-reviewed-direction.png)

![Evidence becomes an executable, versioned Design System.](https://raw.githubusercontent.com/jberdah/codex-design-studio/v0.1.1/media/devpost/03-evidence-becomes-an-executable-system.png)

### How I built it with Codex and GPT-5.6

I designed and built Codex Design Studio during OpenAI Build Week with Codex and GPT-5.6 Sol and Terra. I used a goal-driven workflow: I set the product direction, let Codex carry a well-scoped phase forward, reviewed the result in the real application, then made the next product decision.

This repeated across ideation, implementation, review, and testing. Codex stayed anchored to the goal through long development sessions, while focused subagents explored design options, implemented features, investigated defects, and extended test coverage. I used GPT-5.6 to challenge assumptions, compare approaches, and translate product intent into concrete technical work.

I remained the sole contributor and made every product and creative decision: the user problem, the desired experience, the creative direction, and the bar for shipping. Codex accelerated the execution around those decisions and let me take the project from concept to a tested desktop application for macOS and Windows in a few days.

![Codex Design Studio edits the real artifact, not just a mockup.](https://raw.githubusercontent.com/jberdah/codex-design-studio/v0.1.1/media/devpost/04-codex-edits-the-real-artifact.png)

### Challenges I ran into

The hardest challenge was proving that the desktop application worked reliably end to end across platforms. A polished screen was not enough: I needed confidence that a person could create a project, review the evidence, edit real artifacts, validate a change, and export the result.

Automating that breadth of testing initially felt ambitious for a Build Week. Codex and GPT-5.6 made it practical: I used them to build and run end-to-end journeys, investigate failures, and improve the release path. They did not remove the need for judgment, but they made it possible to spend more time testing the experience than wiring up test infrastructure.

![Proof before promotion: visual QA and review before accepting a change.](https://raw.githubusercontent.com/jberdah/codex-design-studio/v0.1.1/media/devpost/05-proof-before-promotion.png)

### Accomplishments I'm proud of

- I turned scattered creative references into a reusable Design System.
- I kept Web, presentation, and visual artifacts directly editable after creation.
- I combined creation, editing, review, and export in one local-first workspace.
- I shipped tested packages for macOS and Windows in a few days.
- I used Codex and GPT-5.6 to take a user-centred product from a blank workspace to a demonstrable, testable release.

### What I learned

This project changed my understanding of what Codex and GPT-5.6 can make possible.

I have used Codex intensively, every day, for more than a year. That perspective makes the progress especially tangible: I had already felt a clear step forward in the quality of the work with GPT-5.3 Codex. With GPT-5.6, I experienced another step change—both in how long a task can stay coherent and in the quality of the deliverables it can carry to completion.

I learned that Codex can stay anchored to a concrete goal through hours-long sessions. Rather than treating every prompt as a fresh request, I could set a direction, review progress, intervene when a decision needed my judgment, and let the work move forward across ideation, implementation, review, and testing.

Before this project, I had never created an Electron application for macOS or Windows. Codex made that learning curve far more approachable: I used it to build desktop packages, launch them, and interact with the real application to validate the experience as a user would. I learned the desktop stack while applying it to a product that had to work.

I was also integrating Codex App Server into a solution for the first time. That made the learning especially concrete: Codex was both the tool that helped me build the product and a technology I had to design, integrate, and test as part of the product experience.

Finally, I discovered a broader creative workflow. Before Build Week, I assumed that polished visual assets and a complete demo video required switching to ChatGPT or using OpenAI APIs directly. I used Codex to produce those assets and the demo workflow too, while keeping them connected to the product itself.

The important lesson was not that I could remove myself from the process. It was that I could spend more of my time on the work that needs product judgment: understanding the user problem, setting the creative direction, and deciding whether the result is ready to ship.

### What's next for Codex Design Studio

I want to make it easier to bring richer brand sources into the workspace, collaborate on reviews, and turn a trusted Design System into every asset a growing brand needs.

![One system, several editable outputs.](https://raw.githubusercontent.com/jberdah/codex-design-studio/v0.1.1/media/devpost/06-one-system-several-editable-outputs.png)

## Judge testing path

**Download the tested desktop build:** [GitHub Release v0.1.1](https://github.com/jberdah/codex-design-studio/releases/tag/v0.1.1)

1. From that release, download the package for the test machine.
2. Verify the matching SHA-256 manifest.
3. Launch the unsigned package using the documented Gatekeeper or SmartScreen fallback if necessary.
4. Choose an empty local workspace and connect a ChatGPT/Codex account.
5. Create a project, review evidence and the synthesized brief, and approve the Brand System.
6. Select an element in the Web canvas, request a composition-level change, inspect the responsive QA evidence, and accept or reject it.
7. Open the editable presentation and export Web, PPTX, or token artifacts.

The deterministic source path is `npm ci && npm run preflight && npm run check:all`. The verified baseline is 181 Vitest checks on macOS/Linux, 179 applicable checks on Windows, 10 Chromium journeys, and a packaged Electron lifecycle journey on each native release runner.

## Gallery order

1. `01-one-brand-every-future-asset.png`
2. `02-from-raw-inputs-to-reviewed-direction.png`
3. `03-evidence-becomes-an-executable-system.png`
4. `04-codex-edits-the-real-artifact.png`
5. `05-proof-before-promotion.png`
6. `06-one-system-several-editable-outputs.png`

## Final manual gate

- Submit `/feedback` from the recorded Codex Session ID.
- Confirm that the Devpost project is public and all required fields are complete.
