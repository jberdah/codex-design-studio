# Portable workspace format

Codex Design Studio never uses a renderer-provided path as filesystem authority. A workspace becomes authorized only after the Electron main process receives it from the operating-system folder picker and records an opaque grant in Electron `userData`.

## On-disk contract

A selected folder remains user-owned and portable. Studio adds only its ownership marker and project content:

```text
Selected folder/
├── .codex-design-studio-workspace.json
├── projects/
│   └── <project-id>/
│       ├── project.json
│       ├── brand/
│       ├── design-system/
│       ├── web/
│       ├── slides/
│       ├── reviews/
│       ├── exports/
│       └── history/
└── any pre-existing user files, including .git/, untouched
```

The version 1 marker is deliberately portable and contains no local path, bookmark, credential, account data, or secret:

```json
{
  "owner": "com.codexdesignstudio.workspace",
  "schemaVersion": 1,
  "workspaceId": "b6d6c4b7-2f66-4f1f-9a91-bcad370e44f8",
  "createdAt": "2026-07-18T12:00:00.000Z"
}
```

`owner`, `schemaVersion`, and the UUID-shaped `workspaceId` are mandatory. An existing marker with a different owner, unknown version, or invalid ID is rejected rather than overwritten. Future marker migrations must be explicit, monotonic, preserve user files, and use atomic replacement; a newer unknown version must fail closed.

## Private registry

`userData/workspace-registry.json` is schema version 1. It stores opaque renderer-facing IDs, display names, last-opened timestamps, canonical local paths, marker IDs, and optional platform security-scoped bookmarks. It never lives in the portable folder. The preload API returns only opaque IDs and display metadata; it never returns paths or bookmarks.

Registry schema 0 (`entries` and `activeId`) migrates to schema 1 (`workspaces` and `activeWorkspaceId`) on the next write. Unknown newer schemas fail closed. Revocation clears both the canonical path and platform grant, removes active status, and makes the opaque ID unusable.

## Opening, switching, and relinking

The main process canonicalizes the picker result with `realpath`, validates the marker, and records the platform grant. Opening a recent workspace accepts only an opaque registry ID. Relinking prompts with the native picker again and succeeds only when the selected folder carries the original marker ID. This permits moved or renamed folders without allowing a renderer to substitute an arbitrary absolute path.

Each switch stops the embedded server, starts it again with exactly one canonical `CODEX_STUDIO_DATA_DIR` and expected marker ID, then reloads the renderer. Every project-store operation, export, visual worker, and Codex turn resolves beneath that root. The server rejects traversal, absolute route-derived paths, invalid project IDs, and existing or partially missing paths whose realpath escapes through a symlink.

## Legacy migration and recovery

When a folder is first selected, projects from the former `userData/workspace/projects` layout are copied into its `projects/` directory. Copying is non-destructive: an existing destination project is reported as `destination-exists` and never overwritten, symlink entries are ignored, and all unrelated files in an empty folder or existing repository are preserved.

If a recent workspace is unavailable, the registry reports it as missing without exposing its former path to the renderer. The user can relink it through the native picker. Ownership mismatch, unsupported schemas, unavailable roots, and per-project migration outcomes are surfaced as recovery diagnostics; the original files remain untouched.
