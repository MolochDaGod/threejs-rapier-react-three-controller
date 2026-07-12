import type { WeaponDef } from "./types";
import { PI2 } from "./types";

/**
 * Melee weapon prefabs. The roster is intentionally DISTINCT in feel: each
 * one-handed weapon (Sword / Axe / Dagger / Hammer / Mace) and two-handed weapon
 * (Greatsword / Greataxe / Two-Handed Hammer / Spear) drives its own clip set
 * (`WEAPON_SETS[animSet]`) with a unique combo + signature skill, even where
 * models are reused (no new art was added). Shield is an off-hand piece.
 *
 * `duelEligible` marks the weapons the AI melee duel may pick (all true blades
 * and hafts; the off-hand Shield is excluded). `tiers` carry named variants as
 * pure data — same model/clips, different flavour/power; tiers within a type
 * share that type's fighting style.
 *
 * Tier NAMES: the Sword's six (Bloodfeud Blade → Emberclad) and the Axe's first
 * two (Gorehowl, Skullsplitter) are the user's named list. The remaining names
 * continue that dark-fantasy style as data placeholders pending the user's full
 * per-type list; `power` is illustrative only (balancing is out of scope).
 */
export const MELEE_WEAPONS: WeaponDef[] = [
  {
    id: "sword",
    label: "Sword & Knife",
    hand: "right",
    kind: "slash",
    skillName: "Blade Arc",
    skillDuration: 0.8,
    cooldown: 1.5,
    combat: { intensity: 30, direction: 100, range: [1, 2] },
    animSet: "sword",
    group: "melee-1h",
    duelEligible: true,
    tiers: [
      { name: "Bloodfeud Blade", power: 1 },
      { name: "Wraithfang", power: 1.1 },
      { name: "Oathbreaker", power: 1.2 },
      { name: "Kinrend", power: 1.3 },
      { name: "Dusksinger", power: 1.4 },
      { name: "Emberclad", power: 1.5 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.05, 0] }, off: { rot: [PI2, 0, 0], pos: [0, 0.05, 0] } },
    model: {
      main: { file: "models/weapons/sword.glb", length: 0.95, forward: "y+", align: "y", anchor: "base" },
      off: { file: "models/weapons/dagger.glb", length: 0.45, forward: "y+", align: "y", anchor: "base" },
    },
  },
  {
    id: "axe",
    label: "Battle Axe",
    hand: "right",
    kind: "slash",
    skillName: "Cleave",
    skillDuration: 0.9,
    cooldown: 1.8,
    combat: { intensity: 55, direction: 65, range: [1.2, 2.4] },
    animSet: "axe",
    group: "melee-1h",
    duelEligible: true,
    tiers: [
      { name: "Gorehowl", power: 1 },
      { name: "Skullsplitter", power: 1.15 },
      { name: "Marrowrend", power: 1.3 },
      { name: "Bloodmaw", power: 1.4 },
      { name: "Ironreaver", power: 1.5 },
      { name: "Stormfang", power: 1.6 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.05, 0] } },
    model: { main: { file: "models/weapons/axe.glb", length: 1.0, forward: "y+", align: "y", anchor: "base" } },
  },
  {
    id: "dagger",
    label: "Dagger",
    hand: "right",
    kind: "slash",
    skillName: "Flurry",
    skillDuration: 0.6,
    cooldown: 1.1,
    combat: { intensity: 24, direction: 95, range: [0.9, 2.2] },
    animSet: "knife",
    group: "melee-1h",
    duelEligible: true,
    tiers: [
      { name: "Nightsliver", power: 1 },
      { name: "Venomkiss", power: 1.18 },
      { name: "Shadowfang", power: 1.32 },
      { name: "Sicklefang", power: 1.4, model: { file: "models/weapons/sickle.glb", length: 0.55, forward: "y+", align: "y", anchor: "base" } },
      { name: "Whisperedge", power: 1.5 },
      { name: "Gutripper", power: 1.6 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.04, 0] }, off: { rot: [PI2, 0, 0], pos: [0, 0.04, 0] } },
    model: {
      main: { file: "models/weapons/dagger.glb", length: 0.45, forward: "y+", align: "y", anchor: "base" },
      off: { file: "models/weapons/dagger.glb", length: 0.45, forward: "y+", align: "y", anchor: "base" },
    },
  },
  {
    id: "hammer",
    label: "War Hammer",
    hand: "right",
    kind: "slam",
    skillName: "Crushing Blow",
    skillDuration: 1.0,
    cooldown: 2.2,
    combat: { intensity: 62, direction: 50, range: [1.3, 2.6] },
    animSet: "hammer",
    group: "melee-1h",
    duelEligible: true,
    tiers: [
      { name: "Skullknell", power: 1 },
      { name: "Stormfall", power: 1.25 },
      { name: "Earthbreaker", power: 1.35 },
      { name: "Thunderclap", power: 1.45 },
      { name: "Dreadnought", power: 1.55 },
      { name: "Worldender", power: 1.65 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.02, 0] } },
    model: { main: { file: "models/weapons/hammer.glb", length: 1.0, forward: "y+", align: "y", anchor: "base" } },
  },
  {
    id: "mace",
    label: "Flanged Mace",
    hand: "right",
    kind: "slam",
    skillName: "Skull Crusher",
    skillDuration: 0.9,
    cooldown: 1.9,
    combat: { intensity: 50, direction: 60, range: [1.1, 2.2] },
    animSet: "mace",
    group: "melee-1h",
    duelEligible: true,
    tiers: [
      { name: "Bonecrush", power: 1 },
      { name: "Grimspike", power: 1.22 },
      { name: "Skullspike", power: 1.32 },
      { name: "Ironflange", power: 1.42 },
      { name: "Doombringer", power: 1.52 },
      { name: "Wrathful Mace", power: 1.62 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.02, 0] } },
    model: { main: { file: "models/weapons/mace.glb", length: 0.95, forward: "z+", align: "y", anchor: "base" } },
  },
  {
    id: "greatsword",
    label: "Greatsword",
    hand: "right",
    kind: "slam",
    skillName: "Earthshatter",
    skillDuration: 1.1,
    cooldown: 2.6,
    combat: { intensity: 72, direction: 45, range: [1.6, 3] },
    animSet: "greatsword",
    group: "melee-2h",
    duelEligible: true,
    tiers: [
      { name: "Doomedge", power: 1 },
      { name: "Graveward", power: 1.15 },
      { name: "Tyrantfall", power: 1.35 },
      { name: "Worldcleaver", power: 1.45 },
      { name: "Ruinblade", power: 1.55 },
      { name: "Sovereign's End", power: 1.65 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.02, 0] } },
    model: {
      main: { file: "models/weapons/greatsword.glb", length: 1.45, forward: "y+", align: "y", anchor: "base" },
      twoHanded: true,
    },
  },
  {
    id: "greataxe",
    label: "Great Axe",
    hand: "right",
    kind: "slash",
    skillName: "Whirlwind",
    skillDuration: 1.0,
    cooldown: 2.4,
    combat: { intensity: 80, direction: 42, range: [1.6, 3.2] },
    animSet: "greataxe",
    group: "melee-2h",
    duelEligible: true,
    tiers: [
      { name: "Ruinhowl", power: 1 },
      { name: "Headsman", power: 1.3 },
      { name: "Bloodtide", power: 1.4 },
      { name: "Worldsplitter", power: 1.5 },
      { name: "Carnage", power: 1.6 },
      { name: "Apocalypse", power: 1.7 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.05, 0] } },
    model: {
      main: { file: "models/weapons/axe.glb", length: 1.5, forward: "y+", align: "y", anchor: "base" },
      twoHanded: true,
    },
  },
  {
    id: "hammer2h",
    label: "Great Maul",
    hand: "right",
    kind: "slam",
    skillName: "Ground Pound",
    skillDuration: 1.2,
    cooldown: 2.8,
    combat: { intensity: 92, direction: 35, range: [1.6, 3.2] },
    animSet: "hammer2h",
    group: "melee-2h",
    duelEligible: true,
    tiers: [
      { name: "Earthknell", power: 1 },
      { name: "Cataclysm", power: 1.35 },
      { name: "Mountainfall", power: 1.45 },
      { name: "Titansmite", power: 1.55 },
      { name: "Devastator", power: 1.65 },
      { name: "Worldbreaker", power: 1.75 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.02, 0] } },
    model: {
      main: { file: "models/weapons/hammer.glb", length: 1.5, forward: "y+", align: "y", anchor: "base" },
      twoHanded: true,
    },
  },
  {
    id: "spear",
    label: "Spear",
    hand: "right",
    kind: "thrust",
    skillName: "Lunge",
    skillDuration: 0.7,
    cooldown: 1.4,
    combat: { intensity: 42, direction: 80, range: [2, 3.6] },
    animSet: "spear",
    group: "melee-2h",
    duelEligible: true,
    tiers: [
      { name: "Heartseeker", power: 1 },
      { name: "Dragonlance", power: 1.2 },
      { name: "Skypiercer", power: 1.3 },
      { name: "Wyrmfang", power: 1.4 },
      { name: "Stormreach", power: 1.5 },
      { name: "Fatesplitter", power: 1.6 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0, 0] } },
    model: {
      main: { file: "models/weapons/spear.glb", length: 1.9, forward: "y+", align: "y", anchor: "base" },
      twoHanded: true,
    },
  },
  {
    // Javelin — a thrown spear. Reuses the "spear" animation set + 2H hold style
    // (the proven mount/loco path) so no new WeaponClass/clip set is needed. Its
    // F-skill is a real thrown projectile (Studio.doJavelinThrow); the GLB below
    // doubles as the in-flight projectile base mesh (additive VFX trail in Vfx).
    id: "javelin",
    label: "Javelin",
    hand: "right",
    kind: "thrust",
    skillName: "Javelin Throw",
    skillDuration: 0.7,
    cooldown: 1.5,
    combat: { intensity: 38, direction: 90, range: [2, 3.4] },
    animSet: "spear",
    group: "melee-2h",
    // AI plays the javelin as a mid-range thrown projectile, not a melee poke.
    combatRole: "thrown",
    duelEligible: false,
    tiers: [
      { name: "Throwing Spear", power: 1 },
      { name: "War Javelin", power: 1.2 },
      { name: "Pilum", power: 1.35 },
      { name: "Skybreaker", power: 1.5 },
    ],
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0, 0] } },
    model: {
      main: { file: "models/weapons/javelin.glb", length: 1.7, forward: "y+", align: "y", anchor: "base" },
      twoHanded: true,
    },
  },
  {
    id: "shield",
    label: "Tower Shield",
    hand: "left",
    kind: "thrust",
    skillName: "Shield Bash",
    skillDuration: 0.8,
    cooldown: 1.7,
    combat: { intensity: 60, direction: 60, range: [1, 2] },
    animSet: "sword",
    group: "off-hand",
    duelEligible: false,
    grip: { main: { rot: [0, PI2, 0], pos: [0, 0.05, 0] } },
    model: { main: { file: "models/weapons/shield.glb", length: 0.9, forward: "y+", align: "y", anchor: "center" } },
  },
  {
    // Gunblade (gunsword) + roman scutum — the Tank/Centurion's one-handed
    // loadout. Reuses the "sword" animSet (already a sword-and-shield stance:
    // loco / block / combo), so no new clip class is needed. The main piece is
    // held like a sword in the right hand; the scutum rides the left (off) hand
    // like the Tower Shield. The kit's real abilities live on the Tank's
    // signature slots (Studio.doTankSig); this `kind`/`skillName` only flavour
    // the generic skill colour.
    id: "gunblade",
    label: "Gunblade & Scutum",
    hand: "right",
    kind: "slash",
    skillName: "Super Cannon",
    skillDuration: 0.9,
    cooldown: 1.6,
    combat: { intensity: 40, direction: 90, range: [1, 2.1] },
    animSet: "sword",
    group: "melee-1h",
    duelEligible: false,
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.05, 0] }, off: { rot: [0, PI2, 0], pos: [0, 0.05, 0] } },
    model: {
      main: { file: "models/weapons/gunblade.glb", length: 1.0, forward: "y+", align: "y", anchor: "base" },
      off: { file: "models/weapons/roman-shield.glb", length: 0.9, forward: "y+", align: "y", anchor: "center" },
    },
  },
];
