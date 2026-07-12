---
name: Animator dodge-roll + double-tap input
description: Directional double-tap dodge-roll, strafe-roll facing constraint, i-frame cooldown gating, and the M3/Z keybind repurposing in the Danger Room.
---

# Directional dodge-roll + double-tap input

## Stance-gated roll (the intended control scheme)
Dodge-roll input depends on combat stance for a clear action-vs-explore split:
- **RMB held (combat stance, `this.blocking`)** → a SINGLE A / D tap rolls L / R.
- **free movement** → A / D strafe; DOUBLE-tap A / D rolls.
Gate on `this.blocking` (RMB-held), NOT `this.locked` — `locked` only flips true
when `acquireNearest` finds an enemy, so it would dead-zone the roll when no target
is near; `blocking` is true the whole time RMB is down. The Studio loop drains BOTH
`consumePress` and `consumeDoubleTap` for A and D every frame so a stale tap can't
carry across a stance change.

## Double-tap + single-press detection (input.ts)
Both edges must detect a *fresh* key press (`!keys.has(code)` BEFORE adding to the
set) — OS auto-repeat re-fires keydown while a key is held, so timing raw keydowns
would false-trigger. Fresh presses queue into `pressed` (drained via
`consumePress(code)`) and, when a second fresh press lands inside DOUBLE_TAP_MS,
into `doubleTaps` (drained via `consumeDoubleTap(code)`). Clear `pressed`,
`doubleTaps`, AND the per-key timestamps on pointer-lock loss.

## Strafe-roll facing constraint (the non-obvious one)
**Why:** `Controller.dash(dir, ...)` always sets `wantFacing` toward the dash
direction. A sideways dodge (double-tap A/D → roll left/right) must re-assert
`controller.faceToward(forward, 0)` AFTER calling dash, or the body rotates to face
the travel direction and the L/R dodge clip reads as a forward dive instead of a
sideways roll.
**How to apply:** any lateral/strafe motion that wants to keep the original facing
has to override facing post-dash; dash displacement uses its own `dir` and is
unaffected by the facing override.

## i-frame chaining must be cooldown-gated
**Why:** dodge i-frames (`this.invuln = max(invuln, 0.4)`) without a cooldown let
rapid double-taps chain near-continuous immunity.
**How to apply:** gate behind a re-arm timer (dodge uses 0.6s, mirroring the
existing `pistolDodgeCd` precedent — decrement next to `invuln` in the loop).

## Procedural vs GLB rigs
Directional roll lives on `ExplorerCharacter.rollDir(dir)` and is exposed as an
OPTIONAL `rollDir?` on the `Avatar` interface. Gate the move on
`hasClip("roll") && rollDir` — procedural rigs pass (VERBS has "roll"), GLB rigs
no-op cleanly. Note `hasClip("dodgeL"/"dodgeR")` is FALSE (not in VERBS); the only
directional entry point is `rollDir`, not a clip name.

## Keybind repurposing
KeyZ and KeyT were freed from their motion-attacks. KeyT's motion-attack
(ATTACK3_MOTION) moved to middle mouse (M3, `button===1` with `preventDefault`).
KeyZ now triggers the straight stab (blade-only dash-thrust, sword/knife; see
animator-weapon-class chain). Its old ATTACK2_MOTION const is kept
(noUnusedLocals=false) for reuse. DEFERRED: the M3 contextual
grab/throw vs knock-up + free-follow-up combo layer (conflicts with RMB=hold-block,
GPU-unverifiable) — M3 currently just fires the relocated motion-attack.
