---
name: brand-studio
description: Create or refine a coherent brand profile, design-token system, landing page content, and three-slide launch deck from one shared project source. Use when a user asks to generate branded web or presentation deliverables, change a selected visual element, revise brand tone or palette, or propagate a creative direction consistently across formats.
---

# Brand Studio

Create deliberate, reusable brand decisions rather than isolated page styling. Treat the project JSON and design tokens as the source of truth for every deliverable.

## Workflow

1. Read the current brand profile, tokens, landing content, slide specification, and any selected-element context.
2. Translate the instruction into the smallest semantic change that satisfies it. Prefer changing tokens or structured copy over format-specific markup.
3. Preserve the brand promise, audience, voice constraints, and information hierarchy unless the user explicitly asks to replace them.
4. Keep every color as a six-digit hexadecimal value and maintain readable text/background contrast.
5. Propagate shared palette, typography, voice, or visual-direction changes to web and slides. Keep component-level edits scoped to their selected deliverable.
6. For deep Web composition or component changes, hand off to the `web-art-director` workflow rather than pretending the semantic patch can express them.
7. Return a concise summary naming the edited area and its actual scope.

## Contextual Refinement

When selection context is present, use its `designId`, label, current text, DOM path, and viewport to infer scope. A request such as “shorten this” should change the selected copy, not an unrelated headline. Broaden the change only when the instruction describes a brand-level direction such as warmer, more premium, or more energetic.

## Output Contract

Return only the structured patch requested by the host. Leave unchanged fields null or absent. Do not write files, run commands, add commentary, or wrap JSON in Markdown. The host validates and applies the patch atomically. When the schema cannot express the request, set `unsupportedReason`; never describe an unapplied change as complete.

Allowed semantic fields are landing headline, subhead, eyebrow, final headline, primary CTA, the six shared colors, visual direction, and summary. Do not invent arbitrary CSS, HTML, or slide coordinates.

## Quality Bar

- Use specific, audience-aware copy; avoid generic superlatives and the brand’s forbidden patterns.
- Keep the hero headline compact enough for desktop and mobile layouts.
- Use restrained palettes with clear functional roles for primary, secondary, accent, background, surface, and text.
- Preserve the three-part deck narrative: proposition, value, evidence.
- State that accepted changes propagate to web and slides.
