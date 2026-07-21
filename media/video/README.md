# Build Week demo video

**Current public cut:** https://youtu.be/UNe7df9nIf4

The 2:49 public cut is recorded from the real local interface. The final MP4 is
intentionally ignored; the reproducible walkthrough source is kept here.

## Re-recording the walkthrough

```bash
npm run media:bootstrap-demo
```

The command records a dedicated local project at 1920×1080 and writes an
ignored draft WebM. It uses a public reference as reviewable evidence only,
adds the owned Codex Design Studio icon as a source, publishes the Design
System, creates visual directions, edits the Web artifact, runs its candidate
review, and opens the connected presentation and export controls.

## Narration and visual sources

- [`build-week-extended-narration.txt`](build-week-extended-narration.txt)
  contains the English voice-over copy;
- [`brand-assets/`](brand-assets/) contains the owned visual directions shown
  in the walkthrough; and
- [`../../scripts/generate-openai-audio.mjs`](../../scripts/generate-openai-audio.mjs)
  reproduces the OpenAI text-to-speech step when `OPENAI_API_KEY` is available.

The production WAV and MP4 are ignored. The uploaded file is
`codex-design-studio-build-week-extended-disclosed.mp4`; it displays
`Voice-over is AI-generated (OpenAI)` from 0:00:00.7 to 0:00:05.5.

Use [`../../docs/demo-script.md`](../../docs/demo-script.md) for the final
timeline, content boundaries, and publication checklist.
