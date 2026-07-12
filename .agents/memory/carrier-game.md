---
name: Carrier game architecture
description: How the dedicated Carrier artifact works — carrier-net (carrier-owned netcode copy), fighter+mothership-anchor ownership model, deterministic server-only fleet AI, kind-aware shared integrator.
---

# Carrier Game Architecture

The Carrier game is its own artifact (`artifacts/carrier`, web) backed by its own
netcode lib `@workspace/carrier-net` and a dedicated server room
(`api-server/src/game/carrier-room.ts`, WS path `/api/carrier`). It is a SEPARATE
lineage from Skyforge Squadron / `lib/space-net` — do not edit space-net for
carrier work.

## carrier-net is a deliberate carrier-owned copy
`lib/carrier-net` duplicates the space-net netcode shape (types/sim/protocol +
barrel) so Carrier physics/economy can diverge without touching Skyforge.
1 world unit = 1 metre here.
**How to apply:** add carrier features to carrier-net, never space-net.

## Ownership model: fighter + mothership-as-anchor
Each joined player gets TWO server entities: the FIGHTER they fly (id = playerId)
AND a MOTHERSHIP (id `ms_<playerId>`) that is the deploy + zone anchor. Both sit
in the authoritative roster keyed by a stable id/owner.
**Why:** keeps flight/camera unchanged while giving a deploy origin, and the
ownership roster composes with the "become any unit / roster-select" control task
(don't bake fighter-only assumptions into control).
**How to apply:** fleet zones are anchored to the owner's mothership each tick;
fleet units carry `owner` + UUID; friendly-fire is guarded by `owner`.

## Fleet AI is server-only AND deterministic
`fleetIntent(unit, ctx)` (sim.ts) is the pure role-AI: it picks a role goal
(combat roles chase a hostile in range, tactical shadows a warded ally, others run
a slow zone circuit), clamps the unit back inside its rated zone, repels from
`Obstacle` spheres, and returns an `InputCommand` (incl. a `fire` flag gated on
armed + engaging + tight alignment). It uses ONLY `ctx.tick` + a precomputed
deterministic `ctx.rand` (seed via `makeRng`/`hash01`) — never wall-clock or
`Math.random`.
**Why:** single authoritative source + reproducible sim; clients only interpolate
fleet units (no prediction for them).
**How to apply:** keep fleetIntent pure; feed determinism through ctx, not globals.

## One kind-aware shared integrator
`stepShip` is the single fixed-step integrator for every entity; it reads
`tunablesFor(kind)` so fighter / mother_ship / fleet_unit fly with their own
envelope but identical maths (run verbatim client+server). Role tunables (cost/
cap/scale/zoneR/maxHp/engage+fire ranges) live in `FLEET_ROLES`; economy knobs in
`CARRIER`. `spawnEntity` sets `maxHp` from kind+role.

## Client (CarrierGame.ts)
Renders the mothership (large hull) + role-coloured class-scaled fleet units as
remotes, plus a faint wireframe zone sphere ONLY for the local commander's own
units. Deploy is a `{t:"deploy"; role}` message; the HUD deploy panel gates
buttons on live credits + per-role cap + global fleet cap (mirrors server checks).
`DEPLOYABLE_ROLES` is typed `Exclude<FleetRole,"none">[]` so it can index
`FLEET_ROLES` and satisfy the narrow `DeployOption.role` union.

## Platforms are tethered, combat ships are not
Platforms (`PlatformKind` in carrier-net) are a SEPARATE entity class from fleet
units: built with credits, capped per player, and physically cabled to the owner's
mothership (follow it each tick, offset below it). The cable/tether is reserved for
platforms (and by design mechs/miner-docking) — combat ships (fighter/fleet_unit)
are NEVER tethered. `isTetherableKind` is the gate.
**Why:** keeps the "anchored installation vs free-flying ship" distinction crisp so
turret/production/utility platforms read as base infrastructure, not fleet.
**How to apply:** platform function (turret fire / production credit bonus / utility
repair) lives in `tickPlatforms` on the server; clients only interpolate + render
GLB+cable+light and detach (never dispose) shared GLB templates on removal.

## Become-control: only the controlled entity is predicted
`become(entityId)` lets a player take direct control of ANY unit they own (fighter,
mothership, or fleet unit) by id, validated server-side for ownership + alive. The
server skips fleet AI for a player-controlled entity; releasing reverts it to AI.
Client predicts ONLY the controlled entity; everything else interpolates. The HUD
roster lists owned units with become buttons (highlight active); Tab cycles control.
**Why:** one prediction target keeps reconciliation simple while the command layer
stays general (no fighter-only assumptions, composes with the ownership roster).
**How to apply:** when control changes kind, CarrierGame rebuilds `selfGroup` to the
new kind's mesh; camera/input follow `controlledEntityId`.

## Tests
`lib/carrier-net/src/sim.test.ts` (vitest, node env) guards kind-aware
determinism, fleetIntent purity/zone-return/containment/fire-gating, and RNG
reproducibility. Registered in the `test` validation command alongside
voxel-engine + vfx.

## Camera framing reads kind from the authoritative entity, not this.self
`this.self` only carries the predicted TRANSFORM (px/py/yaw/...), not a reliable
`kind`. To frame the camera per controlled unit (e.g. pull way back for the huge
mothership), resolve the controlled kind from `latestEntities.get(controlledEntityId)`
— `updateSelfMesh` does the same. Per-kind framing lives in `CAMERA.mother/fleet`
(mother distances are multiples of `SHIP_FIT * MOTHER_SHIP.scaleFactor`).

## Combat is objective-driven (mining outposts), not ambient
There are no arena-wide "random attacks." The world seeds a fixed set of AI mining
`Outpost`s (objective "pings"); each owns a LEASHED pirate garrison + a guarded
reward cache (a `RewardBox` left inactive until cleared). Pirates only wake when a
player enters their outpost's alert radius and return home past the leash radius —
they never roam the arena. Clearing a garrison unlocks the cache; a tick-based
rearm timer respawns the garrison and re-locks the cache.
**Why:** turns drifting ambient enemies into a fly-out-and-contest loop with a
payoff, while keeping the sim bounded + deterministic.
**How to apply:** seed outposts/garrisons/guarded rewards in `generateWorld` via
the room `rng` only; drive leash + clear + rearm off `tick`/`simTick` (never
wall-clock); guarded reward ids are excluded from the free-reward respawn loop;
broadcast live `outposts` in the snapshot. The pure lib sim stays untouched.

## Energy beams are client-only additive ShaderMaterials
Lasers, plasma platform cables, and the spiral/stream mining beam all ride the one
shared open-cylinder `beamGeo` (uv.x around, uv.y along) via `makeLaser/Plasma/
MiningMaterial` (additive, depthWrite:false) and a single `uTime` uniform bumped
each frame in `updateBeams`/`updatePlatforms`. Pure render — no determinism impact.
**How to apply:** dispose these ShaderMaterials on view removal (already done in
the view-prune loops + global dispose); the open-cylinder geo is shared so never
dispose it per-view.

## Cosmetic hull turrets vs functional salvo; camera-park modes
Motherships render 20–30 cosmetic turrets but fire a separate balance-capped count.
`MOTHER_SHIP.turretSalvoBolts` (~6) is the ONLY value the server salvo loop reads;
`motherTurretVisualCount(shipType)` (20–30, deterministic) is client cosmetic only.
**Why:** decouples visual bristle from balance so a busy hull never out-DPSes design.
**How to apply:** stud cosmetic turrets onto the OUTER mothership group so they
survive the async procedural→OBJ-station swap (the inner station mesh is replaced);
never tie weapon count to the visual count. Mission variety: OUTPOST carries a
weighted `tiers[]` (garrison/reward/radius); seed the tier via the room `rng` only
and stash size in `meta.garrison` so respawn re-arm stays tier-consistent.

Client mothership camera modes (follow/orbit/free) "park" the carrier by simply
NOT sending input while in orbit/free — the server only steps queued inputs, so an
un-driven mother stays put with zero sim/determinism impact. Gate the mode to
mother_ship control (force back to follow otherwise) so fighter/fleet control and
pointer-lock never regress; match every added DOM listener (wheel) with a teardown.

## Hull/station model build is shared in hullFactory (don't inline it again)
The fighter/fleet/station render path lives ONCE in `src/game/hullFactory.ts`
(`loadStationModel`/`loadHullModel` → `tintMetalHull` + `autoOrientShip` +
`fitObject`, plus `disposeGroup`). Both `CarrierGame` (its `requestShip/Station
Model` only orchestrate the in-scene fallback swap) AND the dev inspector import
it, so true on-screen sizing can never drift between gameplay and the inspector.
**How to apply:** change the fit formula / tint / orient in hullFactory only; the
station fit contract is `SHIP_FIT * MOTHER_SHIP.scaleFactor * fitMul`.

## Verifying Puter-gated WebGL cabinets by eye: a `?inspect` short-circuit
To eyeball sizing/visuals without an account or live match, add a hidden URL flag
checked in `App.tsx` BEFORE the auth provider (carrier: `?inspect` →
`MothershipInspectorView`, a disposable scene with OrbitControls that lines up all
5 stations + fighter + fleet via the shared render path). Bypasses the gate
entirely; never linked from player UI. Still cannot be screenshotted — the
headless browser has no WebGL — so it's a manual-in-a-real-browser tool only.

Ship hulls from mixed authoring sources fly nose-forward via `autoOrientShip()`
(now in `hullFactory.ts`): bbox longest *horizontal* axis = length,
vertex-sample both ends, the pointier (smaller mean perpendicular radius) end =
nose, then **premultiply** a world-Y quaternion to map nose→local +Z (the engine
canonical nose). Premultiply (not `rotation.y=`) so it survives a loader root tilt
(e.g. Z-up FBX). `ShipModel.yaw` is optional: omit = auto-orient (default for new
hulls), number = manual override for symmetric/boxy hulls the taper heuristic
misreads. Manual visual verify only — Carrier is Puter-gated, no screenshots.
