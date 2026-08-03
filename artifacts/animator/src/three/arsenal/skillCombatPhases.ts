/**
 * Elden Ring–inspired skill combat phases for competitive play.
 *
 * Design goals:
 * - **Commit / telegraph** — castTime wind-up is readable and punishable
 * - **Dodgeable** — projectiles fly slowly enough that a dodge mid-flight works
 * - **Impact payoff** — strong skills hit hard after the wind-up
 * - **Reload** — firearms trade continuous fire for clip discipline
 *
 * Studio uses these when a WeaponSkillEntry or SkillPreset omits explicit timing.
 */

import type { SkillKind } from "../types";
import type { WeaponSkillEntry } from "./weaponSkillKits";

/** Cast telegraph style (aura / draw / channel during wind-up). */
export type CastEffectStyle =
  | "charge" // growing aura (heavy / magic)
  | "draw" // bow / gun string pull
  | "aura" // soft ring at feet
  | "channel" // sustained caster beam prep
  | "none";

/** Impact resolution family for VFX + hit framing. */
export type ImpactEffectStyle =
  | "slash"
  | "slam"
  | "blast"
  | "shockwave"
  | "bolt"
  | "nova"
  | "muzzle"
  | "thrust";

export interface SkillCombatTiming {
  /** Wind-up before release (s). Opponent can dodge during this + projectile flight. */
  castTime: number;
  /** Recovery after impact before free action (s). Self vulnerability window. */
  recovery: number;
  castEffect: CastEffectStyle;
  impactEffect: ImpactEffectStyle;
  /** Projectile / travel speed (m/s). Lower = more dodgeable. 0 = melee instant. */
  projectileSpeed: number;
  /** Firearm magazine size (0 = not a gun). */
  magazine: number;
  /** Seconds to reload empty magazine. */
  reloadTime: number;
  /** True if hyper-armor / unparryable (rare; big commits only). */
  hyperArmor: boolean;
}

const DEFAULTS: SkillCombatTiming = {
  castTime: 0.35,
  recovery: 0.28,
  castEffect: "charge",
  impactEffect: "slash",
  projectileSpeed: 0,
  magazine: 0,
  reloadTime: 0,
  hyperArmor: false,
};

/** Kind → baseline Elden-style feel. */
export function timingForKind(kind: SkillKind): SkillCombatTiming {
  switch (kind) {
    case "slash":
      return { ...DEFAULTS, castTime: 0.28, recovery: 0.32, castEffect: "charge", impactEffect: "slash" };
    case "thrust":
      return { ...DEFAULTS, castTime: 0.22, recovery: 0.26, castEffect: "charge", impactEffect: "thrust", projectileSpeed: 28 };
    case "slam":
      return { ...DEFAULTS, castTime: 0.55, recovery: 0.45, castEffect: "charge", impactEffect: "slam", hyperArmor: true };
    case "nova":
      return { ...DEFAULTS, castTime: 0.5, recovery: 0.4, castEffect: "aura", impactEffect: "nova" };
    case "bolt":
    case "soul":
      return { ...DEFAULTS, castTime: 0.4, recovery: 0.3, castEffect: "channel", impactEffect: "bolt", projectileSpeed: 18 };
    case "laser":
      return { ...DEFAULTS, castTime: 0.45, recovery: 0.35, castEffect: "channel", impactEffect: "bolt", projectileSpeed: 22 };
    case "muzzle":
      return {
        ...DEFAULTS,
        castTime: 0.12,
        recovery: 0.18,
        castEffect: "draw",
        impactEffect: "muzzle",
        projectileSpeed: 42,
        magazine: 6,
        reloadTime: 1.35,
      };
    case "meteor":
    case "fireDragon":
      return { ...DEFAULTS, castTime: 0.7, recovery: 0.5, castEffect: "channel", impactEffect: "blast", projectileSpeed: 14 };
    case "darkBlades":
    case "swordVolley":
      return { ...DEFAULTS, castTime: 0.48, recovery: 0.38, castEffect: "charge", impactEffect: "slash", projectileSpeed: 16 };
    default:
      return { ...DEFAULTS };
  }
}

/** Merge kit entry overrides onto kind defaults. */
export function resolveSkillTiming(entry: Pick<WeaponSkillEntry, "kind" | "castTime" | "recovery" | "castEffect" | "impactEffect" | "projectileSpeed" | "magazine" | "reloadTime" | "hyperArmor">): SkillCombatTiming {
  const base = timingForKind(entry.kind);
  return {
    castTime: entry.castTime ?? base.castTime,
    recovery: entry.recovery ?? base.recovery,
    castEffect: entry.castEffect ?? base.castEffect,
    impactEffect: entry.impactEffect ?? base.impactEffect,
    projectileSpeed: entry.projectileSpeed ?? base.projectileSpeed,
    magazine: entry.magazine ?? base.magazine,
    reloadTime: entry.reloadTime ?? base.reloadTime,
    hyperArmor: entry.hyperArmor ?? base.hyperArmor,
  };
}

/** Competitive damage scale: longer cast ⇒ higher damage multiplier (pay for commit). */
export function commitDamageMul(castTime: number): number {
  if (castTime <= 0.15) return 0.9;
  if (castTime <= 0.35) return 1.0;
  if (castTime <= 0.55) return 1.2;
  if (castTime <= 0.75) return 1.4;
  return 1.55;
}
