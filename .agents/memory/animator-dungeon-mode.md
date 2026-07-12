---
name: Animator Dungeon Mode
description: Danger Room → dungeon level swap (GLB load, Rapier trimesh, grid navmesh, gated player collision); the rules that keep Danger Room feel intact.
---

# Animator Dungeon Mode

A door portal in the Danger Room (`artifacts/animator`) swaps the whole arena for
a loaded Synty dungeon level with its own colliders, navmesh-driven enemies, and
camera occlusion. Lives under `src/three/dungeon/` + wiring in `Studio.ts`.

## Non-negotiable rules

- **Player collision is GATED behind a provider so Danger Room feel never
  regresses.** `Controller.setCollision(provider, spawn?)` swaps to a Rapier KCC
  capsule reconciliation; `setCollision(null)` restores the ORIGINAL Danger Room
  path (room-bound clamp + Y=0 floor clamp, nothing else). Exit must call
  `setCollision(null)` + `setCameraOccluders([])`. Never bake dungeon physics into
  the default movement path.

- **Navmesh floor sampling: down-rays return hits top→bottom, so `hits[0]` is the
  ROOF, not the floor.** A roof is down-facing and rejected by the up-normal test
  (`worldN.dot(up) < 0.6`), but you must then keep scanning lower hits — don't
  `continue` on the first hit. Walk all hits, accept an up-facing surface whose
  clearance to the hit above it (or open sky for hit 0) ≥ `MIN_HEADROOM`, and keep
  the LOWEST valid one (true ground, not a balcony). Getting this wrong puts
  nav cells / the central spawn on roofs and breaks A*/spawning.

- **`enterDungeon()` must be exception-safe.** It's async (GLB load) and mutates a
  lot of shared state (hide room, stash `dangerTargets`, swap `this.targets`,
  handoff collision). Wrap the body in try/catch/finally: `finally` always clears
  `enteringDungeon` (else re-entry soft-locks), and the catch rolls back the
  partial swap (restore room visibility + `dangerTargets`) only if `!inDungeon`.

## Shape

- `Dungeon.ts`: GLTFLoader load (auto-scale 0.01 if maxDim>300), bakes trimesh
  colliders into its OWN `PhysicsSystem` (gravity 0), builds the grid navmesh by
  down-raycasting, picks a central spawn, builds the KCC capsule. Exposes
  `collision: CollisionProvider`, `occluders`, `nav`, `spawn`, `dispose()`.
- `DungeonEnemies.ts` implements the shared `CombatTargets` interface (added to
  `Targets.ts`) so `Studio` can swap populations behind one surface. Enemies are
  **procedural primitives** (melee Skeleton / ranged Archer w/ telegraph+projectile
  / monster Forge Brute) — the attached FBX skeletons failed to decode, so this is
  an accepted deviation, not FBX-driven.
- `navmesh.ts` (pure grid + A*) and `damage.ts` (pure computeDamage) are
  THREE-free and unit-tested (`*.test.ts`).
- **Dungeon death returns to the Danger Room**, not an in-dungeon respawn:
  `defeatPlayer` calls `exitDungeon()` after the defeat beat (acceptance
  requires dying/exiting both land back in the Danger Room).

## Vertical layering (water descent + sealed end-game pit)

A dungeon can be extended DOWNWARD below the loaded surface map: a translucent
**non-solid** water box, a gap, then a **sealed pit** (solid floor slab + 4
perimeter trimesh-collider walls) packed with hardened brutes + one oversized
boss. The surface navmesh is built from the kit meshes ONLY and BEFORE the depth
geometry is added, so the pit never steals surface walkability. The player
descends by walking off the kit edge into the moat margin and falling inside the
walls down through the water to the pit floor.

- **Tiny kits scale UP**: `Dungeon` auto-scales a small footprint up to a target
  (keeps the existing >300→0.01 down-scale). Don't assume Synty-sized input.
- **Water = slow sink, not free-fall**: `Controller.setWaterBand(top,bottom)` clamps
  *downward* `vertical` to a constant `SINK_SPEED` while feet are in the band
  (upward jumps untouched); `clearWaterBand()` on exit. The band persists across
  in-dungeon respawns (only the surface spawn matters); it's cleared only on exit.
- **Swim clips reuse the explorer traversal SM**: `Avatar.setTraversalMode?("ground"|
  "swim")` is OPTIONAL — `ExplorerCharacter` delegates to `Animator.setMode`, GLB
  `Character` no-ops. Studio's loop sets it each frame from the player's Y vs the
  water band. Restore "ground" on exit.
- **Pit population**: `DungeonEnemies` ctor takes an optional `pit:{nav,spawn}` and
  calls `spawnPit` (brutes + boss "Moloch Da God"). Pit dwellers are
  `hardened` (always fight at `DIFFICULTY.hard` regardless of dungeon difficulty)
  and `noRespawn` (kill sets `respawn = Infinity`, so they stay down). Each enemy
  carries its own `nav` (surface vs pit grid) — `followPath`/`snapToFloor`/
  `reviveEnemy` must use `e.nav`, not the shared surface nav.

## Verify

WebGL can't init in the *headless test sandbox* (renderer throws "WebGL
unavailable") so the gameplay loop can't be exercised by a Node/vitest test. BUT
the **app_preview screenshot DOES render WebGL** (proxied real browser) — use it to
confirm the app boots/renders. What it can't do: drive the pointer-lock 3D combat
input (walk to the in-room door, press interact, walk off the edge), so a true
end-to-end *playthrough* is still manual. Code-level trace + typecheck + the
navmesh unit tests (7) are the automated safety net.

Descent/pit/exit trace (all confirmed correct in code): player walks off the kit
edge into the moat margin (inside the perimeter walls) → water band clamps the
downward fall to SINK_SPEED → short PIT_GAP free-fall → KCC grounds on the pit
floor slab; pit brutes+boss are hardened+noRespawn on pitNav (kill ⇒ respawn
Infinity); swim/ground traversal toggles each frame on Y vs the water band; both
death (defeatPlayer respawn beat) and re-pressing the door call exitDungeon, which
clears collision/occluders/water-band, restores ground traversal + the stashed
Danger Room population, and drops the player back in healed.
