# Verification record

Final local verification was completed on 18 July 2026 in Europe/Paris.

## Environment

- Node.js `22.23.1`
- npm `10.9.8`
- project-local Codex CLI `0.144.5`
- Codex model `gpt-5.6-sol`
- Electron `43.1.1`
- Playwright `1.55.1`
- authentication: ChatGPT Plus account confirmed through `account/read`

## Live creative-edit evidence

A project-isolated Web turn changed the real HTML, retained the selection bridge, produced three monoline navigation SVGs, and completed with App Server thread `019f757b-9a8f-7ed3-8c6c-aeefb1fe0328`.

Corrected visual evidence:

- desktop: 1440×1000, no horizontal overflow, `15.8856%` pixel difference;
- mobile: 390×844, no horizontal overflow, `40.9029%` pixel difference.

## Packaged desktop evidence

The unpacked macOS x64 application was created at `out/Codex Design Studio-darwin-x64/Codex Design Studio.app` and launched with an isolated temporary workspace.

From the packaged runtime—not the development checkout—the verification confirmed:

- embedded Next.js home returned HTTP 200 with its static assets;
- bundled Codex CLI was available;
- the ChatGPT account was readable;
- a new project was created;
- a Web turn completed with thread `019f7586-547c-78c0-8b43-c750617c6c58`;
- three navigation icons and `webCustomized: true` were persisted;
- desktop pixel difference `5.6837%`, mobile `20.6951%`, neither overflowing.

The final unpacked application is approximately 831 MB. Its ASAR contains only the desktop entry point and manifest; the user-provided proprietary reference archive and all development projects are excluded. The verified media are a 376 MB DMG and a 328 MB ZIP.

The editable PPTX was also rendered slide-by-slide through macOS Quick Look. All three 16:9 layouts rendered correctly; the value slide’s editable decision-loop geometry was verified after refinement. The Studio preview was captured at 1510×960 and 1100×760, with the main slide fully contained in the workspace at both sizes.

## Automated evidence

- 14 Vitest unit/renderer checks passed.
- 4 Chromium journeys passed: contextual refinement/review, complete slide deck, visible navigation icons, and isolated project creation.
- TypeScript generation and typecheck passed.
- Next.js standalone production build passed with all application routes.
- Both repository skills passed the Codex skill validator.
- `npm audit --omit=dev` is used for runtime dependencies; current Electron Forge development tooling reports upstream-only advisories separately.

The E2E suite uses `.e2e-workspace`, and live creative tests used temporary directories, so the user’s `projects/demo` changes were not reset or overwritten.
