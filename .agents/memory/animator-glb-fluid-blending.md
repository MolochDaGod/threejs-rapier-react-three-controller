---
name: Animator GLB fluid blending, snippets & shield VFX
description: Bringing the explorer rig's fluid-animation patterns (weight-blend loco, additive overlay, snippet sub-clips) to the standard GLB Character path, plus one-shield-per-block VFX synced to SFX.
---

# GLB Character fluid animation parity with the explorer rig

The bespoke `explorer/` rig long had weight-blended locomotion, an upper-body
additive attack overlay, and fraction-sliced snippet sub-clips. The standard
skinned-GLB `Character` path only had a single-active-clip state machine. These
were ported onto `Character` so GLB rigs feel as fluid as the explorer.

## Blend vs single-clip ownership (the recurring hazard)

`Character` now runs a `LocomotionBlend` (idle/walk/run weight blend) ALONGSIDE
the single-clip crossfade machine — same dual-system design as the explorer.

- `beginSingle()` is the collapse-to-dominant handoff: it must run BEFORE a
  one-shot crossfade so the blend hands off cleanly instead of fighting it.
- `playClipOnce` clears any overlay AND calls `beginSingle()` first.
- `update()` only lets the blend drive when `blendDrives` (i.e. NOT during a
  one-shot). After a one-shot ends, the blend re-acquires — so do not blindly
  `fadeIn` the current clip when the blend is active or you double-own weight.

**Why:** weight-ownership conflicts between a weight-blend group and a
crossfade machine are the classic source of T-pose flickers and stuck poses
(see `animator-locomotion-blend.md` for the explorer's original version).

## Upper-body additive overlay must NOT set the one-shot flag

`playClipOverlay(name, intensity)` plays a swing as an upper-body-only ADDITIVE
action (filtered via shared `isUpperBodyTrack`, `AdditiveAnimationBlendMode`,
cached in `additiveActions`, auto-fades on `elapsed`/OVERLAY consts) so the legs
keep their locomotion blend.

**Critical:** the overlay path must NOT raise the one-shot/`isOneShotActive`
flag. `Controller` suppresses WASD/locomotion while a rooted one-shot plays, so
if the overlay set that flag the "moving swing" would freeze the legs — exactly
what the overlay exists to avoid. `Studio.doComboHit` only takes the overlay
branch when the player is moving on the ground and `playClipOverlay` exists;
otherwise it falls back to the full-body one-shot (rooted swings unchanged).

## Snippets: AnimationUtils.subclip is end-exclusive

`snippets.ts` `sliceClipFraction(parent, from, to, name, fps?)` slices a parent
native clip into a named playable action by fraction. It wraps
`THREE.AnimationUtils.subclip`, which keeps frames `< endFrame` (END-EXCLUSIVE) —
so a slice is up to one frame short of the requested duration. Unit-test
assertions on slice duration must allow ~1 frame of slop (precision 1, not 2),
not treat it as a bug.

## One shield per block, synced to the block SFX

The block/parry force-field VFX (`vfx.forceField`, wrapped as `blockShield`) is
now fired at each block-SFX site (onPlayerHit perfectParry/deflect/blockStop and
in `playPlayerDefenseReaction`) so the shield flashes exactly with the sound.
The old `forceField` call inside `resolveOpponentStrike`'s big-block branch was
REMOVED (its `applyImpulse` bounce stays) — otherwise a single guarded exchange
spawned two shields (one from resolveOpponentStrike, one from the reaction).

**Why:** resolveOpponentStrike and playPlayerDefenseReaction both run per
player-defended hit; consolidating to the SFX sites guarantees one shield in
sync with one sound.
