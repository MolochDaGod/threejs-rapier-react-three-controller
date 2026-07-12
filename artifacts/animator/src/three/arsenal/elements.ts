import type { StaffElement, StatusId } from "../types";
import type { StatusScope } from "../abilities/abilityTypes";

/**
 * Per-element CASTING THEME for the magic staffs.
 *
 * Every elemental staff (fire / ice / storm / nature / holy) shares the proven
 * caster feel but launches its OWN themed homing projectile and applies its
 * matching status on impact. This is pure data — a single source the engine
 * (`Studio.doElementalCast`) reads to pick the projectile + status, and the
 * weapon mounter (`Weapons.mountWeaponModel`) reads to tint the cane skin — so
 * the two never drift. No `three` / engine imports keeps it unit-testable.
 */

/** The travelling-effect family an element casts (maps to a `Vfx.cast*At` call). */
export type ElementProjectile = "dragon" | "darkBlades" | "laser" | "soul";

export interface ElementTheme {
  /** Short school name shown in UI. */
  label: string;
  /** Accent / projectile / cane-tint colour (hex). */
  color: number;
  /** Status applied on a landed cast. */
  status: StatusId;
  /** Who the status lands on (offensive schools debuff the foe; holy buffs self). */
  scope: StatusScope;
  /** Which `Vfx` projectile carries the cast to its impact point. */
  projectile: ElementProjectile;
  /** Cast animation clip (no-ops on rigs that lack it). */
  castClip: string;
}

/** The canonical element table — one entry per {@link StaffElement}. */
export const ELEMENT_THEME: Record<StaffElement, ElementTheme> = {
  fire: { label: "Fire", color: 0xff6a1e, status: "burning", scope: "hostile", projectile: "dragon", castClip: "magicAttack" },
  ice: { label: "Frost", color: 0x9fdcff, status: "frozen", scope: "hostile", projectile: "darkBlades", castClip: "magicAttack" },
  storm: { label: "Lightning", color: 0xffe14d, status: "shocked", scope: "hostile", projectile: "laser", castClip: "magicAttack" },
  nature: { label: "Nature", color: 0x6ee36e, status: "poisoned", scope: "hostile", projectile: "soul", castClip: "magicAttack" },
  holy: { label: "Holy", color: 0xffe08a, status: "regen", scope: "self", projectile: "soul", castClip: "magicArea" },
  arcane: { label: "Arcane", color: 0xb15cff, status: "hexed", scope: "hostile", projectile: "soul", castClip: "magicAttack" },
};
