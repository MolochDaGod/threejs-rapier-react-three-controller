---
name: Animator target portraits
description: How the locked-target HUD portrait capture works and its safety rules (clone-only, name-pruned shells, per-type cache, letter fallback).
---

# Animator target portraits

The locked-target status frame shows a real rendered thumbnail of the enemy rig
(`src/three/targetPortraits.ts`), captured once per enemy *type* into a cached
PNG data URL and read by the HUD through a tiny external store.

**Rules that must hold:**
- The capture NEVER touches the live rig: it `SkeletonUtils.clone`s the subject
  synchronously at request time (so a despawn mid-defer can't be captured),
  then renders the clone offscreen a macrotask later. Clones share geometry +
  materials with the live rig — nothing from a capture is ever disposed.
- Selection outline shells are pruned from the clone by node name
  (`PORTRAIT_OMIT_NAME` = "selection-outline"). Any new selection/highlight
  decoration added to an enemy group must use that name or it shows up inside
  the portrait (it is captured exactly while selected). Hidden nodes are pruned
  too, so primitive placeholder bodies never leak into GLB/avatar portraits.
- Cache keys are per enemy type (`dummy:<kind>` / `avatar:<weapon>` /
  `fighter:<faction>:<weapon>` / `dungeon:<kind>`), and the key changes when an
  async rig mounts (fighter → avatar/dummy), which naturally re-captures the
  upgraded look. A failed/GL-less capture caches `null` → letter fallback.
- The player's own frame uses a stable key (`player:<characterId>`) whose LOOK
  can change under it (wardrobe/respawn), so `invalidateTargetPortrait` exists —
  and it must guard the deferred capture with a per-key generation counter:
  invalidate bumps the gen + clears cache AND inFlight; a completion whose gen
  is stale drops its result (never cache-write, never delete the NEW request's
  inFlight entry). Plain "delete from cache" re-introduces a stale-write race.
- Mounted weapon pieces are tagged `userData[PORTRAIT_OMIT_FLAG]` at mount time
  (both GLB + procedural paths in `Weapons.ts`) and pruned from the capture
  clone, so held blades/staffs don't inflate the face-crop bounds. Framing has
  two modes: "face" (tight head crop, enemy + player frames) vs "bust".

**Why:** rendering the live scene or re-parenting live objects for a portrait
risks corrupting the combat frame; cloning + per-key caching keeps lock-on
hitch-free and WebGL-failure-safe.

**How to apply:** any new `CombatTargets` implementation gets portraits by
implementing optional `selectedPortrait()`; framing math (`portraitFraming`)
and the store are pure and unit-tested in `targetPortraits.test.ts`.
