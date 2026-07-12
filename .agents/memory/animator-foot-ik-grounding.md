---
name: Animator foot-to-ground IK wiring
description: How the post-mixer foot-IK pass is activated at runtime + the navmesh→sampler boundary
---

# Foot-to-ground IK activation

Foot IK is **off by default** so the flat Danger Room (Y=0) feel is untouched; a
library-only solver with no callsite is incomplete (code review will reject it).
It is enabled only on real uneven terrain (dungeon mode).

**Why:** the grounder is a post-mixer bone override; running it on flat ground
would be a behaviour change for no benefit, and an unwired solver does nothing.

**How to apply:**
- The grounder lives in `src/three/anim/legIk.ts` (`FootGrounder`), driven by a
  pure two-bone solver. Skinned rigs (`Character`, `GrudgeAvatar`) own one and
  forward `setFootIk`/`setGroundSampler`; procedural rigs omit the optional
  `Avatar.setFootIk?/setGroundSampler?` methods and no-op.
- `apply(dt)` runs LAST in the documented per-frame post-mixer override order
  (after `mixer.update`, after any additive overlay / arm-width pass). The dt is
  needed for the smoothed leg/pelvis-drop lerp.
- The sampler returns `{y, normal}`; a **non-finite y means off-ground** → the
  grounder no-ops that foot (don't snap to a flat fallback at a cliff edge).
- `navmesh.ts` is deliberately THREE-free: `groundProbeAt` returns plain
  `{y,nx,ny,nz,hit}` with a central-difference normal (wall-edge neighbours fall
  back to centre height = reads flat, not a cliff). The `THREE.Vector3` adapter
  (`makeNavGroundSampler`) lives in `Studio.ts`, not in navmesh.
- Studio wiring: `enterDungeon` builds the sampler from `dungeon.nav` + enables;
  `exitDungeon` clears + disables; `spawnCharacter` re-arms if mid-dungeon (the
  sampler outlives character swaps).
- Priming: `setEnabled(true)` and `setGroundSampler` both reset `primed=false`
  so the first frame snaps to the live ground instead of lerping from a stale /
  different world.

## Pelvis-drop must be undone PRE-mixer, not reconciled post-mixer

A post-mixer bone mutation that the active clip does not re-write every frame
(the grudge/hero clips are **rotation-only** — 0 pelvis translation tracks) will
compound. The robust cure is `beginFrame()`: restore the pelvis to a bind-time
captured local (`pelvisBindLocal`) **immediately before `mixer.update`**, then let
`apply()` drop absolutely from the clean post-mixer pose. Call `beginFrame()`
in every avatar's `update()` right before its mixer.

**Why:** a post-mixer heuristic that tries to detect "did the mixer reset the
pelvis?" is fragile and does NOT fix the clip-boundary case: three.js
`AnimationMixer` saves a clip's **original state** when it starts and restores it
when it finishes. If a one-shot (KeyG evade, an idle variant) starts while the
pelvis is already dropped, the mixer captures the *dropped* pose as "original"
and restores it on finish → one extra drop leaks per clip cycle → cumulative
sink + leg-IK folds the leg to the torso. Restoring bind-local before the mixer
means the mixer always saves/restores a clean base, killing the leak at the
source. Two earlier attempts using a post-mixer reconcile only reduced it.

**How to apply:** any new avatar owning a `FootGrounder` must call
`beginFrame()` before `mixer.update` and `apply()` after. `bind()` must run
pre-playback (rest pose) so `pelvisBindLocal` is neutral — a mid-clip bind would
capture a deformed base.
