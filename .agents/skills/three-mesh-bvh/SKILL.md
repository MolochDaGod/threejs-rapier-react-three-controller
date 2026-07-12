---
name: three-mesh-bvh
description: Fast BVH-accelerated raycasting and spatial/collision queries against three.js meshes (computeBoundsTree, acceleratedRaycast, shapecast, closestPointToPoint). Use when raycasting against complex geometry, doing mesh collision/character movement, navmesh/ground sampling, point/sphere/box proximity queries, or any time THREE.Raycaster is too slow.
---

# three-mesh-bvh

A Bounding Volume Hierarchy (BVH) for three.js that makes raycasting and spatial
queries against arbitrary `BufferGeometry` orders of magnitude faster. It is the
foundation for mesh-based collision, ground sampling, navmesh queries, and
center-screen aiming.

> Repo: https://github.com/gkjohnson/three-mesh-bvh — peer-depends on `three`.
> `three-player-controller` (its own skill) is built on top of this library.

## Install

```bash
# Animator app (a Vite leaf artifact → devDependencies; matches three ^0.184)
pnpm --filter @workspace/animator-app add three-mesh-bvh
```

`three-mesh-bvh` tracks the installed `three` version via a peer dependency; keep
it aligned with the workspace `three` pin (`^0.184.0`). When you add it to a Vite
artifact that imports `three/examples/jsm/*`, make sure `three` stays in the
Vite `resolve.dedupe` list (it already is in the Animator) so there is a single
`three` instance — BVH patches `THREE.BufferGeometry.prototype`, and a duplicated
`three` will silently leave geometries un-accelerated.

## Quick Start — accelerated raycasting

Patch the prototypes **once** at app boot, then any `THREE.Raycaster` that hits a
mesh whose geometry has a bounds tree is accelerated. This is a drop-in: existing
`raycaster.intersectObject(...)` call sites do not change.

```ts
import * as THREE from "three";
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from "three-mesh-bvh";

// Run once, app-wide (e.g. a bvh.ts module imported by main.tsx).
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// For each static/complex mesh you raycast against:
mesh.geometry.computeBoundsTree();

// Casting is unchanged — but now fast:
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true; // big speedup when you only need the nearest hit
raycaster.set(origin, dir.normalize());
const hit = raycaster.intersectObject(mesh, true)[0];
```

`firstHitOnly = true` is a three-mesh-bvh extension on `Raycaster`; set it
whenever you only care about the closest surface (aim rays, ground rays, picking).

### TypeScript

`three-mesh-bvh` ships its own ambient augmentation of the three.js prototypes.
If your tsconfig does not pick it up automatically, add a one-line reference in a
`*.d.ts`:

```ts
import "three-mesh-bvh";
```

## Disposal (important)

A bounds tree holds a typed-array index. Free it whenever you dispose the
geometry, or it leaks alongside the mesh:

```ts
mesh.geometry.disposeBoundsTree?.();
mesh.geometry.dispose();
```

In the Animator, every place that already disposes geometry on mid-game removal
(see the "Three.js disposal" memory) must also call `disposeBoundsTree()`. Never
build a bounds tree on a **shared/cached** template geometry you do not own —
build it on owned clones only, and dispose it with the clone.

## Spatial queries (collision, proximity, navmesh)

Beyond rays, the BVH answers shape queries used for character collision and
ground sampling. Use a single **merged collider mesh** (merge static level
geometry into one `BufferGeometry`, `computeBoundsTree()` once) and query it.

```ts
import { MeshBVH } from "three-mesh-bvh";

// Closest point on the collider to a probe point (capsule/sphere collision):
const target = {};
const bvh = mesh.geometry.boundsTree as MeshBVH;
bvh.closestPointToPoint(localProbePoint, target, 0, capsuleRadius);
// target.point / target.distance → push the capsule out along the surface normal.

// Custom traversal (capsule sweep, triangle collection, voxelization, etc.):
bvh.shapecast({
  intersectsBounds: (box) => box.intersectsSphere(probeSphere),
  intersectsTriangle: (tri) => {
    // resolve collision against `tri` …
    return false; // return true to stop early
  },
});
```

Query points/shapes must be in the collider mesh's **local space** — transform
the probe by `mesh.matrixWorld.invert()` first if the collider is not at the
origin.

## Skinned / animated meshes

A BVH is built against static geometry. For a skinned character that deforms
every frame, do **not** rebuild the tree per frame. Either:

- Cast against a cheap proxy collider (capsule/box) that follows the rig — this
  is what the Animator's combat hit volumes already do (pure `chest()` math), and
  what `three-player-controller` does (capsule vs. merged static collider); or
- If you truly need per-triangle skinned hits, see the library's `skinnedMesh`
  example — it is expensive and rarely worth it for gameplay.

## Adopting it in the Animator (streamlining raycasts)

Today the Animator's raycasting is scattered and **un-accelerated**, with each
subsystem owning a bare `THREE.Raycaster` or hand-rolled grid sampling:

- `src/three/aim/AimSystem.ts` — combat `screenCenterRay` + target intersection.
- `src/three/Controller.ts` — camera obstruction ray.
- `src/three/dungeon/Dungeon.ts` — manual down-ray navmesh **grid sampling**.
- `src/three/editor/EditorScene.ts` — click picking.

Consistent adoption path (additive, low-risk — does **not** touch the bespoke
combat controller or Rapier character physics):

1. Add a single `src/three/bvh.ts` that patches the prototypes and is imported
   from `main.tsx` before any scene is built.
2. Call `geometry.computeBoundsTree()` on **static** meshes only — loaded dungeon
   meshes, the voxel arena collider, editor scene objects — right after they are
   added; pair every `geometry.dispose()` with `disposeBoundsTree()`.
3. Set `raycaster.firstHitOnly = true` on the aim/ground/pick raycasters.
4. For the dungeon down-ray navmesh, replace grid sampling with a BVH ray (and/or
   `shapecast`) against the merged dungeon collider.

Leave Rapier's `KinematicCharacterController` (capsule physics in
`PhysicsSystem.ts` / `Dungeon.ts` / `VoxelArena.ts`) as-is; three-mesh-bvh is a
raycast/query accelerator, not a physics-engine replacement. Verify with
`pnpm --filter @workspace/animator-app run typecheck` (not `build`).

## API cheat-sheet

| Symbol | Purpose |
| --- | --- |
| `computeBoundsTree` / `disposeBoundsTree` | Prototype methods to build/free a geometry's BVH. |
| `acceleratedRaycast` | Replacement `Mesh.raycast` that uses the BVH. |
| `MeshBVH` | The tree object (`geometry.boundsTree`). |
| `raycaster.firstHitOnly` | Return only the nearest hit (faster). |
| `bvh.closestPointToPoint(p, target, min, max)` | Nearest surface point — capsule/sphere collision. |
| `bvh.shapecast({ intersectsBounds, intersectsTriangle })` | Custom traversal — sweeps, collection, voxelize. |
| `MeshBVHHelper` | Debug visualizer for the BVH (from `three-mesh-bvh`). |

## Pitfalls

- Forgetting `computeBoundsTree()` on a geometry → that mesh raycasts at normal
  (slow) speed with no error; profile if a cast is unexpectedly slow.
- Duplicated `three` instance → prototype patch applies to the wrong copy; keep
  `three` deduped.
- Querying world-space points against a transformed collider → transform into the
  collider's local space first.
- Building a tree on shared/cached geometry then disposing it → corrupts other
  users of that geometry. Own the geometry you accelerate.
