import type { SkillKind, StaffElement, WeaponModelPiece } from "../types";
import type { WeaponDef, WeaponTier } from "./types";
import { PI2 } from "./types";
import {
  STAFF_FIRE_SKILL_KIT,
  STAFF_HOLY_SKILL_KIT,
  STAFF_ICE_SKILL_KIT,
  STAFF_NATURE_SKILL_KIT,
  STAFF_STORM_SKILL_KIT,
} from "./weaponSkillKits";
import {
  PRESET_ARCANE_TURRET,
  PRESET_MOONBEAM,
  PRESET_NATURE_BLINK,
  PRESET_RAPID_FIRE,
  getSkillPreset,
} from "../cast/skillPresets";

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
  {
    ...elementalStaff("staffFire", "fire", "Fire Staff", "Flame Shockwave", "fireDragon", "wand-fire.glb"),
    skillKit: STAFF_FIRE_SKILL_KIT,
  },
  {
    ...elementalStaff("staffIce", "ice", "Frost Staff", "Blizzard", "bolt", "wand-frost.glb"),
    skillKit: STAFF_ICE_SKILL_KIT,
  },
  {
    ...elementalStaff("staffStorm", "storm", "Lightning Staff", "Storm Viper", "laser", "wand-lightning.glb"),
    skillKit: STAFF_STORM_SKILL_KIT,
  },
  {
    ...elementalStaff("staffNature", "nature", "Nature Staff", "Nature's Healing", "soul", "wand-nature.glb"),
    skillKit: STAFF_NATURE_SKILL_KIT,
  },
  {
    ...elementalStaff("staffHoly", "holy", "Holy Staff", "Radiant Python", "nova", "wand-holy.glb"),
    skillKit: STAFF_HOLY_SKILL_KIT,
  },
  // Arcane staff: Nature Blink (no frost gate) + turret + void snake + rapid fire.
  {
    ...elementalStaff("staffArcane", "arcane", "Arcane Staff", "Nature Blink", "soul", "wand-arcane.glb"),
    skillKit: {
      primaryLabels: ["Ethereal Cast"],
      ability: {
        id: "nature_blink",
        label: "Nature Blink",
        kind: "soul",
        clip: "skill",
        strategy: "Instant green blink — no frost window required",
        preset: PRESET_NATURE_BLINK,
      },
      signatures: [
        {
          id: "snake_void",
          label: "Void Cobra",
          kind: "soul",
          clip: "skill",
          strategy: "Violet snake — hex + slow + AOE",
          preset: getSkillPreset("ice_snake_void")!,
        },
        {
          id: "arcane_turret",
          label: "Arcane Turret",
          kind: "turret",
          clip: "skill",
          preset: PRESET_ARCANE_TURRET,
        },
        {
          id: "rapid_fire",
          label: "Rapid Fire",
          kind: "muzzle",
          clip: "skill",
          strategy: "Arcane bolt stream — keep pushing",
          preset: { ...PRESET_RAPID_FIRE, color: 0xb15cff, label: "Arcane Barrage" },
        },
        {
          id: "moonbeam",
          label: "Moonbeam",
          kind: "soul",
          clip: "skill",
          preset: PRESET_MOONBEAM,
        },
      ],
    },
  },
];
