/**
 * Pure predictive-aim math: where a projectile must be sent so it intercepts a
 * moving target. No `three`, no DOM — unit-testable in plain vitest. The host
 * (Studio) supplies live positions/velocities; this module returns an aim point.
 *
 * The lead solves the intercept-time quadratic so a fired projectile and a
 * constant-velocity target arrive at the same place at the same time, then clamps
 * the lead displacement so a sharp juke still dodges — the cast leads where the
 * target is *going*, not infinitely far ahead of it.
 */

/** Minimal positional shape; `THREE.Vector3` is structurally assignable. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

function sub(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function len(a: Vec3Like): number {
  return Math.sqrt(dot(a, a));
}

export interface LeadOptions {
  /**
   * Maximum lead displacement as a fraction of the shooter→target distance. The
   * predicted aim point is never pushed farther than this from the target's
   * current position, so a fast juke at close range still beats the cast.
   * Default 0.5.
   */
  maxLeadFraction?: number;
}

/**
 * Time at which a projectile of speed `projSpeed` fired from `shooter` intercepts
 * a target at `target` moving at constant `targetVel`. Returns the smallest
 * positive root of the intercept quadratic, or a straight-line fallback
 * (`distance / projSpeed`) when no positive real root exists (target outrunning
 * the projectile, or projSpeed ≤ 0).
 */
export function interceptTime(
  shooter: Vec3Like,
  target: Vec3Like,
  targetVel: Vec3Like,
  projSpeed: number,
): number {
  const r = sub(target, shooter);
  const dist = len(r);
  if (projSpeed <= 1e-6) return 0;
  const fallback = dist / projSpeed;
  const a = dot(targetVel, targetVel) - projSpeed * projSpeed;
  const b = 2 * dot(r, targetVel);
  const c = dot(r, r);
  if (Math.abs(a) < 1e-6) {
    // Linear case (target speed ≈ projectile speed): b t + c = 0.
    if (Math.abs(b) < 1e-6) return fallback;
    const t = -c / b;
    return t > 0 ? t : fallback;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return fallback;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const pos = [t1, t2].filter((t) => t > 1e-6).sort((x, y) => x - y);
  return pos.length ? pos[0] : fallback;
}

/**
 * Aim point that leads a moving target for a projectile of speed `projSpeed`.
 * The raw intercept point (`target + vel * t`) is clamped so its offset from the
 * target's current position never exceeds `maxLeadFraction` of the shooter→target
 * distance, keeping the lead beatable by a real juke.
 */
export function leadTarget(
  shooter: Vec3Like,
  target: Vec3Like,
  targetVel: Vec3Like,
  projSpeed: number,
  opts: LeadOptions = {},
): Vec3Like {
  const t = interceptTime(shooter, target, targetVel, projSpeed);
  const lead = { x: targetVel.x * t, y: targetVel.y * t, z: targetVel.z * t };
  const dist = len(sub(target, shooter));
  const maxLead = (opts.maxLeadFraction ?? 0.5) * dist;
  const leadLen = len(lead);
  if (leadLen > maxLead && leadLen > 1e-6) {
    const s = maxLead / leadLen;
    lead.x *= s;
    lead.y *= s;
    lead.z *= s;
  }
  return { x: target.x + lead.x, y: target.y + lead.y, z: target.z + lead.z };
}
