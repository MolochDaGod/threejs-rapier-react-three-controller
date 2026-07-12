// Pure animation stepper for the unit-frame vitals (HP / energy). Models the
// classic RPG bar feel: on damage the fill drains fast while a pale "ghost"
// segment holds the old value briefly, then chases the fill down; on heal the
// fill sweeps up with a short shimmer. Pure data + step functions so the tween
// logic is unit-testable without a DOM or requestAnimationFrame.

export interface VitalAnim {
  /** Bar capacity the values are clamped against. */
  max: number;
  /** The real (latest) value the fill is tweening toward. */
  target: number;
  /** Currently displayed fill value. */
  fill: number;
  /** Lagging damage-ghost value (always >= fill). */
  ghost: number;
  /** Remaining seconds the ghost holds before draining. */
  holdT: number;
  /** Remaining seconds of the damage flash overlay. */
  flashT: number;
  /** Remaining seconds of the heal shimmer. */
  healT: number;
}

/**
 * How long the ghost bar holds the pre-damage value before draining. Tuned
 * against real combat cadence: combo hits land every ~0.5–0.9s (swing clip
 * duration x COMBO_PLAYTHROUGH lock), and the hold re-arms on every hit, so it
 * must exceed that spacing or the ghost collapses mid-combo and the string
 * never reads as accumulated damage (0.35s was too short — the ghost fully
 * caught up between hits at 0.7s spacing).
 */
export const GHOST_HOLD_S = 0.6;
/** Duration of the white damage-flash overlay. */
export const DAMAGE_FLASH_S = 0.3;
/** Duration of the heal shimmer on the fill. */
export const HEAL_SHIMMER_S = 0.45;

// Exponential approach rates (fraction/s) + a linear floor so tweens always
// complete instead of asymptoting forever.
const DRAIN_RATE = 14;
const RISE_RATE = 8;
const GHOST_RATE = 6;
/** Linear floor speed as a fraction of max per second. */
const MIN_SPEED_FRAC = 0.4;

function clampValue(v: number, max: number): number {
  return Math.min(Math.max(0, v), Math.max(0, max));
}

export function createVitalAnim(value: number, max: number): VitalAnim {
  const m = Math.max(0, max);
  const v = clampValue(value, m);
  return { max: m, target: v, fill: v, ghost: v, holdT: 0, flashT: 0, healT: 0 };
}

/**
 * Feed a new live value into the animation. Damage arms the ghost hold + flash;
 * heal arms the shimmer. A capacity change (different unit / respawn) snaps —
 * tweening across two different bars would show a fake drain.
 */
export function retargetVitalAnim(s: VitalAnim, value: number, max: number): VitalAnim {
  const m = Math.max(0, max);
  if (m !== s.max) return createVitalAnim(value, m);
  const v = clampValue(value, m);
  if (v === s.target) return s;
  if (v < s.fill) {
    return {
      ...s,
      target: v,
      ghost: Math.max(s.ghost, s.fill),
      holdT: GHOST_HOLD_S,
      flashT: DAMAGE_FLASH_S,
    };
  }
  if (v > s.fill) return { ...s, target: v, healT: HEAL_SHIMMER_S };
  // v is between target and fill (e.g. partial heal mid-drain): just retarget.
  return { ...s, target: v };
}

/** Exponential approach with a linear floor; snaps exactly onto the target. */
function approach(cur: number, target: number, rate: number, minSpeed: number, dt: number): number {
  const diff = target - cur;
  if (diff === 0) return cur;
  const exp = diff * (1 - Math.exp(-rate * dt));
  const lin = Math.sign(diff) * minSpeed * dt;
  const step = Math.abs(exp) > Math.abs(lin) ? exp : lin;
  if (Math.abs(step) >= Math.abs(diff)) return target;
  return cur + step;
}

/** Advance the animation by `dt` seconds. Pure — returns a new state. */
export function stepVitalAnim(s: VitalAnim, dt: number): VitalAnim {
  if (dt <= 0 || vitalAnimSettled(s)) return s;
  const minSpeed = Math.max(1, s.max * MIN_SPEED_FRAC);
  const rate = s.target < s.fill ? DRAIN_RATE : RISE_RATE;
  const fill = approach(s.fill, s.target, rate, minSpeed, dt);
  const holdT = Math.max(0, s.holdT - dt);
  let ghost = Math.max(s.ghost, fill);
  if (holdT <= 0 && ghost > fill) {
    ghost = Math.max(fill, approach(ghost, fill, GHOST_RATE, minSpeed, dt));
  }
  return {
    ...s,
    fill,
    ghost,
    holdT,
    flashT: Math.max(0, s.flashT - dt),
    healT: Math.max(0, s.healT - dt),
  };
}

/** True once every tween and timer has finished (safe to stop the rAF loop). */
export function vitalAnimSettled(s: VitalAnim): boolean {
  return s.fill === s.target && s.ghost === s.fill && s.holdT <= 0 && s.flashT <= 0 && s.healT <= 0;
}
