// One-off builder for the Exo-Armour Mech Mode suit-up mech.
//
// Source: user-provided "Mecha_00" pack (jimmys7777.itch.io):
//   attached_assets/Mech_Char_Mesh_1783547343767.fbx  (modular mech kit)
//   attached_assets/Mech_00_Anim_1783547348810.fbx    (87-bone generic rig clips)
//   attached_assets/Mech_00_1781991442813.zip         (texture palettes)
//
// The mesh FBX ships 44 skinned part meshes (Core_* shared parts + Base_S/M/L
// variant sets) and FBXLoader materializes ONE DUPLICATE 87-bone skeleton PER
// MESH (44 x 87 = 3828 bones, all name-collided). This script:
//   1. keeps a single assembled variant: Core_* + Base_M_* meshes,
//   2. collapses everything onto ONE canonical skeleton (the copy rooted at the
//      outermost `c_traj`), remapping every kept mesh's skeleton bones by name
//      and pruning the other 43 duplicate rigs out of the bone tree,
//   3. drops each mesh's second "OutLine" geometry group (inverted-hull toon
//      shell — wrong look for the Studio's lighting) keeping the "Color" slot,
//   4. binds a curated subset of clips from the anim FBX (same rig/bone names),
//   5. exports a GLB via GLTFExporter (DOM shims; undecodable FBX textures are
//      dropped), then applies one of the pack's palette PNGs as the albedo in a
//      gltf-transform post-pass.
//
// Output: artifacts/animator/public/models/mech-00.glb
//
// Usage: node scripts/src/build-mech-glb.mjs

import fs from "node:fs";
import path from "node:path";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup } from "@gltf-transform/functions";
import { unzipSync } from "fflate";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MESH_FBX = path.join(ROOT, "attached_assets/Mech_Char_Mesh_1783547343767.fbx");
const ANIM_FBX = path.join(ROOT, "attached_assets/Mech_00_Anim_1783547348810.fbx");
const PACK_ZIP = path.join(ROOT, "attached_assets/Mech_00_1781991442813.zip");
const PALETTE_ENTRY = "Mech_00/TexturePallets/Simple/Simple00.png";
const OUT_PATH = path.join(ROOT, "artifacts/animator/public/models/mech-00.glb");

/** The one assembled variant we ship: shared cores + the Medium body set. */
const KEEP_MESH = /^(Core_|Base_M_)/;

/** Clips the mech mode actually uses (suit-up scrub + locomotion + flourishes). */
const KEEP_CLIPS = [
  "Mech_Idle",
  "Mech_Walk",
  "Mech_Run",
  "Mech_Crouch",
  "Mech_Jump_Start",
  "Mech_Jump_Mid",
  "Mech_Jump_Land",
  "Mech_GetHit",
  "Mech_Die",
];

installDomShims();
const THREE = await import("three");
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");

function loadFbx(p) {
  const buf = fs.readFileSync(p);
  return new FBXLoader().parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    path.dirname(p) + path.sep,
  );
}

console.log("▶ build-mech-glb");
const meshGroup = loadFbx(MESH_FBX);
const animGroup = loadFbx(ANIM_FBX);

// ── 1) Collect kept meshes + pick the canonical skeleton ────────────────────
const allSkinned = [];
meshGroup.traverse((o) => {
  if (o.isSkinnedMesh) allSkinned.push(o);
});
const kept = allSkinned.filter((m) => KEEP_MESH.test(m.name));
if (kept.length === 0) throw new Error("no Core_/Base_M_ meshes found");
console.log(`  meshes: keeping ${kept.length}/${allSkinned.length}`);

// The outermost c_traj instance (all 44 duplicate rigs nest beneath it).
const charMech = meshGroup.children.find((c) => c.name === "Char_Mech");
if (!charMech) throw new Error("Char_Mech group not found");
const outerRoot = charMech.children.find((c) => c.isBone && c.name === "c_traj");
if (!outerRoot) throw new Error("outer c_traj not found");

// Canonical skeleton = the (single) mesh skeleton whose bones include outerRoot.
const canonicalOwner = allSkinned.find((m) => m.skeleton.bones.includes(outerRoot));
if (!canonicalOwner) throw new Error("no mesh skeleton owns the outer c_traj");
const canonicalBones = canonicalOwner.skeleton.bones;
const canonicalSet = new Set(canonicalBones);
const byName = new Map(canonicalBones.map((b) => [b.name, b]));
if (byName.size !== canonicalBones.length) {
  throw new Error("canonical skeleton has duplicate bone names");
}

// Prune every duplicate-rig bone (any bone under the canonical tree that is not
// part of the canonical 87-bone set).
let pruned = 0;
const pruneDupes = (node) => {
  for (const child of [...node.children]) {
    if (child.isBone && !canonicalSet.has(child)) {
      node.remove(child);
      pruned++;
    } else {
      pruneDupes(child);
    }
  }
};
pruneDupes(outerRoot);
console.log(`  skeleton: ${canonicalBones.length} canonical bones, pruned ${pruned} dup-rig subtrees`);

// ── 2) Rebind every kept mesh onto the canonical bones (by name) ────────────
for (const mesh of kept) {
  if (mesh === canonicalOwner) continue;
  const mapped = mesh.skeleton.bones.map((b) => {
    const target = byName.get(b.name);
    if (!target) throw new Error(`bone "${b.name}" missing from canonical skeleton`);
    return target;
  });
  mesh.skeleton = new THREE.Skeleton(mapped, mesh.skeleton.boneInverses);
}

// ── 3) Drop the OutLine group + undecodable texture maps ────────────────────
const MAPS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap",
  "aoMap", "specularMap", "bumpMap", "alphaMap", "displacementMap",
];
for (const mesh of kept) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  // Keep only geometry groups pointing at a "Color" (non-OutLine) material.
  if (Array.isArray(mesh.material) && mesh.geometry.groups.length > 1) {
    const keepGroups = mesh.geometry.groups.filter(
      (g) => !/outline/i.test(mats[g.materialIndex]?.name ?? ""),
    );
    mesh.geometry.groups = keepGroups.map((g) => ({ ...g, materialIndex: 0 }));
    mesh.material = mats.find((m) => !/outline/i.test(m?.name ?? "")) ?? mats[0];
  }
  const finalMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of finalMats) {
    if (!m) continue;
    for (const k of MAPS) {
      const t = m[k];
      if (t && (!t.image || !t.image.width)) m[k] = null;
    }
    m.needsUpdate = true;
  }
}

// ── 4) Select clips from the anim FBX ───────────────────────────────────────
const available = (animGroup.animations ?? []).map((c) => c.name);
console.log(`  anim clips available: ${available.join(", ")}`);
const clips = [];
for (const want of KEEP_CLIPS) {
  const clip = (animGroup.animations ?? []).find((c) => c.name === want);
  if (!clip) {
    console.warn(`  WARN clip not found: ${want}`);
    continue;
  }
  clips.push(clip);
}
// Sanity: tracks must bind to canonical bone names.
let bound = 0;
let unbound = 0;
const unboundNames = new Set();
for (const clip of clips) {
  for (const track of clip.tracks) {
    const nodeName = track.name.split(".")[0];
    if (byName.has(nodeName)) bound++;
    else {
      unbound++;
      unboundNames.add(nodeName);
    }
  }
}
console.log(`  clips: ${clips.length} kept; tracks bound=${bound} unbound=${unbound}`);
if (unbound > 0) console.log(`  unbound track nodes: ${[...unboundNames].join(", ")}`);
if (bound === 0) throw new Error("no animation tracks bind to the canonical skeleton");

// ── 5) Assemble export scene + GLTFExporter ─────────────────────────────────
// Export the ORIGINAL FBX root group (minus dropped meshes) so every node keeps
// its as-loaded transform — reparenting the skeleton to a fresh identity group
// would drop Char_Mech's FBX up-axis conversion and export the mech lying down.
const keptSet = new Set(kept);
for (const child of [...meshGroup.children]) {
  if (child.isSkinnedMesh && !keptSet.has(child)) meshGroup.remove(child);
}
const exportRoot = meshGroup;
exportRoot.name = "Mech00";
exportRoot.updateMatrixWorld(true);

const glb = await new Promise((res, rej) =>
  new GLTFExporter().parse(exportRoot, res, rej, { binary: true, animations: clips }),
);

// ── 6) gltf-transform post-pass: palette albedo + prune/dedup ───────────────
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(new Uint8Array(glb));

const zip = unzipSync(new Uint8Array(fs.readFileSync(PACK_ZIP)));
const palettePng = zip[PALETTE_ENTRY];
if (!palettePng) throw new Error(`palette not found in zip: ${PALETTE_ENTRY}`);
const texture = doc
  .createTexture("MechPalette")
  .setImage(palettePng)
  .setMimeType("image/png");

for (const mat of doc.getRoot().listMaterials()) {
  mat.setBaseColorTexture(texture);
  mat.setBaseColorFactor([1, 1, 1, 1]);
  mat.setMetallicFactor(0.25);
  mat.setRoughnessFactor(0.65);
  mat.setDoubleSided(false);
}

await doc.transform(prune(), dedup());
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
await io.write(OUT_PATH, doc);

const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
const { min, max } = getBounds(scene);
console.log(
  `  bounds: ${(max[0] - min[0]).toFixed(1)} x ${(max[1] - min[1]).toFixed(1)} x ${(max[2] - min[2]).toFixed(1)} (minY=${min[1].toFixed(1)})`,
);
console.log(`  skins: ${doc.getRoot().listSkins().length}, meshes: ${doc.getRoot().listMeshes().length}`);
console.log(
  `  anims: ${doc.getRoot().listAnimations().map((a) => `${a.getName()}`).join(", ")}`,
);
console.log(`✔ wrote ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1e6).toFixed(2)} MB)`);

/** Minimal DOM shims so three's FBXLoader/GLTFExporter run headless in Node. */
function installDomShims() {
  globalThis.self ??= globalThis;
  globalThis.window ??= globalThis;
  globalThis.URL.createObjectURL ??= () => "blob:fbx";
  globalThis.URL.revokeObjectURL ??= () => {};
  globalThis.Blob ??= class Blob {
    constructor(parts = []) {
      const chunks = parts.map((p) =>
        p instanceof ArrayBuffer
          ? new Uint8Array(p)
          : ArrayBuffer.isView(p)
            ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength)
            : new Uint8Array(0),
      );
      this.size = chunks.reduce((n, c) => n + c.length, 0);
      this._bytes = new Uint8Array(this.size);
      let off = 0;
      for (const c of chunks) {
        this._bytes.set(c, off);
        off += c.length;
      }
    }
    arrayBuffer() {
      return Promise.resolve(this._bytes.buffer);
    }
  };
  globalThis.FileReader ??= class FileReader {
    readAsArrayBuffer(blob) {
      Promise.resolve(blob.arrayBuffer()).then((buf) => {
        this.result = buf;
        this.onloadend?.();
        this.onload?.();
      });
    }
  };
  const fakeCtx = {
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillRect() {},
    putImageData() {},
  };
  const fakeCanvas = () => ({
    getContext: () => fakeCtx,
    width: 1,
    height: 1,
    toDataURL: () => "data:,",
    toBlob: (cb) => cb(new globalThis.Blob()),
    style: {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.document ??= {
    createElement: () => fakeCanvas(),
    createElementNS: () => fakeCanvas(),
  };
  globalThis.HTMLCanvasElement ??= class {};
  globalThis.ImageData ??= class {
    constructor() {
      this.data = [];
    }
  };
}
