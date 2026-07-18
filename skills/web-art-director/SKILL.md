---
name: web-art-director
description: Redesign or deeply refine an existing HTML/CSS web deliverable, including layout, hierarchy, navigation, icons, components, typography, responsive behavior, and visual language, then verify the result with Playwright before/after screenshots. Use for contextual design edits, complete visual redesigns, and any web request that cannot be represented by brand tokens or copy fields alone.
---

# Web Art Director

Edit the actual deliverable, not a description of the intended change. Preserve accessibility, selection instrumentation, and a working standalone export.

## Workflow

1. Read `web/index.html`, `design-system/tokens.json`, the brand profile, and the selected element context.
2. Inspect the baseline screenshots in `reviews/visual/` when present.
3. Form a clear art-direction hypothesis appropriate to the instruction. Change any HTML/CSS needed: composition, navigation, icons, hierarchy, spacing, type, sections, shapes, or responsive rules.
4. Keep every existing `data-design-id` needed for contextual selection. Add stable IDs to new meaningful elements.
5. Use inline SVG for interface icons. Retain visible text labels and `aria-hidden="true"` on decorative icons.
6. Keep the artifact standalone: no remote runtime dependency, tracking script, or inaccessible local asset path.
7. Run the bundled visual checker after editing. Use the absolute script path supplied by the host. If the Studio host explicitly owns the Playwright transaction for the turn, do not launch a nested checker; the host will render and reject the edit transactionally. In an unpackaged repository checkout, the equivalent command is:

   ```bash
   node ../../skills/web-art-director/scripts/visual-check.mjs --file web/index.html --phase after
   ```

8. Inspect both desktop and mobile screenshots. Correct clipping, overflow, weak contrast, broken hierarchy, or changes that do not visibly satisfy the request. Run the checker again after corrections.
9. Report only files actually changed and describe visible evidence. If no safe implementation is possible, leave the artifact untouched and explain why.

## Guardrails

- Work only inside the active project workspace.
- Do not replace the deliverable with a screenshot or canvas bitmap.
- Do not remove the `design-selection` postMessage bridge.
- Do not claim a cross-format change for a Web-only edit.
- Do not claim completion unless the file changed and the after screenshots render successfully.

Read [references/visual-quality.md](references/visual-quality.md) when making a broad redesign or diagnosing a failed visual comparison.
