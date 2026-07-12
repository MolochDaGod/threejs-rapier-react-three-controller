/**
 * The Danger Room bear's authored move kit. The bear is a simple telegraphed
 * melee bruiser: it rotates through three distinct attacks, each with its own
 * damage/poise/reach/force profile and (crucially) a distinct wind-up length so
 * an attentive player can read the tell and dodge or punish. The actual strike
 * still resolves through the shared melee/`applyAttack` contract — this module
 * only supplies the per-attack multipliers + the rotation, so it stays pure and
 * unit-tested.
 */
export type BearAttackName = "swipe" | "maul" | "slam";

export interface BearAttack {
  name: BearAttackName;
  /** Multiplier on the base melee strike damage. */
  damageMul: number;
  /** Multiplier on the strike's poise damage. */
  poiseMul: number;
  /** Extra reach (m) added to the weapon's strike reach. */
  reachBonus: number;
  /** Extra area radius (m); >0 routes the strike through the ground telegraph. */
  radiusBonus: number;
  /** Scales the telegraph wind-up time (bigger = slower, more readable). */
  windupScale: number;
  /** Impact force tier (1 = light/blockable, 2 = heavy). */
  force: 1 | 2;
  /**
   * Presentation tier driving the swing whoosh + land impact cue (audio + VFX):
   *  - `"light"` quick jab (soft whoosh, body thud),
   *  - `"heavy"` two-handed blow (heavy whoosh, hard hit),
   *  - `"slam"` ground pound (heavy whoosh + a heavier thud with a ground shock).
   * Kept here so the cue stays data-driven alongside the combat multipliers.
   */
  impactTier: "light" | "heavy" | "slam";
}

/**
 * The bear's three distinct attacks, cycled in order:
 *  - **swipe**: quick light jab, short tell.
 *  - **maul**: a heavier two-handed blow, longer tell.
 *  - **slam**: a slow, telegraphed ground pound with a small AoE.
 */
export const BEAR_ATTACKS: readonly BearAttack[] = [
  { name: "swipe", damageMul: 0.9, poiseMul: 1.0, reachBonus: 0.2, radiusBonus: 0, windupScale: 1.2, force: 1, impactTier: "light" },
  { name: "maul", damageMul: 1.4, poiseMul: 1.4, reachBonus: 0.1, radiusBonus: 0, windupScale: 1.7, force: 2, impactTier: "heavy" },
  { name: "slam", damageMul: 1.9, poiseMul: 1.9, reachBonus: 0.4, radiusBonus: 1.6, windupScale: 2.2, force: 2, impactTier: "slam" },
];

/** Pick the next bear attack in the rotation from the previous index. */
export function nextBearAttack(prevIndex: number): { attack: BearAttack; index: number } {
  const n = BEAR_ATTACKS.length;
  const index = (((prevIndex + 1) % n) + n) % n;
  return { attack: BEAR_ATTACKS[index], index };
}

/**
 * Blink intensity (0..1) for a wind-up telegraph: `beats` sharp on/off pulses
 * spread across the wind-up `duration`. Used to flash an enemy bright before it
 * commits, so the tell is unmistakable. Pure so it can be unit-tested and driven
 * deterministically from elapsed time.
 */
export function telegraphBlink(elapsed: number, duration: number, beats = 2): number {
  if (duration <= 0) return 0;
  const t = Math.min(1, Math.max(0, elapsed / duration));
  const s = Math.sin(t * beats * Math.PI * 2);
  return s > 0 ? s : 0;
}

/** Total time (s) the procedural body motion for each bear attack runs. */
export const BEAR_ATTACK_DURATION: Record<BearAttackName, number> = {
  swipe: 0.5,
  maul: 0.72,
  slam: 0.9,
};

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Procedural full-body pose offset for a bear attack at normalized phase
 * `0..1`, used to give each attack a distinct, readable silhouette since the
 * bear rig ships no per-attack clips:
 *  - **swipe**: a quick low forward jab (small lunge, slight head-dip).
 *  - **maul**: a two-handed wind-back then a heavy overhead chop forward+down.
 *  - **slam**: rears up tall, then crashes straight down (the AoE pound).
 *
 * Returns `pitch` (rad, + = rear up / nose up, − = lurch down), `lift` (m up),
 * and `lunge` (m forward along the bear's facing). Every channel is 0 at phase
 * 0 and 1 so the body settles cleanly back onto its looping idle. Pure so it
 * can be unit-tested and driven deterministically from elapsed time.
 */
export function bearAttackPose(
  name: BearAttackName,
  phase: number,
): { pitch: number; lift: number; lunge: number } {
  const p = Math.min(1, Math.max(0, phase));
  if (name === "slam") {
    const windEnd = 0.45;
    if (p < windEnd) {
      const w = smoothstep(p / windEnd);
      return { pitch: 0.5 * w, lift: 0.65 * w, lunge: 0.15 * w };
    }
    const s = (p - windEnd) / (1 - windEnd);
    const crash = Math.sin(s * Math.PI); // 0 → 1 → 0
    return {
      pitch: 0.5 * (1 - s) - 0.45 * crash,
      lift: 0.65 * (1 - s) - 0.12 * crash,
      lunge: 0.15 * (1 - s) + 0.15 * crash,
    };
  }
  if (name === "maul") {
    const windEnd = 0.35;
    if (p < windEnd) {
      const w = smoothstep(p / windEnd);
      return { pitch: 0.32 * w, lift: 0.12 * w, lunge: -0.12 * w };
    }
    const s = (p - windEnd) / (1 - windEnd);
    const chop = Math.sin(s * Math.PI); // 0 → 1 → 0
    return {
      pitch: 0.32 * (1 - s) - 0.42 * chop,
      lift: 0.12 * (1 - s),
      lunge: -0.12 * (1 - s) + 0.55 * chop,
    };
  }
  // swipe: a fast light forward jab with a slight head-dip.
  const j = Math.sin(p * Math.PI); // 0 → 1 → 0
  return { pitch: -0.14 * j, lift: 0, lunge: 0.38 * j };
}
