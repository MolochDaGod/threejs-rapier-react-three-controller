import type { WeaponDef } from "./types";
import { PI2 } from "./types";
import { PISTOL_SKILL_KIT, RIFLE_SKILL_KIT } from "./weaponSkillKits";

/**
 * Ranged weapon prefabs (bow + firearms). Not eligible for the melee duel, but
 * still full self-contained modules (model + grip + clip set + skill + VFX kind)
 * equipped through the same path as melee weapons.
 */
export const RANGED_WEAPONS: WeaponDef[] = [
  {
    id: "bow",
    label: "Longbow",
    hand: "left",
    kind: "bolt",
    skillName: "Piercing Shot",
    skillDuration: 0.7,
    cooldown: 1.3,
    combat: { intensity: 20, direction: 100, range: [0.6, 1.4] },
    animSet: "bow",
    group: "ranged",
    duelEligible: false,
    // Six distinct bows: the base longbow plus five craftpix recurve/composite
    // models. Each tier swaps only the main GLB (the bow grip + bow clip set are
    // shared); tiers inherit the weapon `grip` below unless they override it.
    tiers: [
      { name: "Hunter's Longbow", power: 1 },
      { name: "Recurve Bow", power: 1.1, model: { file: "models/weapons/bow-craft-1.glb", length: 1.25, forward: "y+", align: "y", anchor: "center" } },
      { name: "Composite Bow", power: 1.2, model: { file: "models/weapons/bow-craft-5.glb", length: 1.3, forward: "y+", align: "y", anchor: "center" } },
      { name: "Ranger's Bow", power: 1.3, model: { file: "models/weapons/bow-craft-7.glb", length: 1.4, forward: "y+", align: "y", anchor: "center" } },
      { name: "Warbow", power: 1.4, model: { file: "models/weapons/bow-craft-13.glb", length: 1.35, forward: "y+", align: "y", anchor: "center" } },
      { name: "Dragonhorn Bow", power: 1.5, model: { file: "models/weapons/bow-craft-20.glb", length: 1.4, forward: "y+", align: "y", anchor: "center" } },
    ],
    grip: { main: { rot: [0, 0, PI2], pos: [0, 0.05, 0] } },
    model: {
      main: { file: "models/weapons/bow.glb", length: 1.2, forward: "y+", align: "y", anchor: "center" },
      twoHanded: true,
    },
  },
  {
    id: "pistol",
    label: "Pistol",
    hand: "right",
    kind: "muzzle",
    skillName: "Quick Draw",
    skillDuration: 0.5,
    cooldown: 0.9,
    /** Slot 2 (Digit2) = Earth Wall via skillKit.signatures[1]. */
    skillKit: PISTOL_SKILL_KIT,
    combat: { intensity: 28, direction: 100, range: [0.5, 1.2] },
    animSet: "pistol",
    group: "ranged",
    duelEligible: false,
    tiers: [
      { name: "Sidearm", power: 1 },
      { name: "Hand Cannon", power: 1.1 },
      { name: "Marksman", power: 1.2 },
      { name: "Deadeye", power: 1.3 },
      { name: "Peacemaker", power: 1.4 },
      { name: "Tempest", power: 1.5 },
    ],
    grip: { main: { rot: [0, 0, 0], pos: [0, 0.05, 0.04] } },
    model: { main: { file: "models/weapons/revolver.glb", length: 0.26, forward: "x-", align: "z", anchor: "center" } },
  },
  {
    id: "rifle",
    label: "Rifle",
    hand: "right",
    kind: "muzzle",
    skillName: "Burst Fire",
    skillDuration: 0.8,
    cooldown: 1.6,
    /** Slot 2 (Digit2) = Earth Wall via skillKit.signatures[1]. */
    skillKit: RIFLE_SKILL_KIT,
    combat: { intensity: 40, direction: 100, range: [0.6, 1.4] },
    animSet: "ranged",
    group: "ranged",
    duelEligible: false,
    tiers: [
      { name: "Carbine", power: 1 },
      { name: "Marksman", power: 1.15 },
      { name: "Longshot", power: 1.3 },
      { name: "Sharpshooter", power: 1.4 },
      { name: "Hellfire", power: 1.5 },
      { name: "Annihilator", power: 1.6 },
    ],
    grip: { main: { rot: [0, 0, 0], pos: [0, 0, 0.05] } },
    model: {
      main: { file: "models/weapons/rifle.glb", length: 0.9, forward: "z-", align: "z", anchor: "center" },
      twoHanded: true,
    },
  },
  {
    // Hunter rifle — a heavier single-shot marksman firearm (new GLB asset). It
    // reuses the shared "ranged" animation set + ranged hold style; only the model
    // and the harder-hitting combat profile deviate from the base rifle.
    id: "hunter-rifle",
    label: "Hunter Rifle",
    hand: "right",
    kind: "muzzle",
    skillName: "Piercing Shot",
    skillDuration: 0.9,
    cooldown: 1.9,
    combat: { intensity: 52, direction: 100, range: [0.6, 1.4] },
    animSet: "ranged",
    group: "ranged",
    duelEligible: false,
    tiers: [
      { name: "Hunter Carbine", power: 1 },
      { name: "Tracker", power: 1.15 },
      { name: "Big Game", power: 1.3 },
      { name: "Trophy Hunter", power: 1.45 },
      { name: "Apex Predator", power: 1.6 },
    ],
    grip: { main: { rot: [0, 0, 0], pos: [0, 0, 0.05] } },
    model: {
      main: { file: "models/weapons/hunter-rifle.glb", length: 0.95, forward: "z-", align: "z", anchor: "center" },
      twoHanded: true,
    },
  },
];
