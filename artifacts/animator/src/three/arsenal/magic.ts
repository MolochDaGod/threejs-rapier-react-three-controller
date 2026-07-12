import type { SkillKind, StaffElement, WeaponModelPiece } from "../types";
import type { WeaponDef, WeaponTier } from "./types";
import { PI2 } from "./types";

/**
 * Magic weapon prefabs. Not eligible for the melee duel, but a full
 * self-contained module equipped through the same path as every other weapon.
 *
 * The roster is the bespoke "Soulbinder" staff (arcane nova kit) plus SIX
 * ELEMENTAL staff schools — Fire / Frost / Lightning / Nature / Holy / Arcane.
 * Each school is its own weapon type carrying a distinct voxel-wand GLB
 * (element-tinted at mount), sharing the proven caster feel but casting its OWN
 * themed projectile + status (see `elements.ts` + `Studio.doElementalCast`).
 */

const TIER_TITLES = ["Apprentice", "Adept", "Conjurer's", "Archon", "Magus", "Archmage"] as const;

/**
 * The wand GLB for a school — one of the split voxel wands, element-tinted at
 * mount. Fit to 0.35 m along its longest axis (a hand-held wand next to the 2 m
 * {@link CHARACTER_HEIGHT_M} explorer; engine units are metres).
 */
function wandModel(file: string): WeaponModelPiece {
  return { file: `models/weapons/${file}`, length: 0.35, forward: "y+", align: "y", anchor: "base" };
}

/**
 * Build the six power tiers for an elemental staff. Every tier shares the same
 * voxel-wand GLB (element-tinted at mount) while stepping up name + power, so a
 * school always reads as its own wand no matter the tier.
 */
function wandTiers(file: string, label: string): WeaponTier[] {
  return TIER_TITLES.map((title, t) => ({
    name: `${title} ${label}`,
    power: 1 + t * 0.1,
    model: wandModel(file),
  }));
}

function elementalStaff(
  id: WeaponDef["id"],
  element: StaffElement,
  label: string,
  skillName: string,
  kind: SkillKind,
  wand: string,
): WeaponDef {
  return {
    id,
    label,
    hand: "right",
    kind,
    element,
    skillName,
    skillDuration: 1,
    cooldown: 2.4,
    combat: { intensity: 50, direction: 70, range: [1, 2.2] },
    animSet: "magic",
    group: "magic",
    duelEligible: false,
    tiers: wandTiers(wand, label),
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.05, 0] } },
    model: { main: wandModel(wand) },
  };
}

export const MAGIC_WEAPONS: WeaponDef[] = [
  {
    id: "staff",
    label: "Soulbinder Staff",
    hand: "right",
    kind: "nova",
    skillName: "Arcane Nova",
    skillDuration: 1,
    cooldown: 2.4,
    combat: { intensity: 50, direction: 70, range: [1, 2.2] },
    animSet: "magic",
    group: "magic",
    duelEligible: false,
    tiers: [
      { name: "Apprentice Staff", power: 1 },
      { name: "Adept Staff", power: 1.1 },
      { name: "Conjurer's Staff", power: 1.2 },
      { name: "Archon Staff", power: 1.3 },
      { name: "Magus Staff", power: 1.4 },
      { name: "Archmage Staff", power: 1.5 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.05, 0] } },
    model: { main: { file: "models/weapons/staff.glb", length: 1.4, forward: "y+", align: "y", anchor: "base" } },
  },
  elementalStaff("staffFire", "fire", "Fire Staff", "Flame Cast", "fireDragon", "wand-fire.glb"),
  elementalStaff("staffIce", "ice", "Frost Staff", "Frost Cast", "bolt", "wand-frost.glb"),
  elementalStaff("staffStorm", "storm", "Lightning Staff", "Shock Cast", "laser", "wand-lightning.glb"),
  elementalStaff("staffNature", "nature", "Nature Staff", "Bloom Cast", "soul", "wand-nature.glb"),
  elementalStaff("staffHoly", "holy", "Holy Staff", "Radiant Cast", "nova", "wand-holy.glb"),
  elementalStaff("staffArcane", "arcane", "Arcane Staff", "Ethereal Cast", "soul", "wand-arcane.glb"),
];
