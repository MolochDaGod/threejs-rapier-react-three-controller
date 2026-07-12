---
name: Animator Danger Room HUD editor
description: How the additive 2D HUD-layer editor (themes + move/scale/hide panels) stays non-regressive over the stock Danger Room HUD.
---

# Danger Room 2D UI-layer editor

A toggleable overlay (Danger Room "Panels" menu → "Edit HUD") that lets the user
move/scale/hide the existing HUD panels (vitals, action bar, combat stats, enemy
panel, status notifier, reticle) and pick a theme preset
(default/cyberpunk/rpg/fantasy/tactical). Layout + theme persist to localStorage.

It also owns HUD *layouts*: `config.layout` is `"classic"` (stock bottom bar,
default) or `"tight"` — a single Diablo-style bottom bar (panel id `tightbar`)
built from PSD art (`attached_assets/hud_tight_bar_processed.png`, art space
3800×726): HP orb left, 3×2 slot grid, avatar arch, 3×2 grid, stamina orb
right, poise strip under the arch. Overlay geometry is percentage constants
(`TB_*` in Hud.tsx) scanline-measured off the art — measure cell interiors
programmatically (dark-run detection), don't eyeball crops. The retired
`quickLeft`/`quickRight` panel ids are dropped automatically by `mergeConfig`
(only known `HUD_PANEL_IDS` materialize). Slot bindings live in
`config.quickSlots` (12 × `QuickActionId | null`); the pure catalog + clamp is
`src/hud/quickActions.ts` (type-only icon import so it stays DOM-free). The
tight layout only replaces the ON-FOOT bar — the mech cockpit keeps its bespoke
bottom bar while piloting. App.tsx adds a `hud-tight` class on `.studio` when
the tight layout is active; the fantasy iron reskin of the floating target
frames (`.tframe`) is gated under `.studio.hud-tight` (base `.tframe` CSS is
byte-identical to the old inline styles). Touch layout hides `.tightbar`.
Adding a layout = extend `HudLayoutId` + `HUD_LAYOUTS`
meta; unknown persisted layouts fall back to classic in `mergeConfig`.

## The non-regression rule (load-bearing)

The editor is purely additive — the stock HUD must render byte-identically when
the theme is `default` and all panel offsets are 0/0/1.

- **Theme styling is class-gated, not value-gated.** Theme-consuming CSS lives
  under `.studio.hud-themed ...`; the `hud-themed` class is only added to the
  `.studio` root when `config.theme !== "default"`. So default = no class = zero
  overrides = stock look. Do NOT instead try to make `DEFAULT_VARS` exactly equal
  the old hardcoded values and apply them always — that silently drifts (e.g.
  crosshair `#6fe0ff` vs accent `#4fc3ff`, vitals-name `#eaf3ff` vs text
  `#dbe7ff`) and breaks parity.
- **Layout transform vars are always applied** (`--hud-dx/--hud-dy/--hud-scale`
  with 0/0/1 fallbacks) so persisted offsets show outside edit mode too; identity
  transform is visually a no-op.

**Why:** an earlier pass applied theme vars on `.studio` unconditionally and
overrode crosshair/text/accent colors for the default theme, regressing the
shipped look. Code review (architect) caught it.

## Reticle visibility gotcha

`Crosshair`/`StatusBar` receive an `editBind` ALWAYS (so persisted layout applies
in normal play). Visibility must stay gated on the real `visible` prop — only
force-render while *editing*. Detect editing via
`editBind.className.includes("hud-editable")` (bind only adds that class when
editing). Gating on `editBind` existence alone leaves the reticle on when panels
are open.

## Wiring

- Pure model: `src/hud/hudThemes.ts` (CSS-var maps) + `src/hud/hudConfig.ts`
  (clamp/merge/load/save, hostile-data safe). Unit-tested (pure, no DOM).
- State hook: `src/hud/useHudEditor.ts` — `bind(id)` returns
  data-attr + className + inline `--hud-*` layout vars + pointerdown(drag)/
  contextmenu(select). `api(editing)` is what HUD components consume.
- UI rail: `src/components/hud/HudEditor.tsx` + a full-screen `.hud-edit-catcher`
  that swallows canvas clicks so the engine never grabs pointer-lock while editing.
- animator forbids runtime `@workspace/*` imports — this feature uses none.
