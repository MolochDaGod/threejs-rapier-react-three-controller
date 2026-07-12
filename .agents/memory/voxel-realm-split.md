---
name: Voxel realm split (overworld / underworld)
description: How the voxel-engine splits realms by chunk Y, for anyone adding generators or vertical features.
---

# Voxel realm split at Y=0

The voxel engine packs two realms into one world along the Y axis:
- **Overworld**: chunks with `cy >= 0` (world Y ≥ 0), the noise heightmap.
- **Underworld**: chunks with `cy < 0` (world Y < 0), a cavern realm.

`TerrainGenerator.generate` branches on `chunk.cy < 0` and dispatches the whole
chunk to one realm. This is only safe because **the realm boundary (Y=0) lands
exactly on a chunk boundary** (chunks are 32 tall, aligned at multiples of 32),
so no chunk straddles both realms.

**Why:** keeps each chunk's generation single-purpose and avoids per-voxel realm
checks crossing a mid-chunk seam.

**How to apply:** if you ever change `CHUNK_SIZE` or move the realm boundary off a
multiple of 32, this dispatch breaks — handle the mixed chunk explicitly. New
generators that want both realms should follow the same `cy`-sign dispatch. The
underworld seals itself with a solid netherstone barrier just below Y=0 and a
bedrock floor at `underworldFloor`; caverns are carved with a seed-derived 3D
noise (`caveNoise`) distinct from the heightmap noise so worlds stay seamless.
The engine queues `cy` from `-worldDepth` to `worldHeight-1`, sorted by 3D
distance to origin so overworld streams first, underworld after.
