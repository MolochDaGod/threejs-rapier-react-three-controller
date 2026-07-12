---
name: Voxel-world dungeon stages
description: How large voxel-world GLBs are shipped as explorable Animator stages (Dungeon reuse + meshopt + decoder wiring + size limits).
---

# Voxel-world stages (Breeze Island etc.)

Big Minecraft-style voxel-world GLBs are added as **Danger Room / Dungeon stages**,
NOT a new system: register them in `DungeonMaps.ts` (union + `DUNGEON_MAPS` record +
`DUNGEON_MAP_LIST` + `asDungeonMapId` validator). The Dungeon loader auto-fits, bakes
Rapier trimesh colliders + a down-ray navmesh, and auto-spawns — any scene GLB drops in.

## Shipping the asset
- Compress with `scripts/src/optimize-world.mjs` (gltf-transform: dedup/flatten/weld/join/prune +
  `meshopt()` = EXT_meshopt_compression + KHR_mesh_quantization). Shrinks blocky voxel exports
  ~10x while preserving triangle count / the crisp silhouette (Breeze Island: 382MB → 32.8MB).
- **You MUST wire `MeshoptDecoder` into the Dungeon `GLTFLoader`** (`loader.setMeshoptDecoder(...)`),
  or meshopt-compressed worlds silently fail to load. The decoder is a no-op for plain kits.
  Only the Dungeon loader was wired; other GLTFLoaders in the app are not.

**Why:** raw voxel-region exports are hundreds of MB; unquantized they're unshippable, and
plain three GLTFLoader can't decode EXT_meshopt_compression without the decoder.

## Scale gotcha
Engine units are metres (`CHARACTER_HEIGHT_M = 2.0`). The Dungeon auto-fit shrinks any model
with maxDim > 300u by ×0.01, which makes a ~500u island ~5u (tiny). Use the per-map `scale`
multiplier (applied AFTER auto-fit) to restore a walkable footprint (Breeze uses `scale: 60`
→ ~300u). Tune per world.

## Size limit (hard constraint)
~1GB uncompressed sources (e.g. the "medieval-city"/Kargeth GLB, 1.01GB) **OOM-kill the
optimizer** at the weld/join stage in-environment (SIGKILL, no JS error — native RAM, so
`--max-old-space-size` doesn't help). Such worlds also carry ~30M+ tris → too heavy for the
runtime navmesh raycast + render. They need a pre-decimated (`simplify`d) source first; deferred.

**How to apply:** for a new voxel world, run the optimizer, confirm output is a few tens of MB,
register in `DungeonMaps.ts`, and pick `scale` so the island reads at ~human scale for the 2m rig.
