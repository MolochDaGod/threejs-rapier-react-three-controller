import * as THREE from "three";
import { retargetClip as skeletonRetargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { RetargetNameMap } from "./retargetMap";

/**
 * Runtime side of the unified retargeting pipeline (see {@link ./retargetMap} for
 * the pure bone-name logic). Drives a shared `mixamorig*` FBX library clip onto a
 * real GLB fighter's own skeleton with three's `SkeletonUtils.retargetClip`.
 *
 * `retargetClip` needs a SOURCE that is both an `Object3D` the library clip can
 * bind to BY BONE NAME (so the FBX `mixamorigHips.quaternion` tracks resolve) AND
 * carries a `.skeleton.bones` list — i.e. a real `SkinnedMesh`. Its output tracks
 * are `.bones[Name].quaternion`, which only bind against a root that exposes a
 * `.skeleton`; the GLB `Character`/editor play clips on the scene Group's mixer by
 * NODE name, so {@link retargetLibraryClip} renames `.bones[X].` → `X.` and keeps
 * rotation only (limb proportions stay the target's; the engine drives root
 * translation), matching the established box-rig retarget convention.
 */

/** First `SkinnedMesh` under `root` (the bone-driven mesh to read/write), or null. */
export function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh;
  });
  return found;
}

/** Bone names of a skeleton, in skeleton order. */
export function skeletonBoneNames(skeleton: THREE.Skeleton): string[] {
  return skeleton.bones.map((b) => b.name);
}

/**
 * Build the retarget SOURCE from a loaded skeleton-source scene (the FBX whose
 * `mixamorig*` bones the library clips bind to). Prefers an existing `SkinnedMesh`
 * in the scene; otherwise synthesizes a minimal one wrapping the bone hierarchy so
 * `retargetClip` has both a name-bindable graph and a `.skeleton`. Returns null
 * when the scene carries no bones.
 */
export function makeRetargetSource(sourceScene: THREE.Object3D): THREE.SkinnedMesh | null {
  const existing = findSkinnedMesh(sourceScene);
  if (existing) return existing;

  const bones: THREE.Bone[] = [];
  sourceScene.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  if (bones.length === 0) return null;

  // The root bone is the one whose parent is not itself a bone.
  const rootBone = bones.find((b) => !(b.parent as THREE.Bone | null)?.isBone) ?? bones[0];
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.updateMatrixWorld(true);
  return mesh;
}

const BONES_TRACK = /^\.bones\[(.+?)\]\.(\w+)$/;

/**
 * Retarget one `mixamorig*` library clip onto `target` using `map` (built by
 * `buildRetargetNameMap` from the target's bone names). Returns a rotation-only
 * clip whose tracks are named by NODE (`Hips.quaternion`, …) so it binds against
 * the GLB scene Group's mixer.
 *
 * NOTE: `retargetClip` poses `target.skeleton` while baking; callers that bake a
 * batch should `target.skeleton.pose()` afterwards to restore the bind pose.
 */
export function retargetLibraryClip(
  target: THREE.SkinnedMesh,
  source: THREE.SkinnedMesh,
  clip: THREE.AnimationClip,
  map: RetargetNameMap,
  name = clip.name,
): THREE.AnimationClip {
  const baked = skeletonRetargetClip(target, source, clip, {
    hip: map.hip,
    names: map.names,
  });
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of baked.tracks) {
    const m = BONES_TRACK.exec(track.name);
    if (!m) continue;
    if (m[2] !== "quaternion") continue; // rotation-only: engine owns translation
    const renamed = track.clone();
    renamed.name = `${m[1]}.${m[2]}`;
    tracks.push(renamed);
  }
  return new THREE.AnimationClip(name, baked.duration, tracks);
}

/**
 * Retarget a whole library (catalog id → `mixamorig*` clip) onto `target`,
 * returning node-name clips named by their catalog id. Per-clip failures are
 * skipped so one bad clip can't sink the batch; the target is restored to its
 * bind pose afterwards.
 */
export function retargetLibrary(
  target: THREE.SkinnedMesh,
  source: THREE.SkinnedMesh,
  clips: Map<string, THREE.AnimationClip>,
  map: RetargetNameMap,
): THREE.AnimationClip[] {
  const out: THREE.AnimationClip[] = [];
  for (const [id, clip] of clips) {
    try {
      out.push(retargetLibraryClip(target, source, clip, map, id));
    } catch (err) {
      console.warn(`[retargetLibrary] skipped "${id}"`, err);
    }
  }
  target.skeleton.pose();
  return out;
}
