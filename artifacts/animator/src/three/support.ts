import type { ObstacleCircle } from "./types";

/** Edge forgiveness (m): part of the foot may hang over a rim and still stand. */
export const SUPPORT_PAD = 0.15;
/** A top must be at/below the feet (within this slack) to count as support —
 *  surfaces above the feet are wall faces, not floors. */
const ABOVE_FEET_SLACK = 0.05;

/**
 * Highest walkable support under (x, z) for feet that were at height `fromY`:
 * the flat room floor (y = 0) or any landable obstacle top (finite `top`)
 * at/below the feet. Pure math — the Controller's Danger Room (null-collision)
 * path calls this every gravity frame; the dungeon KCC owns its own floors.
 */
export function supportHeightAt(
  obstacles: ObstacleCircle[],
  x: number,
  z: number,
  fromY: number,
): number {
  let best = 0;
  for (const o of obstacles) {
    if (o.top === undefined || o.top <= best) continue;
    if (o.top > fromY + ABOVE_FEET_SLACK) continue;
    const dx = x - o.x;
    const dz = z - o.z;
    const rr = o.r + SUPPORT_PAD;
    if (dx * dx + dz * dz <= rr * rr) best = o.top;
  }
  return best;
}
