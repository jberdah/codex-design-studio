# Judge testing instructions

## Recommended path

1. Open the [latest GitHub Release](https://github.com/jberdah/codex-design-studio/releases/latest).
2. Download the package matching the test machine:
   - macOS Intel: `Codex-Design-Studio-0.1.1-darwin-x64.dmg`;
   - macOS Apple Silicon: `Codex-Design-Studio-0.1.1-darwin-arm64.dmg`;
   - Windows x64: `Codex-Design-Studio-0.1.1-win32-x64-Setup.exe`.
3. Verify the matching entry in `SHA256SUMS-<platform>-<architecture>.txt`.
4. Open Codex Design Studio and choose or create an empty local workspace folder.
5. Connect a ChatGPT/Codex account from the account control. Project credentials are not stored in the workspace.
6. Create a project from a short brand direction and optionally add a reference URL with **Inspire** intent.
7. Review and approve the synthesized brief, then select an element in the Web preview.
8. Request a visual change, inspect the candidate and responsive QA evidence, and explicitly accept or reject it.
9. Open the editable presentation and export the HTML ZIP or PowerPoint deck.

Expected time: approximately five minutes after download.

On macOS, place the installer and checksum file in the same folder and run:

```bash
shasum -a 256 -c SHA256SUMS-darwin-arm64.txt
```

Use `darwin-x64` instead on an Intel Mac. On Windows, run `Get-FileHash` in PowerShell and compare its output with `SHA256SUMS-win32-x64.txt`:

```powershell
Get-FileHash .\Codex-Design-Studio-0.1.1-win32-x64-Setup.exe -Algorithm SHA256
```

## Unsigned-build notice

The Build Week release may be unsigned because signing credentials are not stored in the repository or CI configuration.

- On macOS, use **Control-click → Open** if Gatekeeper blocks the first launch.
- On Windows, choose **More info → Run anyway** only after verifying the checksum and GitHub repository origin.

## Development fallback

If the native package is unavailable, run the source build:

```bash
npm install
npm run preflight
npm run dev
```

Open <http://127.0.0.1:3000>.

## Known limitations

- live model and image operations require a connected OpenAI account;
- the deterministic test/demo path works without a live model request;
- the application is local-first and single-user;
- packages may be unsigned and are not yet auto-updating;
- repository and collaboration capabilities are optional and capability-declared rather than a hosted sync service.
