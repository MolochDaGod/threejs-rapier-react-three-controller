---
name: Animator lib design
description: Non-obvious rules for the @workspace/animator skeletal system (voxel chars on Mixamo skeleton, motion-only clip packs).
---

# @workspace/animator

A shared lib driving box-geometry voxel characters on the 25-bone Mixamo
skeleton (`mixamorig*` — FBX strips the colon), fed by motion-only clip packs
(sword & shield, rifle, longbow). Assets live under
`lib/assets/models/animations/{sword,rifle,bow}/`; catalog ids are
`animations/<class>/<clip>`.

## Single-active-clip state machine + ONE additive upper-body overlay
The base path is single-clip: exactly one full-body clip is dominant, the mixer
crossfades between them; locomotion, holds (block/aim), and one-shots (attack/
roll/dash/jump/death) all resolve to one clip. **Why:** keeps weight management
bug-free for full-body clips.
EXCEPTION: a single optional additive UPPER-BODY overlay (moving melee swing)
rides ON TOP of the locomotion blend so the legs keep walking/sprinting while the
arms swing (`attackMoving`/`playOverlay`); `isBusy()` stays false so the engine
keeps translating. Non-obvious rules when adding additive actions:
- Clone the clip, strip to upper-body tracks, `AnimationUtils.makeClipAdditive`,
  and register with `AdditiveAnimationBlendMode`. Cache under a SEPARATE key
  (e.g. `__additive__/<id>`) from the full-body action.
- `THREE.AnimationClip.clone()` regenerates `clip.uuid` in its constructor, and
  `mixer.clipAction` caches by clip uuid — so the additive clone never collides
  with the full-body clone of the same source clip. Rely on that; don't reuse a
  clip instance across two clipActions or you get one shared (duplicated) action.

## Root motion is locked; the ENGINE owns world translation
`lockHorizontalRoot` strips X/Z from the `mixamorigHips.position` track (keeps
the vertical bob). The animator never moves the character in the world — the
host engine does.
**How to apply:** because clips are rooted, the engine MUST suppress its own
WASD translation whenever a rooted full-body clip is playing (melee block, an
active one-shot via `isBusy()`, or a movement special that drives its own
displacement) or the avatar foot-slides. Aim holds (bow/rifle) are the exception
— they use directional strafe loco clips that animate movement, so they travel.

## Universal movement actions fall back to the shared unarmed set
jump/land/dodge*/dash exist in the longbow/unarmed packs but NOT the sword/rifle
packs (those are motion-light). `Animator.resolveMovement()` falls back to
`WEAPON_SETS.unarmed.actions[key]` so every weapon can roll/dash/jump with real
animation. Attacks/skills do NOT fall back (a sword attack must not become a
punch) — only the universal movement verbs do.
**Why:** the design spec says longbow loco/roll/jump doubles as default unarmed
loco; this keeps movement consistent across all weapon classes.

## Clip-id integrity is silent
`loadClips` silently drops ids with no matching asset. After editing
`clipCatalog.ts`, cross-check referenced ids against real files
(`animations/<class>/<base>` from the FBX filenames) — a typo means that action
just doesn't animate, with no error.

## Traversal MODE composes with weapon class
`setMode("ground"|"climb"|"swim")` is orthogonal to `setWeapon`. In ground mode
the weapon blend drives loco; in climb/swim the small directional `TRAVERSAL_SETS`
(idle/forward/back) take over via the single-clip path — `move.z>=0` picks
forward (climb-up / swim-stroke), `z<0` picks back (climb-down; swim reuses
forward), speed<MOVE_EPS picks the in-place idle (hang/tread). A one-shot still
wins while it plays. Switching mode just nulls `currentId` so the next `update`
crossfades cleanly.
**Why:** keeps the single-active-clip SM intact — no second mixer, no per-mode
blend tree.

## Class-independent one-shots live in GLOBAL_ACTIONS, not WEAPON_SETS
mantle/swimExit/farming(harvest,water,pick,plantTree,pullPlant)/magic(castSpell,
magicAttack,magicArea) resolve via `resolveGlobalAction()` + `playGlobalOnce()`,
returning 0 when the clip is missing (so a host can no-op gracefully). Any
character can mantle/farm/cast regardless of loadout. `magic` is ALSO a full
WeaponClass (loco from the magic-loco pack, casts as attacks).

## Mantle = engine root-carry in lockstep with the clip
`animator.mantle()` returns the clip duration; the host lerps the body from start
to the ledge top over exactly that duration (smoothstep) — no snap. The clip's
vertical hip bob rides on top (lockHorizontalRoot keeps Y), the engine owns the
up+forward world translation. Same pattern as the dash/roll `special` carry but
with a Y component and a fixed from→to target.
**How to apply:** detect a ~2-block ledge (forward chest-ray for the wall + a
down-probe just past it for the top; gate rise to [minLedge,maxLedge] + headroom),
then start the carry; suppress normal movement/gravity until it ends.

## Adding a new WeaponClass or global clip is a multi-site checklist
New clips just need to be dropped under `lib/assets/models/animations/<class>/`
(Vite `import.meta.glob` resolves URLs — no manual asset registration). But a new
**WeaponClass** must be threaded through every site or it silently misbehaves:
the `WeaponClass` union, a `WEAPON_SETS` entry, a `mountWeapons` branch, AND the
fallback class-list literal in `loader.ts` `createAnimatedCharacter()`. That
fallback only runs when `classes` is undefined (then it preloads
`allReferencedClipIds()`, so clips load regardless) — but keep the literal in
sync anyway so it isn't stale/misleading. On the host side, also update every
exhaustive `Record<WeaponClass>` (e.g. Explorer `WEAPON_LABELS`) + the
`WEAPON_ORDER` cycle array, or TS errors / an unreachable class result.
**A class with no locomotion pack reuses another class's walk/run** (knife reuses
the bow/unarmed loco set) — its own pack only needs idle + attacks.
New ActionKeys: add to the `ActionKey` union; combo extensions (e.g. sword
`attack4`) flow through the existing `combo[]` + `nextComboClip()` with no extra
plumbing; new global verbs (slide/throw) go in `GLOBAL_ACTIONS` + a thin
`playGlobalOnce` wrapper method.

## Verification is manual
The Explorer cabinet sits behind Puter guest auth + uses pointer/drag input that
headless Playwright can't drive — verify play feel manually, not via screenshots.
