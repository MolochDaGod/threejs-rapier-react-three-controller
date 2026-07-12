import * as THREE from "three";
import type { EpicFightModel } from "../model.js";
import type { HitboxSpec } from "./types.js";

/**
 * Maps the biped's named body `parts` to the bone that best represents that
 * limb. Cosmetic layers (sleeves/pants/jacket/hat) fold onto the same bone as
 * the limb they cover, so {@link buildHurtboxes} yields ~6 hit volumes
 * (head, chest, two arms, two legs) instead of one per mesh part.
 */
export const DEFAULT_PART_BONES: Record<string, string> = {
  head: "Head",
  hat: "Head",
  torso: "Chest",
  jacket: "Chest",
  leftArm: "Arm_L",
  leftSleeve: "Arm_L",
  rightArm: "Arm_R",
  rightSleeve: "Arm_R",
  leftLeg: "Leg_L",
  leftPants: "Leg_L",
  rightLeg: "Leg_R",
  rightPants: "Leg_R",
};

/** An animation-driven hit volume centred on a bone. */
export interface Hurtbox {
  /** Logical name (the representative bone, e.g. "Head", "Chest"). */
  name: string;
  /** The bone whose world transform drives this hurtbox. */
  bone: THREE.Bone;
  /** Local radius (in model space, before the root group's scale). */
  radius: number;
}

export interface BuildHurtboxOptions {
  /** Part → bone overrides merged onto {@link DEFAULT_PART_BONES}. */
  partBones?: Record<string, string>;
  /**
   * Multiplier applied to each derived radius. The base radius is half of the
   * union AABB's largest horizontal extent for the bone's parts. Default 0.6.
   */
  radiusScale?: number;
  /** Floor for any derived radius (model units). Default 0.05. */
  minRadius?: number;
}

/**
 * Derive per-bone {@link Hurtbox}es from a loaded model's `partBounds`. Radii
 * are computed once from the rest pose; centres follow the live bone transforms
 * at query time. Bones with no mapped parts are skipped.
 */
export function buildHurtboxes(
  model: EpicFightModel,
  opts: BuildHurtboxOptions = {},
): Hurtbox[] {
  const partBones = { ...DEFAULT_PART_BONES, ...(opts.partBones ?? {}) };
  const radiusScale = opts.radiusScale ?? 0.6;
  const minRadius = opts.minRadius ?? 0.05;

  // Union the rest-pose AABBs of every part that maps to a given bone.
  const unions = new Map<string, THREE.Box3>();
  for (const [part, box] of Object.entries(model.partBounds)) {
    if (box.isEmpty()) continue;
    const boneName = partBones[part];
    if (!boneName) continue;
    const existing = unions.get(boneName);
    if (existing) existing.union(box);
    else unions.set(boneName, box.clone());
  }

  const size = new THREE.Vector3();
  const out: Hurtbox[] = [];
  for (const [boneName, box] of unions) {
    const bone = model.boneByName.get(boneName);
    if (!bone) continue;
    box.getSize(size);
    const horizontal = Math.max(size.x, size.z);
    const radius = Math.max(minRadius, 0.5 * horizontal * radiusScale);
    out.push({ name: boneName, bone, radius });
  }
  return out;
}

/**
 * Build the world-space attack sphere for a move's {@link HitboxSpec}.
 *
 * `origin` is the attacker's world position; `forward` is its facing (XZ is
 * enough, it is normalised here). The sphere sits `spec.forward` metres ahead
 * and `spec.up` metres above the origin.
 */
export function attackSphere(
  origin: THREE.Vector3,
  forward: THREE.Vector3,
  spec: HitboxSpec,
  target = new THREE.Sphere(),
): THREE.Sphere {
  const fx = forward.x;
  const fz = forward.z;
  const len = Math.hypot(fx, fz) || 1;
  target.center.set(
    origin.x + (fx / len) * spec.forward,
    origin.y + spec.up,
    origin.z + (fz / len) * spec.forward,
  );
  target.radius = spec.radius;
  return target;
}

const _tmpCenter = new THREE.Vector3();

/**
 * Test an attack sphere against a target's hurtboxes (in world space). Returns
 * the name of the first hurtbox hit, or null. Call `updateMatrixWorld` on the
 * target model's root before querying so bone world positions are current.
 *
 * `worldScale` is the uniform scale applied to the target's root group (the
 * hurtbox radii are in model space and must be scaled to match).
 */
export function queryHurtboxes(
  sphere: THREE.Sphere,
  hurtboxes: Hurtbox[],
  worldScale = 1,
): string | null {
  for (const hb of hurtboxes) {
    hb.bone.getWorldPosition(_tmpCenter);
    const r = sphere.radius + hb.radius * worldScale;
    if (_tmpCenter.distanceToSquared(sphere.center) <= r * r) return hb.name;
  }
  return null;
}
