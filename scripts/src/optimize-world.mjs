// Optimize a large voxel-world GLB for use as an Animator dungeon stage.
//
// Welds + joins primitives then applies EXT_meshopt_compression (with
// KHR_mesh_quantization) via meshoptimizer, which shrinks blocky voxel exports
// by ~10x while preserving triangle count / the crisp voxel silhouette. The
// output loads through the meshopt decoder wired into the Dungeon GLTFLoader.
//
// Usage: node scripts/src/optimize-world.mjs <src.glb> <out.glb>
//
// NOTE: gltf-transform loads the whole document into memory, so multi-hundred-MB
// sources need a raised heap (e.g. `node --max-old-space-size=9216 ...`).
// Sources around ~1GB uncompressed can exhaust available RAM (OOM at weld/join)
// and should be pre-decimated before running this.
import { NodeIO } from "@gltf-transform/core";
import { KHRMeshQuantization, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptEncoder } from "meshoptimizer";
import { dedup, flatten, weld, join, prune, meshopt } from "@gltf-transform/functions";
import fs from "node:fs";

await MeshoptEncoder.ready;

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("Usage: node scripts/src/optimize-world.mjs <src.glb> <out.glb>");
  process.exit(1);
}

const io = new NodeIO()
  .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

const doc = await io.read(src);
const countTris = () =>
  doc
    .getRoot()
    .listMeshes()
    .reduce(
      (s, m) =>
        s +
        m
          .listPrimitives()
          .reduce((a, p) => a + (p.getIndices()?.getCount() || p.getAttribute("POSITION")?.getCount() || 0) / 3, 0),
      0,
    );
const tris0 = countTris();

await doc.transform(
  dedup(),
  flatten(),
  weld(),
  join(),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: "high" }),
);

await io.write(out, doc);
const sizeMB = (fs.statSync(out).size / 1e6).toFixed(1);
console.log(
  `OUT ${out}  size=${sizeMB}MB  meshes=${doc.getRoot().listMeshes().length}  tris ${Math.round(tris0).toLocaleString()} -> ${Math.round(countTris()).toLocaleString()}`,
);
