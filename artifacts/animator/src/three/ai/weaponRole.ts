/**
 * Weapon-aware combat profiles for the sparring AI. This is the single place the
 * fighter brain learns to "understand its weapon": it maps an equipped
 * {@link WeaponId} onto a combat role (melee / ranged / thrown) and the derived
 * envelope (poke range, combo cap, the projectile it looses, recast cadence).
 *
 * The role is read from weapon METADATA — an explicit `combatRole` flag, falling
 * back to the roster `group` — so behaviour is data-driven rather than a global
 * "all opponents are melee" assumption.
 */

import { getWeapon } from "../assets";
import { CHARACTER_HEIGHT_M } from "../types";
import type { SkillKind, WeaponId } from "../types";

export type WeaponCombatRole = "melee" | "ranged" | "thrown";

/** Resolve a weapon's AI combat role from its metadata (explicit flag → group). */
export function weaponRole(weaponId: WeaponId): WeaponCombatRole {
  const def = getWeapon(weaponId);
  if (def.combatRole) return def.combatRole;
  if (def.group === "ranged") return "ranged";
  return "melee";
}

/** The per-fighter combat envelope the brain reasons over for an equipped weapon. */
export interface FighterWeaponProfile {
  role: WeaponCombatRole;
  /** Max distance (m) at which the fighter commits a ranged shot / throw / spell. */
  spellRange: number;
  /** Hard cap on melee combo length for this weapon class (1 for ranged/thrown). */
  comboMax: number;
  /**
   * The projectile fired when the fighter "casts": ranged fighters loose a fast
   * straight bolt (laser), thrown fighters hurl a blade volley (the javelin), and
   * melee fighters fall back to a random flashy spell (null → host picks one).
   */
  castKind: SkillKind | null;
  /**
   * Multiplier on the host's base ranged cooldown. Ranged fighters recast fast
   * (shooting is their primary game); thrown is a paced mid-range poke; melee
   * keeps the long occasional-spell cadence (1).
   */
  castCdScale: number;
}

/** Derive a fighter's combat profile from its equipped weapon's metadata. */
export function fighterWeaponProfile(weaponId: WeaponId): FighterWeaponProfile {
  const role = weaponRole(weaponId);
  const def = getWeapon(weaponId);
  const h = CHARACTER_HEIGHT_M;
  if (role === "ranged") {
    // Long stand-off; shooting is the primary attack, so recast quickly.
    return { role, spellRange: Math.round(h * 12), comboMax: 1, castKind: "laser", castCdScale: 0.35 };
  }
  if (role === "thrown") {
    // Mid-range hurl: a paced poke between melee exchanges.
    return { role, spellRange: Math.round(h * 6), comboMax: 1, castKind: "swordVolley", castCdScale: 0.6 };
  }
  // Melee: occasional spell flavour at the legacy stand-off range; combo length by
  // family (light 1H chains longer, heavy 2H shorter, off-hand/other stays at 3).
  const comboMax = def.group === "melee-2h" ? 2 : def.group === "melee-1h" ? 4 : 3;
  return { role, spellRange: Math.round(h * 10), comboMax, castKind: null, castCdScale: 1 };
}
