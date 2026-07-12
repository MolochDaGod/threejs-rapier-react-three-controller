---
name: VFX three.quarks lib
description: Non-obvious lifecycle rules for the shared @workspace/vfx three.quarks wrapper consumed by both games.
---

# Shared VFX package (`@workspace/vfx`)

A per-scene `VfxManager` wraps a three.quarks `BatchedRenderer`: load prototypes
once, `play(key, pos, opts)` for one-shots, `track(key, pos, opts)` for a
caller-driven looping handle (projectile trails), `update(dt)` per frame,
`dispose()` on teardown. Effects are addressed by **semantic keys** (`muzzleFlash`,
`projectileTrail`, `bloodImpact`, `explosion`, ...) mapped via the `EFFECTS`
registry in `effects.ts` to EITHER a JSON file (`kind:"json"`) OR a code builder
(`kind:"built"`), so retuning/swapping never touches either game.

## Effect registry: json vs built (test-safety boundary)
- `load(keys)` branches on `EFFECTS[key].kind`. `json` keys `await loadEffectJson`
  (base64-embedded textures, no extra fetch); `built` keys `await def.load()` then
  dynamically `import("./textures.js")` to resolve PNGs and call `spec.build(texs)`.
- The dynamic imports of `builders.js`/`textures.js` are **deliberately lazy** so
  vitest (which mocks `three.quarks` + `./urls.js` and only loads json keys) never
  pulls them into the test path. Do NOT static-import builders/textures at module
  top of VfxManager — it breaks the test harness.
- Mesh primitives (beam/shockwave/weaponTrail) use textures via `ensurePrimTextures()`
  lazy swap + `setMap`, so they also stay out of the synchronous import path.

## Shared-texture ownership (cost a real bug — multi-manager teardown)
- `textures.ts` `loadTexture` returns SHARED, module-cached `THREE.Texture`
  instances reused across EVERY `VfxManager` for the page lifetime (the cache is
  never freed — small, bounded). Both games remount engines, so manager A's
  `dispose()` must NOT free a borrowed texture or it invalidates the GPU texture
  for manager B / the next mount → effects silently render blank.
- `VfxManager` tracks every borrowed texture in a `sharedTextures` Set (added in
  the `built`-effect load branch AND `ensurePrimTextures`). `dispose()` only frees
  prototype textures NOT in that set: `json` prototypes own their base64-parsed
  textures (free them), `built` prototypes + primitives borrow shared ones (leave
  them). Primitive textures are never disposed — just drop the ref.
  **Why:** `Material.dispose()` never frees its `.map`, so the only leak/over-free
  risks are the explicit `texture.dispose()` calls — keep them off shared instances.

## Mesh primitives (NOT particles) — `primitives.ts`
- `beam(from,to,opts)`→BeamHandle (`setEndpoints`/`stop`), `shockwave(pos,opts)`
  auto-cleaning expanding ring, `weaponTrail(opts)`→TrailHandle (`push(tip,base)`
  each frame, then `stop()`). All are tracked in `meshes[]`, advanced in `update()`,
  and reaped in `dispose()` alongside `primTextures`. Each accepts `THREE.Texture|null`.
- Weapon-trail callers must `group.updateMatrixWorld(true)` before `localToWorld`/
  `applyMatrix4` to sample the blade tip/base, then `stop()` the handle on swing end,
  disable, AND dispose. Without a real weapon-node transform (e.g. arcade Explorer's
  animator), approximate tip/base from the avatar facing+height.

## Knockback (gameplay, not VFX)
- Knockback lives in the gameplay sim, decoupled from the visual: voxel-engine
  `CreatureSystem` carries transient `knockX/knockZ` impulse fields added to the
  per-frame horizontal move in `physics()` and decayed with `exp(-KNOCK_DECAY*dt)`
  (snap to 0 under a small epsilon) so it's a brief shove, not drift. `damageCreature`
  sets them from a `knockDir`+strength and emits `combat:creature-death` for the
  death VFX (boneDebris + shockwave).

## Dark/elemental built effects (fire + dark families)
- **Additive black is invisible.** A "dark" body can't use the additive+white+tint
  convention. Render the dark BODY (void cores, mist, columns) with `normalBlend`
  + a baked near-black `startColor`; keep energy ACCENTS (auras, rings, sparks)
  additive+white so the per-spawn `opts.color` tint still reads cleanly.
- `ColorOverLife` (incl. `fadeOut`) MULTIPLIES by `startColor`, so a baked dark
  RGB survives the white-RGB/alpha fade gradient — the body stays dark and just
  fades out. The `opts.color` tint multiplies again on top via `material.color`.
- **Ground-flat ring/vortex:** `DonutEmitter` emits in its local XY plane (normal
  +Z). Set `emitter.rotation.x = -Math.PI/2` to lay it on the world ground; that
  maps local +Z → world +Y, so an `OrbitOverLife` meant to spin around world-up
  must use axis `(0,0,1)` (local), not `(0,1,0)`. `GravityForce(center0, +mag)`
  pulls particles inward for a vortex/in-draw.
- `HorizontalBillBoard` keeps sprites flat regardless of emitter rotation — use it
  for ground discs/rings/vortex arms.

## Non-obvious three.quarks rules (cost real debugging)
- **A ParticleSystem self-disposes if its top-most ancestor is not a `THREE.Scene`.**
  The BatchedRenderer AND every spawned instance must be added directly under the
  actual scene — not a detached group — or systems vanish on first update.
- **`Object3D.clone()` shares materials/textures by reference.** Per-instance
  dispose must NOT free shared prototype materials; only dispose per-instance
  *tinted* clones (made when `opts.color` is set). Free the prototype
  materials/textures exactly once in `dispose()`.
- **Completion detection:** `setAutoDestroy(true)` + emitter drains
  (`particleNum===0`) → quarks removes the emitter from its parent. Detect "all
  done" via `runOnAllParticleEmitters` count, plus a TTL fallback (~4s) that
  force-cleans looping prototypes used as one-shots so nothing lingers.
- **For tracked/looping handles:** force `system.looping = true`, then `restart()`;
  on `stop()` call `setAutoDestroy(true)` BEFORE `endEmit()` and cap a short
  drain TTL so the husk frees itself.
- **`ParticleEmitter.system` is typed as a minimal `IParticleSystem`** lacking
  `material`/`texture`/`dispose`; cast `pe.system as ParticleSystem` to reach them.

**Why:** these are emergent runtime behaviors, invisible in the type signatures;
getting them wrong leaks GPU resources across a long session or makes effects
silently never appear.

**How to apply:** when adding new effect keys or a new host game, reuse
`VfxManager` as-is, gate `update()` behind the host's play/enabled flag, and call
`dispose()` BEFORE the host's own scene sweep so quarks-owned objects go first.
Both Vite configs already `dedupe: ["three"]`, required since quarks imports three.
