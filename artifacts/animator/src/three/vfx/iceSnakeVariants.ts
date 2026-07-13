/**
 * Six ice-snake projectile variants — one per weapon.
 * Shared travel model (home → stop short of target); unique color, size,
 * speed, sway, and on-hit effect family so each weapon feels distinct.
 */

import type { StatusId } from "../types";
import type { WeaponId } from "../types";

/** On-hit combat tags applied by snake impact (Studio maps to damage + status). */
export type SnakeHitTag = "aoe" | "stun" | "burn" | "slow" | "poison" | "shock" | "hex";

export interface IceSnakeVariant {
  id: string;
  /** Display name on HUD / cast flash. */
  label: string;
  /** Weapon this variant is bound to. */
  weaponId: WeaponId;
  color: number;
  /** Secondary trail/glow color. */
  color2: number;
  /** Head radius (m). */
  radius: number;
  /** Trail width (m). */
  trailWidth: number;
  /** Body length scale (elongated capsule vs sphere). */
  lengthScale: number;
  /**
   * Travel speed multiplier (1 = baseline). Higher = snappier snake.
   * Life is derived from distance / speed.
   */
  speed: number;
  /** Lateral sine amplitude (m). */
  sway: number;
  /** Sine frequency along the path. */
  swayFreq: number;
  /** Stop this far short of the target (m) — dodge window. */
  stopDistance: number;
  /** Impact blast radius (m); >0 = AOE splash. */
  aoeRadius: number;
  /** Base damage at impact. */
  damage: number;
  /** Status applied on hit (existing StatusFx ids). */
  status: StatusId;
  statusDuration: number;
  /** Design tags for combat routing. */
  tags: readonly SnakeHitTag[];
  /** Skill preset id for cast mode. */
  presetId: string;
}

/**
 * Six weapons × six snakes.
 * Colors / shapes / speeds / effects all differ.
 */
export const ICE_SNAKE_VARIANTS: readonly IceSnakeVariant[] = [
  {
    id: "snake_glacial",
    label: "Glacial Serpent",
    weaponId: "staffIce",
    color: 0x7ad0ff,
    color2: 0xe8fbff,
    radius: 0.18,
    trailWidth: 0.22,
    lengthScale: 2.4,
    speed: 1.0,
    sway: 0.45,
    swayFreq: 4,
    stopDistance: 2.0,
    aoeRadius: 1.6,
    damage: 28,
    status: "frozen",
    statusDuration: 3,
    tags: ["aoe", "slow"],
    presetId: "ice_snake_glacial",
  },
  {
    id: "snake_ember",
    label: "Ember Asp",
    weaponId: "staffFire",
    color: 0xff6a1e,
    color2: 0xffd27a,
    radius: 0.2,
    trailWidth: 0.28,
    lengthScale: 2.0,
    speed: 1.15,
    sway: 0.35,
    swayFreq: 5,
    stopDistance: 1.8,
    aoeRadius: 2.0,
    damage: 32,
    status: "burning",
    statusDuration: 5,
    tags: ["aoe", "burn"],
    presetId: "ice_snake_ember",
  },
  {
    id: "snake_venom",
    label: "Venom Adder",
    weaponId: "staffNature",
    color: 0x6ee36e,
    color2: 0xd4ff9a,
    radius: 0.15,
    trailWidth: 0.18,
    lengthScale: 2.8,
    speed: 0.9,
    sway: 0.55,
    swayFreq: 3.2,
    stopDistance: 2.2,
    aoeRadius: 1.3,
    damage: 22,
    status: "poisoned",
    statusDuration: 7,
    tags: ["poison", "slow"],
    presetId: "ice_snake_venom",
  },
  {
    id: "snake_storm",
    label: "Storm Viper",
    weaponId: "staffStorm",
    color: 0xffe14d,
    color2: 0xffffff,
    radius: 0.16,
    trailWidth: 0.2,
    lengthScale: 1.8,
    speed: 1.45,
    sway: 0.25,
    swayFreq: 6.5,
    stopDistance: 1.6,
    aoeRadius: 1.4,
    damage: 26,
    status: "shocked",
    statusDuration: 3,
    tags: ["stun", "shock"],
    presetId: "ice_snake_storm",
  },
  {
    id: "snake_void",
    label: "Void Cobra",
    weaponId: "staffArcane",
    color: 0xb15cff,
    color2: 0xe4b6ff,
    radius: 0.22,
    trailWidth: 0.3,
    lengthScale: 2.2,
    speed: 0.95,
    sway: 0.5,
    swayFreq: 3.8,
    stopDistance: 2.1,
    aoeRadius: 1.8,
    damage: 30,
    status: "hexed",
    statusDuration: 5,
    tags: ["hex", "slow", "aoe"],
    presetId: "ice_snake_void",
  },
  {
    id: "snake_radiant",
    label: "Radiant Python",
    weaponId: "staffHoly",
    color: 0xffe08a,
    color2: 0xfff6d0,
    radius: 0.24,
    trailWidth: 0.32,
    lengthScale: 2.6,
    speed: 0.85,
    sway: 0.3,
    swayFreq: 2.8,
    stopDistance: 2.4,
    aoeRadius: 2.2,
    damage: 24,
    status: "stunned",
    statusDuration: 2.5,
    tags: ["stun", "aoe"],
    presetId: "ice_snake_radiant",
  },
] as const;

export function iceSnakeForWeapon(weaponId: WeaponId): IceSnakeVariant | undefined {
  return ICE_SNAKE_VARIANTS.find((v) => v.weaponId === weaponId);
}

export function iceSnakeById(id: string): IceSnakeVariant | undefined {
  return ICE_SNAKE_VARIANTS.find((v) => v.id === id);
}

export function iceSnakeByPresetId(presetId: string): IceSnakeVariant | undefined {
  return ICE_SNAKE_VARIANTS.find((v) => v.presetId === presetId);
}
