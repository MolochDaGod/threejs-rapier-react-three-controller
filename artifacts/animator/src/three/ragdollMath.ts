import * as THREE from "three";

/**
 * Pure, renderer-agnostic math for the bone-joint ragdoll (see {@link Ragdoll}).
 *
 * None of these touch Rapier or the render loop — they are the testable core of
 * the ragdoll: turning live bone world transforms into capsule frames + joint
 * anchors at build time, and turning the simulated body transforms back into
 * per-bone *local* TRS at write-back time. Keeping them here (and unit-tested in
 * `ragdollMath.test.ts`) means the hard geometry is verified without WebGL or a
 * wasm physics world, which the sandbox cannot run.
 *
 * Conventions:
 * - A Rapier capsule's long axis is its local **+Y**.
 * - "world" transforms are absolute; "local" transforms are relative to a parent.
 * - All helpers are allocation-light where it matters but prefer clarity; callers
 *   in the hot path pass scratch `out` objects.
 */

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _yUp = new THREE.Vector3(0, 1, 0);

/** Frame of a capsule spanning head→tail. */
export interface SegmentFrame {
  /** Capsule centre (midpoint of head→tail). */
  center: THREE.Vector3;
  /** Rotation taking local +Y onto the (tail − head) direction. */
  quat: THREE.Quaternion;
  /** Half the head→tail distance (full half-length, NOT the capsule half-height). */
  halfLength: number;
}

/**
 * Build the capsule frame for a segment whose proximal joint is `head` and distal
 * end is `tail` (both world space). The capsule is centred between them and
 * oriented so its local +Y runs head→tail. Degenerate (coincident) endpoints fall
 * back to an identity orientation and a tiny half-length so callers can clamp.
 */
export function segmentFrame(
  head: THREE.Vector3,
  tail: THREE.Vector3,
  out?: SegmentFrame,
): SegmentFrame {
  const res: SegmentFrame = out ?? {
    center: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    halfLength: 0,
  };
  res.center.copy(head).add(tail).multiplyScalar(0.5);
  _v.copy(tail).sub(head);
  const len = _v.length();
  res.halfLength = len * 0.5;
  if (len < 1e-6) {
    res.quat.identity();
  } else {
    _v.divideScalar(len);
    res.quat.setFromUnitVectors(_yUp, _v);
  }
  return res;
}

/**
 * A bone's pose captured relative to a (rigid) body frame at build time, so the
 * bone can be reconstructed from the body's later transform. See
 * {@link captureBoneInBody} / {@link boneWorldFromBody}.
 */
export interface BoneInBody {
  /** Bone origin expressed in the body's local frame. */
  posOffset: THREE.Vector3;
  /** Rotation taking the body frame to the bone frame (bodyᵀ · bone). */
  quatOffset: THREE.Quaternion;
}

/**
 * Capture a bone's world transform relative to a body's world transform. The
 * returned offsets are constant for the life of the ragdoll (the body is rigid),
 * so write-back is a cheap `boneWorldFromBody`.
 */
export function captureBoneInBody(
  bonePos: THREE.Vector3,
  boneQuat: THREE.Quaternion,
  bodyPos: THREE.Vector3,
  bodyQuat: THREE.Quaternion,
  out?: BoneInBody,
): BoneInBody {
  const res: BoneInBody = out ?? {
    posOffset: new THREE.Vector3(),
    quatOffset: new THREE.Quaternion(),
  };
  _q.copy(bodyQuat).invert();
  res.posOffset.copy(bonePos).sub(bodyPos).applyQuaternion(_q);
  res.quatOffset.copy(_q).multiply(boneQuat);
  return res;
}

/** Reconstruct a bone's world transform from the body's current transform. */
export function boneWorldFromBody(
  bodyPos: THREE.Vector3,
  bodyQuat: THREE.Quaternion,
  cap: BoneInBody,
  outPos?: THREE.Vector3,
  outQuat?: THREE.Quaternion,
): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const pos = (outPos ?? new THREE.Vector3()).copy(cap.posOffset).applyQuaternion(bodyQuat).add(bodyPos);
  const quat = (outQuat ?? new THREE.Quaternion()).copy(bodyQuat).multiply(cap.quatOffset);
  return { pos, quat };
}

/**
 * Convert a desired world transform into the local TRS it must have under a parent
 * whose world transform is given. Used for root-first write-back: each bone's
 * local pose is solved against its parent's *already-updated* world transform.
 * `parentScale` is the parent's (assumed uniform) world scale — bones are unit-
 * scaled but the armature root carries the model's fit scale.
 */
export function worldToLocal(
  worldPos: THREE.Vector3,
  worldQuat: THREE.Quaternion,
  parentPos: THREE.Vector3,
  parentQuat: THREE.Quaternion,
  parentScale = 1,
  outPos?: THREE.Vector3,
  outQuat?: THREE.Quaternion,
): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  _q.copy(parentQuat).invert();
  const s = Math.abs(parentScale) < 1e-9 ? 1 : parentScale;
  const pos = (outPos ?? new THREE.Vector3())
    .copy(worldPos)
    .sub(parentPos)
    .applyQuaternion(_q)
    .divideScalar(s);
  const quat = (outQuat ?? new THREE.Quaternion()).copy(_q).multiply(worldQuat);
  return { pos, quat };
}

/**
 * Express a world-space joint point in a body's local frame — the anchor form a
 * Rapier spherical joint expects. Both the parent and child body anchor of one
 * joint resolve to the SAME world point through their respective bodies.
 */
export function worldPointToBodyLocal(
  worldPt: THREE.Vector3,
  bodyPos: THREE.Vector3,
  bodyQuat: THREE.Quaternion,
  out?: THREE.Vector3,
): THREE.Vector3 {
  _q.copy(bodyQuat).invert();
  return (out ?? new THREE.Vector3()).copy(worldPt).sub(bodyPos).applyQuaternion(_q);
}
