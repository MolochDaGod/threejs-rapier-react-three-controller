---
name: Animator Skill Lab (Dressing Room Playground)
description: How the Playground's live animation/skill authoring (overdrive, mirror, arm-width, sub-clip, damaging collider, slash-from-collider, source VFX) is wired and the invariants it must keep.
---

# Animator Skill Lab

Live skill/animation authoring for the driven Grudge-race character, surfaced in
the Dressing Room → Playground panel. Knobs live on `GrudgeAvatar`; orchestration
+ snapshot live on `EditorScene`; UI in `PlaygroundPanel.tsx`.

## Key invariants (why, not the code)

- **The skill target is `playAvatar ?? selected grudge`.** Any code path that can
  change which avatar is the target (`startPlay`, `stopPlay`, `select`, grudge
  load via `select(rootId)`) MUST re-run `applySkillLab()` or the new target keeps
  stale overdrive/mirror/arm-width/collider while the UI looks active.
  **Why:** setters only push state to whatever was the target *at edit time*; a
  target swap without re-apply desyncs engine state from the snapshot.

- **Only the active target ever shows its damaging-collider wireframe.**
  `applySkillLab()` hides the collider on every other spawned grudge avatar before
  applying to the target — otherwise switching targets leaves a stale visible
  wireframe on the old one.

- **Authored sub-clips are cached and must be bounded.** `playAuthoredClip` keys a
  `THREE.AnimationUtils.subclip` (+ optional mirror) by `name|from|to|mirror` and
  caches both the clip and its `mixer.clipAction`. Slider-driven trims would
  accumulate unique clips/actions for the avatar's lifetime, so the cache is capped
  with oldest-eviction + `mixer.uncacheClip` on evict (full `clear()` on dispose).

- **Source GLB VFX are NOT re-imported** — they're already in `vfxCatalog`
  (`VFX_PRESETS`) with real `Vfx` cast methods (fireDragon/meteor/turret/
  darkBlades/swordVolley). The Skill Lab just exposes them in a dropdown and fires
  the chosen one through `testSkill()`. (`attached_assets/fx/*` are Godot files, not
  portable — do not try to load them.)

- **`slashFromCollider` drives angle AND position for EVERY Skill Lab asset**, not
  just the slash trail. The damaging collider is bone-anchored to the swinging hand
  so its world position + orientation track the swing; `EditorScene.playVfx` consumes
  both when ON. **Why OFF must stay identical:** every VFX branch must collapse to the
  legacy `srcPos=p / aimDir=fwd / slashQuat=quat` when OFF — never add a VFX case that
  reads collider state outside this gate, or you silently change the default path.
- **Cast aim must come from the collider's ORIENTATION, not its displacement.**
  Aiming a projectile along `collider - chest` ignores the hand rotating in place
  (a real swing), so aim is derived by projecting hand-frame axes through the hand
  world quaternion. **Why the axis is *selected* by displacement, not hardcoded:** the
  raw hand-bone local-axis convention is rig-dependent (and the GLB vs line slash
  paths even disagree on which axis is the arc normal), so a hardcoded `(0,0,1)` can
  fly sideways/into the floor — pick the projected axis most aligned with the outward
  body→collider vector, then orientation supplies the continuous pitch/yaw.
- **Ground-deploy assets need their internal offset backed out.** `Vfx.castTurret`
  shifts its chassis `+1.5` forward along the flattened aim then snaps `y=0`; to stand
  it under the collider XZ in collider mode, pass `srcPos - ground*1.5`.
- **Default collider offset is the bare hand** (`colliderY/Z = 0`) since the collider
  now rides the hand; non-zero offsets are authored deltas in the body-yaw frame.

## Unverifiable headless

Mirror correctness and the arm-width axis (local Z spread on upper-arm bones) are
visual-only — cannot be confirmed in a headless/WebGL-less environment. Treat as
tunable knobs, not asserted-correct.
