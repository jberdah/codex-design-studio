# Codex Design Studio

Create a brand once, refine it contextually with Codex, and ship it as a responsive landing page plus an editable PowerPoint deck.

The MVP proves one executable design system can power multiple deliverables. It includes a polished local Studio, an instrumented landing preview, semantic element selection, Codex App Server refinement, an offline fallback, deterministic design review, and HTML/JSON/PPTX exports.

## Requirements

- macOS or Linux
- Node.js 22 LTS
- npm 10+
- A ChatGPT/Codex login for live agent refinement

The Codex CLI is pinned locally to `0.144.5`; no global CLI install is required.

## Start

```bash
npm install
npm run preflight
npm run dev
```

Open <http://127.0.0.1:3000>. If needed, authenticate once with `npx codex login`. Copy `.env.example` to `.env.local` only when overriding the model or forcing the offline mode.

## Demo flow

1. Select the hero title or description directly inside the landing preview.
2. Ask Codex to make it “more premium and concise” or choose a quick prompt.
3. Inspect the updated token version, landing, and three-slide presentation.
4. Run **Review** and inspect the deterministic quality checks.
5. Export the landing ZIP, tokens JSON, and editable PPTX.

The reliable fallback recognizes a small set of demo directions such as warmer, premium, concise, violet, and bold. Live Codex mode supports open-ended semantic refinements.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run test:e2e` starts an isolated server on port 3100 and forces the deterministic fallback. Install its browser once with `npx playwright install chromium`.

To smoke-test the real App Server path, start the app normally in another terminal and run:

```bash
npm run test:agent
```

This performs a live structured refinement, verifies the Codex source and thread ID, then restores the demo project.

## Project layout

```text
projects/demo/             inspectable project source and generated artifacts
skills/                    Codex brand-generation and design-review workflows
src/domain/                shared project contract and reference project
src/server/                store, renderers, reviewer, exports, App Server adapter
src/app/api/               narrow HTTP boundary used by the Studio
src/components/            Studio canvas, contextual chat, and slide previews
tests/                     domain/export tests and Chromium journeys
```

See [the architecture](docs/architecture.md) for runtime boundaries and deliberate MVP trade-offs, [the demo script](docs/demo-script.md) for the submission recording, and [the verification record](docs/verification.md) for the preserved App Server session and test evidence.

## Current scope

This is intentionally a single-user, local-first MVP with one reference brand. Authentication, multi-project storage, real-time collaboration, asset generation, and desktop packaging are post-MVP work. The file-based store is an explicit simplification of the original SQLite/FastAPI suggestion, isolated behind interfaces that can be replaced later.
