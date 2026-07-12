---
name: Animator locomotion blend
description: How @workspace/animator mixes idle/walk/run alongside its single-clip crossfade SM, and the ownership handoff rules.
---

The Animator is a single-active-clip crossfade state machine. A weight-blended
locomotion layer (`LocomotionBlend`) sits ALONGSIDE it — the two never drive the
same pose at once.

- **Blend drives locomotion**; the single-clip path drives one-shots (attack/
  roll/jump/land/die) and rooted holds (block / aim-still / crouch-still). Holds
  only override the blend when the equipped class actually ships that clip
  (`holdClip()`), so motion-light packs fall through to the blend.
- **Stride sync, not crossfade:** walk+run share ONE normalized phase. Stride
  clips get `effectiveTimeScale(0)` + manual `action.time = phase*duration` each
  frame; idle plays free at timeScale 1. This is what kills foot-slide — do NOT
  "simplify" it back to crossfading clips of different length.

**Why the handoff is the fragile part:** the blend and the crossfade both want to
own an action's weight. Rules that keep it conflict-free:
- Any single-clip activation calls `beginSingle()` FIRST → `collapseToDominant()`
  stops all blend clips except the heaviest, restores that one to weight 1 +
  natural time, and clears the blend. The new clip then `crossFadeFrom`s a single
  stable `current`.
- On single→blend re-entry the old `current` is `fadeOut`'d while blend weights
  ease in. When the blend re-acquires a cached action, DON'T `reset()` it if it's
  still running (`isRunning()`), or the idle loop pops.
- While a one-shot is active (`once` set) the blend is NOT updated — no mid-
  crossfade reacquisition churn.

**`MoveInput.running` is advisory now** — tiering is speed-driven (idle/walk/run
control points in `LocomotionBlend`). The engine must push `speed` into the run
range to read as running; `running` alone won't force the run clip.

**Crouch** is state-only + clip-where-it-exists: only the rifle pack ships a
crouch clip (`idle-crouching` → `crouchIdle`). Crouch suppresses run weight +
slows cadence in the blend; ExplorerGame also scales translation
(`CONFIG.move.crouchFactor`) so foot speed matches. Other classes fall back to
normal idle/walk (no crouch clip), reading as a slow sneak.
