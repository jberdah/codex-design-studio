# Verification record

This record describes reproducible evidence for the OpenAI Build Week submission. Claims about packaged platforms are added only after the corresponding artifact has executed natively in CI or on real hardware.

## Source baseline

Verification completed on 19 July 2026 in Europe/Paris with:

- Node.js `22.23.1`;
- npm `10.9.8`;
- project-local Codex CLI `0.144.5`;
- default Codex model `gpt-5.6-sol`;
- Electron `43.1.1`; and
- Playwright `1.55.1`.

Commands:

```bash
npm run check:all
npm run test:electron
```

Results:

- 164 Vitest checks passed;
- 3 opt-in live tests skipped by default;
- 9 Chromium end-to-end journeys passed;
- 1 Electron workspace lifecycle journey passed;
- TypeScript generation and typecheck passed; and
- the standalone Next.js production build passed.

GitHub CI reproduced the source verification on the public repository after merge commit `d6eb4ba`.

## Covered product journeys

The Chromium suite verifies:

1. contextual refinement and review of a selected landing-page element;
2. complete rendering of the three-slide deck;
3. visible accessible navigation icons;
4. comparison and explicit acceptance of a QA-blocked Web candidate;
5. isolated project creation from a reviewed traceable bootstrap brief;
6. non-blocking reference responsibility warnings and manual recovery;
7. slide scene-node editing, keyboard control, undo, and autosaved persistence;
8. flushing pending canvas edits when edit mode closes; and
9. stable inline Web editing preserved after reload.

The Electron journey verifies native workspace selection state, relaunch persistence, and revocation through the context-isolated preload bridge.

## Reference-aware bootstrap evidence

Unit and route tests verify that:

- reference capture happens before synthesis;
- remote instructions are isolated from trusted prompt data;
- observations are bounded and typed;
- Extract and Inspire intent remain distinct;
- raw user wording is preserved alongside transformed creative direction;
- facts, inferences, assumptions, and questions remain inspectable;
- reviewed tokens materially affect the approved project;
- failed or partial capture can be retried or continued manually; and
- approval migrates source graphs, blobs, and captures atomically into the created project.

An opt-in live reference test is available but excluded from the default count because public-site responses and network state are not deterministic.

## Transactional Web evidence

Automated checks cover:

- project-scoped source mutation;
- baseline and candidate rendering;
- responsive overflow and clipping;
- missing assets;
- contrast, including inconclusive gradients/transparency;
- focus order and landmark checks;
- required preview instrumentation;
- immutable candidate persistence;
- explicit acceptance or rejection; and
- rollback when generation or rendering fails.

The host never treats a model summary as proof that a visual change succeeded.

## Packaged desktop evidence

The previously produced macOS x64 package verified the embedded Next.js server, bundled Codex CLI, ChatGPT account visibility, project creation, Web refinement, Playwright rendering, workspace persistence, editable PPTX export, and application relaunch.

That package predates the final reference-aware bootstrap changes and is therefore not the public release candidate. Final x64, Apple Silicon, and Windows package evidence will be recorded here only after their native release workflows pass.

## Known build warning

Next.js currently emits a non-blocking Turbopack/NFT trace warning for dynamic filesystem access originating from the BrandSystem route. The production build succeeds, and desktop runtime preparation copies an explicit allow-list rather than shipping the conservatively traced repository.

## Evidence integrity

- E2E tests use an isolated `.e2e-workspace`.
- Live tests use temporary directories and explicit opt-in environment flags.
- Generated `out/`, `desktop-runtime/`, reports, local source materials, proprietary reference archives, and Brainclaw runtime memory are excluded from Git.
- User modifications in `projects/demo` are not reset or included in release commits.
