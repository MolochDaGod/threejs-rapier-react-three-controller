/**
 * Deterministic projectile ↔ weapon-collider parry rebound.
 *
 * On parry success (CombatController state `parry` + projectile near blade
 * capsule): reverse toward the original caster on a more direct path at 2× speed.
 * Pure math — hosts supply collider + spawn the reverse projectile + VFX.
 */
import * as THREE from "three";

/** World-space blade capsule (grip → tip) used as the parry volume. */
export interface WeaponParryCollider {
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
}

export interface ReboundResult {
  /** New velocity (already scaled by speedMul). */
  vel: THREE.Vector3;
  /** Contact point on the blade (for VFX). */
  point: THREE.Vector3;
  /** Unit direction of the rebound (toward caster, mostly). */
  dir: THREE.Vector3;
  /** Incoming speed used before mul. */
  inSpeed: number;
  /** Outgoing speed after mul. */
  outSpeed: number;
}

/** Default: reverse shot flies twice as fast. */
export const PARRY_REBOUND_SPEED_MUL = 2;

/**
 * Closest point on segment AB to P, plus squared distance.
 * Pure — no allocations of the segment vectors beyond the out param.
 */
export function closestPointOnSegment(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  out: THREE.Vector3,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = abLenSq > 1e-10 ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
  const dx = p.x - out.x;
  const dy = p.y - out.y;
  const dz = p.z - out.z;
  return dx * dx + dy * dy + dz * dz;
}

/** True when point P is within the capsule (segment AB + radius). */
export function pointHitsWeaponCollider(
  p: THREE.Vector3,
  col: WeaponParryCollider,
  outPoint?: THREE.Vector3,
): boolean {
  const tmp = outPoint ?? new THREE.Vector3();
  const d2 = closestPointOnSegment(p, col.a, col.b, tmp);
  const r = Math.max(0.05, col.radius);
  return d2 <= r * r;
}

/**
 * Build rebound velocity: mostly **direct at caster chest**, with a small
 * pure-180° reverse blend so the shot still reads as a ricochet.
 *
 * @param incomingVel current projectile velocity
 * @param hitPos      contact / projectile position at parry
 * @param casterPos   original projectile owner (chest-ish)
 * @param speedMul    default 2
 */
export function computeParryRebound(
  incomingVel: THREE.Vector3,
  hitPos: THREE.Vector3,
  casterPos: THREE.Vector3,
  speedMul: number = PARRY_REBOUND_SPEED_MUL,
): ReboundResult {
  const inSpeed = Math.max(1e-3, incomingVel.length());
  const reverse = incomingVel.clone().negate();
  if (reverse.lengthSq() < 1e-8) reverse.set(0, 0, 1);
  else reverse.normalize();

  // Direct path at caster — slightly elevate aim to chest if caster is at feet.
  const aim = casterPos.clone();
  if (Math.abs(aim.y - hitPos.y) < 0.35) aim.y += 1.0;
  const direct = aim.sub(hitPos);
  if (direct.lengthSq() < 1e-8) direct.copy(reverse);
  else direct.normalize();

  // 85% caster-home / 15% pure reverse → "180°" feel + more direct kill path.
  const dir = direct.multiplyScalar(0.85).add(reverse.multiplyScalar(0.15));
  if (dir.lengthSq() < 1e-8) dir.copy(reverse);
  else dir.normalize();

  const outSpeed = inSpeed * Math.max(1, speedMul);
  return {
    vel: dir.clone().multiplyScalar(outSpeed),
    point: hitPos.clone(),
    dir: dir.clone(),
    inSpeed,
    outSpeed,
  };
}

/** CombatController / sparring states that count as active parry for projectiles. */
export function isProjectileParryState(state: string | null | undefined): boolean {
  return state === "parry";
}
