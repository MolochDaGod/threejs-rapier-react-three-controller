---
name: Animator global tooltip layer
description: App-wide data-tip tooltip system — use it instead of native title=
---

The Animator has one global tooltip layer (`TipLayer`, mounted once by the
AppShell) that renders a styled tooltip for ANY element carrying a
`data-tip="…"` attribute.

**Rule:** for user-facing hover hints in the Animator, use `data-tip`, not the
native `title=` attribute.

**Why:** native `title` has a ~1s browser delay, unstyled rendering, and never
shows on touch devices. The global layer gives a consistent styled tooltip with
a short hover delay, long-press support on touch (release still delivers the
tap), and keyboard focus support (`:focus-visible`-gated so mouse clicks don't
double-trigger).

**How to apply:** just add `data-tip="text"` to the element — no imports, no
wrapper components. Keep `aria-label` on icon-only/blank controls (e.g. color
swatches) since `data-tip` is not exposed to screen readers. The layer is
capture-phase document listeners + `pointer-events: none`, so it can never
steal input from gameplay UI; it hides on click, scroll, resize, blur, Esc.
