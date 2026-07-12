---
name: Pistol Kiter kit
description: How the Danger Room pistol "Gunslinger/Kiter" primary generalizes the weapon path data-driven, and how bespoke one-shots reach the procedural rig.
---

# Pistol Kiter kit (Danger Room / Animator)

The pistol flagship primary is **data-driven on `CharacterDef`**, not a new
weapon `kind` branch. A `KiterKit` (in `three/types.ts`) authored on the
Gunslinger drives a proximity-adaptive LMB: beyond `kickRange` it shoots a
tracer + back-steps; inside it, an MMA kick. A `clipSize` clip auto-reloads and
the final round is an explosive AoE bullet.

**Rule:** new per-character primary kits hook by branching `Studio.attack()`
on a data field present on the active `CharacterDef` (e.g. `def.kiter && weaponId==="pistol"`),
**before** the generic weapon-combo path — mirror the existing `def.meleeStyle==="kick"`
(Striker) branch. Keep tuning as pure data so the editor can retune it.

**Why:** Studio.attack() already had two paths (Striker kick combo, generic
weapon combo). The pistol needed a third identity (ranged kiter) without
disturbing the other 11 weapons. A data flag + early-return branch keeps each
identity isolated and editor-tunable.

## Reaching the procedural rig with bespoke one-shots

The Gunslinger is the procedural Explorer rig (`procedural:true`), so its
"clips" are **verbs**, not GLB clip names. To play a new bespoke motion:
1. add an `ActionKey` in `explorer/types.ts`,
2. map it to an FBX id under `WEAPON_SETS.<class>.actions` in `explorer/clipCatalog.ts`,
3. it plays via the generic `Animator.playAction(key)` (resolves current weapon
   clip, falls back to globals),
4. expose it as a verb in `ExplorerCharacter` `VERBS` + a `playClipOnce` switch case.

Then `Studio` calls `character.playClipOnce("<verb>")` — for the procedural rig
the verb routes through `playAction`; GLB rigs would treat the same string as a
real clip name. New pistol verbs: `mmaKick`, `chargedShot`, `pistolWhip`,
`uppercut`, `kipUp`.

**Gotcha:** dummy `Targets` are passive (no AI/attacks), so "parry/stun" and
"shield-break" are cosmetic-only today (knockback + flash). Real stun needs a
per-target status on `Targets`, deferred with the dummy-roster rework.

## Kiter signature skills (slots 1-4)

The Kiter's four bespoke skills mirror the Striker's `meleeStyle==="kick"` model:
a `def.kiter && weaponId==="pistol" && isSig` branch in `useSkill` dispatches to
`doPistolSig(idx)` **before** the shared `skillCooldown` gate, so each slot keeps
its **own** independent cooldown in the `sigCooldowns[4]` array (decremented in
the loop, surfaced in `pushHud` via a `perSig = isKick || kiter-pistol` flag).
`PISTOL_SIG_CD`/`PISTOL_SIG_ST` are parallel 4-tuples; `armSig(idx)` arms the
cooldown + spends stamina.

- sig0 Quick Draw: 3-round fan at the crosshair target.
- sig1 Smoke Phantom: `vfx.smokeClone` decoy auto-fires 3 shots (scheduled),
  player goes invisible (`character.root.visible=false`) + `setSpeedMultiplier(2)`
  for `phantomTimer` ~4s, plus a pistolWhip→uppercut close combo. The loop
  restores visibility + speed when `phantomTimer` hits 0; **also reset
  `phantomTimer=0` + `setSpeedMultiplier(1)` in `spawnCharacter`** so a rig swap
  mid-phantom never spawns invisible.
- sig2 Bear Trap: `vfx.thrownProp("models/props/bear-trap.glb", from,to,...)`
  arcs to the aimed point, blasts + `markStun` on land.
- sig3 Hexaring Beam: `controller.startHover` float + `vfx.hexaring` at muzzle,
  0.5s charge then `vfx.beam` for 1.5s; beam hits are a manual point-to-ray
  distance test (proj along dir within length, perp dist ≤1.4) → `shieldBreak`+
  `stunMark`.

VFX prop GLBs (`magic-hexarings`/`bear-trap`/`hand-grenade`) load into
`Vfx.propTpls` in `loadGlbAssets` and are disposed in `Vfx.dispose`; clones share
geometry/textures (shared:true), so never dispose a clone's geo/textures.

## Combat transients are shared across characters — reset them on swap

`Studio.sigCooldowns`/`sigCooldownMaxes`, `skillCooldown`, the `pending` scheduled
callbacks, and the phantom invis/speed buff are ONE instance reused for every
character. Only `dispose()` cleared `pending`; nothing cleared the cooldown arrays
on a character swap. So a Gunslinger signature on cooldown blocked the SAME slot
index on the next character (e.g. the Striker), and stale decoy-shot/beam/combo
callbacks fired on the freshly-spawned rig. `spawnCharacter` now zeroes all of
these alongside the existing `phantomTimer=0`/`setSpeedMultiplier(1)`.

**Why:** the per-sig cooldown array is indexed by slot, not by character, so any
new per-character kit that writes shared Studio combat state must be reset in
`spawnCharacter` or it leaks across the swap.

**Verify gotcha:** the Animator has NO Puter gate, but the headless screenshot
sandbox can't create a WebGL context ("WebGL unavailable"), so the Danger Room's
3D skills still can't be screenshotted here — live visual tuning is user-manual.

## Backstep i-frame dodge must be cooldown-gated, not just timed

The kiter's after-shot backstep grants a real i-frame dodge (sets `Studio.invuln`),
but the i-frame window MUST be gated by its own cooldown (`pistolDodgeCd`), not just
set on every shot. **Why:** the shot re-fire lock is only ~0.18s; an i-frame window
≥ that (e.g. 0.22s) refreshes faster than it decays, so spam-firing chains it into
continuous immunity (`resolveOpponentStrike` bails while `invuln>0`). Gate it so the
dodge covers one backstep then leaves a genuine vulnerable beat (re-arms ~0.6s).
Only the ranged shot backstep dodges — never the close-range MMA kick.

## Kiter "R" + deployed turret (Studio-driven, not Vfx)
The pistol Kiter's heavy ("R") is overloaded in `doHeavyAttack`: for a
`def.kiter && weaponId==="pistol"` actor it branches to a tactical retreat
(dash away from nearest living enemy + brief i-frames) that drops a turret.
A deployed turret that actually shoots enemies MUST be driven from `Studio`
(`deployTurret`/`fireTurretVolley`) — `Vfx` is pure-visual and has no access to
`targets`/damage. `Vfx.spawnTurret` only renders the standing chassis; Studio
schedules volleys + muzzle flashes + the damage-producing `bolt` (a `scale`
param makes it oversized). The Archmage's `fskillKind:"turret"` routes through
the same `deployTurret`, not `Vfx.playSkill("turret")` (which is cosmetic).
**Why:** keeps the "ranged effect object is the damage producer" rule — the bolt
deals collision damage where it lands, so a target off the firing line dodges.
