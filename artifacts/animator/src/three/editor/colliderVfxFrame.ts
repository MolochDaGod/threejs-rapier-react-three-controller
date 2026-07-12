import * as THREE from "three";

/**
 * The origin/aim/orientation a Skill Lab VFX case fires from. With the collider
 * toggle OFF this MUST collapse to the body's flat frame (origin, facing,
 * facingQuat); with it ON the slash/projectile origin moves onto the damaging
 * collider's swinging-hand frame. See {@link deriveColliderVfxFrame}.
 */
export interface ColliderVfxFrame {
  /** World-space origin every collider-bound asset emits from. */
  srcPos: THREE.Vector3;
  /** Direction directional effects (projectiles, cones) travel along. */
  aimDir: THREE.Vector3;
  /** Orientation the slash arc takes (tilts/rolls with the swing). */
  slashQuat: THREE.Quaternion;
}

/**
 * Pure derivation of the VFX frame shared by every `playVfx` case.
 *
 * INVARIANT (the safety check this module exists to lock in): when
 * `slashFromCollider` is false the result is exactly the legacy flat frame —
 * `srcPos == origin`, `aimDir == facing`, `slashQuat == facingQuat` — so the
 * default (toggle OFF) behavior can never drift as new VFX cases are added.
 *
 * When the toggle is ON and a collider world position is available, the origin
 * snaps to the collider center. If a collider orientation is also available the
 * slash takes that orientation and the aim is the collider's most-outward
 * orientation axis (so rotating the hand in place re-aims the cast); otherwise
 * the aim falls back to the outward chest->collider displacement.
 *
 * Returns fresh vectors/quaternions (clones of the inputs on the OFF path) so
 * callers can mutate the frame without disturbing their source values.
 */
export function deriveColliderVfxFrame(args: {
  /** Body VFX origin (`p`). */
  origin: THREE.Vector3;
  /** Body flat facing (`fwd`). */
  facing: THREE.Vector3;
  /** Body flat facing as a yaw-only quaternion (`quat`). */
  facingQuat: THREE.Quaternion;
  /** Whether the Skill Lab "emit from collider" toggle is on. */
  slashFromCollider: boolean;
  /** Collider world center, or null when unavailable / no target. */
  colliderPos: THREE.Vector3 | null;
  /** Collider world orientation, or null when no collider is attached. */
  colliderQuat: THREE.Quaternion | null;
}): ColliderVfxFrame {
  const { origin, facing, facingQuat, slashFromCollider, colliderPos, colliderQuat } = args;

  // Default (toggle OFF) path: identical to the legacy flat behavior.
  const srcPos = origin.clone();
  const aimDir = facing.clone();
  const slashQuat = facingQuat.clone();

  if (!slashFromCollider) return { srcPos, aimDir, slashQuat };

  const cp = colliderPos;
  if (cp) {
    srcPos.copy(cp);
    const cq = colliderQuat;
    if (cq) {
      slashQuat.copy(cq);
      // Aim from the collider's ORIENTATION, not its position: project each
      // hand-frame axis through the hand world quaternion and take the one
      // pointing most outward from the body. The chest->collider vector only
      // disambiguates which axis/sign is "forward" (the raw hand-bone axis
      // convention is rig-dependent) so projectiles can't fly sideways/down.
      const ref = cp.clone().sub(origin);
      if (ref.lengthSq() > 1e-5) ref.normalize();
      else ref.copy(facing);
      const axes = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, -1),
      ];
      const aim = new THREE.Vector3();
      let bestDot = -Infinity;
      for (const ax of axes) {
        ax.applyQuaternion(cq);
        const d = ax.dot(ref);
        if (d > bestDot) {
          bestDot = d;
          aim.copy(ax);
        }
      }
      aimDir.copy(aim.normalize());
    } else {
      // No orientation available: aim along the outward displacement.
      const dir = cp.clone().sub(origin);
      if (dir.lengthSq() > 1e-5) aimDir.copy(dir.normalize());
    }
  }

  return { srcPos, aimDir, slashQuat };
}

/**
 * Per-effect placement constants. These are the literal offsets each `playVfx`
 * case applies on top of the shared {@link ColliderVfxFrame}; centralizing them
 * keeps the helpers below and the call sites in lockstep.
 */
/** Chest height a body-origin launch (fire dragon / dark blades) rises to. */
export const VFX_CHEST_HEIGHT = 1.1;
/** How far in front a slash arc leads out along the flat facing while playing. */
export const SLASH_LEAD_OUT = 1.0;
/** How far the meteor landing zone projects out along the collider aim. */
export const METEOR_LANDING_DIST = 6;
/** How far the sword-volley landing zone projects out along the collider aim. */
export const SWORD_VOLLEY_LANDING_DIST = 4;
/** How far the turret chassis is backed out so it stands under the collider. */
export const TURRET_BACK_OUT = 1.5;

/**
 * Where a slash arc is emitted from.
 *
 * - Collider ON: the collider center (`srcPos`), so the cut tilts/rolls to the
 *   real swing plane.
 * - Collider OFF while playing: led out {@link SLASH_LEAD_OUT} in front of the
 *   body along its flat facing.
 * - Collider OFF in the static editor: the body origin unchanged.
 *
 * Returns a fresh vector so the caller can mutate it freely.
 */
export function deriveSlashArcOrigin(args: {
  origin: THREE.Vector3;
  facing: THREE.Vector3;
  srcPos: THREE.Vector3;
  slashFromCollider: boolean;
  playing: boolean;
}): THREE.Vector3 {
  const { origin, facing, srcPos, slashFromCollider, playing } = args;
  if (slashFromCollider) return srcPos.clone();
  if (playing) return origin.clone().addScaledVector(facing, SLASH_LEAD_OUT);
  return origin.clone();
}

/**
 * Launch origin for body-fired projectiles (fire dragon, dark blades).
 *
 * - Collider ON: the collider center (`srcPos`), so the cast launches along the
 *   collider's 3D aim (pitch + yaw).
 * - Collider OFF: chest height ({@link VFX_CHEST_HEIGHT} above the body origin)
 *   so the cast leaves the torso, not the feet.
 *
 * Returns a fresh vector.
 */
export function deriveLaunchOrigin(args: {
  origin: THREE.Vector3;
  srcPos: THREE.Vector3;
  slashFromCollider: boolean;
}): THREE.Vector3 {
  const { origin, srcPos, slashFromCollider } = args;
  if (slashFromCollider) return srcPos.clone();
  return new THREE.Vector3(origin.x, origin.y + VFX_CHEST_HEIGHT, origin.z);
}

/**
 * Landing zone for sky-falling effects (meteor, sword volley).
 *
 * - Collider ON: projected `distance` out along the collider aim from the
 *   collider center, so the strike lands where the swing points.
 * - Collider OFF: `null` — the caller passes `undefined` and the effect uses its
 *   own default straight-ahead landing.
 *
 * Returns a fresh vector (ON) or null (OFF).
 */
export function deriveLandingZone(args: {
  srcPos: THREE.Vector3;
  aimDir: THREE.Vector3;
  slashFromCollider: boolean;
  distance: number;
}): THREE.Vector3 | null {
  const { srcPos, aimDir, slashFromCollider, distance } = args;
  if (!slashFromCollider) return null;
  return srcPos.clone().addScaledVector(aimDir, distance);
}

/**
 * Base position + aim for the turret chassis.
 *
 * `castTurret` shifts its chassis {@link TURRET_BACK_OUT} forward along the
 * flattened aim and snaps y=0. So:
 *
 * - Collider ON: back that shift out (`-TURRET_BACK_OUT` along the flattened,
 *   normalized collider aim) from the collider center, so the turret stands
 *   directly under the collider's world XZ instead of ahead of it. If the aim is
 *   (near) vertical, the flattened aim falls back to +Z.
 * - Collider OFF: the body origin with the body's flat facing.
 *
 * Returns fresh vectors.
 */
export function deriveTurretBase(args: {
  origin: THREE.Vector3;
  facing: THREE.Vector3;
  srcPos: THREE.Vector3;
  aimDir: THREE.Vector3;
  slashFromCollider: boolean;
}): { base: THREE.Vector3; aim: THREE.Vector3 } {
  const { origin, facing, srcPos, aimDir, slashFromCollider } = args;
  if (!slashFromCollider) {
    return { base: origin.clone(), aim: facing.clone() };
  }
  const ground = aimDir.clone().setY(0);
  if (ground.lengthSq() < 1e-4) ground.set(0, 0, 1);
  ground.normalize();
  return {
    base: srcPos.clone().addScaledVector(ground, -TURRET_BACK_OUT),
    aim: aimDir.clone(),
  };
}
