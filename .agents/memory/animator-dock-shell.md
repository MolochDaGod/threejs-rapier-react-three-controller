---
name: Animator dock shell + menubar
description: Reusable dockable-panel framework (components/dock) and how existing panels were hosted in it without rewrites; how the Danger Room dock became the single source of truth for panel visibility.
---

# Animator dock shell (components/dock/)

A reusable Unity-style panel system: `useDockLayout(storageKey, metas)` owns a
persisted `DockLayout` (zones left/right/bottom + floating windows + hidden) and
returns imperative `DockControls`. `DockSurface` renders it; `ToolMenubar`/`Tip`
render the grouped-dropdown top bar over radix. Themed via `dock.css` (`--dk-*`).

## Hosting an EXISTING panel without a rewrite — the `chrome` flag

Each legacy overlay panel (AdminPanel/EditorPanel/AnimationsPanel) got a
`chrome?: boolean` (default `true`). When `chrome` is false the panel extracts its
sections into a `body` fragment and `return body` — no `.panel` wrapper, head, close
`.x`, or hint. So the SAME component renders standalone (chrome=true) or inside a
dock tab (chrome=false). Wrap the chrome-less body in `.dock-pad` because the bare
`.panel-section`s have no horizontal padding of their own.

**Why:** lets you dock pre-existing panels without forking their markup.
**How to apply:** add `chrome` flag, guard `if (chrome && !open) return null` at top,
build `body`, then `if (!chrome) return body` before the chromed return.

## Dock layout as the single source of truth for visibility

The Danger Room used to track three booleans (adminOpen/editorOpen/animOpen). Those
were DELETED — visibility now derives from `dangerDock.isVisible(id)` and
`panelsOpen` is computed from it. Hotkeys, the Panels menu, and tab-close all go
through one `toggleDangerPanel(id)` helper that reproduces the old side effects:
check `isVisible` BEFORE toggling, and only when surfacing a panel call
`document.exitPointerLock?.()` (+ `refreshAnim()` for the clips panel).

**Why:** two sources (booleans + dock) desync; the dock must win so tab-share /
pop-out / persisted layout stay authoritative.
**How to apply:** never reintroduce per-panel open booleans alongside a dock; read
`isVisible`, and put show-time side effects in the toggle helper, gated on the
pre-toggle visibility (isVisible reads the current layoutRef, so call it first).

Hotkeys: `` ` ``=admin, E=editor (only when NOT pointer-locked; in-game E is block),
C=clips. Add the toggle helper to the keydown effect deps (it's a stable useCallback).

## Dock zones must own pointer-events when hosted in a pointer-events:none overlay

The Dressing Room (`EditorMode`) nests `DockSurface` inside `.ed-root` which is
`pointer-events:none` (only nested `button/input/select` re-enable to `auto`). Tab
*switching* fires on a `<div className="dock-tab">` (pointer-down → setActive), so a
docked div inherits `none` and tab-clicks silently die — while close/collapse/panel
`<button>`s still work. Symptom: "right tabs aren't clickable" (left zone has one tab
so nobody notices). Fix: `.dock-zone`/`.dock-float` set `pointer-events:auto`
themselves. The Danger Room never hit this — it hosts the dock directly under
`TipProvider`, not inside `.ed-root`.

**Why:** the shared dock can be dropped into either an interactive or a
pass-through overlay; it must not depend on the host's pointer-events.
**How to apply:** keep `pointer-events:auto` on dock containers; never rely on a
host wrapper to enable clicks for non-button dock chrome.
