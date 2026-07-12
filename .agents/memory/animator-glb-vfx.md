---
name: Animator GLB-driven VFX
description: How the animator Danger Room spawns model-driven VFX (slash arcs, lightning) by cloning shared GLB templates, and the per-instance disposal trap.
---

The animator Danger Room (`artifacts/animator`, the "DANGERROOM" preview — its
skill bar matches `assets.ts` CHARACTERS/WEAPONS) renders combat VFX through
`src/three/Vfx.ts`. It is a self-contained artifact: VFX GLBs are **self-hosted**
in `public/models/vfx/` and loaded via `asset("models/vfx/…")` + GLTFLoader (no
`@workspace`/`@assets` imports allowed here).

**The original slash was a thin `THREE.Line` crescent (`slashArc`)** — users
called it the worst-looking effect. It was replaced with a textured anime arc
cloned from `attack-slashes.glb` (6 `Circle` meshes, BLEND, additive); `slashArc`
now delegates to `glbSlash` and only falls back to the line until the GLB loads.

**Per-instance GLB VFX must NOT dispose shared resources.** Effects spawned by
cloning a template share the template's geometry AND textures (`material.clone()`
copies the `.map` *reference*). Mark such effects `shared: true` so the disposal
path frees only the cloned material — never its `.map` or geometry — otherwise the
first effect that ends corrupts the template and all later spawns render black/
empty. Template geometry+textures are freed once in `Vfx.dispose()`, not per use.
**Why:** disposing a shared texture/geo per-instance is silent — it only shows up
as broken VFX after the first one expires.

**Animated GLB effects** (e.g. `lightning.glb`, skinned, 1 clip) need an
`AnimationMixer` advanced from the Vfx update loop (Effect gained an optional
`mixer`). Same `shared` rule applies to their cloned materials.

**Fireball caveat:** `4_diferent_colors_of_fire_ball_anime_effect.glb` packs all
4 color variants strung along +Z (node translations ~0 / 131 / 256 / 387 in cm,
Sketchfab root scale). Cloning the whole scene shows all four at once — to use one
color you must isolate a cluster by baked world-Z (or hide the others) before
re-centering. Deferred for that reason; slash + lightning shipped first.

**Mixed-ownership spawns (deformed crescents) need `ownGeos`.** The editor's
per-crescent slash tool (`slashArcParam`) clones+deforms geometry per spawn but
keeps the template's shared texture. `shared:true` alone would leak the cloned
geo (geo disposal is skipped under `shared`); `shared:false` would dispose the
shared `.map`. Resolved by an `Effect.ownGeos?` field that `free()` ALWAYS
disposes regardless of `shared` — so deformed spawns use `shared:true` + `geos:[]`
+ `ownGeos:[clonedGeo]`. **Why:** the two ownership axes (geo vs texture/map) were
coupled under one flag; deform needs them split. MeshBasic ignores normals, so
deform skips `computeVertexNormals`.

**Stable crescent indexing:** editor tabs map to crescents by sorting the loaded
meshes by name (tie-broken by traversal order), since GLB traverse order is not
guaranteed. The random combat `slashArc()`/`glbSlash()` path is untouched.

**Model projectiles don't home until their GLB caches.** `flyModel*` (incl. the
turn-rate homing variant used by the "soul" skill) falls back to a straight
`bolt`/`flyModel` while `ensureModel()` is still lazy-loading the template, so the
*first* cast of any new model projectile flies straight, not seeking. **Why:**
combat never blocks on a download; don't debug "homing is broken" before the
template has loaded once.

**darkBlades is NO LONGER GLB-driven.** It used to fly `triple-dark-blade.glb`,
but that GLB embeds an unwanted humanoid figure, so it was dropped from `MODEL_VFX`
and `castDarkBlades`/`castDarkBladesAt` now spawn THREE procedural crescent
"air-blades" (partial-torus arcs via `flySlashBlade`) that fly forward, fan into a
diagonal, and diverge — a Zoro-style split sword slash. Only the centre lane (0)
carries the gameplay `onHit`; the flankers are cosmetic. The `playSkill` darkBlades
case is unchanged, so collider-emission + Studio/Targets callers are unaffected.
**Why:** the source GLB shipped a character mesh; don't reach for that GLB again.

No WebGL in the Replit sandbox → the Danger Room shows "WebGL unavailable" in
screenshots. VFX look/orientation can only be verified by the user in a real
browser; the arc's facing (rotateY(π/2)+roll on the actor Y-quat) was a best guess.
