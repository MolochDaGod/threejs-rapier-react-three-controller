import type { DefensiveOutcome, VulnerableState } from "@workspace/epicfight";
import type { ActionKey } from "../explorer/types";
import type { WeaponCombat, WeaponGripDef, WeaponGroup, WeaponHitShape } from "../types";
import { PI2 } from "./types";

/**
 * Per-category WEAPON HOLD-STYLE STANDARD.
 *
 * Every weapon belongs to one {@link WeaponGroup} category (one-handed melee,
 * two-handed melee, ranged, magic, unarmed, off-hand). Each category has ONE
 * canonical hold style — keyed off the hand bone plus the weapon's "business
 * vector" (how far its working end reaches past the hand) — from which we derive:
 *
 *  - the grip orientation that mounts the model into the hand,
 *  - the engagement / spacing band the AI fights at (`fightRange`),
 *  - the default melee combat profile (per-weapon defs only declare DEVIATIONS),
 *  - a guaranteed defensive-clip set (block / parry / dodge / stumble / fall /
 *    recover) so every {@link DefensiveOutcome} the resolver can produce maps to a
 *    real animation with no silent no-ops, used by BOTH the player and the AI,
 *  - a ready / guard pose (plus an optional draw flourish) shown on stance entry.
 *
 * This module is pure data + pure helpers (no engine / three imports) so it can
 * be unit-tested and shared by the loader, the assets layer, and the AI.
 */

/**
 * The guaranteed defensive-clip set for a hold style. Each value is an
 * {@link ActionKey} the rig resolves to a real clip (per-class via `WEAPON_SETS`
 * or class-independent via `GLOBAL_REACTIONS`). No entry may be omitted — every
 * defensive exchange outcome routes to one of these keys.
 */
export interface DefenseStyle {
  /** Raised guard hold (the blocked / deflected stance). */
  block: ActionKey;
  /** Parry flourish (perfect-parry / deflect snap). */
  parry: ActionKey;
  /** Evade roll (dodge i-frames). */
  dodge: ActionKey;
  /** Light stagger flinch (a clean hit that keeps the fighter standing). */
  stumble: ActionKey;
  /** Knock-down (a crit / heavy launch). */
  fall: ActionKey;
  /** Get-up recovery after a knock-down. */
  recover: ActionKey;
  /** Directional guarded-hit recoil — a hit soaked from the fighter's left. */
  blockLeft: ActionKey;
  /** Directional guarded-hit recoil — a hit soaked from the fighter's right. */
  blockRight: ActionKey;
  /** Frontal/weighted guarded-hit recoil — a hit soaked head-on. */
  blockReact: ActionKey;
}

/** A category's ready stance: a held guard pose + an optional draw-on-equip clip. */
export interface GuardStyle {
  /** The ready / guard pose held on stance entry. */
  pose: ActionKey;
  /** Optional one-shot flourish played when the weapon is first drawn / equipped. */
  draw?: ActionKey;
}

/** The complete per-category hold-style descriptor. */
export interface HoldStyle {
  /** The category this style standardises. */
  category: WeaponGroup;
  /**
   * Canonical hand-mount grip. A weapon only overrides this when its model needs
   * a different orientation (e.g. a bow held flat, a firearm pointing forward).
   */
  grip: WeaponGripDef;
  /**
   * How far the weapon's business end (blade tip / haft / muzzle) reaches past
   * the hand, in metres. This is the "business vector" length the strike band and
   * spacing derive from — longer reach ⇒ the fighter strikes and spaces farther.
   */
  businessReach: number;
  /**
   * Category default melee combat profile. Per-weapon `combat` is a PARTIAL
   * deviation merged over this (see `resolveCombat`), so a weapon that fights
   * exactly to category standard declares no combat numbers at all.
   */
  combat: WeaponCombat;
  /**
   * The engagement / spacing band [min, max] in metres the AI holds at. For melee
   * this tracks the strike band; for RANGED it is the TRUE kiting distance (far),
   * not the tiny butt-strike melee range — a bow keeps its distance, it does not
   * walk into sword range.
   */
  fightRange: [number, number];
  /** Ready / guard pose shown when entering the stance. */
  guard: GuardStyle;
  /** Guaranteed defensive clips for every resolver outcome. */
  defense: DefenseStyle;
}

/** One-handed-melee canonical defense set (sword/axe/dagger/hammer/mace/shield). */
const ONE_HAND_DEFENSE: DefenseStyle = {
  block: "blockStart",
  parry: "parryReact",
  dodge: "spinEvade",
  stumble: "stumble",
  fall: "fallDown",
  recover: "getUp",
  blockLeft: "blockLeft",
  blockRight: "blockRight",
  blockReact: "blockReact",
};

/** Two-handed-melee defense: heavier reactions read the weightier hold style. */
const TWO_HAND_DEFENSE: DefenseStyle = {
  block: "blockStart",
  parry: "parryReact",
  dodge: "spinEvade",
  stumble: "bigBlow",
  fall: "flyingBack",
  recover: "getUp",
  blockLeft: "blockLeft",
  blockRight: "blockRight",
  // Big two-handed guard rings off with a heavy impact recoil.
  blockReact: "blockReactHeavy",
};

/**
 * The single per-category hold-style table. Keyed by {@link WeaponGroup} so every
 * weapon resolves its standard from its `group`.
 */
export const HOLD_STYLES: Record<WeaponGroup, HoldStyle> = {
  // -------------------------------------------------------------- bare hands
  unarmed: {
    category: "unarmed",
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.05, 0] } },
    businessReach: 0.4,
    combat: { intensity: 22, direction: 85, range: [0.8, 1.6] },
    fightRange: [0.8, 1.6],
    guard: { pose: "blockStart" },
    defense: ONE_HAND_DEFENSE,
  },

  // ---------------------------------------------------------- one-handed melee
  // Blade/haft held grip-down, business end up +Y — the canonical melee hold.
  "melee-1h": {
    category: "melee-1h",
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.05, 0] } },
    businessReach: 1.0,
    combat: { intensity: 30, direction: 100, range: [1, 2] },
    fightRange: [1, 2],
    guard: { pose: "blockStart", draw: "draw" },
    defense: ONE_HAND_DEFENSE,
  },

  // ---------------------------------------------------------- two-handed melee
  // Longer business vector ⇒ naturally fights + spaces farther than one-handed.
  "melee-2h": {
    category: "melee-2h",
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.02, 0] } },
    businessReach: 1.6,
    combat: { intensity: 72, direction: 45, range: [1.6, 3] },
    fightRange: [1.6, 3],
    guard: { pose: "blockStart", draw: "draw" },
    defense: TWO_HAND_DEFENSE,
  },

  // ------------------------------------------------------------------ off-hand
  // Shield piece — mounts flat on the forearm; fights at one-handed spacing.
  "off-hand": {
    category: "off-hand",
    grip: { main: { rot: [0, PI2, 0], pos: [0, 0.05, 0] } },
    businessReach: 0.5,
    combat: { intensity: 60, direction: 60, range: [1, 2] },
    fightRange: [1, 2],
    guard: { pose: "blockStart" },
    defense: ONE_HAND_DEFENSE,
  },

  // -------------------------------------------------------------------- ranged
  // Held forward (bow flat, firearm muzzle out). The fight range is the KITE
  // distance — far poke spacing, NOT the tiny melee butt-strike number.
  ranged: {
    category: "ranged",
    grip: { main: { rot: [0, 0, 0], pos: [0, 0.05, 0] } },
    businessReach: 0.6,
    combat: { intensity: 28, direction: 100, range: [0.6, 1.4] },
    fightRange: [5, 11],
    guard: { pose: "aim", draw: "drawArrow" },
    defense: {
      block: "blockStart",
      parry: "parryReact",
      // Backstep evade — ranged keeps its distance rather than rolling through.
      dodge: "dodgeB",
      stumble: "stumble",
      fall: "fallDown",
      recover: "getUp",
      blockLeft: "blockLeft",
      blockRight: "blockRight",
      blockReact: "blockReactWide",
    },
  },

  // --------------------------------------------------------------------- magic
  // Focus/staff hold (grip-down, +Y). Casters poke from a mid band and lean on
  // spell range to kite, so the melee spacing stays modest.
  magic: {
    category: "magic",
    grip: { main: { rot: [PI2, 0, 0], pos: [0, 0.05, 0] } },
    businessReach: 1.0,
    combat: { intensity: 50, direction: 70, range: [1, 2.2] },
    fightRange: [1, 2.2],
    guard: { pose: "magicChannel", draw: "castSpell2" },
    defense: {
      block: "blockStart",
      parry: "parryReact",
      dodge: "spinEvade",
      stumble: "stumble",
      fall: "fallDown",
      recover: "getUp",
      blockLeft: "blockLeft",
      blockRight: "blockRight",
      blockReact: "blockReactWide",
    },
  },
};

/** The hold style for a weapon group (defaults to one-handed melee). */
export function holdStyle(group: WeaponGroup | undefined): HoldStyle {
  return HOLD_STYLES[group ?? "melee-1h"] ?? HOLD_STYLES["melee-1h"];
}

/**
 * The grip a weapon mounts with: its own grip override when declared, else the
 * category standard. So a weapon that holds to category standard needs no grip.
 */
export function resolveGrip(weapon: { group?: WeaponGroup; grip?: WeaponGripDef }): WeaponGripDef {
  return weapon.grip ?? holdStyle(weapon.group).grip;
}

/**
 * A weapon's full melee combat profile: the category default with the weapon's
 * partial deviation merged over it. A weapon that matches its category declares
 * no `combat` at all; one that deviates declares only the fields that differ
 * (e.g. an extra-long greatsword overrides just `range`).
 */
export function resolveCombat(weapon: {
  group?: WeaponGroup;
  combat?: Partial<WeaponCombat>;
}): WeaponCombat {
  const base = holdStyle(weapon.group).combat;
  const dev = weapon.combat;
  if (!dev) return { ...base, range: [...base.range] };
  return {
    intensity: dev.intensity ?? base.intensity,
    direction: dev.direction ?? base.direction,
    range: dev.range ? [...dev.range] : [...base.range],
  };
}

/**
 * The AI engagement / spacing band for a weapon. Melee, off-hand and magic space
 * at their strike band (so existing feel is unchanged); RANGED returns its true
 * kite distance from the hold style instead of the tiny melee number.
 */
export function fightBand(weapon: { group?: WeaponGroup; combat?: Partial<WeaponCombat> }): [number, number] {
  if (weapon.group === "ranged") {
    const r = holdStyle("ranged").fightRange;
    return [r[0], r[1]];
  }
  const range = resolveCombat(weapon).range;
  return [range[0], range[1]];
}

/** The guaranteed defensive clip-set for a weapon's category. */
export function defenseClips(group: WeaponGroup | undefined): DefenseStyle {
  return holdStyle(group).defense;
}

/**
 * Per-group default blade-capsule shape: the cutting edge runs along the weapon's
 * tip axis from `startFrac`·L to L (L = tip length), inflated by `radius`. Groups
 * absent here swing no blade (ranged/magic/unarmed use projectile/kick logic).
 */
const HIT_DEFAULTS: Partial<Record<WeaponGroup, { radius: number; startFrac: number }>> = {
  "melee-1h": { radius: 0.11, startFrac: 0.28 },
  "melee-2h": { radius: 0.15, startFrac: 0.3 },
  "off-hand": { radius: 0.09, startFrac: 0.25 },
};

/**
 * A weapon's game-ready blade-edge capsule in its LOCAL mount frame. Returns the
 * weapon's own `hit` when declared, else a default derived from its group + the
 * mounted tip length (`tipLen`, metres). `null` = this weapon swings no blade.
 */
export function resolveHitShape(
  weapon: { group?: WeaponGroup; hit?: WeaponHitShape },
  tipLen: number,
): WeaponHitShape | null {
  if (weapon.hit) return weapon.hit;
  const d = HIT_DEFAULTS[weapon.group ?? "melee-1h"];
  if (!d) return null;
  const L = Math.max(0.2, tipLen);
  return { a: [0, d.startFrac * L, 0], b: [0, L, 0], radius: d.radius };
}

/**
 * The guarded-hit recoil a fighter plays when a strike lands on a RAISED guard.
 * Picks the directional react for a side hit (left/right) or the frontal/weighted
 * react for a head-on hit, so the guard visibly reacts to where the blow came
 * from before settling back into the held block pose. Shared by player + AI.
 */
export function guardedHitClip(
  group: WeaponGroup | undefined,
  side: "left" | "right" | "front",
): ActionKey {
  const d = defenseClips(group);
  if (side === "left") return d.blockLeft;
  if (side === "right") return d.blockRight;
  return d.blockReact;
}

/**
 * Map a resolver {@link DefensiveOutcome} to the DEFENDER's reaction clip key.
 * Every outcome maps to a real clip in the category's {@link DefenseStyle}, so a
 * defending fighter always animates the result — no silent no-ops.
 */
export function defenseOutcomeClip(group: WeaponGroup | undefined, outcome: DefensiveOutcome): ActionKey {
  const d = defenseClips(group);
  switch (outcome) {
    case "deflect":
    case "blockStop":
      return d.block;
    case "perfectParry":
      return d.parry;
    case "dodgeEvade":
    case "dodgePunish":
      return d.dodge;
    case "hit":
      return d.stumble;
    case "crit":
      return d.fall;
  }
}

/**
 * Map a {@link VulnerableState} (the loser's reaction after a failed exchange) to
 * a reaction clip key. Used so a parried / dodge-punished / stunned fighter — be
 * it the player or an AI — always plays a real reaction from one shared source.
 */
export function vulnerableReactionClip(group: WeaponGroup | undefined, state: VulnerableState): ActionKey | null {
  const d = defenseClips(group);
  switch (state) {
    case "parried":
    case "dodgePunished":
      return d.stumble;
    case "stunned":
      return "stunned";
    case "fallen":
      return d.fall;
    case "none":
      return null;
  }
}
