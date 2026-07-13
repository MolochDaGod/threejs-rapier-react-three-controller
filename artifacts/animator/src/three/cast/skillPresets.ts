/**
 * Skillwrite-style presets — aligned with VFX Studio patterns
 * (https://vfx-studio-sigma.vercel.app/) and Warlords staff fantasy.
 *
 * Acquisition modes:
 * - `instant`  — fire immediately (existing elemental bolts)
 * - `target`   — soft-lock / click confirmed on a living target
 * - `groundAoe`— skill arms a ground circle; LMB places the cast
 */

import type { StatusId } from "../types";
import { ICE_SNAKE_VARIANTS } from "../vfx/iceSnakeVariants";

export type CastAcquire = "instant" | "target" | "groundAoe";

export type SkillVfxId =
  | "meteor"
  | "blizzard"
  | "iceSnake"
  | "moonbeam"
  | "naturesHealing"
  | "earthWall"
  | "earthWave"
  | "turret"
  | "flameBody"
  | "elementBolt"
  | "muzzleFlash"
  | "portal"
  | "flameSlash"
  | "frostSlash"
  | "frostAoe"
  | "roots"
  | "polymorph"
  | "frostBlink"
  | "natureBlink"
  | "shockwavePush"
  | "rapidFire"
  | "standing2h";

export interface SkillPreset {
  id: string;
  label: string;
  /** How the player aims before release. */
  acquire: CastAcquire;
  /** Ground / beam radius (m). */
  aoeRadius?: number;
  /**
   * Homing projectiles stop this far from the target (m) so dodges work.
   * Ice snake uses ~2 (per-variant override via iceSnakeVariantId).
   */
  stopDistance?: number;
  /** Effect / DoT lifetime (s). */
  duration?: number;
  vfx: SkillVfxId;
  color: number;
  damage?: number;
  heal?: number;
  status?: StatusId;
  /** Friendly target (ally/self) — Nature's Healing. */
  statusOnFriendly?: StatusId;
  /** Hostile target — Nature's Healing slow/chip. */
  statusOnHostile?: StatusId;
  /** Seconds status lasts when applied by this skill. */
  statusDuration?: number;
  cooldown: number;
  stamina: number;
  /** When vfx === iceSnake, which of the 6 weapon snakes to fire. */
  iceSnakeVariantId?: string;
}

/** Fire staff — meteor strike (ground AOE). */
export const PRESET_METEOR_STRIKE: SkillPreset = {
  id: "meteor_strike",
  label: "Meteor Strike",
  acquire: "groundAoe",
  aoeRadius: 4.2,
  duration: 0.85,
  vfx: "meteor",
  color: 0xff8a3d,
  damage: 48,
  status: "burning",
  statusDuration: 6,
  cooldown: 3.2,
  stamina: 22,
};

/** Ice staff — blizzard (ground AOE). */
export const PRESET_BLIZZARD: SkillPreset = {
  id: "blizzard",
  label: "Blizzard",
  acquire: "groundAoe",
  aoeRadius: 5.5,
  duration: 4.0,
  vfx: "blizzard",
  color: 0x9fdcff,
  damage: 12,
  status: "frozen",
  statusDuration: 5,
  cooldown: 3.6,
  stamina: 24,
};

/** @deprecated Prefer per-weapon presets from ICE_SNAKE_PRESETS. */
export const PRESET_ICE_SNAKE: SkillPreset = {
  id: "ice_snake",
  label: "Ice Snake",
  acquire: "target",
  stopDistance: 2,
  duration: 1.4,
  vfx: "iceSnake",
  color: 0x7ad0ff,
  damage: 28,
  status: "frozen",
  statusDuration: 3,
  cooldown: 2.0,
  stamina: 16,
  iceSnakeVariantId: "snake_glacial",
};

/** Frost AOE field (smaller/faster than Blizzard). */
export const PRESET_FROST_AOE: SkillPreset = {
  id: "frost_aoe",
  label: "Frost Field",
  acquire: "groundAoe",
  aoeRadius: 3.5,
  duration: 2.8,
  vfx: "frostAoe",
  color: 0x9fdcff,
  damage: 14,
  status: "slowed",
  statusDuration: 4,
  cooldown: 2.6,
  stamina: 16,
};

/** Nature roots CC. */
export const PRESET_ROOTS: SkillPreset = {
  id: "roots",
  label: "Entangling Roots",
  acquire: "groundAoe",
  aoeRadius: 2.0,
  duration: 3.5,
  vfx: "roots",
  color: 0x4a8a2a,
  damage: 10,
  status: "stunned",
  statusDuration: 2.5,
  cooldown: 3.8,
  stamina: 18,
};

/** Flame slash projectile. */
export const PRESET_FLAME_SLASH: SkillPreset = {
  id: "flame_slash",
  label: "Flame Slash",
  acquire: "instant",
  vfx: "flameSlash",
  color: 0xff6a1e,
  damage: 26,
  status: "burning",
  statusDuration: 4,
  cooldown: 1.6,
  stamina: 12,
};

/** Frost slash projectile. */
export const PRESET_FROST_SLASH: SkillPreset = {
  id: "frost_slash",
  label: "Frost Slash",
  acquire: "instant",
  vfx: "frostSlash",
  color: 0x9fdcff,
  damage: 24,
  status: "slowed",
  statusDuration: 3,
  cooldown: 1.6,
  stamina: 12,
};

/** Simple portal flash (teleport / Flame Body combo). */
export const PRESET_PORTAL: SkillPreset = {
  id: "portal",
  label: "Portal",
  acquire: "instant",
  duration: 1.2,
  vfx: "portal",
  color: 0xb15cff,
  cooldown: 8,
  stamina: 20,
};

/**
 * Polymorph — target cast. Hex + stun + animal silhouette VFX.
 * On Nature + Holy staffs.
 */
export const PRESET_POLYMORPH: SkillPreset = {
  id: "polymorph",
  label: "Polymorph",
  acquire: "target",
  aoeRadius: 1.2,
  duration: 6,
  vfx: "polymorph",
  color: 0xd4a0ff,
  damage: 6,
  status: "hexed",
  statusDuration: 6,
  cooldown: 8,
  stamina: 22,
};

/**
 * Frost AOE that also arms a 2s Frost Blink window (re-press same skill).
 * Handled specially in Studio when frostBlinkWindow is live.
 */
export const PRESET_FROST_AOE_BLINK: SkillPreset = {
  id: "frost_aoe_blink",
  label: "Frost Field",
  acquire: "groundAoe",
  aoeRadius: 3.5,
  duration: 2.8,
  vfx: "frostAoe",
  color: 0x9fdcff,
  damage: 14,
  status: "slowed",
  statusDuration: 4,
  cooldown: 2.6,
  stamina: 16,
};

/** Instant forward blink (Arcane) — green nature portal, no frost field gate. */
export const PRESET_NATURE_BLINK: SkillPreset = {
  id: "nature_blink",
  label: "Nature Blink",
  acquire: "instant",
  duration: 0.4,
  vfx: "natureBlink",
  color: 0x4dff88,
  cooldown: 5,
  stamina: 14,
};

/**
 * Fire staff shockwave → push (vfxgrudge Key A / castShockwave pattern).
 * Shock ring first, then cone push-back on hostiles.
 */
export const PRESET_SHOCKWAVE_PUSH: SkillPreset = {
  id: "shockwave_push",
  label: "Flame Shockwave",
  acquire: "instant",
  aoeRadius: 4.5,
  duration: 0.7,
  vfx: "shockwavePush",
  color: 0xff7a2e,
  damage: 22,
  status: "burning",
  statusDuration: 3,
  cooldown: 3.2,
  stamina: 18,
};

/**
 * Rapid Fire (vfxgrudge Key P) — burst of bolts for sustained pressure.
 */
export const PRESET_RAPID_FIRE: SkillPreset = {
  id: "rapid_fire",
  label: "Rapid Fire",
  acquire: "instant",
  duration: 0.9,
  vfx: "rapidFire",
  color: 0xffb24d,
  damage: 8,
  status: "burning",
  statusDuration: 2,
  cooldown: 2.4,
  stamina: 16,
};

/**
 * Standing 2H Magic (vfxgrudge standing-2h-magic) — channel ground pulses
 * so casters can keep pushing while rooted in cast.
 */
export const PRESET_STANDING_2H: SkillPreset = {
  id: "standing_2h",
  label: "2H Magic",
  acquire: "instant",
  aoeRadius: 3.2,
  duration: 1.35,
  vfx: "standing2h",
  color: 0xb98cff,
  damage: 12,
  status: "empowered",
  statusDuration: 3,
  cooldown: 2.8,
  stamina: 18,
};

/** Frost blink only (used when re-casting inside the 2s window). */
export const PRESET_FROST_BLINK: SkillPreset = {
  id: "frost_blink",
  label: "Frost Blink",
  acquire: "instant",
  duration: 0.35,
  vfx: "frostBlink",
  color: 0x9fdcff,
  cooldown: 0.4,
  stamina: 8,
};

/** Classic moonbeam — target lock, click to cast. */
export const PRESET_MOONBEAM: SkillPreset = {
  id: "moonbeam",
  label: "Moonbeam",
  acquire: "target",
  aoeRadius: 1.4,
  duration: 3.5,
  vfx: "moonbeam",
  color: 0xd8e8ff,
  damage: 18,
  status: "hexed",
  statusDuration: 4,
  cooldown: 2.8,
  stamina: 18,
};

/**
 * Nature staff — green opaque beam.
 * Friendly: heal + regen. Enemy: slow chip + poison for 10s.
 */
export const PRESET_NATURES_HEALING: SkillPreset = {
  id: "natures_healing",
  label: "Nature's Healing",
  acquire: "target",
  aoeRadius: 1.6,
  duration: 10,
  vfx: "naturesHealing",
  color: 0x4dff88,
  damage: 8,
  heal: 22,
  statusOnFriendly: "regen",
  statusOnHostile: "poisoned",
  statusDuration: 10,
  cooldown: 3.0,
  stamina: 18,
};

/**
 * Earth Wall — voxel barrier (blocks projectiles / soft cover).
 * Design export: color #6c6f78, voxel 0.42, w 7.95, h 7, hold 6.95, drop 6.
 * Melee F-skill + guns signature slot 2 (see weaponSkillKits).
 * Status: haste = short caster speed boost (Studio self-scope).
 */
export const PRESET_EARTH_WALL: SkillPreset = {
  id: "earth_wall",
  label: "Earth Wall",
  /** Soft-lock / look-dir: Studio places wall toward foe, not free ground click. */
  acquire: "target",
  aoeRadius: 4.0,
  duration: 6.95,
  vfx: "earthWall",
  color: 0x6c6f78,
  damage: 0,
  status: "haste",
  statusDuration: 2.8,
  cooldown: 7.5,
  stamina: 18,
};

/** Nature — earth wave (ground AOE push). */
export const PRESET_EARTH_WAVE: SkillPreset = {
  id: "earth_wave",
  label: "Earth Wave",
  acquire: "groundAoe",
  aoeRadius: 6,
  duration: 0.9,
  vfx: "earthWave",
  color: 0x6b9a3a,
  damage: 32,
  status: "poisoned",
  statusDuration: 4,
  cooldown: 3.4,
  stamina: 20,
};

/** Deployable turret chassis (fire staff + gunblade / centurion already have gameplay turret). */
export const PRESET_ARCANE_TURRET: SkillPreset = {
  id: "arcane_turret",
  label: "Arcane Turret",
  acquire: "groundAoe",
  aoeRadius: 1.2,
  duration: 8,
  vfx: "turret",
  color: 0x8fd0ff,
  damage: 14,
  cooldown: 8,
  stamina: 22,
};

/** Fire form body trail / teleport flash. */
export const PRESET_FLAME_BODY: SkillPreset = {
  id: "flame_body",
  label: "Flame Body",
  acquire: "instant",
  duration: 6,
  vfx: "flameBody",
  color: 0xff6a1e,
  status: "empowered",
  statusDuration: 6,
  cooldown: 12,
  stamina: 28,
};

/** Six weapon-bound ice snake presets (built from ICE_SNAKE_VARIANTS). */
export const ICE_SNAKE_PRESETS: SkillPreset[] = ICE_SNAKE_VARIANTS.map((v) => ({
  id: v.presetId,
  label: v.label,
  acquire: "target" as const,
  stopDistance: v.stopDistance,
  duration: 1.4,
  vfx: "iceSnake" as const,
  color: v.color,
  damage: v.damage,
  status: v.status,
  statusDuration: v.statusDuration,
  aoeRadius: v.aoeRadius,
  cooldown: 2.0,
  stamina: 16,
  iceSnakeVariantId: v.id,
}));

/** Lookup table for staff kits / Studio. */
export const SKILL_PRESETS: Record<string, SkillPreset> = {
  [PRESET_METEOR_STRIKE.id]: PRESET_METEOR_STRIKE,
  [PRESET_BLIZZARD.id]: PRESET_BLIZZARD,
  [PRESET_ICE_SNAKE.id]: PRESET_ICE_SNAKE,
  [PRESET_MOONBEAM.id]: PRESET_MOONBEAM,
  [PRESET_NATURES_HEALING.id]: PRESET_NATURES_HEALING,
  [PRESET_EARTH_WALL.id]: PRESET_EARTH_WALL,
  [PRESET_EARTH_WAVE.id]: PRESET_EARTH_WAVE,
  [PRESET_ARCANE_TURRET.id]: PRESET_ARCANE_TURRET,
  [PRESET_FLAME_BODY.id]: PRESET_FLAME_BODY,
  [PRESET_FROST_AOE.id]: PRESET_FROST_AOE,
  [PRESET_ROOTS.id]: PRESET_ROOTS,
  [PRESET_FLAME_SLASH.id]: PRESET_FLAME_SLASH,
  [PRESET_FROST_SLASH.id]: PRESET_FROST_SLASH,
  [PRESET_PORTAL.id]: PRESET_PORTAL,
  [PRESET_POLYMORPH.id]: PRESET_POLYMORPH,
  [PRESET_FROST_AOE_BLINK.id]: PRESET_FROST_AOE_BLINK,
  [PRESET_NATURE_BLINK.id]: PRESET_NATURE_BLINK,
  [PRESET_SHOCKWAVE_PUSH.id]: PRESET_SHOCKWAVE_PUSH,
  [PRESET_RAPID_FIRE.id]: PRESET_RAPID_FIRE,
  [PRESET_STANDING_2H.id]: PRESET_STANDING_2H,
  [PRESET_FROST_BLINK.id]: PRESET_FROST_BLINK,
  ...Object.fromEntries(ICE_SNAKE_PRESETS.map((p) => [p.id, p])),
};

export function getSkillPreset(id: string): SkillPreset | undefined {
  return SKILL_PRESETS[id];
}
