# Verification record

Final local verification was completed on 18 July 2026 in Europe/Paris.

## Environment

- Node.js `22.23.1`
- npm `10.9.8`
- project-local Codex CLI `0.144.5`
- Codex model `gpt-5.6-sol`
- authentication: ChatGPT login, confirmed by `npm run preflight`

## Codex App Server evidence

`npm run test:agent` completed two live structured refinements through the App Server and confirmed that the second turn resumed the first thread.

- source: `codex`
- thread ID: `019f753a-8158-7d83-96ee-c879df7866ce`
- resumed: `true`
- final result: shared visual direction updated and propagated to web and slides

The smoke script restores the reference project after completion, so this durable record intentionally lives outside mutable demo data.

## Automated evidence

`npm run check:all` passed from the workspace and after a clean local clone with `npm ci`:

- TypeScript route generation and strict typecheck
- 12 Vitest checks across refinement, review, rendering, path boundaries, App Server output parsing, and editable PPTX generation
- Next.js 16 production build with all application and API routes
- 2 Chromium journeys covering contextual iframe selection, deterministic refinement, propagation, 100/100 review, and the complete three-slide deck
- `npm audit`: 0 known vulnerabilities
- both Codex skills: valid according to the Codex skill validator

Git commits `f5df12a` and `f9e402d` preserve the implementation and reproducibility checkpoints. The proprietary desktop reference archive is excluded from Git and no source or assets from it are included.
