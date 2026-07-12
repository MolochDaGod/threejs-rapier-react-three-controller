/**
 * Pure two-bone inverse-kinematics math for foot-to-ground planting.
 *
 * This module is deliberately PURE — no `three`, no DOM — so the solve is
 * unit-testable in plain vitest. The avatar (skinned rig) layer is responsible
 * for turning these angles into bone quaternions and applying them AFTER the
 * animation mixer has run (see the documented post-mixer override order in the
 * avatar classes); this file only owns the geometry.
 *
 * A leg is a two-bone chain: an upper bone (thigh, length `upperLen`) from the
 * hip joint to the knee, and a lower bone (shin, length `lowerLen`) from the
 * knee to the ankle/foot. Given the straight-line distance from hip to the
 * desired foot target, the law of cosines yields:
 *  - `rootAngle` — how far to swing the thigh off the hip→target line so the
 *    knee lands correctly, and
 *  - `jointAngle` — the interior bend at the knee (π = fully straight leg).
 */

/** Result of a single two-bone solve. Angles are in radians. */
export interface TwoBoneSolution {
  /**
   * False when the target is farther than the leg can reach (`> upperLen +
   * lowerLen`): the leg is straightened toward the target rather than detaching.
   */
  reachable: boolean;
  /** Angle to rotate the upper bone off the hip→target line (0 when straight). */
  rootAngle: number;
  /** Interior angle at the knee; π = straight, smaller = more bent. */
  jointAngle: number;
}

/** Clamp helper kept local so the module stays dependency-free. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Solve a planar two-bone chain for the hip-swing and knee-bend angles needed to
 * place the foot at distance `targetDist` from the hip.
 *
 * - When the target is unreachably far, the leg is straightened (`rootAngle = 0`,
 *   `jointAngle = π`) and `reachable` is false.
 * - When the target is closer than `|upperLen - lowerLen|` (over-compressed), the
 *   distance is clamped up to that minimum so the acos arguments stay valid.
 */
export function solveTwoBoneIk(
  upperLen: number,
  lowerLen: number,
  targetDist: number,
): TwoBoneSolution {
  const reach = upperLen + lowerLen;
  const minDist = Math.abs(upperLen - lowerLen);
  if (targetDist >= reach) {
    return { reachable: false, rootAngle: 0, jointAngle: Math.PI };
  }
  const d = clamp(targetDist, minDist + 1e-6, reach - 1e-6);
  // Law of cosines. Arguments clamped to [-1, 1] to absorb float drift.
  const rootCos = clamp(
    (upperLen * upperLen + d * d - lowerLen * lowerLen) / (2 * upperLen * d),
    -1,
    1,
  );
  const jointCos = clamp(
    (upperLen * upperLen + lowerLen * lowerLen - d * d) / (2 * upperLen * lowerLen),
    -1,
    1,
  );
  return {
    reachable: true,
    rootAngle: Math.acos(rootCos),
    jointAngle: Math.acos(jointCos),
  };
}

/**
 * Vertical correction to move a foot from its animated height onto the ground.
 *
 * Returns the signed delta (`groundY - footY`) clamped to `[-maxDrop, maxLift]`,
 * so the rig only lifts a foot up to `maxLift` onto a rise and drops it down to
 * `maxDrop` into a dip — beyond that the pose is left alone to avoid grotesque
 * over-stretching. Positive = lift the foot up, negative = push it down.
 */
export function footPlantOffset(
  footY: number,
  groundY: number,
  maxLift: number,
  maxDrop: number,
): number {
  return clamp(groundY - footY, -Math.abs(maxDrop), Math.abs(maxLift));
}

/**
 * How far to drop the pelvis so the lowest-reaching foot can still plant.
 *
 * Given each leg's desired foot correction (from {@link footPlantOffset}), a foot
 * that must drop below where its straightened leg can reach forces the whole
 * pelvis down. We take the most-negative correction (deepest drop) and return it
 * as a non-positive pelvis offset; rises (positive corrections) never raise the
 * pelvis (the planted foot handles those via knee bend instead).
 */
export function pelvisDropForFeet(footOffsets: readonly number[]): number {
  let drop = 0;
  for (const o of footOffsets) if (o < drop) drop = o;
  return drop;
}
