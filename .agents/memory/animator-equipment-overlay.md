---
name: Animator in-play loadout overlay
description: How live weapon-swap UI is wired during gameplay (play + danger) and the keyboard-guard gotcha.
---

# In-play Loadout (EquipmentScreen)

A presentational modal (`src/components/EquipmentScreen.tsx`) lets players swap the
active weapon LIVE mid-session, instead of only in the Dressing Room. It consumes
the existing arsenal API (`WEAPONS` / `WEAPON_ICON` / `Icon`) and equips via the
already-existing `App.onWeapon -> studio.setWeapon` path — additive, no arsenal
model changes. It is framed as a modular "loadout": Main Hand is the only live slot;
Off-Hand/Armor/Trinket are intentional teaser slots seeding a future modular system.

## Wiring rules (App.tsx)

- Overlay open state is `equipOpen` + a render-synced `equipOpenRef`. The two global
  keydown handlers (one per mode: `play`, `danger`) read the **ref**, not the state,
  to avoid stale closures.
- **Gotcha (cost a review cycle):** the keydown handlers early-return on
  `INPUT`/`TEXTAREA` targets. The overlay's search box is `autoFocus`, so any key that
  must work *while it's focused* (here: `Esc` to close) MUST be handled BEFORE that
  input guard. `KeyI` (toggle) stays AFTER the guard on purpose, so typing "i" in the
  search box types a letter instead of closing.
- Reset `equipOpen` on every `mode` change (`useEffect([mode])`) so the overlay never
  carries across surfaces.
- Fold `equipOpen` into crosshair `visible`, the `immersive` canvas class, and the
  click-hint visibility so HUD/cursor states stay consistent while it's open.

## Verifying visuals (animator preview is infra-blocked)

The `artifacts/animator: web` workflow harness kills vite right after "ready", so
app_preview/screenshot of the animator is impossible. Verify animator UI visually by
mirroring the component as a self-contained mockup under
`artifacts/mockup-sandbox/src/components/mockups/<lab>/` (stub the Icon + sample data,
copy the CSS) and screenshotting `/__mockup/preview/<lab>/<Component>`. Logic/types
are verified by `pnpm --filter @workspace/animator-app run typecheck`.
