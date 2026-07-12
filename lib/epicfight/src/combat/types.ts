/**
 * Game-agnostic combat data types, modelled on Epic Fight's structure:
 * weapon movesets are ordered combo chains of {@link AttackMove}s, each with
 * windup → active(contact) → recovery phases. Defensive reactions (parry,
 * block, dodge) resolve through the pure {@link resolveDefense} function in
 * `defense.ts` and surface outcomes via typed {@link DefensiveResult} values.
 */

export type CombatStateName =
  | "idle"
  | "attack"
  | "dodge"
  | "parry"
  | "block"
  | "stagger"
  | "stunned"
  | "fallen"
  | "getUp"
  | "dead";

export type AttackKind = "light" | "heavy";

/** A forward, character-local hit volume active during an attack's contact frames. */
export interface HitboxSpec {
  /** Distance in front of the character origin (metres). */
  forward: number;
  /** Vertical offset from the character origin (metres). */
  up: number;
  /** Sphere radius (metres). */
  radius: number;
}

/** A single attack animation with its combat timing + payload. */
export interface AttackMove {
  /** Logical id (unique within a moveset). */
  id: string;
  /** Animation clip name to play (one-shot). */
  clip: string;
  /** Total move length in seconds (should match the clip duration). */
  duration: number;
  /** Seconds from move start until the hit becomes active. */
  windup: number;
  /** Seconds the hit stays active (contact window) after windup. */
  active: number;
  /** Damage dealt on hit. */
  damage: number;
  /** Stamina consumed to start the move. */
  staminaCost: number;
  /** Poise damage dealt to victims. */
  poiseDamage: number;
  /**
   * Forward momentum / force of this move.  Higher-force moves break blocks and
   * overcome parries when defender force < attack force (see `resolveDefense`).
   * Defaults to 1. Heavy moves typically use 2–3; shield-break specials use ≥4.
   */
  force?: number;
  /**
   * When true this move carries a shield-break flag: a defender's block turns
   * into a stunned state instead of a simple blockStop. Typically set on "R"
   * skill moves only.
   */
  shieldBreak?: boolean;
  /** If true the attacker has super armor for the whole move (cannot be staggered). */
  superArmor?: boolean;
  /**
   * Seconds from move start when the next combo input is accepted. Defaults to
   * `windup` (you can buffer the next swing as soon as the current one commits).
   */
  comboWindowStart?: number;
  /** Hit volume for this move. */
  hit: HitboxSpec;
}

/** A weapon's full moveset: a light chain, optional heavy chain, optional dash attack. */
export interface Moveset {
  id: string;
  /** Light-attack combo chain (index wraps when you keep attacking). */
  light: AttackMove[];
  /** Optional heavy-attack combo chain. */
  heavy?: AttackMove[];
}

/** Dodge/roll tuning. */
export interface DodgeConfig {
  /** Total dodge length in seconds. */
  duration: number;
  /** Seconds from dodge start when invincibility begins. */
  iframeStart: number;
  /** Seconds from dodge start when invincibility ends. */
  iframeEnd: number;
  /** Stamina consumed to dodge. */
  staminaCost: number;
  /** Ground distance to travel (the game moves the body; the core just times it). */
  distance: number;
}

/** Block stance tuning. */
export interface BlockConfig {
  /** Stamina consumed to raise the block. */
  staminaCostOnRaise: number;
  /** Stamina drained per second while holding block. */
  staminaDrainPerSec: number;
  /** Defensive force (compared against `AttackMove.force` in `resolveDefense`). */
  force: number;
}

/** Parry timing windows (seconds). */
export interface ParryConfig {
  /** Wider window that negates damage (deflect outcome). */
  deflectWindow: number;
  /** Tighter window inside `deflectWindow` that also launches the attacker. */
  perfectWindow: number;
  /** Defensive force used during the parry. */
  force: number;
  /** Stamina consumed to parry. */
  staminaCost: number;
}

/** Top-level combat tuning for one fighter. */
export interface CombatConfig {
  maxHealth: number;
  maxStamina: number;
  /** Stamina regenerated per second once the regen delay elapses. */
  staminaRegenPerSec: number;
  /** Seconds after spending stamina before regen resumes. */
  staminaRegenDelay: number;
  maxPoise: number;
  /** Poise regenerated per second (when not staggered). */
  poiseRegenPerSec: number;
  dodge: DodgeConfig;
  block: BlockConfig;
  parry: ParryConfig;
  /** Seconds the stagger reaction lasts. */
  staggerDuration: number;
  /** Seconds the stunned reaction lasts. */
  stunnedDuration: number;
  /** Seconds the fallen/knocked-down state lasts before `getUp` may be triggered. */
  fallenDuration: number;
  /** Seconds the get-up recovery clip plays before returning to idle. */
  getUpDuration: number;
  /** Seconds during which the next incoming hit is a guaranteed crit. */
  critWindowDuration: number;
  /** How long (seconds) a queued attack input is remembered for combo buffering. */
  inputBufferTime: number;
}

// ----------------------------------------------------------------- Defensive types

/** Defensive action the fighter chose when the attack contacted. */
export type DefensiveAction = "parry" | "block" | "dodge" | "none";

/**
 * Typed outcome of a defensive exchange (return value of `resolveDefense` and
 * `CombatController.applyAttack`).
 *
 * | Outcome         | Meaning                                                      |
 * |-----------------|--------------------------------------------------------------|
 * | `deflect`       | Attack negated; no damage on either side (parry or equal-force bounce). |
 * | `perfectParry`  | Deflect + attacker enters `parried` vulnerable state.        |
 * | `blockStop`     | Motion halted; no positional gain (may stun the blocker if shieldBreak). |
 * | `dodgeEvade`    | I-frame avoidance; attack whiffs entirely.                   |
 * | `dodgePunish`   | Well-timed dodge reroutes attacker into `dodgePunished` stumble. |
 * | `hit`           | Defense failed or absent; damage and poise damage applied.   |
 * | `crit`          | Hit inside a crit window; damage multiplied by `critMultiplier`. |
 */
export type DefensiveOutcome =
  | "deflect"
  | "perfectParry"
  | "blockStop"
  | "dodgeEvade"
  | "dodgePunish"
  | "hit"
  | "crit";

/**
 * Vulnerable states that open a guaranteed-crit window on the NEXT incoming hit.
 * Entering any of these sets a 2-second crit timer in the CombatController.
 */
export type VulnerableState = "stunned" | "fallen" | "parried" | "dodgePunished" | "none";

/** Metadata about an incoming attack, used by `resolveDefense`. */
export interface AttackPayload {
  /** Forward momentum / force of this move (matches `AttackMove.force`). */
  force: number;
  /** Damage on clean hit. */
  damage: number;
  /** Poise damage on clean hit. */
  poiseDamage: number;
  /** When true, the attack carries a shield-break flag. */
  shieldBreak?: boolean;
}

/** Metadata describing the defender's chosen action + timing. */
export interface DefensePayload {
  /** The action the fighter is currently performing. */
  action: DefensiveAction;
  /** Defensive force (from block or parry config). */
  force: number;
  /**
   * Seconds elapsed since this defense was activated. Used for timing checks:
   * - Parry: 0 = perfectly timed, larger = later/worse.
   * - Dodge: 0 = start of dodge (punish window), larger = later.
   */
  age: number;
}

/** Full result of a defensive exchange, returned by `resolveDefense` and `applyAttack`. */
export interface DefensiveResult {
  /** Categorical outcome of the exchange. */
  outcome: DefensiveOutcome;
  /** Damage actually applied to the DEFENDER (0 on evade/deflect/block). */
  damageDealt: number;
  /** Poise damage actually applied to the DEFENDER. */
  poiseDamageDealt: number;
  /**
   * Vulnerable state the ATTACKER should enter (e.g. `parried` on perfectParry,
   * `dodgePunished` on a punish-dodge). `"none"` means no attacker reaction.
   */
  attackerReaction: VulnerableState;
  /**
   * Vulnerable state the DEFENDER should enter (e.g. `stunned` on shieldBreak).
   * `"none"` means no defensive reaction beyond what the outcome already implies.
   */
  defenderReaction: VulnerableState;
  /**
   * True if this hit should open a 2-second guaranteed-crit window on the next
   * incoming hit to the DEFENDER (raised by `blockStop+shieldBreak`).
   */
  critWindow: boolean;
}

// ----------------------------------------------------------------- Legacy result

/** Result of applying an incoming hit to a fighter (legacy path; prefer `DefensiveResult`). */
export interface HitResult {
  /** The hit was negated by dodge i-frames. */
  evaded: boolean;
  /** Damage actually applied. */
  damage: number;
  /** The hit caused a stagger. */
  staggered: boolean;
  /** The hit was fatal. */
  killed: boolean;
}

/** Lifecycle callbacks the host game wires into (e.g. play clips, spawn hitboxes). */
export interface CombatEvents {
  onStateChange?(state: CombatStateName, previous: CombatStateName): void;
  /** A new attack move began — play `move.clip`. */
  onMoveStart?(move: AttackMove, comboIndex: number): void;
  /** Contact frames started — the game should query targets with `move.hit`. */
  onHitActive?(move: AttackMove): void;
  /** Contact frames ended. */
  onHitEnd?(move: AttackMove): void;
  /** A dodge began (unit direction in the fighter's local space). */
  onDodge?(dir: DodgeDir): void;
  /** A parry was activated. */
  onParry?(): void;
  /** Block stance raised or lowered. */
  onBlock?(active: boolean): void;
  /** The fighter was staggered. */
  onStagger?(): void;
  /** The fighter entered a stunned state. */
  onStunned?(): void;
  /** The fighter fell (knocked down). */
  onFallen?(): void;
  /** The fighter got up from a fallen/knocked-down state. */
  onGetUp?(): void;
  /** The fighter died. */
  onDeath?(): void;
  onStaminaChange?(value: number, max: number): void;
  onHealthChange?(value: number, max: number): void;
  /** An action was refused because of insufficient stamina. */
  onStaminaBlocked?(): void;
  /**
   * A defensive exchange resolved. `result.outcome` gives the categorical
   * outcome; the host plays the appropriate reaction clips + VFX from here.
   * `attackerController` is supplied when the host can identify the attacker,
   * so the listener can call `attackerController.applyVulnerableState(...)`.
   */
  onDefensiveOutcome?(result: DefensiveResult): void;
}

/** Planar dodge direction (character-local: +x right, +z forward). */
export interface DodgeDir {
  x: number;
  z: number;
}

/** Crit damage multiplier applied to hits inside a crit window. */
export const CRIT_MULTIPLIER = 1.5;
