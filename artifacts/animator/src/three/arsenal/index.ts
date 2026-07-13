import type { WeaponDef, WeaponGripDef, WeaponId } from "../types";
import { MELEE_WEAPONS } from "./melee";
import { RANGED_WEAPONS } from "./ranged";
import { MAGIC_WEAPONS } from "./magic";
import { resolveGrip } from "./holdStyle";
import { MELEE_EARTH_WALL_SKILL_KIT } from "./weaponSkillKits";

export type { WeaponDef, WeaponGripDef, WeaponGripTransform, WeaponGroup, WeaponTier } from "./types";
export { MELEE_WEAPONS } from "./melee";
export { RANGED_WEAPONS } from "./ranged";
export { MAGIC_WEAPONS } from "./magic";
export {
  MACE2H_SKILL_KIT,
  MELEE_EARTH_WALL_SKILL_KIT,
  PISTOL_SKILL_KIT,
  RIFLE_SKILL_KIT,
  EARTH_WALL_ABILITY,
  STAFF_FIRE_SKILL_KIT,
  STAFF_ICE_SKILL_KIT,
  STAFF_NATURE_SKILL_KIT,
  STAFF_STORM_SKILL_KIT,
  STAFF_HOLY_SKILL_KIT,
  type WeaponSkillKit,
  type WeaponSkillEntry,
} from "./weaponSkillKits";

/** The "no weapon" prefab — a pure unarmed loadout (no model, no grip). */
export const NONE: WeaponDef = {
  id: "none",
  label: "Unarmed",
  hand: "right",
  kind: "slash",
  skillName: "Earth Wall",
  skillDuration: 0.7,
  cooldown: 8,
  combat: { intensity: 22, direction: 85, range: [0.8, 1.6] },
  animSet: "unarmed",
  group: "unarmed",
  duelEligible: false,
  skillKit: MELEE_EARTH_WALL_SKILL_KIT,
};

/**
 * The single composed weapon table the app equips from. Order is preserved for
 * any UI that iterates it: unarmed → melee → ranged → magic.
 */
export const WEAPONS: WeaponDef[] = [NONE, ...MELEE_WEAPONS, ...RANGED_WEAPONS, ...MAGIC_WEAPONS];

/**
 * Per-weapon hand-mount grips. Each weapon resolves to its own co-located `grip`
 * override when declared, else the canonical grip for its category hold style
 * (`holdStyle.ts`). So a weapon that mounts to category standard needs no grip,
 * and ONE table fits both the GLB-model mount path and the procedural fallback.
 */
export const WEAPON_GRIPS: Partial<Record<WeaponId, WeaponGripDef>> = Object.fromEntries(
  WEAPONS.map((w) => [w.id, resolveGrip(w)]),
) as Partial<Record<WeaponId, WeaponGripDef>>;

/**
 * The melee weapons an AI duel may select (distinct blades + hafts; the off-hand
 * Shield and all ranged/magic weapons are excluded). Carried as `WeaponId`s so
 * callers can pick two DIFFERENT entries per round (never a mirror match).
 */
export function meleeDuelWeapons(): WeaponId[] {
  return WEAPONS.filter((w) => w.duelEligible).map((w) => w.id);
}

/**
 * Off-hand-slot prefabs — items that mount to the OFF hand alongside a main
 * weapon (the Tower Shield today). Surfaced by the loadout's Off-Hand slot.
 */
export const OFF_HAND_WEAPONS: WeaponDef[] = WEAPONS.filter((w) => w.group === "off-hand");

/**
 * Whether a Tower-Shield-style off-hand piece may be equipped ALONGSIDE the given
 * main weapon. Allowed only for a single one-handed weapon (or unarmed fists)
 * that is NOT already dual-wielding: a built-in `model.off` (sword+knife, dual
 * daggers, gunblade+scutum) or a two-handed stance already occupies the off hand,
 * and ranged/magic kits are excluded.
 */
export function offHandEligible(mainId: WeaponId): boolean {
  const d = WEAPONS.find((w) => w.id === mainId);
  if (!d) return false;
  const group = d.group ?? "unarmed";
  if (group !== "melee-1h" && group !== "unarmed") return false;
  if (d.model?.off) return false;
  if (d.model?.twoHanded) return false;
  return true;
}
