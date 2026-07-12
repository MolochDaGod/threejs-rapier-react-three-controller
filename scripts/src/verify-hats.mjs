// One-off visual verification for avatar hats: replicates hats.ts normalize
// math (bake world transform → fit width → base at y=0, mount at y=0.5+def.y)
// and splats vertex point clouds over a unit head cube outline, front + side
// views, into /tmp/hat-verify/*.png. Headless-safe (no WebGL / GLTFLoader).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const HATS_DIR = resolve(import.meta.dirname, "../../artifacts/animator/public/avatar/hats");
const OUT_DIR = "/tmp/hat-verify";
mkdirSync(OUT_DIR, { recursive: true });

const HAT_DEFS = {
  pirateVoxel: { src: "voxel", fit: 1.45, y: -0.1, fixVoxelRoot: true },
  pirate: { src: "pack", node: "Pirate_low", fit: 1.5, y: -0.06 },
  cowboy: { src: "pack", node: "Cowboy_low", fit: 1.55, y: -0.05 },
  witch: { src: "pack", node: "Witch_low", fit: 1.45, y: -0.06 },
  tophat: { src: "pack", node: "TopHat_low", fit: 1.2, y: -0.03 },
  princess: { src: "pack", node: "Princess_low", fit: 0.85, y: -0.02 },
  astronaut: { src: "pack", node: "Astronaut_low", fit: 1.35, y: -0.45, rotY: Math.PI / 2 },
  hood: { src: "pack", node: "Hood_low", fit: 1.35, y: -0.55 },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** 4x4 column-major multiply (glTF convention). */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function apply(m, v) {
  const [x, y, z] = v;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Rotation matrix for exact -90° about X (column-major). */
const NEG_90_X = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

/** Collect world-space vertices of `root` node subtree (or whole scene). */
function collectVerts(scene, wantedName, fixVoxelRoot) {
  const pts = [];
  const visit = (node, parentM, inWanted) => {
    const local =
      fixVoxelRoot && node.getName() === "Sketchfab_model" ? NEG_90_X : node.getMatrix();
    const m = mul(parentM, local);
    const hit = inWanted || !wantedName || node.getName() === wantedName;
    const mesh = node.getMesh();
    if (hit && mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        for (let i = 0; i < arr.length; i += 3) pts.push(apply(m, [arr[i], arr[i + 1], arr[i + 2]]));
      }
    }
    for (const child of node.listChildren()) visit(child, m, hit);
  };
  for (const node of scene.listChildren()) visit(node, IDENT, false);
  return pts;
}

async function render(name, rawPts, def) {
  // corrective yaw about Y, applied before the bbox like hats.ts normalize
  const th = def.rotY ?? 0;
  const pts = th
    ? rawPts.map(([x, y, z]) => [x * Math.cos(th) + z * Math.sin(th), y, -x * Math.sin(th) + z * Math.cos(th)])
    : rawPts;
  // normalize exactly like hats.ts: fit width (max x/z), centre, base y=0
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts)
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const centre = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2];
  const s = def.fit / (Math.max(size[0], size[2]) || 1);
  const mountY = 0.5 + def.y;
  const world = pts.map((p) => [
    (p[0] - centre[0]) * s,
    (p[1] - centre[1]) * s + (size[1] * s) / 2 + mountY,
    (p[2] - centre[2]) * s,
  ]);

  // draw: 2 views side by side, ortho. span [-1.3, 1.9] both axes.
  const W = 240, H = 240, PAD = 8;
  const buf = Buffer.alloc(W * 2 * H * 3, 24);
  const put = (vx, px, py, r, g, b) => {
    const x = Math.round(((px + 1.3) / 3.2) * (W - 2 * PAD)) + PAD + vx * W;
    const y = H - PAD - Math.round(((py + 1.3) / 3.2) * (H - 2 * PAD));
    if (x < vx * W || x >= (vx + 1) * W || y < 0 || y >= H) return;
    const i = (y * W * 2 + x) * 3;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
  };
  // head cube outline [-0.5,0.5]^3
  for (let t = -0.5; t <= 0.5; t += 0.01) {
    for (const [a, b] of [[t, -0.5], [t, 0.5], [-0.5, t], [0.5, t]]) {
      put(0, a, b, 90, 110, 150); // front view (x,y)
      put(1, a, b, 90, 110, 150); // side view (z,y)
    }
  }
  // front-face marker: nose dot at (0, 0, +0.5) → side view z=+0.5
  for (let d = -0.04; d <= 0.04; d += 0.01) {
    put(0, d, 0, 220, 120, 80);
    put(1, 0.5 + d, 0, 220, 120, 80);
  }
  for (const [x, y, z] of world) {
    put(0, x, y, 235, 220, 160);
    put(1, z, y, 160, 220, 235);
  }
  await sharp(buf, { raw: { width: W * 2, height: H, channels: 3 } })
    .png()
    .toFile(`${OUT_DIR}/${name}.png`);
  console.log(
    `${name}: fitted w=${(size[0] * s).toFixed(2)} h=${(size[1] * s).toFixed(2)} d=${(size[2] * s).toFixed(2)} base y=${mountY.toFixed(2)}`,
  );
}

const packDoc = await io.read(`${HATS_DIR}/hat-pack.glb`);
const voxelDoc = await io.read(`${HATS_DIR}/pirate-voxel.glb`);
for (const [name, def] of Object.entries(HAT_DEFS)) {
  const doc = def.src === "voxel" ? voxelDoc : packDoc;
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const pts = collectVerts(scene, def.node, def.fixVoxelRoot);
  if (!pts.length) {
    console.error(`${name}: NO VERTICES (node "${def.node}" not found?)`);
    continue;
  }
  await render(name, pts, def);
}
console.log(`wrote ${OUT_DIR}`);
