# Codex Design Studio

Codex Design Studio is a local-first desktop application for creating a brand project, directing a real Web composition with Codex, checking every edit visually, and exporting production artifacts.

The application now includes:

- official Codex App Server authentication with ChatGPT or an OpenAI API key;
- native workspace selection plus creation, switching, and isolated persistence of portable projects;
- brand bootstrap from manual direction, URLs, documents, logos, images, and local or remote Git repositories;
- source provenance, conflict reconciliation, immutable BrandSystem versions, and project-owned design-system presets;
- an extensible catalog covering Web, Slides, Mobile App, Wireframe, Document, Animation, UI Mockups, CV, 3D object, Research, HTML email, Color + Type pairing, Diagram, and Flier;
- contextual selection inside the live landing-page preview;
- freeform HTML/CSS/SVG design edits by Codex, beyond tokens and copy fields;
- stable inline Web text editing and a transactional slide canvas with move, resize, keyboard controls, undo/redo, grouping, alignment, z-order, typography, and colour controls;
- versioned OpenAI visual generation, comparison, approval, refinement, restore, and placement, using ChatGPT authentication by default;
- transactional Playwright screenshots at desktop and mobile sizes, pixel diffs, and overflow rejection;
- a deterministic offline refinement path for the demo-safe semantic contract;
- responsive HTML ZIP, design-token JSON, and scene-graph-driven editable PowerPoint exports with rendered validation evidence;
- optional capability-declared GitHub, GitLab, and Bitbucket adapters, reproducible handoffs, durable jobs, project-local skills/templates, and encrypted collaboration controls;
- an isolated Electron shell with an embedded Next.js server, Codex CLI, and Chromium headless runtime.

## Requirements

- macOS x64 for the currently configured desktop target;
- Node.js 22 LTS and npm 10+ for development;
- a ChatGPT/Codex login or OpenAI API key for live Codex edits.

The project pins Codex CLI `0.144.5`, Playwright `1.55.1`, and Electron `43.1.1`. No global Codex installation is required.

## Run in development

```bash
npm install
npm run preflight
npm run dev
```

Open <http://127.0.0.1:3000>. Use the account button in the top bar to connect with ChatGPT or an API key. Authentication is handled by Codex and is not written into project files.

To run the Electron shell against the development server:

```bash
npm run desktop:dev
```

## Create the desktop application

Install the headless browser locally once, then package or create distributable media:

```bash
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
npm run desktop:package
npm run desktop:make
```

Outputs are written below `out/`. `desktop:package` creates the unpacked `.app`; `desktop:make` creates the configured ZIP and DMG. The development build is not code-signed or notarized.

On first launch, the packaged application asks the user to choose or create a portable workspace folder. Project content lives in that folder rather than in the application bundle or Electron user-data directory:

```text
<selected folder>/.codex-design-studio-workspace.json
<selected folder>/projects/
```

Electron `userData` contains only private recent-workspace metadata and operating-system grants. Moving a workspace preserves its ownership marker and allows it to be relinked through the native picker. See [the portable workspace contract](docs/portable-workspaces.md).

## Product flow

1. Connect the user’s OpenAI account.
2. Choose a portable workspace and create a project from brand direction and optional reference sources.
3. Reconcile extracted evidence, publish a BrandSystem version, and choose a preset or template when useful.
4. Select an element directly in the Web preview, or open the slide canvas for direct manipulation.
5. Ask Codex for a focused adjustment, complete visual redesign, or versioned visual asset.
6. Inspect the rendered comparisons and run the evidence-backed design review.
7. Export HTML, tokens, or an editable deck; optionally prepare a provider-neutral repository handoff.

Web edits modify the real `web/index.html`. The host captures a baseline first, runs Codex in a project-scoped writable sandbox, verifies that preview instrumentation remains intact, and then renders desktop and mobile comparisons. A failed, timed-out, or overflowing proposal is rolled back.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:electron
# or the complete Web verification chain
npm run check:all
```

`npm run test:e2e` uses an isolated `.e2e-workspace` on port 3100 and forces the deterministic path. `npm run test:electron` exercises the context-isolated bridge, relaunch persistence, and revocation; set `CODEX_STUDIO_PACKAGED_APP` to run it against a packaged executable. `npm run test:agent` exercises the live structured App Server path and restores its test project afterward.

## Project layout

```text
desktop/                  Electron main process and runtime preparation
projects/                 inspectable development project workspaces
skills/                   brand and Web art-direction workflows
src/domain/               project, artifact, editing, catalog, and integration contracts
src/server/               storage, extraction, repositories, Codex, auth, QA, jobs, and exports
src/app/api/              project-scoped HTTP boundary
src/components/           Studio canvas, project UI, account UI, and chat
tests/                    unit, renderer, and Chromium journeys
```

See [the architecture](docs/architecture.md), [the demo script](docs/demo-script.md), and [the verification record](docs/verification.md).

## Deliberate limits

This build is local-first and single-user by default. Collaboration and repository providers are explicit opt-in extensions; there is no hosted cloud synchronization service. Signing/notarization, auto-update, Apple Silicon universal packaging, and Windows packaging remain release work. The account belongs to the current OS user and project data remains local unless the user deliberately enables an external capability.
