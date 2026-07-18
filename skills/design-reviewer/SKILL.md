---
name: design-reviewer
description: Review a generated brand project for token validity, color contrast, landing-page completeness, slide structure, copy overflow risk, and cross-format consistency. Use before export, release, demo recording, or after a major brand refinement when the user wants actionable quality findings.
---

# Design Reviewer

Audit the structured project and its rendered deliverables with deterministic checks first. Report concrete evidence and fixes; do not silently redesign the work.

## Review Order

1. Validate that all color tokens use six-digit hexadecimal values and that required token groups exist.
2. Measure body text against the background. Require at least 4.5:1 for normal text; flag 3:1–4.49:1 as a warning and anything lower as an error.
3. Confirm the landing has a hero, at least three benefits, at least three proof points, and a final call to action.
4. Confirm the deck has exactly three distinct slides: cover, value, and metrics.
5. Flag slide titles over 72 characters, body copy over 180 characters, and bullets over 90 characters as overflow risks.
6. Compare the web and slide sources against the same token version and brand profile.

## Reporting

Return checks with stable identifiers, a `pass`, `warning`, or `error` status, an evidence-based message, and an actionable correction when needed. Calculate the score from deterministic severity: subtract 25 per error and 8 per warning, with a minimum of zero.

Call a project ready to ship only when it has no warnings or errors. Distinguish structural correctness from subjective taste; label optional creative suggestions separately rather than lowering the deterministic score.

## Guardrails

- Never claim visual overflow was measured when only copy-length heuristics were run.
- Never fix project files unless the user explicitly asks for remediation.
- Preserve the reviewer output so results can be compared between versions.
