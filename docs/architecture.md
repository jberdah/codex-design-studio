# Architecture

Codex Design Studio is a local-first Next.js application built around one serializable `ProjectData` model. The model—not generated markup—is the source of truth for the brand profile, tokens, landing content, and slide narrative.

```text
Studio UI (React)
    │ HTTP + selection messages
    ▼
Next.js route boundary
    ├── project store ──► JSON/CSS/HTML artifacts
    ├── deterministic reviewer
    ├── PPTX + ZIP exporters
    └── Codex adapter ──► Codex App Server (stdio JSON-RPC)
                              │ structured patch
                              ▼
                       validated semantic update
```

## Runtime boundaries

- The renderer owns interaction and presentation only. The generated landing runs in a sandboxed iframe and emits structured selection context.
- Server routes own persistence, validation, review, and exports.
- The Codex adapter owns process transport and App Server protocol details. Codex runs read-only and returns a strict structured patch; only the host writes project files.
- HTML and PPTX renderers consume the same project and token version. The PowerPoint output uses native text and shapes, so it remains editable.

The desktop application archive supplied during development was used only as a high-level architecture reference. Its process separation reinforced the decision to isolate UI, agent runtime, and heavier jobs behind message boundaries. No source code or assets from that archive are included, and the archive is ignored by Git.

## MVP choices

The original brief suggested FastAPI and SQLite. For the three-day, single-user local MVP, Next.js route handlers and atomic project files remove a second runtime and make the exported source directly inspectable. The route and store boundaries are intentionally narrow, so a future desktop shell, job worker, FastAPI service, or database can replace them without rewriting the Studio UI.

Codex App Server is launched per refinement for fault isolation. A deterministic local fallback keeps the live demo functional when authentication or network access is unavailable. Production evolution would add a long-lived supervised App Server process, queued jobs, streaming progress, multi-project persistence, and authenticated user isolation.

## Security model

- Project IDs and paths are constrained to the project workspace.
- Agent turns use `approvalPolicy: never` and a read-only sandbox.
- The App Server output schema rejects extra properties and constrains semantic fields.
- Project-authored HTML content is escaped.
- Persistence uses atomic JSON replacement.
- The iframe has scripts enabled only for element selection and no same-origin access.
