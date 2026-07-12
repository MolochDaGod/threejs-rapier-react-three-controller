---
name: Offline 3D model facing/size verification
description: How to visually verify GLB/OBJ model orientation and scale when the headless screenshot browser has no WebGL and the app is Puter-gated.
---

# Verifying 3D model facing & size without a live render

The headless screenshot browser CANNOT create a WebGL context, and the studio
cabinets (carrier, arcade, voxel-engine, explorer, racer, skies) sit behind a
Puter guest gate that automated browsers can't drive. So you cannot screenshot a
running 3D scene to check whether a hull faces the right way or a station is sized
sensibly.

**Technique that works:** parse the asset offline with three in Node and
software-rasterize a silhouette to a PNG you can open with the `read` tool.

**Why:** it's the only way to get an actual picture of model geometry for these
artifacts; pure bbox/taper heuristics are unreliable for near-square or
wing-dominated hulls (the wide axis is the wingspan, not the length).

**How to apply:**
- Run the script FROM the artifact dir (e.g. `artifacts/carrier`) so Node resolves
  `three` from that package's `node_modules`. `GLTFLoader`/`OBJLoader` from
  `three/examples/jsm/loaders/*` work via `.parse(arrayBuffer/text)`.
- No PNG lib is installed — encode PNG manually with node's `zlib.deflateSync`
  (IHDR + IDAT scanlines with filter byte 0 + CRC32 chunks).
- Collect world-space triangles (apply `matrixWorld`), project top-down (+X right,
  +Z up via `screenY = cy - z*s`) and fill triangles with a barycentric
  rasterizer. Draw +Z/+X axis arrows for reference.
- For facing: render raw (yaw 0), read where the nose points, then compute the yaw
  that rotates that nose to +Z. For sizing: lay all models out at TRUE relative
  scale (uniform px-per-unit) with a known-scale reference (e.g. the fighter).
- Clean up ALL scratch scripts (`artifacts/*/_*.mjs`) and output PNGs before
  finishing — they are throwaway.

**Carrier finding (now also encoded in `factionAssets.ts`):** the fleet + fighter
GLB pack is authored nose-toward local -Z (so yaw = π points it at +Z); the two
capital hulls (cruiser-01/destroyer-01) are authored nose-toward -X (yaw = π/2).
