---
name: Voxel per-vertex material id for shaders
description: How to give voxel block types distinct procedural surface looks without breaking greedy meshing or the no-image-asset rule.
---

# Per-vertex material id (`mat`) for stylized block surfaces

To texture specific block types differently (e.g. leaf dapple on foliage,
vertical grain on bark) in the voxel-engine renderer, thread a per-vertex `mat`
float through the whole mesh pipeline and branch on it in the terrain GLSL
shader. There is intentionally **no** image-texture path — all surface detail is
procedural value noise in `StylizedMaterials.ts`.

**Rule:** the material id must be derived deterministically from the block id
(via `block.meta`, e.g. `foliage`/`bark` flags in `BlockRegistry`), never from
position or anything that varies within a block type.

**Why:** the greedy mesher merges faces using only `blockId(sign) + packed AO` as
the merge key. A material id that is constant per block id rides along for free —
it can be written to all 4 quad vertices without affecting merging. If `mat` ever
varied within a block type it would silently break merges or interpolate across a
face (the shader thresholds like `vMat > 0.5 && < 1.5` assume a face is uniform).

**How to apply:**
- Add the value in `MeshBuilder.addQuad` (one number, pushed for all 4 verts),
  carry it in `MeshData`, publish it as a geometry attribute in
  `ChunkMesher.meshDataToGeometry`, declare `attribute float mat;` +
  `varying float vMat;` in the terrain shader.
- The same attribute lands on the water-layer geometry too; that is harmless —
  WebGL ignores vertex attributes the active program does not reference.
- Keep the per-material branches as cheap noise tweaks on `base` color; they run
  per-fragment for all terrain, so avoid heavy work.
