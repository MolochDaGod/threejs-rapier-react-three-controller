/**
 * Per-weapon skill kits — fill ONE weapon completely before the next.
 *
 * Pipeline (do not mass-edit the roster):
 *  1. Pick a WeaponId (current exemplar: mace2h)
 *  2. Map Warlords SSOT skills from master-weaponSkills.json
 *  3. Bind animSet actions + VFX kinds + dash modes
 *  4. Playtest until unique (strategy / anims / effects)
 *  5. Only then copy the pattern to the next weapon
 *
 * Weapons WITHOUT a kit keep legacy behaviour (character signatureSkills + skillName).
 *
 * **Earth Wall (2026):** MELEE_EARTH_WALL_SKILL_KIT (F on sword/dagger/unarmed),
 * PISTOL/RIFLE_SKILL_KIT signature[1] = slot 2. Preset PRESET_EARTH_WALL.
 * Nature staff keeps earth_wave on its own kit — do not overwrite.
 *
 * Scope: Animator / Warlords-era ground combat only. Carrier (space ship game)
 * and unrelated GRUDOX surfaces are out of band for these kits.
 */

import type { SkillKind } from "../types";
import type { SkillPreset } from "../cast/skillPresets";
import {
  PRESET_BLIZZARD,
  PRESET_EARTH_WALL,
  PRESET_EARTH_WAVE,
  PRESET_FROST_SLASH,
  PRESET_METEOR_STRIKE,
  PRESET_MOONBEAM,
  PRESET_NATURES_HEALING,
  PRESET_PORTAL,
  PRESET_ROOTS,
  PRESET_POLYMORPH,
  PRESET_FROST_AOE_BLINK,
  PRESET_SHOCKWAVE_PUSH,
  PRESET_RAPID_FIRE,
  PRESET_STANDING_2H,
  PRESET_ARCANE_TURRET,
  PRESET_NATURE_BLINK,
  getSkillPreset,
} from "../cast/skillPresets";

// Resolve snakes by stable preset id from iceSnakeVariants.
const SNAKE = {
  glacial: getSkillPreset("ice_snake_glacial")!,
  ember: getSkillPreset("ice_snake_ember")!,
  venom: getSkillPreset("ice_snake_venom")!,
  storm: getSkillPreset("ice_snake_storm")!,
  void: getSkillPreset("ice_snake_void")!,
  radiant: getSkillPreset("ice_snake_radiant")!,
};

/** One equippable combat skill on a weapon (F or keys 1–4). */
export interface WeaponSkillEntry {
  /** Stable id from ObjectStore master-weaponSkills when available. */
  id: string;
  /** HUD label — prefer SSOT name. */
  label: string;
  /** VFX / damage family. */
  kind: SkillKind;
  /** "dash" = gap-closer then AoE (doDashSkill). */
  mode?: "default" | "dash";
  /**
   * Clip to play: Explorer verbs (skill, dashAttack, attack1, …) or GLB clip names.
   * Studio tries hasClip / playClipOnce; falls back to attack role.
   */
  clip: string;
  /** Short design note for designers / next weapon authors. */
  strategy?: string;
  /**
   * Optional skillwrite preset — when set, Studio arms target/ground cast mode
   * instead of the generic VFX path.
   */
  preset?: SkillPreset;
  /**
   * Elden Ring–style commit wind-up (s). Readable telegraph; dodgeable if the
   * defender rolls during cast + projectile flight. Defaults from skillCombatPhases.
   */
  castTime?: number;
  /** Self recovery after impact (s) — punish window if the skill whiffs. */
  recovery?: number;
  /** Cast telegraph style during wind-up. */
  castEffect?: import("./skillCombatPhases").CastEffectStyle;
  /** Impact VFX family on resolve. */
  impactEffect?: import("./skillCombatPhases").ImpactEffectStyle;
  /** Projectile speed (m/s). Lower = more competitive dodge window. */
  projectileSpeed?: number;
  /** Firearm magazine; 0 = melee/magic. */
  magazine?: number;
  /** Reload empty magazine (s). */
  reloadTime?: number;
  /** Rare hyper-armor during cast (heavy 2H only). */
  hyperArmor?: boolean;
}

/** Full kit for one weapon: LMB description + F + four signature slots. */
export interface WeaponSkillKit {
  /** Warlords primary pool names (informational; LMB still uses animSet combo). */
  primaryLabels: string[];
  /** F-key ability. */
  ability: WeaponSkillEntry;
  /** Digit1–4 signature slots. */
  signatures: readonly [WeaponSkillEntry, WeaponSkillEntry, WeaponSkillEntry, WeaponSkillEntry];
}

/**
 * Guardian Maul (`mace2h`) — COMPLETE exemplar kit.
 *
 * Strategy: heavy 2H holy maul — slow combo, Smite cast, slide into Whirlwind Slash.
 * Anims: WEAPON_SETS.mace2h (greatsword combo + cast + slide + spin).
 * SSOT: MACE ability Smite; GREATSWORD secondary Whirlwind Slash + primary Overhead Slash;
 *       MACE primary Crushing Blow.
 */
/**
 * Fire staff — vfxgrudge shockwave→push (A), rapid fire (P), 2H magic channel,
 * meteor, flame body / ember snake retained for depth.
 */
export const STAFF_FIRE_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Flame Cast"],
  ability: {
    id: "shockwave_push",
    label: "Flame Shockwave",
    kind: "slam",
    clip: "skill",
    strategy: "vfxgrudge shockwave then forward push cone",
    preset: PRESET_SHOCKWAVE_PUSH,
  },
  signatures: [
    {
      id: "rapid_fire",
      label: "Rapid Fire",
      kind: "muzzle",
      clip: "skill",
      strategy: "vfxgrudge rapid bolt stream — keep pressure",
      preset: PRESET_RAPID_FIRE,
    },
    {
      id: "standing_2h",
      label: "2H Magic",
      kind: "nova",
      clip: "skill",
      strategy: "Standing 2H cast channel + ground pulses",
      preset: PRESET_STANDING_2H,
    },
    {
      id: "meteor_strike",
      label: "Meteor Strike",
      kind: "meteor",
      clip: "skill",
      strategy: "Ground AOE meteor",
      preset: PRESET_METEOR_STRIKE,
    },
    {
      id: "fire_dragon",
      label: "Fire Dragon",
      kind: "fireDragon",
      clip: "skill",
      strategy: "Aimed fire dragon (homing castDragon) — no preset, uses doElementalCast",
      // No skillwrite preset: Studio routes kind fireDragon + staffFire → doElementalCast.
    },
  ],
};

/**
 * Frost staff — Frost Field arms a 2s Frost Blink window (re-press same skill).
 * Blizzard, glacial snake, frost slash stay for freeze pressure.
 */
export const STAFF_ICE_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Frost Cast"],
  ability: {
    id: "frost_aoe_blink",
    label: "Frost Field",
    kind: "bolt",
    clip: "skill",
    strategy: "Frost AOE — re-press within 2s to Frost Blink forward",
    preset: PRESET_FROST_AOE_BLINK,
  },
  signatures: [
    {
      id: "snake_glacial",
      label: "Glacial Serpent",
      kind: "bolt",
      clip: "skill",
      strategy: "Cyan snake — freeze + AOE",
      preset: SNAKE.glacial,
    },
    {
      id: "blizzard",
      label: "Blizzard",
      kind: "bolt",
      clip: "skill",
      strategy: "Large freeze zone",
      preset: PRESET_BLIZZARD,
    },
    {
      id: "frost_aoe_blink",
      label: "Frost Field",
      kind: "bolt",
      clip: "skill",
      strategy: "Field + 2s blink window (same skill)",
      preset: PRESET_FROST_AOE_BLINK,
    },
    {
      id: "frost_slash",
      label: "Frost Slash",
      kind: "slash",
      clip: "skill",
      strategy: "Instant ice crescent",
      preset: PRESET_FROST_SLASH,
    },
  ],
};

/** Nature staff — Polymorph + healing/roots kit. */
export const STAFF_NATURE_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Bloom Cast"],
  ability: {
    id: "polymorph",
    label: "Polymorph",
    kind: "soul",
    clip: "skill",
    strategy: "Target → animal form VFX + hex",
    preset: PRESET_POLYMORPH,
  },
  signatures: [
    {
      id: "natures_healing",
      label: "Nature's Healing",
      kind: "soul",
      clip: "skill",
      strategy: "Green beam: heal allies / chip foes",
      preset: PRESET_NATURES_HEALING,
    },
    {
      id: "earth_wave",
      label: "Earth Wave",
      kind: "slam",
      clip: "skill",
      preset: PRESET_EARTH_WAVE,
    },
    {
      id: "snake_venom",
      label: "Venom Adder",
      kind: "soul",
      clip: "skill",
      preset: SNAKE.venom,
    },
    {
      id: "roots",
      label: "Entangling Roots",
      kind: "slam",
      clip: "skill",
      strategy: "Ground roots — stun CC",
      preset: PRESET_ROOTS,
    },
  ],
};

/** Storm staff — Storm Viper snake + bolt kit. */
export const STAFF_STORM_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Shock Cast"],
  ability: {
    id: "snake_storm",
    label: "Storm Viper",
    kind: "laser",
    clip: "skill",
    strategy: "Yellow snake — fast, stun/shock",
    preset: SNAKE.storm,
  },
  signatures: [
    {
      id: "snake_storm",
      label: "Storm Viper",
      kind: "laser",
      clip: "skill",
      preset: SNAKE.storm,
    },
    {
      id: "portal",
      label: "Storm Portal",
      kind: "nova",
      clip: "skill",
      strategy: "Portal flash + Flame Body style blink read",
      preset: PRESET_PORTAL,
    },
    {
      id: "snake_storm",
      label: "Storm Viper",
      kind: "laser",
      clip: "skill",
      preset: SNAKE.storm,
    },
    {
      id: "frost_slash",
      label: "Frost Slash",
      kind: "slash",
      clip: "skill",
      preset: PRESET_FROST_SLASH,
    },
  ],
};

/** Holy staff — second Polymorph + Radiant Python. */
export const STAFF_HOLY_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Radiant Cast"],
  ability: {
    id: "polymorph",
    label: "Polymorph",
    kind: "nova",
    clip: "skill",
    strategy: "Second polymorph staff — hex + silhouette",
    preset: PRESET_POLYMORPH,
  },
  signatures: [
    {
      id: "snake_radiant",
      label: "Radiant Python",
      kind: "nova",
      clip: "skill",
      strategy: "Gold snake — large, stun AOE",
      preset: SNAKE.radiant,
    },
    {
      id: "moonbeam",
      label: "Moonbeam",
      kind: "soul",
      clip: "skill",
      preset: PRESET_MOONBEAM,
    },
    {
      id: "standing_2h",
      label: "2H Magic",
      kind: "nova",
      clip: "skill",
      strategy: "Holy 2H cast channel",
      preset: { ...PRESET_STANDING_2H, color: 0xffe08a, label: "Radiant 2H" },
    },
    {
      id: "polymorph",
      label: "Polymorph",
      kind: "nova",
      clip: "skill",
      preset: PRESET_POLYMORPH,
    },
  ],
};

/**
 * Shared Earth Wall ability — melee F-skill and gun signature slot 2.
 * Preset SSOT: {@link PRESET_EARTH_WALL}. Arcade dangerRoomWeaponSkills mirrors this.
 * Animator / Warlords ground combat only — not Carrier (space) or other games.
 */
export const EARTH_WALL_ABILITY: WeaponSkillEntry = {
  id: "earth_wall",
  label: "Earth Wall",
  kind: "slam",
  clip: "skill",
  strategy: "Auto barrier toward foe — blocks ranged; haste self (~2.8s). Short cast, long CD.",
  preset: PRESET_EARTH_WALL,
  castTime: 0.35,
  recovery: 0.25,
  castEffect: "aura",
  impactEffect: "slam",
};

/** Melee (sword / knife / unarmed): F = Earth Wall; slots keep light combat utility. */
export const MELEE_EARTH_WALL_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Strike"],
  ability: EARTH_WALL_ABILITY,
  signatures: [
    {
      id: "combo_strike",
      label: "Combo Strike",
      kind: "slash",
      clip: "skill",
      strategy: "Extra slash chain finisher",
    },
    {
      id: "blade_flourish",
      label: "Blade Flourish",
      kind: "slash",
      clip: "skill",
    },
    {
      id: "freeze_dash",
      label: "Freeze Dash",
      kind: "slash",
      mode: "dash",
      clip: "dashAttack",
      strategy: "Gap-close lunge",
    },
    {
      id: "power_throw",
      label: "Power Throw",
      kind: "bolt",
      clip: "skill",
    },
  ],
};

/** Pistol — clip + reload; skills are readable and dodgeable mid-flight. */
export const PISTOL_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Quick Draw"],
  ability: {
    id: "quick_draw",
    label: "Quick Draw",
    kind: "muzzle",
    clip: "skill",
    strategy: "Heavy pistol round — short draw, dodgeable tracer",
    castTime: 0.14,
    recovery: 0.2,
    castEffect: "draw",
    impactEffect: "muzzle",
    projectileSpeed: 38,
    magazine: 6,
    reloadTime: 1.25,
  },
  signatures: [
    {
      id: "fan_the_hammer",
      label: "Fan the Hammer",
      kind: "muzzle",
      clip: "skill",
      strategy: "3-round burst; long recovery if whiffed",
      castTime: 0.2,
      recovery: 0.55,
      castEffect: "draw",
      impactEffect: "muzzle",
      projectileSpeed: 36,
      magazine: 6,
      reloadTime: 1.25,
    },
    EARTH_WALL_ABILITY,
    {
      id: "slide_shot",
      label: "Slide Shot",
      kind: "muzzle",
      mode: "dash",
      clip: "dashAttack",
      strategy: "Dash then fire — commit, then free-aim vulnerability",
      castTime: 0.18,
      recovery: 0.35,
      castEffect: "draw",
      impactEffect: "muzzle",
      projectileSpeed: 40,
    },
    {
      id: "high_noon",
      label: "High Noon",
      kind: "muzzle",
      clip: "skill",
      strategy: "Long wind-up explosive round — big damage, easy to dodge",
      castTime: 0.85,
      recovery: 0.6,
      castEffect: "charge",
      impactEffect: "blast",
      projectileSpeed: 22,
      magazine: 1,
      reloadTime: 1.6,
    },
  ],
};

/** Rifle — magazine pressure, sniper-style commits. */
export const RIFLE_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Burst Fire"],
  ability: {
    id: "burst_fire",
    label: "Burst Fire",
    kind: "muzzle",
    clip: "skill",
    strategy: "3-tap burst; moderate cast; dodgeable between rounds",
    castTime: 0.18,
    recovery: 0.28,
    castEffect: "draw",
    impactEffect: "muzzle",
    projectileSpeed: 48,
    magazine: 8,
    reloadTime: 1.55,
  },
  signatures: [
    {
      id: "marksman_focus",
      label: "Marksman Focus",
      kind: "muzzle",
      clip: "skill",
      strategy: "Hold cast then high-velocity shot",
      castTime: 0.65,
      recovery: 0.4,
      castEffect: "channel",
      impactEffect: "bolt",
      projectileSpeed: 55,
      magazine: 8,
      reloadTime: 1.55,
    },
    EARTH_WALL_ABILITY,
    {
      id: "suppressive_fire",
      label: "Suppressive Fire",
      kind: "muzzle",
      clip: "skill",
      strategy: "Wide cone tracers — weaker per hit, harder to walk through",
      castTime: 0.3,
      recovery: 0.5,
      castEffect: "draw",
      impactEffect: "muzzle",
      projectileSpeed: 32,
      magazine: 8,
      reloadTime: 1.55,
    },
    {
      id: "power_throw",
      label: "Bayonet Lunge",
      kind: "thrust",
      mode: "dash",
      clip: "dashAttack",
      strategy: "Emergency melee — short cast, high recovery",
      castTime: 0.2,
      recovery: 0.55,
      castEffect: "charge",
      impactEffect: "thrust",
    },
  ],
};

export const MACE2H_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Cleaving Strike", "Overhead Slash"],
  ability: {
    id: "mace_smite",
    label: "Smite",
    kind: "nova",
    clip: "skill",
    strategy: "Holy cast slam — long commit, hyper-armor, then nova",
    castTime: 0.7,
    recovery: 0.55,
    castEffect: "aura",
    impactEffect: "nova",
    hyperArmor: true,
  },
  signatures: [
    {
      id: "gs_whirlwind",
      label: "Whirlwind Slash",
      kind: "nova",
      mode: "dash",
      clip: "dashAttack",
      strategy: "Slide in, then spin AoE — close + clear",
      castTime: 0.35,
      recovery: 0.5,
      castEffect: "charge",
      impactEffect: "slash",
    },
    {
      id: "mace_smite",
      label: "Smite",
      kind: "nova",
      clip: "skill",
      strategy: "Same as F — dedicated hotkey for cast",
      castTime: 0.7,
      recovery: 0.55,
      castEffect: "aura",
      impactEffect: "nova",
      hyperArmor: true,
    },
    {
      id: "mace_crushing",
      label: "Crushing Blow",
      kind: "slam",
      clip: "attack",
      strategy: "Single heavy overhead — high damage, no dash",
      castTime: 0.6,
      recovery: 0.55,
      castEffect: "charge",
      impactEffect: "slam",
      hyperArmor: true,
    },
    {
      id: "gs_overhead",
      label: "Overhead Slash",
      kind: "slash",
      clip: "attack2",
      strategy: "Finisher cleave — ends combo pressure",
      castTime: 0.45,
      recovery: 0.4,
      castEffect: "charge",
      impactEffect: "slash",
    },
  ],
};

// ── Complete competitive kits (Elden-style commit / dodge windows) ─────────

/** Axe — wide cleaves, medium commit. */
export const AXE_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Cleave"],
  ability: {
    id: "axe_cleave",
    label: "Cleave",
    kind: "slash",
    clip: "skill",
    strategy: "Wide arc — medium wind-up; side-roll dodges",
    castTime: 0.42,
    recovery: 0.4,
    castEffect: "charge",
    impactEffect: "slash",
  },
  signatures: [
    {
      id: "skull_splitter",
      label: "Skullsplitter",
      kind: "slam",
      clip: "attack",
      strategy: "Overhead commit; hyper-armor mid-cast",
      castTime: 0.62,
      recovery: 0.5,
      castEffect: "charge",
      impactEffect: "slam",
      hyperArmor: true,
    },
    {
      id: "blood_spin",
      label: "Blood Spin",
      kind: "nova",
      mode: "dash",
      clip: "dashAttack",
      castTime: 0.3,
      recovery: 0.48,
      castEffect: "charge",
      impactEffect: "slash",
    },
    {
      id: "throw_axe",
      label: "Flying Axe",
      kind: "bolt",
      clip: "skill",
      strategy: "Thrown axe — slow projectile, high damage",
      castTime: 0.38,
      recovery: 0.42,
      castEffect: "draw",
      impactEffect: "slash",
      projectileSpeed: 16,
    },
    {
      id: "war_cry",
      label: "War Cry",
      kind: "nova",
      clip: "skill",
      strategy: "Self buff aura — short cast, no projectile",
      castTime: 0.25,
      recovery: 0.2,
      castEffect: "aura",
      impactEffect: "nova",
    },
  ],
};

/** Hammer 1H — poise break, long recovery. */
export const HAMMER_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Crushing Blow"],
  ability: {
    id: "crushing_blow",
    label: "Crushing Blow",
    kind: "slam",
    clip: "skill",
    strategy: "Long wind-up slam; dodge early or eat stun",
    castTime: 0.68,
    recovery: 0.58,
    castEffect: "charge",
    impactEffect: "slam",
    hyperArmor: true,
  },
  signatures: [
    {
      id: "earth_shatter",
      label: "Earth Shatter",
      kind: "slam",
      clip: "attack",
      castTime: 0.75,
      recovery: 0.6,
      castEffect: "aura",
      impactEffect: "shockwave",
      hyperArmor: true,
    },
    {
      id: "chain_strike",
      label: "Chain Strike",
      kind: "slash",
      clip: "attack2",
      castTime: 0.32,
      recovery: 0.35,
      castEffect: "charge",
      impactEffect: "slash",
    },
    {
      id: "hammer_toss",
      label: "Hammer Toss",
      kind: "bolt",
      clip: "skill",
      castTime: 0.4,
      recovery: 0.45,
      castEffect: "draw",
      impactEffect: "blast",
      projectileSpeed: 14,
    },
    {
      id: "stun_wave",
      label: "Stun Wave",
      kind: "nova",
      clip: "skill",
      castTime: 0.5,
      recovery: 0.4,
      castEffect: "aura",
      impactEffect: "shockwave",
    },
  ],
};

/** Flanged mace — similar to hammer, faster. */
export const MACE_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Skull Crusher"],
  ability: {
    id: "skull_crusher",
    label: "Skull Crusher",
    kind: "slam",
    clip: "skill",
    castTime: 0.5,
    recovery: 0.42,
    castEffect: "charge",
    impactEffect: "slam",
  },
  signatures: [
    {
      id: "flange_spin",
      label: "Flange Spin",
      kind: "nova",
      mode: "dash",
      clip: "dashAttack",
      castTime: 0.32,
      recovery: 0.4,
      castEffect: "charge",
      impactEffect: "slash",
    },
    {
      id: "crushing_blow",
      label: "Crushing Blow",
      kind: "slam",
      clip: "attack",
      castTime: 0.55,
      recovery: 0.48,
      castEffect: "charge",
      impactEffect: "slam",
    },
    {
      id: "mace_throw",
      label: "Mace Throw",
      kind: "bolt",
      clip: "skill",
      castTime: 0.35,
      recovery: 0.4,
      castEffect: "draw",
      impactEffect: "blast",
      projectileSpeed: 15,
    },
    {
      id: "stun_tap",
      label: "Stun Tap",
      kind: "slash",
      clip: "attack2",
      castTime: 0.28,
      recovery: 0.3,
      castEffect: "charge",
      impactEffect: "slash",
    },
  ],
};

/** Greatsword — classic ER ultra: long commit, huge payoff. */
export const GREATSWORD_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Earthshatter"],
  ability: {
    id: "earthshatter",
    label: "Earthshatter",
    kind: "slam",
    clip: "skill",
    strategy: "Planted colossal slam — hyper-armor; roll early",
    castTime: 0.8,
    recovery: 0.65,
    castEffect: "charge",
    impactEffect: "shockwave",
    hyperArmor: true,
  },
  signatures: [
    {
      id: "lion_claw",
      label: "Lion's Claw",
      kind: "slam",
      mode: "dash",
      clip: "dashAttack",
      strategy: "Somersault commit — famous ER skill shape",
      castTime: 0.55,
      recovery: 0.55,
      castEffect: "charge",
      impactEffect: "slam",
      hyperArmor: true,
    },
    {
      id: "stamp_upward",
      label: "Stamp Upward",
      kind: "slash",
      clip: "attack2",
      castTime: 0.45,
      recovery: 0.42,
      castEffect: "charge",
      impactEffect: "slash",
    },
    {
      id: "void_slash",
      label: "Void Slash",
      kind: "slash",
      clip: "skill",
      strategy: "Getsuga-style wave — slow projectile",
      castTime: 0.5,
      recovery: 0.45,
      castEffect: "channel",
      impactEffect: "slash",
      projectileSpeed: 14,
    },
    {
      id: "guard_counter",
      label: "Guard Counter",
      kind: "slash",
      clip: "attack",
      strategy: "Fast if timed after block (recovery short)",
      castTime: 0.22,
      recovery: 0.35,
      castEffect: "charge",
      impactEffect: "slash",
    },
  ],
};

/** Greataxe — whirlwind pressure. */
export const GREATAXE_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Whirlwind"],
  ability: {
    id: "whirlwind",
    label: "Whirlwind",
    kind: "nova",
    clip: "skill",
    castTime: 0.45,
    recovery: 0.55,
    castEffect: "charge",
    impactEffect: "slash",
  },
  signatures: [
    {
      id: "spinning_slash",
      label: "Spinning Slash",
      kind: "nova",
      mode: "dash",
      clip: "dashAttack",
      castTime: 0.38,
      recovery: 0.5,
      castEffect: "charge",
      impactEffect: "slash",
    },
    {
      id: "war_cry_2h",
      label: "Barbaric Roar",
      kind: "nova",
      clip: "skill",
      castTime: 0.3,
      recovery: 0.25,
      castEffect: "aura",
      impactEffect: "nova",
    },
    {
      id: "cragblade",
      label: "Cragblade",
      kind: "slam",
      clip: "attack",
      castTime: 0.7,
      recovery: 0.55,
      castEffect: "charge",
      impactEffect: "slam",
      hyperArmor: true,
    },
    {
      id: "wild_strikes",
      label: "Wild Strikes",
      kind: "slash",
      clip: "attack2",
      castTime: 0.25,
      recovery: 0.6,
      castEffect: "charge",
      impactEffect: "slash",
    },
  ],
};

/** 2H hammer — cataclysm slam. */
export const HAMMER2H_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Ground Pound"],
  ability: {
    id: "ground_pound",
    label: "Ground Pound",
    kind: "slam",
    clip: "skill",
    castTime: 0.85,
    recovery: 0.7,
    castEffect: "aura",
    impactEffect: "shockwave",
    hyperArmor: true,
  },
  signatures: [
    {
      id: "titan_leap",
      label: "Titan Leap",
      kind: "slam",
      mode: "dash",
      clip: "dashAttack",
      castTime: 0.6,
      recovery: 0.65,
      castEffect: "charge",
      impactEffect: "slam",
      hyperArmor: true,
    },
    {
      id: "earth_wave",
      label: "Earth Wave",
      kind: "slam",
      clip: "skill",
      strategy: "Ground wave projectile — dodge sideways",
      castTime: 0.5,
      recovery: 0.45,
      castEffect: "channel",
      impactEffect: "shockwave",
      projectileSpeed: 12,
      preset: PRESET_EARTH_WAVE,
    },
    {
      id: "colossal_swing",
      label: "Colossal Swing",
      kind: "slash",
      clip: "attack2",
      castTime: 0.55,
      recovery: 0.55,
      castEffect: "charge",
      impactEffect: "slash",
    },
    {
      id: "shatter",
      label: "Shatter",
      kind: "nova",
      clip: "attack",
      castTime: 0.4,
      recovery: 0.4,
      castEffect: "aura",
      impactEffect: "blast",
    },
  ],
};

/** Spear — pokes + thrust projectile. */
export const SPEAR_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Lunge"],
  ability: {
    id: "spear_lunge",
    label: "Lunge",
    kind: "thrust",
    mode: "dash",
    clip: "dashAttack",
    strategy: "Fast gap-close poke; short cast, medium recovery",
    castTime: 0.22,
    recovery: 0.38,
    castEffect: "charge",
    impactEffect: "thrust",
  },
  signatures: [
    {
      id: "impaling_thrust",
      label: "Impaling Thrust",
      kind: "thrust",
      clip: "skill",
      castTime: 0.48,
      recovery: 0.4,
      castEffect: "charge",
      impactEffect: "thrust",
    },
    {
      id: "spear_throw",
      label: "Spear Throw",
      kind: "bolt",
      clip: "skill",
      castTime: 0.4,
      recovery: 0.45,
      castEffect: "draw",
      impactEffect: "thrust",
      projectileSpeed: 20,
    },
    {
      id: "sweep",
      label: "Halberd Sweep",
      kind: "slash",
      clip: "attack2",
      castTime: 0.38,
      recovery: 0.4,
      castEffect: "charge",
      impactEffect: "slash",
    },
    {
      id: "phalanx",
      label: "Phalanx",
      kind: "nova",
      clip: "skill",
      strategy: "Defensive stance pulse",
      castTime: 0.3,
      recovery: 0.25,
      castEffect: "aura",
      impactEffect: "nova",
    },
  ],
};

/** Javelin — pure thrown pressure. */
export const JAVELIN_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Javelin Throw"],
  ability: {
    id: "javelin_throw",
    label: "Javelin Throw",
    kind: "thrust",
    clip: "skill",
    strategy: "Thrown spear — mid speed, high damage; dodge mid-flight",
    castTime: 0.35,
    recovery: 0.4,
    castEffect: "draw",
    impactEffect: "thrust",
    projectileSpeed: 18,
  },
  signatures: [
    {
      id: "power_throw",
      label: "Power Throw",
      kind: "bolt",
      clip: "skill",
      castTime: 0.55,
      recovery: 0.5,
      castEffect: "charge",
      impactEffect: "blast",
      projectileSpeed: 15,
    },
    {
      id: "quick_throw",
      label: "Quick Throw",
      kind: "thrust",
      clip: "attack",
      castTime: 0.18,
      recovery: 0.28,
      castEffect: "draw",
      impactEffect: "thrust",
      projectileSpeed: 24,
    },
    {
      id: "pin_down",
      label: "Pin Down",
      kind: "bolt",
      clip: "skill",
      strategy: "Root on hit if they fail to dodge",
      castTime: 0.42,
      recovery: 0.4,
      castEffect: "channel",
      impactEffect: "thrust",
      projectileSpeed: 16,
    },
    {
      id: "melee_poke",
      label: "Close Poke",
      kind: "thrust",
      clip: "attack2",
      castTime: 0.2,
      recovery: 0.3,
      castEffect: "charge",
      impactEffect: "thrust",
    },
  ],
};

/** Bow — draw time is the cast; arrows are dodgeable. */
export const BOW_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Piercing Shot"],
  ability: {
    id: "piercing_shot",
    label: "Piercing Shot",
    kind: "bolt",
    clip: "skill",
    strategy: "Full draw → pierce bolt; roll mid-flight",
    castTime: 0.55,
    recovery: 0.35,
    castEffect: "draw",
    impactEffect: "bolt",
    projectileSpeed: 26,
  },
  signatures: [
    {
      id: "rain_of_arrows",
      label: "Rain of Arrows",
      kind: "nova",
      clip: "skill",
      strategy: "Ground AOE rain — leave the circle",
      castTime: 0.6,
      recovery: 0.45,
      castEffect: "channel",
      impactEffect: "blast",
      projectileSpeed: 10,
    },
    {
      id: "quickshot",
      label: "Quickshot",
      kind: "bolt",
      clip: "attack",
      castTime: 0.2,
      recovery: 0.22,
      castEffect: "draw",
      impactEffect: "bolt",
      projectileSpeed: 30,
    },
    {
      id: "poison_arrow",
      label: "Poison Arrow",
      kind: "soul",
      clip: "skill",
      castTime: 0.45,
      recovery: 0.35,
      castEffect: "draw",
      impactEffect: "bolt",
      projectileSpeed: 22,
    },
    {
      id: "barrage",
      label: "Barrage",
      kind: "bolt",
      clip: "skill",
      strategy: "Multi-arrow fan — side-step out of cone",
      castTime: 0.4,
      recovery: 0.5,
      castEffect: "draw",
      impactEffect: "bolt",
      projectileSpeed: 24,
    },
  ],
};

/** Shotgun — hip-fire + pump + shell discipline. */
export const SHOTGUN_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Hip Fire"],
  ability: {
    id: "buckshot",
    label: "Buckshot",
    kind: "muzzle",
    clip: "hipFire",
    strategy: "Wide cone close range; pump after; shell reload",
    castTime: 0.12,
    recovery: 0.45,
    castEffect: "draw",
    impactEffect: "muzzle",
    projectileSpeed: 28,
    magazine: 5,
    reloadTime: 1.9,
  },
  signatures: [
    {
      id: "slug",
      label: "Slug",
      kind: "muzzle",
      clip: "shoot",
      strategy: "Tight slug — longer cast, more range",
      castTime: 0.35,
      recovery: 0.5,
      castEffect: "draw",
      impactEffect: "bolt",
      projectileSpeed: 36,
      magazine: 5,
      reloadTime: 1.9,
    },
    EARTH_WALL_ABILITY,
    {
      id: "pump_blast",
      label: "Pump Blast",
      kind: "muzzle",
      clip: "pump",
      strategy: "Pump then fire — readable commit",
      castTime: 0.4,
      recovery: 0.55,
      castEffect: "charge",
      impactEffect: "blast",
      projectileSpeed: 24,
      magazine: 5,
      reloadTime: 1.9,
    },
    {
      id: "breach",
      label: "Breach",
      kind: "slam",
      mode: "dash",
      clip: "dashAttack",
      strategy: "Close gap then hip blast",
      castTime: 0.28,
      recovery: 0.5,
      castEffect: "charge",
      impactEffect: "blast",
    },
  ],
};

/** Hunter rifle — sniper commits + reload. */
export const HUNTER_RIFLE_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Piercing Shot"],
  ability: {
    id: "hunter_pierce",
    label: "Piercing Shot",
    kind: "muzzle",
    clip: "skill",
    castTime: 0.75,
    recovery: 0.5,
    castEffect: "channel",
    impactEffect: "bolt",
    projectileSpeed: 52,
    magazine: 4,
    reloadTime: 1.9,
  },
  signatures: [
    {
      id: "steady_aim",
      label: "Steady Aim",
      kind: "muzzle",
      clip: "skill",
      castTime: 1.0,
      recovery: 0.55,
      castEffect: "channel",
      impactEffect: "blast",
      projectileSpeed: 58,
      magazine: 4,
      reloadTime: 1.9,
    },
    EARTH_WALL_ABILITY,
    {
      id: "hip_fire",
      label: "Hip Fire",
      kind: "muzzle",
      clip: "attack",
      castTime: 0.15,
      recovery: 0.25,
      castEffect: "draw",
      impactEffect: "muzzle",
      projectileSpeed: 40,
      magazine: 4,
      reloadTime: 1.9,
    },
    {
      id: "explosive_round",
      label: "Explosive Round",
      kind: "meteor",
      clip: "skill",
      castTime: 0.9,
      recovery: 0.6,
      castEffect: "charge",
      impactEffect: "blast",
      projectileSpeed: 28,
      magazine: 1,
      reloadTime: 2.1,
    },
  ],
};

/** Base soulbinder staff. */
export const STAFF_ARCANE_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Arcane Nova"],
  ability: {
    id: "arcane_nova",
    label: "Arcane Nova",
    kind: "nova",
    clip: "skill",
    castTime: 0.55,
    recovery: 0.4,
    castEffect: "aura",
    impactEffect: "nova",
  },
  signatures: [
    {
      id: "arcane_turret",
      label: "Arcane Turret",
      kind: "laser",
      clip: "skill",
      castTime: 0.5,
      recovery: 0.35,
      castEffect: "channel",
      impactEffect: "bolt",
      preset: PRESET_ARCANE_TURRET,
    },
    {
      id: "moonbeam",
      label: "Moonbeam",
      kind: "soul",
      clip: "skill",
      castTime: 0.45,
      recovery: 0.35,
      castEffect: "channel",
      impactEffect: "bolt",
      projectileSpeed: 16,
      preset: PRESET_MOONBEAM,
    },
    {
      id: "rapid_fire",
      label: "Arcane Barrage",
      kind: "muzzle",
      clip: "skill",
      castTime: 0.25,
      recovery: 0.4,
      castEffect: "channel",
      impactEffect: "bolt",
      projectileSpeed: 20,
      preset: PRESET_RAPID_FIRE,
    },
    {
      id: "nature_blink",
      label: "Phase Step",
      kind: "nova",
      clip: "skill",
      castTime: 0.15,
      recovery: 0.2,
      castEffect: "aura",
      impactEffect: "nova",
      preset: PRESET_NATURE_BLINK,
    },
  ],
};
