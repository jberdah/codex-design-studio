# Architecture

Codex Design Studio separates the desktop shell, renderer, application server, agent process, project workspace, and visual worker. The `ProjectData` manifest remains the source of truth for shared brand data, while `web/index.html` may become an independently composed artifact after a freeform Codex edit.

```text
Electron main process
    ├── sandboxed BrowserWindow ──► Next.js Studio UI
    └── embedded Next.js server
            ├── project store ──► manifests, HTML, tokens, slides, reviews
            ├── Codex account service ──► persistent App Server auth session
            ├── structured refiner ──► read-only Codex turn
            ├── Web art director ──► project-scoped writable Codex turn
            ├── visual worker ──► Playwright desktop/mobile + pixelmatch
            └── exporters ──► HTML ZIP, JSON, editable PPTX
```

## Desktop boundary

The Electron renderer has `contextIsolation`, sandboxing, and Web security enabled, with Node integration disabled. A narrow preload bridge offers native choose/create, recent, open, relink, and revoke operations using opaque workspace IDs. External HTTPS login URLs are handed to the operating-system browser. The main process starts a loopback-only standalone Next.js server against one user-selected portable workspace at a time and restarts it when that workspace changes. Canonical paths and platform grants remain in Electron `userData`; project content does not.

The packaged resources are split deliberately:

- `studio-server`: the standalone Next.js application;
- `studio-runtime`: Codex CLI, the original project skills, Playwright, pixelmatch, and Chromium headless;
- `app.asar`: only the Electron entry point and package manifest.

The supplied Claude Desktop archive informed the high-level choice to isolate the UI, agent runtime, and heavyweight workers. Its bundled workflows also reinforced screenshot-based self-critique and deterministic artifact checks. No proprietary code, prompts, or assets are copied into this repository or package.

## Codex and authentication

The account service uses the official App Server methods `account/read`, `account/login/start`, and `account/logout`. ChatGPT login opens the returned browser URL; API-key login is also supported. Credentials remain in Codex’s OS-level credential storage and never enter a project manifest.

Structured shared-brand edits run with `approvalPolicy: never`, a read-only sandbox, and a strict JSON output schema. The open-ended Web editor runs with the same approval policy in a workspace-write sandbox scoped to the active project.

## Transactional Web editing

For a freeform Web request, the host:

1. saves the original HTML and renders desktop/mobile baselines;
2. asks Codex to edit the actual artifact using the `web-art-director` skill;
3. verifies that the source changed and retained design-selection instrumentation;
4. renders 1440×1000 and 390×844 screenshots with the bundled browser;
5. records pixel differences and horizontal-overflow results;
6. commits the new project version only after validation.

Any agent failure, timeout, removed instrumentation, render failure, or horizontal overflow restores the original HTML. Once a Web artifact is marked `webCustomized`, unrelated brand-system saves preserve its composition instead of regenerating the template.

## Project persistence

Each project is an isolated directory inside the authorized portable workspace, with atomic JSON writes, generated brand/token/slide sources, the editable Web artifact, visual reviews, exports, history, and an immutable initial snapshot used by **Restore project**. API routes resolve only a validated project ID from the request, new project IDs use collision-safe slugs, and realpath validation rejects traversal and symlink escapes. The manifest, registry schema, migration rules, and recovery behavior are specified in [portable-workspaces.md](portable-workspaces.md).

## Remaining production work

The current package is a macOS x64, local-first submission build. A commercial release would add code signing and notarization, per-platform installers, auto-update, crash reporting with consent, encrypted cloud sync, collaboration, storage quotas, and a supervised job queue for concurrent agent work.
