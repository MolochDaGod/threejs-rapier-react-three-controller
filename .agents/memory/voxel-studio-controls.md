---
name: Voxel Studio control/camera feel
description: Intentional Studio control choices (Q=swap mode, absorb in all modes, TPS camera deadband) that look like bugs but are deliberate — don't naively revert.
---

# Voxel Studio (Game Studio) control + camera feel

These are deliberate design choices made after the user complained the controls/camera
felt "ugly". A future agent might "tidy" them back into a regression — don't.

- **`KeyQ` = swap Build/Play mode**, globally (works in both modes). It is wired as an
  always-mounted window keydown in `Workspace` (routed through a ref so it never goes
  stale), NOT through the rebindable keybinds. `KeyQ` is in `RESERVED_KEYS` so it can
  never be bound to an action and an old save's `drop:"KeyQ"` is dropped on load.
  - **Why:** user asked for Q to swap mode, not drop.
- **Drop moved off Q → default `KeyB`** (rebindable). Old saves auto-migrate because
  `mergeKeybinds` ignores reserved codes and falls back to the default.
- **"Absorb" works in EVERY mode, not just play.** Build-mode block breaks
  (`BlockEditor.onAbsorb`) add the broken block's item to the session inventory, and
  `ItemDropSystem.enabled` is forced `true` in build mode too (so dropped items vacuum
  up while building). Do not re-gate pickup/absorb to play-only.
  - **Why:** user explicitly wants to mine/collect blocks + items while building.
- **Third-person orbit distance uses a deadband** (`TP_DISTANCE_DEADBAND` in
  `Controls.ts`): target changes smaller than it are ignored so the camera stops
  micro-zooming every frame as the collision probe grazes nearby geometry while you
  look around. Pull-in rate was also softened (26→22).
  - **Why:** the constant in/out creep is what the user described as the camera
    "zooming around" / feeling jank. Keep the deadband; tune its size rather than
    removing it. Camera *feel* is unverifiable in the sandbox (no WebGL, Puter gate
    blocks screenshots) — changes here need the user to confirm on screen.
