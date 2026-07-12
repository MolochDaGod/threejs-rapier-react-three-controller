---
name: Voxel terrain generation
description: Determinism, seamlessness, and budget rules for the voxel-engine TerrainGenerator — read before changing terrain, trees, ores, or world size.
---

# Voxel terrain generation (voxel-engine / Game Studio)

The terrain generator must stay **pure-data** (no Three.js in the generation/voxel
layers) and **deterministic from the world seed alone**, because chunks are
generated independently and on demand. Two chunks that share a feature must
reconstruct identical voxels with no communication.

## Determinism rules (non-negotiable)
- Every generation decision keys off **world-space coords + seed**, never
  chunk-local indices. Height, mountain mask, caves, and ores all do this.
- For one-shot per-voxel rolls (underworld accents) use the module-level
  `hash01(x,y,z,seed)` (inlined mulberry32 finalizer), NOT a fresh
  `mulberry32()` closure per voxel. At the current world size the per-voxel loops
  run into the millions, so a closure-per-voxel caused real GC churn / load
  stalls. Use `mulberry32` only where you need a short *sequence* (e.g. a tree's
  shape or an ore vein's accretion walk), and seed it from the world column/cell.

## Seamlessness rules
- **Structures that span chunk borders (trees) must be stamped, not owned.**
  Trees run in a separate margin-expanded pass (`placeTrees`, margin = widest
  canopy radius). Each chunk scans its columns plus a margin, recomputes the
  same per-column tree (existence + shape from world column + seed), and stamps
  with world->local Y conversion. `Chunk.set/get` clip out-of-bounds, so every
  overlapping chunk draws only its own slice and the slices line up — horizontally
  AND vertically (tall conifers crossing a cy boundary). Do not move tree
  placement back into the terrain fill loop; that reintroduces border clipping.
- A cheap existence roll runs **before** the costly `columnAt`, so the margin
  pass only pays for the ~few percent of columns that actually grow a tree.
- **Ores are veins, not per-voxel specks, and follow the same stamp-not-own
  rule.** `placeOreVeins` partitions world space into `VEIN_CELL`^3 cells; each
  (cell, ore-type) pair gets one independent `hash01` existence roll, then a
  `mulberry32` seeded from cell+type+seed picks the origin/size and grows a
  connected blob by accretion (bounded to `VEIN_MARGIN` reach). The pass runs
  after the fill loop and stamps ore ONLY onto voxels that are currently `stone`
  and in-bounds, so caves stay carved and a vein crossing a chunk border is
  reconstructed identically in each chunk (margin = `VEIN_MARGIN`). Vein growth
  uses reusable instance scratch arrays (`veinX/Y/Z`) to stay allocation-free.
  Independent per-type rolls (not a cumulative roll) let several ores coexist in
  one cell. Do NOT move ore back into the fill loop or use a cumulative roll —
  that reintroduces lone specks and starves rare ores at deep bands.

## Realm boundary
- Y=0 separates overworld (cy>=0, heightmap) from underworld (cy<0, netherstone
  caverns). Chunk bounds must stay aligned to this boundary — see
  `voxel-realm-split.md`. Terrain writes chunks directly (no `voxel:set` events),
  so the studio `WorldRecorder` does not record generation. Keep it that way or
  saved worlds will balloon.

## World size / budget
- `WORLD_DIMS.worldRadius` controls map size; the Engine builds from this
  constant so changing it affects new *and* existing projects (saved edits keep
  absolute coords). Larger radius scales chunk count by the square — watch
  initial-generation cost. Streaming is fixed-rate (`processGenQueue` +
  `chunkRenderer.update` per frame), not time-budgeted; if a much larger world is
  requested, adaptive per-frame budgeting is the next lever.
