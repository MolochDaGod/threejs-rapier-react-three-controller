import * as THREE from "three";

/**
 * In-place root lock — keep authored joint *rotations*, kill clip-driven world travel.
 *
 * Controllers / Dressing pedestal own world XYZ. Mixamo + "Retargeted Clip" packs
 * often ship large Hips/Bip001/Armature.position deltas (and off-origin first frames).
 * If those tracks play raw, blends and skill swaps fling the body through space and
 * into environment colliders ("meshing transitions" / layer pops).
 *
 * Rules:
 *  1. Recognise root translation under Mixamo / bare Hips / Bip001 / Armature / Root.
 *  2. Pin X, Y, Z to the rig BIND pose (not frame 0 — off-origin packs start far away).
 *  3. Full XYZ freeze: vertical bob is also owned by the controller/physics so clips
 *     cannot launch the character through floors or platforms.
 *  4. Optionally drop non-root position tracks (limb positions break retargets).
 */

export type BindRoot = { x: number; y: number; z: number };

/**
 * True for any root/hips/pelvis/armature **position** track that would relocate
 * the character in world or pedestal space.
 */
export function isRootPositionTrack(name: string): boolean {
  if (!name.endsWith(".position")) return false;
  let bone = name.slice(0, -".position".length);
  // mixamorig:Hips / mixamorigHips
  bone = bone.replace(/^mixamorig:?/i, "");
  // Strip path prefixes from some exporters: Armature|Hips, Scene/Hips
  const leaf = bone.includes("|")
    ? bone.slice(bone.lastIndexOf("|") + 1)
    : bone.includes("/")
      ? bone.slice(bone.lastIndexOf("/") + 1)
      : bone;
  const key = leaf.toLowerCase().replace(/[\s._-]+/g, "");
  // Mixamo / generic hips
  if (/^hips\d*$/.test(key)) return true;
  if (/^character\d*hips$/.test(key)) return true;
  // Bip001 pelvis / root (Unity/Max)
  if (/^bip001$/.test(key)) return true;
  if (/^bip001pelvis$/.test(key)) return true;
  if (/^pelvis$/.test(key)) return true;
  // Scene / armature roots that sometimes carry translation
  if (/^armature$/.test(key)) return true;
  if (/^root$/.test(key)) return true;
  if (/^motion$/.test(key)) return true;
  if (/^reference$/.test(key)) return true;
  if (/^character1_reference$/.test(key)) return true;
  if (/^skeleton$/.test(key)) return true;
  return false;
}

/**
 * Read bind-pose root translation from a live skeleton root (prefer hips bone).
 * Call after the model is scaled/fitted so bind matches the posed rig.
 */
export function sampleBindRoot(skeletonRoot: THREE.Object3D): BindRoot {
  const candidates = [
    "mixamorigHips",
    "mixamorig:Hips",
    "Hips",
    "Bip001 Pelvis",
    "Bip001_Pelvis",
    "Bip001",
    "Pelvis",
    "Root",
    "Armature",
  ];
  for (const name of candidates) {
    const n = skeletonRoot.getObjectByName(name);
    if (n) {
      return { x: n.position.x, y: n.position.y, z: n.position.z };
    }
  }
  // Fuzzy: first bone whose name looks like hips / pelvis
  let found: THREE.Object3D | null = null;
  skeletonRoot.traverse((o) => {
    if (found) return;
    const k = o.name.toLowerCase().replace(/[\s._-]+/g, "");
    if (
      /hips\d*$/.test(k) ||
      /bip001pelvis/.test(k) ||
      k === "pelvis" ||
      k === "bip001"
    ) {
      found = o;
    }
  });
  if (found) {
    const f = found as THREE.Object3D;
    return { x: f.position.x, y: f.position.y, z: f.position.z };
  }
  return { x: 0, y: 0, z: 0 };
}

/**
 * Pin root X/Y/Z to bind. Mutates track values in place.
 * Safe to call multiple times (idempotent once locked to bind).
 *
 * Full XYZ freeze: controller / pedestal owns world position so blends never
 * accumulate root deltas from mismatched pack authors.
 */
export function lockInPlaceRoot(clip: THREE.AnimationClip, bind: BindRoot): void {
  for (const track of clip.tracks) {
    if (!isRootPositionTrack(track.name)) continue;
    const v = track.values;
    if (v.length < 3) continue;
    for (let i = 0; i < v.length; i += 3) {
      v[i] = bind.x;
      v[i + 1] = bind.y;
      v[i + 2] = bind.z;
    }
  }
}

/**
 * Drop limb position tracks (keep root position for lock, all quaternions/scales).
 * Use after retarget onto a proportion-different skeleton.
 */
export function stripNonRootPositions(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => {
    if (!t.name.endsWith(".position")) return true;
    return isRootPositionTrack(t.name);
  });
  if (tracks.length === clip.tracks.length) return clip;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

/**
 * Full stabilize pipeline for a clip about to hit a mixer on `skeletonRoot`:
 * filter is caller's job; here we strip limb positions + lock root to bind.
 * Always clones when mutating a shared library clip.
 */
export function stabilizeClipForPlayback(
  skeletonRoot: THREE.Object3D,
  clip: THREE.AnimationClip,
  opts: { stripLimbPositions?: boolean; bind?: BindRoot } = {},
): THREE.AnimationClip {
  const bind = opts.bind ?? sampleBindRoot(skeletonRoot);
  let c = clip;
  if (opts.stripLimbPositions !== false) {
    const stripped = stripNonRootPositions(c);
    if (stripped !== c) c = stripped;
  }
  // Always work on a clone if caller passes shared library clips
  if (c === clip) c = clip.clone();
  lockInPlaceRoot(c, bind);
  return c;
}

/** @deprecated alias — same as lockInPlaceRoot with full bind */
export function lockHorizontalRoot(clip: THREE.AnimationClip, bind: BindRoot | number): void {
  if (typeof bind === "number") {
    lockInPlaceRoot(clip, { x: 0, y: bind, z: 0 });
  } else {
    lockInPlaceRoot(clip, bind);
  }
}

/** @deprecated alias */
export const isHipsPositionTrack = isRootPositionTrack;
