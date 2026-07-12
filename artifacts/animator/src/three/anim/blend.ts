/**
 * Pure blending math for richer locomotion + clean clip handback. No `three`, no
 * DOM — unit-testable in plain vitest. The avatar layer turns these weights into
 * mixer action weights; this file only owns the math.
 */

/** Per-direction locomotion weights, each in 0..1, summing to ≤ 1. */
export interface DirectionalWeights {
  forward: number;
  back: number;
  left: number;
  right: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Split a planar move intent into forward/back/left/right strafe weights.
 *
 * `moveZ` is forward(+)/back(−), `moveX` is right(+)/left(−) in the character's
 * own facing frame. The magnitude is normalised so a diagonal input does not
 * exceed unit total weight (matching how a blend tree distributes a single
 * clip's worth of motion across its directional corners), then scaled by the
 * overall `speed` (0 = idle, 1 = full-speed clips).
 */
export function directionalBlendWeights(
  moveX: number,
  moveZ: number,
  speed = 1,
): DirectionalWeights {
  const mag = Math.hypot(moveX, moveZ);
  const s = clamp01(speed);
  if (mag < 1e-6 || s < 1e-6) {
    return { forward: 0, back: 0, left: 0, right: 0 };
  }
  // Direction is split with L1 (Manhattan) normalisation so the four corner
  // weights form a convex combination that sums to `total` — a diagonal reads as
  // 0.5 forward + 0.5 right, never 0.707+0.707. The overall `total` uses the L2
  // magnitude (capped at 1) so a diagonal isn't "faster" than a cardinal input.
  const l1 = Math.abs(moveX) + Math.abs(moveZ);
  const nx = moveX / l1;
  const nz = moveZ / l1;
  const total = Math.min(1, mag) * s;
  const fb = Math.abs(nz) * total;
  const lr = Math.abs(nx) * total;
  return {
    forward: nz > 0 ? fb : 0,
    back: nz < 0 ? fb : 0,
    right: nx > 0 ? lr : 0,
    left: nx < 0 ? lr : 0,
  };
}

/**
 * Eased 0..1 crossfade alpha for handing one clip back to another over
 * `duration` seconds. Uses smoothstep so the fade eases in and out instead of
 * snapping linearly. `duration ≤ 0` returns 1 immediately (instant handback).
 */
export function crossfadeAlpha(elapsed: number, duration: number): number {
  if (duration <= 1e-6) return 1;
  const t = clamp01(elapsed / duration);
  return t * t * (3 - 2 * t);
}

/**
 * Resolve a per-avatar blend time, clamped to a sane range so AI-authored or
 * UI-driven overrides can never set a negative or absurdly long crossfade.
 * Returns `fallback` when `requested` is undefined / not finite.
 */
export function resolveBlendTime(
  requested: number | undefined,
  fallback: number,
  min = 0,
  max = 1.5,
): number {
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.min(max, Math.max(min, requested));
}
