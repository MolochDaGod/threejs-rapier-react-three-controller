import * as THREE from "three";
import { leadTarget } from "../anim/predictiveLead";
import { screenCenterRay } from "./AimSystem";

/**
 * Shared projectile / skill aim resolution for Danger Room.
 *
 * Priority (single SSOT — do not fork per skill):
 *  1. Explicit combat target (hard/soft lock or crosshair pick) with optional lead
 *  2. Soft/hard lock world point
 *  3. Screen-centre camera ray (true crosshair aim)
 *
 * All spells/bolts/guns should call this so soft lock, hard lock, and free-aim
 * never diverge ("reticle lies").
 */

export interface FireTarget {
  position: THREE.Vector3;
  /** m/s planar or world velocity for lead; omit for stationary. */
  velocity?: THREE.Vector3;
}

export interface ResolveFireAimOpts {
  origin: THREE.Vector3;
  camera: THREE.Camera;
  /** Live crosshair / soft-aim pick (preferred). */
  target?: FireTarget | null;
  /** Hard-lock or soft-lock world point (XZ) when no full target. */
  lockPoint?: THREE.Vector3 | null;
  /** Projectile speed for lead (m/s). 0 / omit = no lead. */
  projSpeed?: number;
  /** Lead clamp as fraction of shooter→target distance. Default 0.5. */
  maxLeadFraction?: number;
  /** Height on target for aim point (m above target feet/position). Default 1.0. */
  aimHeight?: number;
  /** Fallback planar forward when no camera dir. */
  fallbackForward?: THREE.Vector3;
}

export interface FireAim {
  /** Unit direction from origin to aim point. */
  dir: THREE.Vector3;
  /** World point the projectile should seek / land toward. */
  aimPoint: THREE.Vector3;
  /** True when a combat target or lock supplied the aim (not pure free-look). */
  locked: boolean;
}

/**
 * Resolve fire direction + aim point for a projectile cast from `origin`.
 */
export function resolveFireAim(opts: ResolveFireAimOpts): FireAim {
  const {
    origin,
    camera,
    target = null,
    lockPoint = null,
    projSpeed = 0,
    maxLeadFraction = 0.5,
    aimHeight = 1.0,
  } = opts;

  const aimPoint = new THREE.Vector3();
  let locked = false;

  if (target) {
    locked = true;
    if (projSpeed > 1e-3 && target.velocity) {
      const led = leadTarget(origin, target.position, target.velocity, projSpeed, {
        maxLeadFraction,
      });
      aimPoint.set(led.x, target.position.y + aimHeight, led.z);
    } else {
      aimPoint.copy(target.position);
      aimPoint.y += aimHeight;
    }
  } else if (lockPoint && lockPoint.lengthSq() > 1e-8) {
    locked = true;
    aimPoint.set(lockPoint.x, origin.y + aimHeight, lockPoint.z);
  } else {
    const ray = screenCenterRay(camera);
    // Project crosshair ray to a point ~16 m ahead (or ground-ish height of origin)
    aimPoint.copy(ray.origin).addScaledVector(ray.direction, 16);
    // Keep height near muzzle when free-aiming so bolts don't bury into floor
    if (Math.abs(aimPoint.y - origin.y) > 8) {
      aimPoint.y = origin.y + Math.sin(Math.atan2(ray.direction.y, Math.hypot(ray.direction.x, ray.direction.z))) * 8;
    }
  }

  const dir = aimPoint.clone().sub(origin);
  if (dir.lengthSq() < 1e-6) {
    if (opts.fallbackForward) dir.copy(opts.fallbackForward);
    else {
      const ray = screenCenterRay(camera);
      dir.copy(ray.direction);
    }
  }
  dir.normalize();
  return { dir, aimPoint, locked };
}
