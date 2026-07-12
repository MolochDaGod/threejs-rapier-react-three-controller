import * as THREE from "three";
import type { WeaponCombat, WeaponGroup, Faction } from "./types";

/**
 * Shared melee combat resolution. Both the player's combo (Studio) and the AI
 * sparring opponents (Targets) build their strikes from the SAME scriptable
 * weapon-combat data through here, and resolve area hits with the same falloff,
 * so the two sides of a duel use one consistent damage model.
 */

/** Distance attenuation for an area strike: 1 at the centre → 0 at the rim, or -1 when out of range. */
export function aoeFalloff(dist: number, radius: number): number {
  if (radius <= 0 || dist > radius) return -1;
  return 1 - dist / radius;
}

/** Concrete numbers one melee strike lands with, derived from a weapon profile. */
export interface MeleeStrike {
  /** Mid of the weapon's reach band — where the strike centres ahead of the attacker (m). */
  reach: number;
  /** Strike area radius (m). */
  radius: number;
  /** Damage at the centre. */
  damage: number;
  /** Knockback force at the centre. */
  force: number;
}

/**
 * Resolve a weapon's combat profile into one strike's params. `finisher` boosts a
 * combo ender, `skill` boosts a weapon-skill swing, `damageScale` lets the AI
 * difficulty tune output, and `skillForce` is the editor's global knockback knob.
 * The base numbers match the player's hand-tuned combo so both sides feel alike.
 */
export function meleeStrike(
  combat: WeaponCombat,
  opts: { finisher?: boolean; skill?: boolean; skillForce: number; damageScale?: number },
): MeleeStrike {
  const intensityN = THREE.MathUtils.clamp(combat.intensity, 1, 100) / 100;
  const [rMin, rMax] = combat.range;
  const finisher = opts.finisher ?? false;
  const skill = opts.skill ?? false;
  const damageScale = opts.damageScale ?? 1;
  const damage = (10 + 26 * intensityN) * (finisher ? 1.6 : 1) * (skill ? 1.5 : 1) * damageScale;
  const force = opts.skillForce * (0.4 + intensityN * 0.9) * (finisher ? 1.5 : 1) * (skill ? 1.4 : 1);
  const radius = (rMax - rMin) * 0.5 + 0.5 + (finisher ? 0.3 : 0) + (skill ? 0.6 : 0);
  return { reach: (rMin + rMax) * 0.5, radius, damage, force };
}

// ---------------------------------------------------------------------------
// Optimal Weapon Range (OWR) — the "respect through range" model.
//
// Every fighter projects a threat envelope derived from their weapon's hold
// style. Positioning relative to BOTH fighters' envelopes decides whether a
// strike lands clean, lands weak (you're inside their range but outside yours),
// or rewards/punishes a committed forward "penetration" of the gap. This is the
// single source the consequence layers (damage scaling, stagger, slow-mo,
// expose windows) read from, so the player and AI respect range the same way.
// ---------------------------------------------------------------------------

/** A fighter's Optimal Weapon Range envelope, in metres (the "threat bubble"). */
export interface OWR {
  /** Closer than this the weapon is cramped (can't bring it to bear). */
  inner: number;
  /** Clean-hit band start. */
  optimalMin: number;
  /** Clean-hit band end — the bright bubble edge. */
  optimalMax: number;
  /** Absolute reach; beyond this a strike whiffs entirely. */
  outer: number;
}

/**
 * Per-category hold-style standard: how a weapon class relates to the hand and
 * to space. Melee classes derive their OWR from the weapon's reach band; ranged
 * and magic override it with a real fighting/kite band (their tiny `combat.range`
 * is only a point-blank butt-strike, NOT how far they actually fight).
 */
export interface HoldStyle {
  /** Held in two hands (longer reach, higher guard). */
  twoHanded: boolean;
  /** Ready/guard pose key consumed by the stance layer. */
  guard: "fists" | "midMelee" | "highMelee" | "aimed" | "channel";
  /** Ranged/magic only: absolute optimal fighting band [min,max] in metres. */
  kite?: [number, number];
  /** How far past optimalMax the tip still threatens (penetration edge bias). */
  outerBias: number;
  /** Fraction of optimalMin below which the fighter is cramped (inner). */
  innerFrac: number;
}

export const HOLD_STYLES: Record<WeaponGroup, HoldStyle> = {
  unarmed: { twoHanded: false, guard: "fists", outerBias: 0.4, innerFrac: 0.5 },
  "melee-1h": { twoHanded: false, guard: "midMelee", outerBias: 0.6, innerFrac: 0.55 },
  "melee-2h": { twoHanded: true, guard: "highMelee", outerBias: 0.85, innerFrac: 0.62 },
  "off-hand": { twoHanded: false, guard: "midMelee", outerBias: 0.5, innerFrac: 0.55 },
  ranged: { twoHanded: false, guard: "aimed", kite: [5, 12], outerBias: 0.35, innerFrac: 0.4 },
  magic: { twoHanded: false, guard: "channel", kite: [4, 11], outerBias: 0.35, innerFrac: 0.4 },
};

/**
 * Resolve a weapon's OWR envelope from its combat profile + group hold style,
 * scaled by body size (`scale`, e.g. CHARACTER_HEIGHT_M / 1.8) so the bubbles
 * grow with the canonical fighter. Falls back to a neutral 1h melee envelope.
 */
export function weaponOWR(combat: WeaponCombat | undefined, group: WeaponGroup | undefined, scale = 1): OWR {
  const style = HOLD_STYLES[group ?? "melee-1h"] ?? HOLD_STYLES["melee-1h"];
  if (style.kite) {
    const optimalMin = style.kite[0] * scale;
    const optimalMax = style.kite[1] * scale;
    // The melee `range` (if any) marks where a ranged fighter is "too close".
    const inner = (combat ? combat.range[1] : 1.4) * scale;
    return { inner, optimalMin, optimalMax, outer: optimalMax + (optimalMax - optimalMin) * style.outerBias };
  }
  const [rMin, rMax] = combat ? combat.range : [0.8, 1.6];
  const optimalMin = rMin * scale;
  const optimalMax = rMax * scale;
  return {
    inner: optimalMin * style.innerFrac,
    optimalMin,
    optimalMax,
    outer: optimalMax + (rMax - rMin + 0.5) * style.outerBias * scale,
  };
}

/** The qualitative result of a strike, given where both fighters stand. */
export type RangeOutcome =
  | "clean"
  | "spacingDisadvantage"
  | "penetrationSuccess"
  | "penetrationFail"
  | "whiff";

/** Full verdict of a ranged engagement: outcome + every consequence flag. */
export interface RangeVerdict {
  outcome: RangeOutcome;
  /** Multiplier on base damage (0 = whiff). */
  damageMul: number;
  /** Attacker is locked in recovery; defender earns a free counter. */
  staggerLock: boolean;
  /** Defender gets a free counter window. */
  freeCounter: boolean;
  /** Seconds the attacker is left exposed (failed penetration). */
  exposeWindow: number;
  /** Trigger the brief slow-mo / screen-flash cinematic (clean penetration). */
  slowmo: boolean;
}

const VERDICT = (
  outcome: RangeOutcome,
  damageMul: number,
  extra?: Partial<RangeVerdict>,
): RangeVerdict => ({
  outcome,
  damageMul,
  staggerLock: false,
  freeCounter: false,
  exposeWindow: 0,
  slowmo: false,
  ...extra,
});

/**
 * Classify one strike by the geometry of both fighters' OWR envelopes plus the
 * attacker's commitment + timing. Pure — both the player's combo and the AI
 * resolve through this so positioning consequences are symmetric.
 *
 * - clean: attacker is in their optimal band → full damage.
 * - spacingDisadvantage: attacker is inside the DEFENDER's range but outside its
 *   own optimal → weak hit + stagger lock + the defender gets a free counter.
 * - penetrationSuccess/Fail: a committed forward attack that crosses the outer
 *   edge into range. Good timing → big damage + slow-mo; poor timing → weak hit
 *   and a long expose window (momentum carry-through).
 * - whiff: out of reach entirely.
 */
export function classifyEngagement(args: {
  dist: number;
  attacker: OWR;
  defender: OWR;
  committedLunge?: boolean;
  timingQuality?: number;
}): RangeVerdict {
  const { dist, attacker, defender } = args;
  const committed = args.committedLunge ?? false;
  const timing = THREE.MathUtils.clamp(args.timingQuality ?? 0, 0, 1);

  // A committed forward attack that breaches the gap is a "penetration window".
  if (committed && dist <= attacker.outer && dist >= attacker.optimalMin * 0.55) {
    return timing >= 0.5
      ? VERDICT("penetrationSuccess", 1.6, { slowmo: true })
      : VERDICT("penetrationFail", 0.3, { exposeWindow: 0.7, freeCounter: true });
  }

  // Out of reach entirely.
  if (dist > attacker.outer) return VERDICT("whiff", 0);

  // Both fighters' optimal bands overlap the gap → clean hit, full damage.
  if (dist >= attacker.optimalMin && dist <= attacker.optimalMax) {
    return VERDICT("clean", 1);
  }

  // Inside the defender's reach but outside your own optimal → you're at a
  // spacing disadvantage: weak hit, stagger lock, and they get a free counter.
  if (dist <= defender.optimalMax && dist >= defender.inner) {
    return VERDICT("spacingDisadvantage", 0.5, { staggerLock: true, freeCounter: true });
  }

  // Reachable but off-optimal (slightly long / slightly close) → glancing hit.
  return VERDICT("clean", 0.8);
}

/**
 * Defense/knockback force tier of a melee strike. A boss skill swing is
 * UNBLOCKABLE (4) — block leaks full damage, parry only halves, only a clean
 * dodge fully evades; a regular skill swing is heavy (2); a basic swing is
 * light (1). This is the `AttackPayload.force` both the direct strike AND the
 * telegraph resolve must use, so a telegraphed boss skill stays unblockable.
 */
export function strikeForceLevel(isBoss: boolean, isSkill: boolean): 1 | 2 | 4 {
  return isBoss && isSkill ? 4 : isSkill ? 2 : 1;
}

/**
 * Who an AoE (skill) swing resolves against, keyed off the ATTACKER's faction.
 * Enemies hit the player + allied units; allies hit enemy units only and NEVER
 * the player. Used at telegraph-resolve time so an ally's skill AoE can't damage
 * the player or fellow allies.
 */
export function aoeVictims(attackerFaction: Faction): { hitsPlayer: boolean; victimFaction: Faction } {
  return attackerFaction === "enemy"
    ? { hitsPlayer: true, victimFaction: "ally" }
    : { hitsPlayer: false, victimFaction: "enemy" };
}

/**
 * Whether a player's offensive ability should resolve against the explicitly
 * Tab-selected hostile (the red target) rather than its cone/nearest fallback.
 * The selected hostile wins as long as it's a positive distance away and within
 * the ability's acquisition range — so a red target is honored even when another
 * enemy is nearer or better aligned, but a selection out of range still falls
 * back. `selectedDist` is null when nothing hostile is selected (then: false).
 */
export function preferSelectedHostile(selectedDist: number | null, maxRange: number): boolean {
  return selectedDist != null && selectedDist >= 1e-3 && selectedDist <= maxRange;
}

/** Per-stage params of the caster's "Hot Hands" fire spell-combo. */
export interface FireComboStep {
  /** Impact AoE radius (m). */
  radius: number;
  /** Centre damage. */
  damage: number;
  /** Multiplier on the global skillForce knob → escalating knockback. */
  forceMul: number;
  /** Upward launch velocity applied at impact (0 = none; finisher pops the target). */
  launch: number;
  /** Scale of the blazing-hand VFX on the casting hand. */
  handScale: number;
  /** True on the chain-ending meteor finisher. */
  finisher: boolean;
}

/**
 * Tuning for the 3-stage Soulbinder "Hot Hands" fire-combo. Each press within the
 * chain window escalates: a quick ember fireball (light knockback) → a flame
 * dragon (heavier) → a meteor finisher that launches the target. Pure data so the
 * escalation curve is unit-tested without a renderer; the orchestration (clips,
 * projectiles, blast resolution) lives in `Studio.doFireCombo`. `stage` is
 * clamped into 0-2, so an out-of-range index degrades to the nearest valid step.
 */
export function fireComboStep(stage: number): FireComboStep {
  const s = Math.min(2, Math.max(0, Math.floor(stage)));
  const steps: FireComboStep[] = [
    { radius: 1.6, damage: 20, forceMul: 0.6, launch: 0, handScale: 1.0, finisher: false },
    { radius: 2.3, damage: 32, forceMul: 1.0, launch: 0, handScale: 1.2, finisher: false },
    { radius: 3.2, damage: 52, forceMul: 1.6, launch: 9, handScale: 1.5, finisher: true },
  ];
  return steps[s];
}
