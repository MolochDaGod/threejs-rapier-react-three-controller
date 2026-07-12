---
name: Arcade multi-game route + Three.js dedupe
description: Lessons from hosting multiple disposable Three.js game engines behind one Play route in artifacts/arcade.
---

# Hosting multiple Three.js games behind one route

## Tag HUD snapshots with their game id
When a single route component (wouter `/play/:id`) mounts different game engines
that each push a *different* HUD shape via an `onHud` callback, store the snapshot
together with the id of the game that produced it (`{ id, state }`), and only
render a HUD when that tag matches the current route id.

**Why:** wouter reuses the same component instance across `/play/:id` changes, so
a HUD snapshot from the previous game lingers in state for one render after
switching. Rendering `hud as HudStateA` based only on the new route id feeds the
wrong shape to the new HUD and throws (e.g. `state.weapons.map` on a boat HUD).
A union `HudA | HudB` cast is unsafe without a runtime discriminator.

**How to apply:** capture `gameId` in the engine-mount effect closure, set
`{ id, state }` in `onHud`, derive `liveHud = hud?.id === gameId ? hud.state : null`,
and clear HUD in the effect cleanup. Effect deps must include `gameId` so the
engine is re-created when switching between two playable games.

## Adding the first three/examples/jsm addon triggers "Multiple instances of Three.js"
The console warns `THREE.WARNING: Multiple instances of Three.js being imported.`
the first time you import a `three/examples/jsm/*` addon (e.g. OrbitControls)
alongside `import * as THREE from "three"`.

**Why:** Vite can resolve the addon's internal `import ... from "three"` to a
second copy in dev. Fix by adding `"three"` to `resolve.dedupe` in the artifact's
`vite.config.ts`. Requires a workflow restart to take effect.
