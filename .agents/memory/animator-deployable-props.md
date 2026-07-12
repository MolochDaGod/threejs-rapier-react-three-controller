---
name: Animator Voxel Editor deployable GLB props
description: How placeable GLB props (benches / build helpers) are wired into the Voxel Editor + play mode, and why they're normalized at load.
---

# Animator deployable GLB props

Props (crafting benches, modular build helpers) are a `DeployableKind` ("prop")
in the Voxel Editor, placed from the Deploy palette and rendered in both the
editor and play mode (`VoxelArena`).

## Normalize at load, never hardcode scale
**Why:** uploaded GLBs arrive at wildly different native scales AND off-origin
pivots (one prop was ~2m tall but centred far from origin with negative minY;
another was tiny at ~0.2m). A single shared loader (`three/voxel/props.ts`
`loadPropTemplate`) fits each model to a per-prop `targetHeight`, recentres X/Z,
and drops its base to Y=0 so it sits correctly on the deployable group origin.
**How to apply:** add new props to `PROPS` in `types.ts` with a `targetHeight`;
the loader handles fitting. Don't bake scale/offset into placement code.

## Shared template — clones must NOT be disposed per-instance
The template is loaded+normalized once and cached; every placement clones it
sharing geometry + materials. Editor/arena teardown only disposes their own
caches (`ownGeos`/`ownMats`), never the clones. Disposing a clone would corrupt
all other placements + the cached template.

## Adding a new DeployableKind needs lockstep edits
`DeployableKind` union → `DeployableData` field → `BrushState` field + every
`BrushState` literal (App.tsx DEFAULT_BRUSH **and** VoxelEditor's private
`brush`) → editor `buildDeployable`/`placeDeployable`/`emitStats` → palette UI →
play-time `buildDeployables`. Miss the `brush` literal and typecheck fails on a
missing required field.

## Follow-up: texture compression
The 3 source GLBs are ~30MB each (uncompressed high-res textures, geometry is
fine at 3k–60k tris). Consider KTX2/Draco or downscaled textures before shipping
many props — large downloads hurt editor/play load time.
