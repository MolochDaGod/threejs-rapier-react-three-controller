import * as THREE from "three";
import type { CombatController } from "@workspace/epicfight";
import type {
  AttackPayload,
  DefensiveResult,
  DodgeDir,
  CombatStateName,
} from "@workspace/epicfight";
import { fighterConfig, makeFighterCC } from "./combatModel";

const PLAYER_CFG = fighterConfig("player");

/** Heavy shield-break payload the player fires with the "R" skill. */
export const PLAYER_HEAVY_PAYLOAD: AttackPayload = {
  force: 3,
  damage: 22,
  poiseDamage: 35,
  shieldBreak: true,
};

/**
 * Stomp finisher payload — a heavy execution dropped on a knocked-down (fallen)
 * enemy. Force 4 (unblockable; the foe is prone anyway) with big damage/poise so
 * the ground stomp reads as a true finisher.
 */
export const PLAYER_STOMP_PAYLOAD: AttackPayload = {
  force: 4,
  damage: 45,
  poiseDamage: 60,
};

/**
 * Illegal headbutt payload — a quick, dirty close-range melee. Light damage but
 * a solid poise/stagger hit so it reads as a disruptive headbutt; blockable
 * (force 2), so it is not a guaranteed stun against a raised guard.
 */
export const PLAYER_HEADBUTT_PAYLOAD: AttackPayload = {
  force: 2,
  damage: 8,
  poiseDamage: 22,
};

export interface SparringCallbacks {
  /** Player combat state changed (parry/block/dodge/stunned/fallen/idle…). */
  onPlayerStateChange?: (state: CombatStateName) => void;
  /**
   * An opponent's attack resolved against the player (player = DEFENDER).
   * Studio maps the outcome to the player's loser/parry/dodge reactions.
   */
  onDummyHitResult?: (result: DefensiveResult, pos: THREE.Vector3) => void;
}

/**
 * Holds the PLAYER's single {@link CombatController} for the Danger Room.
 *
 * Combat is unified on `@workspace/epicfight`: every fighter owns one
 * CombatController. Opponents own theirs inside {@link Targets}; this class owns
 * the player's and mediates the player's defensive inputs (parry/block/dodge)
 * plus the resolution of incoming opponent strikes ({@link resolvePlayerDefense}).
 * It holds no AI and no opponent state — opponents drive themselves.
 */
export class SparringCombat {
  private _playerCC: CombatController;
  private callbacks: SparringCallbacks;

  constructor(callbacks: SparringCallbacks = {}) {
    this.callbacks = callbacks;
    this._playerCC = this.makePlayerCC();
  }

  private makePlayerCC(): CombatController {
    return makeFighterCC("player", {
      onStateChange: (s) => this.callbacks.onPlayerStateChange?.(s),
    });
  }

  // ---- accessors ----

  get playerCC(): CombatController { return this._playerCC; }

  getPlayerState(): CombatStateName { return this._playerCC.getState(); }
  getPlayerHealth(): number { return this._playerCC.getHealth(); }
  getPlayerStamina(): number { return this._playerCC.getStamina(); }
  getPlayerPoise(): number { return this._playerCC.getPoise(); }
  getPlayerCritWindow(): number { return this._playerCC.getCritWindowRemaining(); }
  getPlayerMaxHealth(): number { return PLAYER_CFG.maxHealth; }
  getPlayerMaxStamina(): number { return PLAYER_CFG.maxStamina; }
  getPlayerMaxPoise(): number { return PLAYER_CFG.maxPoise; }

  // ---- player inputs ----

  parry(): void { this._playerCC.parry(); }
  startBlock(): void { this._playerCC.startBlock(); }
  endBlock(): void { this._playerCC.endBlock(); }
  dodge(dir: DodgeDir = { x: 0, z: 1 }): void { this._playerCC.dodge(dir); }
  /** Restore player HP (clamped to max) — used by the heal-potion consumable. */
  healPlayer(amount: number): void { this._playerCC.heal(amount); }

  // ---- defense resolution ----

  /**
   * Resolve an incoming opponent strike against the player CombatController.
   * The CC decides block/parry/dodge/hit/crit from the player's current input
   * state and applies health/poise/stamina internally. Returns the result so the
   * caller can punish a parried/dodge-punished attacker and play reactions.
   */
  resolvePlayerDefense(payload: AttackPayload, pos: THREE.Vector3): DefensiveResult {
    const result = this._playerCC.applyAttack(payload);
    this.callbacks.onDummyHitResult?.(result, pos.clone());
    return result;
  }

  // ---- lifecycle ----

  /** Recreate the player CombatController (health-reset / character swap). */
  resetPlayer(): void {
    this._playerCC = this.makePlayerCC();
  }

  update(dt: number): void {
    this._playerCC.update(dt);
  }
}
