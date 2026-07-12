---
name: Voxel Studio creatures + game modes + ranged aim
description: How play-mode creatures, game-mode rules, ranged aim/projectiles, and device settings fit together in the Game Studio artifact.
---

# Game Studio play-mode gameplay layer

The Studio (`artifacts/voxel-engine`) play mode adds living creatures, a game-mode
ruleset, ranged combat, and device-local settings. All additive — build mode and
the arcade/boat/explorer cabinets are untouched.

## Game-mode rules are the single source of truth

`engine/content/gameRules.ts` owns `GameMode` (standard/survival/rpg/rpg_survival)
and `rulesFor(mode)` → `{npcsHostile, playerCanDie, xpEnabled, animalsFlee}`.
`worldState.ts` re-exports `GameMode` from here (no circular dep). Every system
reads these flags rather than checking the mode string:

- `CreatureSystem` gates aggression on `npcsHostile`, flee on `animalsFlee`,
  player melee on `playerCanDie`, and **XP award on `xpEnabled`** (the `onKill`
  callback is only fired under rpg rules).
- `PlayerController.setCanDie(playerCanDie)` gates **environmental** death (lava
  in `tickVitals`). Creature melee reaches the player via `applyExternalDamage`,
  which the CreatureSystem already gates upstream — so don't double-gate it.

**Why:** an earlier pass enforced rules only inside CreatureSystem, so non-rpg
modes still accumulated XP and peaceful modes still died to lava. Rule
enforcement must cover *every* damage/XP source, not just creature melee.

## Creatures are procedural + non-persisted

`CreatureSystem` spawns a population in a ring on the **first enter-play of each
engine mount** (guarded by a `creaturesSpawnedRef` reset on remount), wanders/
chases/flees with persistent per-creature heading, and is NOT saved to the world
snapshot. Regenerate remounts the engine → fresh population. `CreatureActor`
wraps the animated GLB; real asset ids: animals cat/dog/wolf/horse/pig/sheep/
chicken/raccoon, NPCs character-male-1/-2, character-female-1/-2.

## Hostility is per-creature, and monsters spawn away from the surface

`CreatureDef.hostile` (+ `isHostileDef(def)` = `hostile || boss`) decides who is a
real monster, *independent* of game mode. Only `hostile && rules.npcsHostile` NPCs
are classified `enemy` (`factionForCreature`) and allowed to chase/attack
(CreatureSystem gate). Peaceful humanoids (villagers) stay neutral even in
survival. Pools: `FRIENDLY_NPC_DEFS` / `HOSTILE_NPC_DEFS` split out of `NPC_DEFS`.

`CreatureSystem.spawn(defs, rand, place?: SpawnPlacement {minDist,maxDist,underground})`
controls placement. `caveAt(x,z,height)` scans below the surface for a dry
(non-liquid) air pocket with headroom and returns feet-Y, else null → caller
falls back to the far surface. Workspace spawns friendly villagers + animals on
the near surface (default ring) but spawns monsters ONLY under `npcsHostile`,
FEW (`HOSTILE_SPAWN_COUNT`), far + underground (minDist 22, maxDist 48).

**Why:** the old single pool ring-spawned ~5 monsters at 8..22 blocks on every
survival enter-play — instant pressure, crowding, unfun to build on the surface.
**How to apply:** new monster defs set `hostile: true`; keep peaceful NPCs
unflagged. To add a habitat (e.g. nether cy<0), extend `SpawnPlacement`/`caveAt`,
don't re-mix the pools.

## Ranged aim + projectiles

`PlayerController` RMB is overloaded: **hold** = aim-down-sights (zoom FOV 70→52,
emit `aim:change`), **quick tap** (<~220ms, resolved on mouseup) = the classic
place/use/interact. While aiming, LMB fires (emits `combat:fire {origin,dir,
damage}`) and mining is suppressed (`tickMining` early-returns on `this.aiming`).
`setEnabled(false)` calls `setAim(false)` so leaving play never leaves the camera
zoomed. `ProjectileSystem` listens for `combat:fire`, flies a ballistic bolt with
gravity, and resolves hits via `CreatureSystem.hitTest`/`damageCreature` + voxel
solidity. It clears live projectiles when disabled and unsubscribes on dispose.

## Device-local settings (not part of the world save)

`studio/settings.ts` persists `{invertY, reticle}` in `localStorage`
(`studio:settings`) — these belong to the person, not the project. `Controls`
applies `invertY`; Workspace applies it at engine setup AND via a `useEffect` on
change. The HUD shows a reticle only while `aiming` and an XP/level bar only in
rpg modes.

## Creature ambience (idle/hurt/footstep sounds)

`CreatureSystem` emits `creature:idle`/`creature:hurt`/`creature:step`
(`CreatureSoundPayload {voice, gain, heavy?}`); `WorldAudioSystem` consumes them
and synthesises per-`CreatureVoice` Web-Audio tones (no assets). Distance
attenuation gain is **pre-computed in CreatureSystem** (it owns the player
position) and far/out-of-range creatures never fire an event at all — the audio
system stays a dumb synth with no spatial maths. `CreatureDef.voice` (per-species,
defaults to `grunt`) picks the timbre; hurt is the same voice pitched down +
louder, kept distinct from the death tone played on `combat:creature-death`.

**Why:** keeps a busy world cheap (no event spam) and the volume model in one
place. **How to apply:** any new creature sound should pass an already-attenuated
`gain` in its payload, not raw positions; new species just set `voice`.

## Boss specials + boss health bar

`CreatureDef` carries `boss?`/`name?`; `Creature` carries `special`/`specialCd`.
A boss's `think()` first calls `bossSpecial()` — if it owns the frame (special in
flight or just launched) `think` returns early, else the boss acts like a normal
hostile NPC. Two telegraphed specials, chosen by range: a close-range AoE slam
(windup→active blow+`spell:aoe` ring+`fx:shake`→recover) and a longer-range
charge (windup→locked-heading rush→contact impact+`fx:shake`→recover), gated by
`BOSS_SPECIAL_CD` + `BOSS_CHARGE_MAX`. **Player damage from any special must be
gated on `rules.playerCanDie`** (same rule every damage source obeys). Boss death
adds a bigger `spell:aoe`+`fx:shake` payoff on top of the standard XP path.

HUD: `updateBossStatus(dt)` (end of `update()`) emits a throttled `boss:update`
(`BossStatus {name,hp,maxHp,attack}`) while a boss lives and a one-shot
`boss:cleared` when the last boss dies. `BossHud.tsx` is pure-snapshot (no engine
access, like PlayHud/CombatHud). Workspace subscribes both events into React
state and has a play-mode "Summon Boss" button (disabled while a boss is alive).

## Adding a new spawnable enemy (no loader/scale work)
To make a new monster spawn: drop its GLB under `lib/assets/models/enemies/`
(auto-discovered as id `enemies/<file-no-ext>`, animated) and add a CreatureDef
referencing that id — `hostile:true` in NPC_DEFS to ride the survival cave/edge
spawn rules, or `boss:true` in BOSS_DEFS to make it summonable. No loader or
scale code is needed: `CreatureActor.fitHeight` rescales any model to
`def.height` and grounds it, and clip mapping is regex with graceful fallback
(matched clip → clip[0] → static). Only constraint: GLTFLoader has NO
Draco/meshopt decoder, so a compressed GLB silently fails to load (spawn
try/catch skips it). Verify GLBs are uncompressed glTF before relying on them.
