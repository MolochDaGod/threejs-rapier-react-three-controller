/**
 * Pure bear-trap combat helpers (no THREE).
 *
 * A deployed trap arms under its owner, is invisible to everyone else, and
 * fires a one-shot 2 m stun when any enemy walks into the trigger cylinder.
 */

/** Horizontal trigger radius in metres (2 m AOE). */
export const BEAR_TRAP_RADIUS_M = 2.0;

/** Stun duration applied to every enemy inside the trigger on fire. */
export const BEAR_TRAP_STUN_SEC = 2.5;

/** Max life of an untriggered trap before it despawns (seconds). */
export const BEAR_TRAP_LIFE_SEC = 40;

/** F-skill cooldown after a successful deploy (seconds). */
export const BEAR_TRAP_COOLDOWN = 10;

/** Public model path (under the asset host / public root). */
export const BEAR_TRAP_MODEL = "models/gadgets/bear-trap.glb";

/**
 * True when an enemy at `(ex, ez)` is inside the trap's horizontal trigger
 * cylinder of `radius` metres around `(tx, tz)`. Y is ignored so slopes still
 * trip the trap.
 */
export function enemyInBearTrapZone(
  tx: number,
  tz: number,
  ex: number,
  ez: number,
  radius: number = BEAR_TRAP_RADIUS_M,
): boolean {
  const dx = ex - tx;
  const dz = ez - tz;
  return dx * dx + dz * dz <= radius * radius;
}

/** True when the local viewer is allowed to see this trap (owner-only mesh). */
export function canSeeBearTrap(ownerId: string, viewerId: string): boolean {
  return ownerId === viewerId;
}
