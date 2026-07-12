// Offline audit: does every animation clip bind to the SHARED Mixamo box rig?
// Replicates artifacts/animator/src/three/explorer/loader.ts binding logic and
// checks each clip's resulting track target bones against the real skeleton
// source's bone set. Run from artifacts/animator: `node audit-skeleton-binding.mjs`
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";

// Minimal DOM/worker shims so FBXLoader's texture/image code paths don't crash
// in Node — we only care about animation tracks, not pixels.
globalThis.self ??= globalThis;
const fakeCanvas = () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: [] }), fillRect() {} }), width: 0, height: 0, toDataURL: () => "", style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {} });
globalThis.document ??= {
  createElement: () => fakeCanvas(),
  createElementNS: () => fakeCanvas(),
};
globalThis.HTMLCanvasElement ??= class {};
globalThis.ImageData ??= class { constructor() { this.data = []; } };

// ---- ts-free copies of the loader's pure transforms -------------------------
const RIG_BONE_SUFFIXES = new Set([
  "Hips","Spine","Spine1","Spine2","Neck","Head",
  "LeftShoulder","LeftArm","LeftForeArm","LeftHand",
  "LeftUpLeg","LeftLeg","LeftFoot","LeftToeBase",
  "RightShoulder","RightArm","RightForeArm","RightHand",
  "RightUpLeg","RightLeg","RightFoot","RightToeBase",
]);
function canonicalRigBone(raw) {
  let n = raw.replace(/^mixamorig:?/, "");
  if (/^Spine0*1$|^Spine11$/.test(n)) n = "Spine1";
  else if (/^Spine0*2$|^Spine21$/.test(n)) n = "Spine2";
  else if (/^Spine$/.test(n)) n = "Spine";
  else if (/^Neck\d*$/i.test(n)) n = "Neck";
  else if (/^Head\d*$/.test(n)) n = "Head";
  else if (/^Hips\d*$/.test(n)) n = "Hips";
  else n = n.replace(/\d+$/, "");
  return RIG_BONE_SUFFIXES.has(n) ? `mixamorig${n}` : null;
}
function normalizeRetargetedFbxClip(clip) {
  const tracks = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf(".");
    if (dot < 0) continue;
    const prop = track.name.slice(dot + 1);
    const bone = canonicalRigBone(track.name.slice(0, dot));
    if (!bone) continue;
    if (prop === "quaternion" || (prop === "position" && bone === "mixamorigHips")) {
      const r = track.clone(); r.name = `${bone}.${prop}`; tracks.push(r);
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
function retargetMixamoClip(clip) {
  const SUFFIX = ".quaternion";
  const tracks = [];
  for (const track of clip.tracks) {
    if (!track.name.endsWith(SUFFIX)) continue;
    const node = track.name.slice(0, -SUFFIX.length);
    const bone = node.replace("mixamorig:", "mixamorig").replace(/_\d+$/, "");
    const r = track.clone(); r.name = `${bone}${SUFFIX}`; tracks.push(r);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const fbx = new FBXLoader();
const gltf = new GLTFLoader();
function parseFbx(id) {
  const buf = readFileSync(`public/anim/${id}.fbx`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return fbx.parse(ab, "");
}
function parseGlb(id) {
  const buf = readFileSync(`public/anim/${id}.glb`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return Promise.race([
    new Promise((res, rej) => gltf.parse(ab, "", (g) => res(g), rej)),
    new Promise((_, rej) => setTimeout(() => rej(new Error("glb parse timeout (texture hang; retarget is rotation-only)")), 4000)),
  ]);
}

// ---- ground truth: the shared skeleton's bone set ---------------------------
const SKELETON_SOURCE_ID = "animations/bow/unarmed-idle-01";
const src = parseFbx(SKELETON_SOURCE_ID);
const rigBones = new Set();
src.traverse((o) => { if (o.isBone) rigBones.add(o.name); });
console.log(`Rig bones in skeleton source (${rigBones.size}):`);
console.log("  " + [...rigBones].sort().join(", "));
console.log("");

// node base name property = track target node. Check each clip.
function boneOf(trackName) {
  const dot = trackName.lastIndexOf(".");
  return dot < 0 ? trackName : trackName.slice(0, dot);
}

// Gather every referenced id (mirror clipCatalog) by scanning the TS source.
const cat = readFileSync("src/three/explorer/clipCatalog.ts", "utf8");
const ids = [...new Set([...cat.matchAll(/"(animations\/[^"]+)"/g)].map((m) => m[1]))];
const GLB = new Set(ids.filter((i) => i.includes("/combo/")));
const SUBCLIP = /melee-combo-1-hit\d$/;

const report = [];
for (const id of ids) {
  if (SUBCLIP.test(id)) continue; // derived from parent at runtime; parent covers binding
  try {
    let clip;
    if (GLB.has(id)) {
      const g = await parseGlb(id);
      clip = g.animations[0];
      if (!clip) { report.push({ id, status: "NO_CLIP" }); continue; }
      clip = retargetMixamoClip(clip);
    } else {
      const group = parseFbx(id);
      clip = group.animations[0];
      if (!clip) { report.push({ id, status: "NO_CLIP" }); continue; }
      const native = clip.tracks.some((t) => t.name.startsWith("mixamorig"));
      clip = native ? clip : normalizeRetargetedFbxClip(clip);
    }
    const bones = [...new Set(clip.tracks.map((t) => boneOf(t.name)))];
    const bound = bones.filter((b) => rigBones.has(b));
    const orphan = bones.filter((b) => !rigBones.has(b));
    const hasHips = bound.includes("mixamorigHips");
    const hasArms = bound.includes("mixamorigRightArm") || bound.includes("mixamorigLeftArm");
    report.push({
      id, total: bones.length, bound: bound.length, orphan: orphan.length,
      hasHips, hasArms, sampleOrphans: orphan.slice(0, 4),
      status: bound.length === 0 ? "DEAD" : (!hasArms || !hasHips) ? "PARTIAL" : "OK",
    });
  } catch (e) {
    report.push({ id, status: "ERROR", err: String(e).slice(0, 120) });
  }
}

const bad = report.filter((r) => r.status !== "OK");
console.log(`Audited ${report.length} clips. Problems: ${bad.length}\n`);
for (const r of report.filter((r) => r.status === "DEAD" || r.status === "NO_CLIP" || r.status === "ERROR")) {
  console.log(`  [${r.status}] ${r.id}  ${r.err ?? ""} orphans=${JSON.stringify(r.sampleOrphans ?? [])}`);
}
console.log("");
for (const r of report.filter((r) => r.status === "PARTIAL")) {
  console.log(`  [PARTIAL] ${r.id}  bound=${r.bound}/${r.total} hips=${r.hasHips} arms=${r.hasArms} orphans=${JSON.stringify(r.sampleOrphans)}`);
}
console.log(`\nOK: ${report.filter((r) => r.status === "OK").length}`);

// ---- CLIP_REGISTRY binding cross-check (Task #224) ----
// Every ActionKey named by the declarative clip registry must resolve to at
// least one clip the binding audit deems healthy (OK/PARTIAL) — or a known-good
// GLB-combo / sub-clip false positive — so a new verb can never ship pointing at
// a dead/missing clip id. Fails the audit (exit 1) when a key has no healthy clip.
const goodIds = new Set(
  report.filter((r) => r.status === "OK" || r.status === "PARTIAL").map((r) => r.id),
);
const keyToIds = {};
for (const m of cat.matchAll(/(\w+)\s*:\s*"(animations\/[^"]+)"/g)) {
  (keyToIds[m[1]] ??= []).push(m[2]);
}
const reg = readFileSync("src/three/explorer/clipRegistry.ts", "utf8");
const regKeys = [...new Set([...reg.matchAll(/\bkey:\s*"(\w+)"/g)].map((m) => m[1]))];
const regBad = [];
for (const key of regKeys) {
  const idsForKey = keyToIds[key] ?? [];
  if (!idsForKey.length) {
    regBad.push(`${key} -> (no clip id in clipCatalog)`);
    continue;
  }
  const ok = idsForKey.some((id) => GLB.has(id) || SUBCLIP.test(id) || goodIds.has(id));
  if (!ok) regBad.push(`${key} -> ${idsForKey.join(", ")} (none OK/PARTIAL)`);
}
console.log(`\nRegistry keys checked: ${regKeys.length}. Problems: ${regBad.length}`);
for (const b of regBad) console.log(`  [REG-BAD] ${b}`);
if (regBad.length) process.exitCode = 1;
