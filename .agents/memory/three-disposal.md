---
name: Three.js mid-game disposal
description: Why removing objects from a Three.js scene is not enough; what to dispose and when.
---

# Three.js GPU resource disposal

`scene.remove(obj)` only detaches from the scene graph — it does NOT free GPU
memory. Every geometry, material, AND texture must be `.dispose()`-ed explicitly.

**Why:** in a long-running game loop, short-lived objects (bullets, particles,
enemies, items, pickups) are spawned and removed constantly. If you only call
`scene.remove`, geometries/materials accumulate for the lifetime of the WebGL
context and degrade or crash rendering. A teardown-only dispose that traverses
the *current* scene never frees anything already removed mid-game.

**How to apply:** keep a recursive `disposeObject3D(root)` helper that traverses
and disposes `geometry`, each material, and every `THREE.Texture`-valued
property on each material (`material.dispose()` does not dispose its `.map`).
Call it at EVERY mid-game removal site, not just on unmount. For a class-based
engine mounted in React, also call it on the whole scene in `dispose()`.

## Shared catalog models vs. owned clones (cabinet launchers)

Models returned by `loadAsset` (`@workspace/assets`) are **shared, loader-cached
singletons** — their geometry/textures are reused across sessions. A cabinet's
engine clones them with `cloneCatalogModel` (which marks every mesh
`userData.shared = true`), so `disposeObject3D` on the clone frees only the
cloned materials and leaves shared geometry/textures intact.

**Rule:** a launcher must NEVER call `disposeObject3D(model.scene)` on the raw
`loadAsset` result (it is unmarked, so the disposer frees cached geometry/
textures and breaks every future load). On partial/cancelled load or an
engine-construction throw, dispose only the resources this attempt actually owns
(e.g. the animator from `createAnimatedCharacter`); let the engine's own
`dispose()` free its clone. When the engine took ownership, call
`engine.dispose()` and do NOT also dispose the animator (double-free).

**Why:** in the racer cabinet, disposing the raw cached car model on partial
failure corrupted subsequent loads. **How to apply:** any launcher that loads a
catalog asset + creates owned resources in parallel (`Promise.allSettled`).

## Hand-rolled clone + custom disposer must replicate the shared-geometry guard

If an engine clones a `loadAsset` model with a bare `THREE.Object3D.clone(true)`
(NOT `cloneCatalogModel`) and frees it through its OWN traversal disposer, that
disposer will free geometry shared with the loader cache and every sibling clone
unless you add the guard yourself. `clone(true)` shares geometry references; a
per-instance re-material step (cloning each material) makes only the *materials*
owned. **Rule:** flag every loaded-clone mesh (e.g. `userData.sharedGeo = true`)
at clone/re-material time and skip `geometry.dispose()` for flagged meshes in the
disposer — still dispose the owned cloned materials; textures survive
`Material.dispose()` so the shared diffuse map is safe.

**Why:** the carrier cabinet's `disposeGroup` is a custom traverse-and-dispose
(it predates/bypasses `cloneCatalogModel`), so destroying one fleet unit/station
was freeing geometry still used by live siblings and the cache. **How to apply:**
any engine pairing `m.scene.clone(true)` with a bespoke recursive disposer.

## Per-spawn material whose `.map` is a module-cached texture

A generic effect disposer that frees `material.map` for every non-shared effect
will silently dispose a *module-cached singleton* texture if an effect uses one
(e.g. Animator `Vfx` ground rings/shockwaves use the shared `ringTexture()` +
`unitGroundPlane()` from `fx/fxTextures.ts`, where textures are cached and meant
to live forever). The effect owns its tinted material (must dispose) but NOT the
map. **Rule:** distinguish "owns material" from "owns map" — add a per-effect
`sharedMaps` flag and skip `map.dispose()` when set; only effects whose texture
is freshly built per spawn (e.g. `sparkTexture()` returns a new `CanvasTexture`
each call) should dispose their map. **Why:** without it, every ring/shockwave
teardown disposes the shared atlas and forces a GPU re-upload on the next cast —
self-heals visually but churns; blended impacts that fire several rings per hit
multiply the churn.
