---
name: Animator instanced billboard particles (SmokeFx)
description: The single-draw-call GPU billboard particle subsystem in the Animator Vfx — technique source, blend choice, and the lockstep wiring needed to add presets.
---

# SmokeFx — instanced billboard particles

`src/three/SmokeFx.ts` is a self-contained GPU-instanced billboard particle
system, owned by `Vfx` (constructed in ctor, ticked in `Vfx.update`, freed in
`Vfx.dispose`). It complements the older per-effect `Effect[]` meshes and the
GPU flame/blade trails — it is NOT a replacement for them.

Technique adapted from the illuminsi / MolochDaGod "smoke·fire·trace·steam"
CodePen (MIT): ONE `InstancedBufferGeometry` quad, one draw call, per-instance
attributes, and the billboard **mode packed into `iQuat.w`**:
- `3` camera-facing (puffs, smoke, fire, embers, sparks)
- `4` cylindrical / world-up
- `6` axis-aligned streak (bullet trails / traces) — local-Y runs along
  `iQuat.xyz`, local-X stays perpendicular to both axis and view.

**Why additive, not the source's "over" blend:** uses premultiplied
`CustomBlending` One+One (rgb *= a in the fragment shader). This is
order-independent, so it needs **no per-frame CPU depth sort** (the source
sorts every frame), and it matches the project's all-additive VFX aesthetic.
Trade-off: dark smoke on a bright background reads weak — keep smoke/puff
colours light/pale (they're tinted in the presets, e.g. puff `0xdfe6ee`).

**How to apply / gotchas:**
- `cameraPosition` is a three.js built-in uniform for `ShaderMaterial` — the
  billboard maths use it directly; do NOT thread a camera in.
- Custom instance attrs are `i`-prefixed (`iOffset/iScale/iQuat/iRot/iColor/
  iBlend/iTex`) to avoid colliding with three's built-in `color/position/uv`.
- `mesh.frustumCulled = false` + a huge boundingSphere: particles roam far from
  the mesh origin, so culling would pop them.
- Adding a preset is a 3-file lockstep, same as the rest of the VFX library:
  method on `SmokeFx` → delegating method on `Vfx` → entry in
  `editor/vfxCatalog.ts` (group `"smoke"`) + a `case` in `EditorScene.playVfx`.
  The `VfxPreset.group` union in `editor/types.ts` must include the group.
- Continuous effects (`castSwirl`, `smokeColumn`) push timed `Emitter`s; bursts
  (`puff`, `smokePop`, `bulletTrail`, `fireBurst`) spawn immediately. Pool is
  capped at `MAX` (2000) — `alloc()` returns null when full, callers `break`.
- `smokePop` is layered into `Vfx.impact()`, so every melee hit already spawns
  instanced smoke + airborne spark debris.
