import type { AttackMove, CombatConfig, HitboxSpec, Moveset } from "./types.js";

/** A reasonable default hit volume for a one-handed swing (model units). */
export const DEFAULT_HITBOX: HitboxSpec = { forward: 1.1, up: 1.0, radius: 0.9 };

/** Sensible default fighter tuning; callers can override per fighter. */
export function defaultCombatConfig(overrides: Partial<CombatConfig> = {}): CombatConfig {
  return {
    maxHealth: 100,
    maxStamina: 100,
    staminaRegenPerSec: 18,
    staminaRegenDelay: 0.6,
    maxPoise: 50,
    poiseRegenPerSec: 12,
    dodge: {
      duration: 0.55,
      iframeStart: 0.06,
      iframeEnd: 0.34,
      staminaCost: 20,
      distance: 3.2,
    },
    block: {
      staminaCostOnRaise: 5,
      staminaDrainPerSec: 8,
      force: 2,
    },
    parry: {
      deflectWindow: 0.45,
      perfectWindow: 0.15,
      force: 2,
      staminaCost: 15,
    },
    staggerDuration: 0.6,
    stunnedDuration: 1.5,
    fallenDuration: 1.2,
    getUpDuration: 0.8,
    critWindowDuration: 2.0,
    inputBufferTime: 0.32,
    ...overrides,
  };
}

export interface MoveTimingOptions {
  duration: number;
  windup: number;
  active: number;
  damage: number;
  staminaCost: number;
  poiseDamage: number;
  force?: number;
  shieldBreak?: boolean;
  superArmor?: boolean;
  comboWindowStart?: number;
  hit?: HitboxSpec;
}

/** Build one {@link AttackMove}. */
export function attackMove(
  id: string,
  clip: string,
  timing: MoveTimingOptions,
): AttackMove {
  return {
    id,
    clip,
    duration: timing.duration,
    windup: timing.windup,
    active: timing.active,
    damage: timing.damage,
    staminaCost: timing.staminaCost,
    poiseDamage: timing.poiseDamage,
    force: timing.force,
    shieldBreak: timing.shieldBreak,
    superArmor: timing.superArmor,
    comboWindowStart: timing.comboWindowStart,
    hit: timing.hit ?? DEFAULT_HITBOX,
  };
}

/**
 * Build a light-attack combo chain from a list of clip names, auto-scaling
 * windup/active to each clip's duration and ramping damage/poise across the
 * chain so the finisher hits hardest. Use this when you don't have exact
 * per-frame phase data and want sensible defaults.
 */
export function lightCombo(
  clips: { clip: string; duration: number }[],
  base: Partial<MoveTimingOptions> = {},
): AttackMove[] {
  return clips.map((c, i) => {
    const duration = c.duration;
    const windup = duration * 0.32;
    const active = Math.min(0.14, duration * 0.22);
    return attackMove(`light${i + 1}`, c.clip, {
      duration,
      windup,
      active,
      damage: (base.damage ?? 8) + i * 2,
      staminaCost: base.staminaCost ?? 14,
      poiseDamage: (base.poiseDamage ?? 14) + i * 4,
      force: base.force ?? 1,
      comboWindowStart: windup + active * 0.5,
      hit: base.hit,
      superArmor: base.superArmor,
    });
  });
}

/** Assemble a {@link Moveset} from a light chain (+ optional heavy chain). */
export function makeMoveset(
  id: string,
  light: AttackMove[],
  heavy?: AttackMove[],
): Moveset {
  return { id, light, heavy };
}
