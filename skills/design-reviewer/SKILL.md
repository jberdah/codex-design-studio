---
name: design-reviewer
description: Review versioned design artifacts in either exploration or regression mode, with deterministic Web checks, structured critique, approved goldens, and honest validation of exported PowerPoint files. Use before selection, export, release, or after a major refinement.
---

# Design Reviewer

Audit the structured project and its rendered deliverables with deterministic checks first. Report concrete evidence and fixes; do not silently redesign the work.

## Choose the review mode first

- Use an `ExplorationReview` to critique a candidate creative direction. Bind it to the artifact and BrandSystem versions, cite evidence for every finding, and never treat intentional visual divergence as an automatic release failure.
- Use a `RegressionReview` only against a golden baseline created from an approved artifact version. Structural invariants are deterministic gates. A pixel difference is a warning when the new version declares an intentional change; it is an error only when an undeclared change exceeds the approved threshold.

Never blend the two modes: creative taste is not a regression defect.

## Review Order

1. Validate that all color tokens use six-digit hexadecimal values and that required token groups exist.
2. Measure body text against the background. Require at least 4.5:1 for normal text; flag 3:1–4.49:1 as a warning and anything lower as an error.
3. Confirm the landing has a hero, at least three benefits, at least three proof points, and a final call to action.
4. Confirm the deck has exactly three distinct slides: cover, value, and metrics.
5. Flag slide titles over 72 characters, body copy over 180 characters, and bullets over 90 characters as overflow risks.
6. For rendered Web artifacts, measure desktop, tablet, and mobile states for horizontal overflow, clipped meaningful content, broken assets, WCAG text contrast, focus order, primary landmarks, and responsive structure.
   Treat contrast over gradients, images, blending or translucent layers as `warning/inconclusive` until pixel sampling is available; never turn an inferred white background into a blocking error.
7. Compare Web and slide sources against the exact same BrandSystem version and include that version id in every evidence item.
8. Critique hierarchy, brand adherence, content fit, user intent, and cross-artifact consistency. Every claim must cite a screenshot, metric, source locator, structure snapshot, render, or export hash.
9. Create a golden only after artifact approval. Store visual captures alongside structural invariants; later regression runs compare both.
10. Validate the actual exported PPTX buffer, not the browser preview. Prefer LibreOffice rendering at canonical 960 × 540 pt wide-slide dimensions. On macOS, Quick Look may provide honest first-slide evidence. PowerPoint and Keynote automation require explicit user consent and must never be assumed. If no renderer runs, report `structural-only` capability and do not claim pixel validation.

## Reporting

Return checks with stable identifiers, a `pass`, `warning`, or `error` status, an evidence-based message, and an actionable correction when needed. Exploration suggestions do not lower the deterministic score. Calculate legacy project scores from deterministic severity: subtract 25 per error and 8 per warning, with a minimum of zero.

Preserve a portable evidence bundle with the input/version bindings, screenshots, metrics, defects, actual export hash, renderer capability, and exact commands used to reproduce the review.

Call a project ready to ship only when it has no warnings or errors. Distinguish structural correctness from subjective taste; label optional creative suggestions separately rather than lowering the deterministic score.

## Guardrails

- Never claim visual overflow was measured when only copy-length heuristics were run.
- Never claim a PPTX was rendered when only its OOXML package was inspected.
- Never create or replace a golden baseline for an unapproved artifact version.
- Never fail an exploration because its pixels intentionally differ from another direction.
- Never fix project files unless the user explicitly asks for remediation.
- Preserve the reviewer output so results can be compared between versions.
