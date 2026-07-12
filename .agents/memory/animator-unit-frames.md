---
name: Animator unit-frame status HUD
description: Gold-fantasy player/target status frames with animated vitals — theming, target gating, and how to visually verify HUD DOM without WebGL.
---

# Animator unit-frame status HUD

- The Danger Room player/target status frames (`components/hud/UnitFrame.tsx` + `unitFrame.css`, pure stepper in `hud/vitalAnim.ts`) intentionally do NOT reuse the `rpg-vitals` / `rpg-enemy` classes. HUD themes now recolor them via `.studio.hud-themed` class-gated rules at the bottom of `unitFrame.css`: the three `--uf-gold*` chrome vars are re-derived from `--hud-accent` with `color-mix` (one place re-tints every gradient), plate interiors use `--hud-panel-bg`, friendly HP/energy use `--hud-hp`/`--hud-sp`. Hostile HP stays red on purpose (universal enemy signal). Never restyle the ungated defaults.
- The target frame renders only while `hud.selectedTarget` exists, but must force-render in HUD-edit mode (detect via `editBind.className.includes("hud-editable")`) or the panel can't be selected/moved in the editor.
- Key the target `UnitFrame` by the enemy's unique id, NOT its display name — non-boss dummies are named by weapon label and dungeon enemies by shared profile name, so same-name swaps would tween a fake drain across units. The id rides `selectedView()` → `HudSnapshot.selectedTarget.id`.
- Ghost-hold tuning rule: `GHOST_HOLD_S` must exceed real combo hit spacing (~0.5–0.9s = swing clip dur × COMBO_PLAYTHROUGH) because the hold re-arms per hit; too short and the ghost collapses mid-combo so strings never read as accumulated damage. Verified via a deterministic "filmstrip" harness: simulate hit scripts with the pure stepper and render sampled states as static bars (no rAF timing flakiness).
- **Verifying HUD DOM without WebGL:** the screenshot browser cannot create a WebGL context, so Danger Room never boots headless. Instead drop a throwaway `hud-preview.html` + `src/hud-preview.tsx` harness into the artifact root (Vite dev serves any root `.html`), render the components with fake data, screenshot `/hud-preview.html`, then delete both files (they'd fail typecheck/ship otherwise).
