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
  strategy: "Auto barrier toward foe — blocks ranged; haste self (~2.8s)",
  preset: PRESET_EARTH_WALL,
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

/** Pistol — F stays Quick Draw; signature slot 2 (Digit2) = Earth Wall. */
export const PISTOL_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Quick Draw"],
  ability: {
    id: "quick_draw",
    label: "Quick Draw",
    kind: "muzzle",
    clip: "skill",
    strategy: "Heavy pistol round",
  },
  signatures: [
    {
      id: "combo_strike",
      label: "Combo Strike",
      kind: "slash",
      clip: "skill",
    },
    EARTH_WALL_ABILITY,
    {
      id: "freeze_dash",
      label: "Freeze Dash",
      kind: "slash",
      mode: "dash",
      clip: "dashAttack",
    },
    {
      id: "power_throw",
      label: "Power Throw",
      kind: "bolt",
      clip: "skill",
    },
  ],
};

/** Rifle — F stays Burst Fire; signature slot 2 = Earth Wall. */
export const RIFLE_SKILL_KIT: WeaponSkillKit = {
  primaryLabels: ["Burst Fire"],
  ability: {
    id: "burst_fire",
    label: "Burst Fire",
    kind: "muzzle",
    clip: "skill",
    strategy: "Burst tracers down-range",
  },
  signatures: [
    {
      id: "combo_strike",
      label: "Combo Strike",
      kind: "slash",
      clip: "skill",
    },
    EARTH_WALL_ABILITY,
    {
      id: "freeze_dash",
      label: "Freeze Dash",
      kind: "slash",
      mode: "dash",
      clip: "dashAttack",
    },
    {
      id: "power_throw",
      label: "Power Throw",
      kind: "bolt",
      clip: "skill",
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
    strategy: "Holy cast slam — commit, then nova at feet/target",
  },
  signatures: [
    {
      id: "gs_whirlwind",
      label: "Whirlwind Slash",
      kind: "nova",
      mode: "dash",
      clip: "dashAttack",
      strategy: "Slide in, then spin AoE — close + clear",
    },
    {
      id: "mace_smite",
      label: "Smite",
      kind: "nova",
      clip: "skill",
      strategy: "Same as F — dedicated hotkey for cast",
    },
    {
      id: "mace_crushing",
      label: "Crushing Blow",
      kind: "slam",
      // Explorer verb "attack" → combo opener (attack1 in animSet).
      clip: "attack",
      strategy: "Single heavy overhead — high damage, no dash",
    },
    {
      id: "gs_overhead",
      label: "Overhead Slash",
      kind: "slash",
      // Explorer verb "attack2" → second combo stage / heavy cleave.
      clip: "attack2",
      strategy: "Finisher cleave — ends combo pressure",
    },
  ],
};
