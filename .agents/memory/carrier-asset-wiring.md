---
name: Carrier asset-id wiring
description: How carrier ship/station asset ids resolve, the silent-fallback trap, and the offline guard that pins the wiring.
---

# Carrier ship/station asset wiring

The `@workspace/assets` catalog id is the file path under `lib/assets/models/`
**minus only the extension**. Packs that ship a single model inside a same-named
folder therefore have a *doubled* id segment: `vehicles/space/fleet/camo-jet/camo-jet`,
not `vehicles/space/fleet/camo-jet`. Pointing a `ShipModel.id` / station `parts[]`
at the bare folder is a real, easy mistake.

**Why it bites silently:** `CarrierGame.requestShipModel` / `requestStationModel`
`loadAsset(id).catch(() => keep procedural fallback)`. A bad id throws in
`getAsset`, the catch swallows it, and the hull/station just renders as the
procedural placeholder — no console error, no crash. So a wrong id looks like
"the model is a bit plain", not "the model is missing".

**How to apply:**
- When wiring a new hull/station, confirm the id with `findAsset(id)` (the game's
  own resolver), not by eyeballing the folder name.
- The guard `artifacts/carrier/src/game/factionAssets.test.ts` pins every id in
  `FLEET_GLB`/`FIGHTER_GLB`/`FACTION_STATIONS` to a resolvable, on-disk,
  parseable-with-vertices model, plus each ship's orient mode (auto vs explicit
  yaw) and each station's part count + fitMul. It parses models with three in
  Node from disk (no WebGL) per the offline-3d-model-verification approach.
- This carrier vitest suite needs its own `--filter @workspace/carrier` in the
  `test` validation command (it was added there); the other cabinets don't have
  test suites.
