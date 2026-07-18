# Contributing

Thanks for helping improve Codex Design Studio.

## Development setup

1. Install Node.js using the version in `.nvmrc` and npm 10 or newer.
2. Run `npm ci`.
3. Install Chromium with `PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium`.
4. Run `npm run preflight` and `npm run dev`.

Use synthetic project data. Never commit credentials, local workspaces,
customer material, generated exports, or review evidence.

## Before opening a pull request

Run the complete Web verification chain:

```bash
npm run check:all
```

For desktop changes, also package and exercise the real Electron application:

```bash
npm run desktop:package
CODEX_STUDIO_PACKAGED_APP="$PWD/out/Codex Design Studio-darwin-x64/Codex Design Studio.app/Contents/MacOS/codex-design-studio" npm run test:electron
```

Keep pull requests focused, explain user impact and security implications, and
include visual evidence when changing rendered artifacts.
