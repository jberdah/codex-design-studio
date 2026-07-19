# OpenAI Build Week — Devpost submission draft

## Submission fields

- **Project name:** Codex Design Studio
- **Tagline:** One trusted brand direction. Every future asset.
- **Recommended track:** Work and Productivity
- **Repository:** https://github.com/jberdah/codex-design-studio
- **Release:** https://github.com/jberdah/codex-design-studio/releases/tag/v0.1.1
- **Public YouTube demo:** https://youtu.be/aqHBoggxBLY
- **Codex Session ID for `/feedback`:** `019f753a-8158-7d83-96ee-c879df7866ce`
- **Final video file:** `codex-design-studio-build-week-final.mp4`
- **Final video SHA-256:** `0832b4bcedaf50963a716ce4f8d15bda9d442f78b8b9414b96c787782d9fbae1`

## Short description

Codex Design Studio is a local-first desktop workspace that turns scattered brand evidence into a living Design System, then lets GPT-5.6 and Codex create, directly edit, verify, and export production Web, presentation, and visual assets from it.

## Full description

Every new launch asset forces small teams to reconstruct the same brand context: which source is authoritative, what was only inspiration, why a design decision was made, and whether generated output is actually usable. Most AI design tools then stop at a plausible screenshot.

Codex Design Studio starts from explicit intent, source provenance, and human-reviewed evidence. GPT-5.6 reconciles facts, inferences, assumptions, and constraints into a versioned Brand System. Codex acts on the real project: it can edit the actual HTML, CSS, SVG, scene graph, and project files inside a scoped workspace.

The host keeps trust boundaries clear. It snapshots the active artifact, renders responsive before/after evidence, checks instrumentation, overflow, clipping, assets, contrast, focus order, and landmarks, and keeps a proposal separate when a conservative check needs review. The user—not the model—accepts, rejects, or restores the result.

The same governed system powers directly editable Web canvases, editable presentation scenes, versioned visual assets, responsive landing-page ZIPs, design-token JSON, and editable PowerPoint exports. Projects remain portable and local by default, while authentication uses official Codex App Server account flows.

The Build Week submission includes a public MIT repository, reproducible tests, and native unsigned packages for macOS Intel, macOS Apple Silicon, and Windows x64.

## How GPT-5.6 and Codex were used

GPT-5.6 performs evidence reconciliation, strategic brief synthesis, cross-format creative reasoning, composition-level design direction, and structured visual planning. Codex App Server supplies authenticated, resumable agent execution: it inspects the scoped project, invokes project-local skills, and edits real artifacts.

During Build Week, Codex also helped challenge the product requirements, design the local-first architecture and trust model, implement the Next.js/Electron/TypeScript/Playwright stack, write tests, diagnose rendered failures, package the native runtimes, and maintain plans and handoffs through Brainclaw. The human product owner defined the problem, creative direction, safety boundaries, and final acceptance decisions.

## Judge testing path

1. Open the latest GitHub Release and download the package for the test machine.
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
