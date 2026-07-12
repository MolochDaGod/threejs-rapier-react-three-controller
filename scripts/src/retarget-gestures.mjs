// Bake the gesture idle-break FBX pack onto the Animator's mixamorig skeleton.
//
// The `animations/gestures/*` pack is authored on an IDENTITY-REST skeleton
// (every bone's rest rotation is 0,0,0 — limb direction is encoded purely in
// bone translations), while the box rig and every other library pack are
// mixamo-space (legs point down via ~180° rest rotations). The runtime
// rename-only normalization (`normalizeRetargetedFbxClip`) therefore binds the
// gesture rotations wildly wrong — legs fold up to the head and the hips pitch
// the body through the floor every idle-break fidget.
//
// Fix: a real rest-pose-aware retarget via `SkeletonUtils.retargetClip` (which
// works from bind matrices, so the rest-pose mismatch is handled), baked
// offline onto the skeleton-source rig and shipped as rotation-only GLB clips
// with native `mixamorig*` track names.
//
// Usage:
//   node scripts/src/retarget-gestures.mjs
//
// Reads  artifacts/animator/public/anim/animations/gestures/*.fbx
// Writes artifacts/animator/public/anim/animations/gestures/*.glb
// (the loader lists these ids in NATIVE_GLB_CLIP_IDS and loads the .glb)

import fs from "node:fs";
import path from "node:path";

installDomShims();

const THREE = await import("three");
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
const { retargetClip } = await import("three/examples/jsm/utils/SkeletonUtils.js");

const ANIM_DIR = path.resolve(
  import.meta.dirname,
  "../../artifacts/animator/public/anim",
);
const GESTURE_DIR = path.join(ANIM_DIR, "animations/gestures");
// Same file the runtime uses as the rig skeleton source (SKELETON_SOURCE_ID).
const SKELETON_SOURCE = path.join(ANIM_DIR, "animations/bow/unarmed-idle-01.fbx");

function loadFbx(p) {
  const buf = fs.readFileSync(p);
  return new FBXLoader().parse(new Uint8Array(buf).buffer, path.dirname(p) + path.sep);
}

/** Wrap a scene's bone hierarchy in a SkinnedMesh so retargetClip can use it. */
function makeSkinned(scene) {
  let existing = null;
  scene.traverse((o) => {
    if (!existing && o.isSkinnedMesh) existing = o;
  });
  if (existing) {
    existing.updateMatrixWorld(true);
    return existing;
  }
  const bones = [];
  scene.traverse((o) => {
    if (o.isBone) bones.push(o);
  });
  if (bones.length === 0) throw new Error("scene has no bones");
  const rootBone = bones.find((b) => !b.parent?.isBone) ?? bones[0];
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton(bones));
  // Keep the bones inside the original scene graph: mesh.add() above reparents
  // the root bone out of `scene`, which would break name-based track binding
  // (mixer/poseCheck/export all walk `scene`).
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  return mesh;
}

/**
 * Map a gesture-pack bone name to the rig's mixamorig* name (mirrors the
 * runtime `canonicalRigBone` in the animator loader). Null = no rig equivalent.
 */
const RIG_BONE_SUFFIXES = new Set([
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
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

/** names map for retargetClip: TARGET bone name -> SOURCE bone name. */
function buildNames(sourceMesh) {
  const names = {};
  for (const b of sourceMesh.skeleton.bones) {
    const target = canonicalRigBone(b.name);
    if (target) names[target] = b.name;
  }
  return names;
}

/** World-rest quaternion per bone name (scene must be in bind/rest pose). */
function restWorldQuats(scene) {
  scene.updateMatrixWorld(true);
  const map = new Map();
  scene.traverse((o) => {
    if (o.isBone) map.set(o.name, o.getWorldQuaternion(new THREE.Quaternion()));
  });
  return map;
}

/**
 * Per-target-bone basis-change offsets for `retargetClip`. The gesture pack's
 * skeleton has IDENTITY rest rotations (bone direction lives in translations),
 * the rig's is mixamo-space — so the default "copy source world rotation"
 * retarget folds limbs wrong. `retarget` post-multiplies
 * `localOffsets[targetBone]` onto the copied source world rotation, so
 * `inv(srcRestWorld) * tgtRestWorld` maps rest→rest and carries animation
 * deltas across the differing bone axes.
 */
function buildLocalOffsets(names, srcRest, tgtRest) {
  const offsets = {};
  for (const [targetName, sourceName] of Object.entries(names)) {
    const s = srcRest.get(sourceName);
    const t = tgtRest.get(targetName);
    if (!s || !t) continue;
    const q = s.clone().invert().multiply(t);
    offsets[targetName] = new THREE.Matrix4().makeRotationFromQuaternion(q);
  }
  return offsets;
}

const BONES_TRACK = /^\.bones\[(.+?)\]\.(\w+)$/;

/** Rotation-only, node-name-addressed copy of a retargetClip result. */
function toNodeTracks(baked, name) {
  const tracks = [];
  for (const track of baked.tracks) {
    const m = BONES_TRACK.exec(track.name);
    if (!m || m[2] !== "quaternion") continue; // engine owns translation
    const renamed = track.clone();
    renamed.name = `${m[1]}.${m[2]}`;
    tracks.push(renamed);
  }
  return new THREE.AnimationClip(name, baked.duration, tracks);
}

/** Sanity: pose skeleton with clip at time t, report head/foot world Y. */
function poseCheck(scene, mesh, clip, t) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(t);
  scene.updateMatrixWorld(true);
  const y = (name) => {
    let v = null;
    scene.traverse((o) => {
      if (!v && o.name === name) v = o.getWorldPosition(new THREE.Vector3()).y;
    });
    return v;
  };
  const res = { head: y("mixamorigHead"), lFoot: y("mixamorigLeftFoot"), rFoot: y("mixamorigRightFoot"), hips: y("mixamorigHips") };
  mixer.stopAllAction();
  mesh.skeleton.pose();
  scene.updateMatrixWorld(true);
  return res;
}

async function exportGlb(scene, clip) {
  const exporter = new GLTFExporter();
  return await new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => resolve(Buffer.from(result)),
      reject,
      { binary: true, animations: [clip] },
    );
  });
}

function fmt(v) {
  return v == null ? "?" : v.toFixed(2);
}

// --- main -------------------------------------------------------------------
const targetScene = loadFbx(SKELETON_SOURCE);
const targetMesh = makeSkinned(targetScene);
const tgtRest = restWorldQuats(targetScene);

const files = fs.readdirSync(GESTURE_DIR).filter((f) => f.endsWith(".fbx")).sort();
for (const f of files) {
  const src = loadFbx(path.join(GESTURE_DIR, f));
  const srcMesh = makeSkinned(src);
  const clip = src.animations[0];
  if (!clip) {
    console.log(`${f}: NO CLIP, skipped`);
    continue;
  }
  const names = buildNames(srcMesh);
  const srcRest = restWorldQuats(src);
  const baked = retargetClip(targetMesh, srcMesh, clip, {
    hip: names.mixamorigHips ?? "Hips",
    names,
    localOffsets: buildLocalOffsets(names, srcRest, tgtRest),
  });
  targetMesh.skeleton.pose();
  targetScene.updateMatrixWorld(true);
  const out = toNodeTracks(baked, f.replace(/\.fbx$/, ""));
  if (out.tracks.length === 0) throw new Error(`${f}: retarget produced no tracks`);

  // Sanity poses: feet should stay far below the head at start/mid/end.
  for (const t of [0, out.duration / 2, Math.max(0, out.duration - 0.05)]) {
    const p = poseCheck(targetScene, targetMesh, out, t);
    const ok = p.head != null && p.lFoot != null && p.lFoot < p.hips && p.rFoot < p.hips && p.head > p.hips;
    console.log(
      `${f} t=${t.toFixed(2)} head=${fmt(p.head)} hips=${fmt(p.hips)} feet=${fmt(p.lFoot)}/${fmt(p.rFoot)} ${ok ? "OK" : "BROKEN"}`,
    );
    if (!ok) throw new Error(`${f}: pose check failed at t=${t}`);
  }

  const glb = await exportGlb(targetScene, out);
  const outPath = path.join(GESTURE_DIR, f.replace(/\.fbx$/, ".glb"));
  fs.writeFileSync(outPath, glb);
  console.log(`${f} -> ${path.basename(outPath)} (${(glb.length / 1024).toFixed(0)} KB, ${out.tracks.length} tracks, ${out.duration.toFixed(2)}s)`);
}
console.log("done");

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
