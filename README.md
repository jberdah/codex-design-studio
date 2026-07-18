# Codex Design Studio

Codex Design Studio is a local-first desktop application for creating a brand project, directing a real Web composition with Codex, checking every edit visually, and exporting production artifacts.

The application now includes:

- official Codex App Server authentication with ChatGPT or an OpenAI API key;
- creation, switching, and isolated persistence of multiple projects;
- contextual selection inside the live landing-page preview;
- freeform HTML/CSS/SVG design edits by Codex, beyond tokens and copy fields;
- transactional Playwright screenshots at desktop and mobile sizes, pixel diffs, and overflow rejection;
- a deterministic offline refinement path for the demo-safe semantic contract;
- responsive HTML ZIP, design-token JSON, and editable PowerPoint exports;
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

In the packaged application, projects live under the Electron user-data directory rather than inside the application bundle. On macOS the default workspace is:

```text
~/Library/Application Support/Codex Design Studio/workspace/projects/
```

## Product flow

1. Connect the user’s OpenAI account.
2. Create a project with its brand, industry, audience, and promise.
3. Select an element directly in the Web preview.
4. Ask Codex for a focused adjustment or a complete visual redesign.
5. Inspect the rendered result and run the design review.
6. Export HTML, tokens, or an editable deck.

Web edits modify the real `web/index.html`. The host captures a baseline first, runs Codex in a project-scoped writable sandbox, verifies that preview instrumentation remains intact, and then renders desktop and mobile comparisons. A failed, timed-out, or overflowing proposal is rolled back.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run test:e2e` uses an isolated `.e2e-workspace` on port 3100 and forces the deterministic path. `npm run test:agent` exercises the live structured App Server path and restores its test project afterward.

## Project layout

```text
desktop/                  Electron main process and runtime preparation
projects/                 inspectable development project workspaces
skills/                   brand and Web art-direction workflows
src/domain/               shared project contract and defaults
src/server/               storage, renderers, Codex, auth, QA, and exports
src/app/api/              project-scoped HTTP boundary
src/components/           Studio canvas, project UI, account UI, and chat
tests/                    unit, renderer, and Chromium journeys
```

See [the architecture](docs/architecture.md), [the demo script](docs/demo-script.md), and [the verification record](docs/verification.md).

## Deliberate limits

This build is local-first and single-user per machine. It does not yet include cloud synchronization, team collaboration, signing/notarization, auto-update, or Windows packaging. The account belongs to the current OS user and project data remains local.
