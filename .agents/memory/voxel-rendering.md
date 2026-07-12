---
name: Voxel stylized rendering
description: Design decisions for AO-baked greedy meshing, two-layer (opaque/water) meshing, and custom ShaderMaterials in the voxel engine.
---

# AO-aware greedy meshing
AO must be part of the greedy-merge equivalence key, not just block id. Quads only merge when block id AND the 4 corner AO values match.
**Why:** baked per-vertex AO creates gradients across a face; merging cells with different AO would smear/flatten the gradient and produce visible banding.
**How to apply:** when editing the mesher, keep AO packed into the merge mask. For back faces, reverse vertex order AND the AO array together (p0,p3,p2,p1 / b0,b3,b2,b1) or AO will mismatch the corners. The diagonal-flip in MeshBuilder.addQuad picks triangulation from AO of the actually-submitted vertex order — keep that ordering consistent.

# Two-layer meshing (opaque vs water)
Each dirty chunk is meshed twice via a BlockFilter predicate: opaque (solid && !transparent) and water (solid && transparent), each with its own material/mesh.
**Why:** water needs a separate transparent ShaderMaterial (depthWrite=false, waves, fresnel); mixing into one mesh breaks sorting/blending.
**Trade-off:** ~2x meshing CPU per dirty chunk. Acceptable at current chunk budget (update(4)). If streaming/edit-heavy load regresses, switch to a single-pass classifier that emits per-material vertex streams in one sweep.

# ShaderMaterial gotcha
With THREE.ShaderMaterial (not Raw), position/normal/uv/matrices AND `cameraPosition` are auto-injected in BOTH vertex and fragment prefixes — safe to use cameraPosition in the fragment shader. Only declare extra custom attributes (`attribute vec3 color; attribute float ao;`). Do NOT set vertexColors (that would redeclare `color`).
