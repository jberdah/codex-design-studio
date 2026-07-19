# Demo video production

Generate a credential-free, deterministic walkthrough with:

```bash
npm run media:demo-video
```

The command records the real local interface at 1920×1080 and writes
`codex-design-studio-demo-draft.webm` here. The binary is intentionally ignored
by Git. The approved English voice-over is in `demo-narration.txt`, and the
matching burned-in caption timeline is in `demo-captions.srt`. The reviewed
H.264/AAC cut is named `codex-design-studio-build-week-final.mp4`; upload it
publicly to YouTube for Devpost.

This draft demonstrates project bootstrap, the versioned Design System, a
transactional Codex proposal, review evidence, and editable slides. It contains
no live model call, account email, credentials, or third-party reference asset.
Use [`docs/demo-script.md`](../../docs/demo-script.md) for the narrated final
take and keep its duration below three minutes.
