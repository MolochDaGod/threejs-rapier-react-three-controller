import type {
  AttackKind,
  AttackMove,
  AttackPayload,
  BlockConfig,
  CombatConfig,
  CombatEvents,
  CombatStateName,
  DefensePayload,
  DefensiveResult,
  DodgeDir,
  HitResult,
  Moveset,
  VulnerableState,
} from "./types.js";
import { CRIT_MULTIPLIER } from "./types.js";
import { resolveDefense } from "./defense.js";

/**
 * Game-agnostic melee combat state machine, modelled on Epic Fight.
 *
 * Pure logic — no Three.js, no game world. The host drives it with
 * {@link lightAttack}/{@link heavyAttack}/{@link dodge}/{@link parry}/
 * {@link startBlock}/{@link endBlock}/{@link applyHit}/{@link applyAttack}
 * and advances it with {@link update}; lifecycle is surfaced through
 * {@link CombatEvents}. Hit geometry lives in `colliders.ts`; this class only
 * owns timing, combos, stamina/poise, state, and defensive resolution.
 */
export class CombatController {
  private state: CombatStateName = "idle";
  private cfg: CombatConfig;
  private moveset: Moveset;
  private readonly events: CombatEvents;

  private health: number;
  private stamina: number;
  private poise: number;

  /** Seconds elapsed in the current state. */
  private timer = 0;
  private regenDelay = 0;

  private comboKind: AttackKind | null = null;
  private comboIndex = -1;
  private currentMove: AttackMove | null = null;
  private hitActive = false;

  private buffered: AttackKind | null = null;
  private bufferTimer = 0;

  private invincible = false;
  private dodgeDir: DodgeDir = { x: 0, z: 1 };

  // ---- defensive state ----
  /** Current vulnerable state (opens a crit window). */
  private vulnerableState: VulnerableState = "none";
  /** Remaining seconds of the guaranteed-crit window. */
  private critWindowTimer = 0;
  /** Seconds remaining in the stunned state (used for block-drain as well). */
  private stunnedTimer = 0;
  /** True while block is held (block state drains stamina per second). */
  private blockHeld = false;

  constructor(cfg: CombatConfig, moveset: Moveset, events: CombatEvents = {}) {
    this.cfg = cfg;
    this.moveset = moveset;
    this.events = events;
    this.health = cfg.maxHealth;
    this.stamina = cfg.maxStamina;
    this.poise = cfg.maxPoise;
  }

  // ----- queries -------------------------------------------------------------

  getState(): CombatStateName {
    return this.state;
  }
  getHealth(): number {
    return this.health;
  }
  /**
   * Restore health (clamped to `maxHealth`), e.g. from a heal potion / consumable.
   * No-op when dead or for non-positive amounts. Fires `onHealthChange` so HUDs
   * and mirrors update immediately.
   */
  heal(amount: number): void {
    if (this.state === "dead" || amount <= 0) return;
    this.health = Math.min(this.cfg.maxHealth, this.health + amount);
    this.events.onHealthChange?.(this.health, this.cfg.maxHealth);
  }
  getStamina(): number {
    return this.stamina;
  }
  getPoise(): number {
    return this.poise;
  }
  getComboIndex(): number {
    return this.comboIndex;
  }
  getCurrentMove(): AttackMove | null {
    return this.currentMove;
  }
  isInvincible(): boolean {
    return this.invincible;
  }
  isAlive(): boolean {
    return this.state !== "dead";
  }
  isAttacking(): boolean {
    return this.state === "attack";
  }
  /** Hit query should run this frame (contact window open). */
  isHitActive(): boolean {
    return this.hitActive;
  }
  /** The fighter is in a vulnerable state that opens a guaranteed-crit window. */
  getVulnerableState(): VulnerableState {
    return this.vulnerableState;
  }
  /** True if the next incoming hit will be a crit. */
  hasCritWindow(): boolean {
    return this.critWindowTimer > 0;
  }
  /** Seconds remaining in the current crit window (0 when none active). */
  getCritWindowRemaining(): number {
    return this.critWindowTimer;
  }

  // ----- config --------------------------------------------------------------

  /** Swap the active weapon moveset (resets any in-progress combo to idle). */
  setMoveset(moveset: Moveset): void {
    this.moveset = moveset;
    if (this.state === "attack") this.toIdle();
  }

  getMoveset(): Moveset {
    return this.moveset;
  }

  // ----- inputs --------------------------------------------------------------

  lightAttack(): void {
    this.tryAttack("light");
  }

  heavyAttack(): void {
    this.tryAttack("heavy");
  }

  private tryAttack(kind: AttackKind): void {
    if (
      this.state === "dead" ||
      this.state === "stagger" ||
      this.state === "dodge" ||
      this.state === "stunned" ||
      this.state === "fallen" ||
      this.state === "parry"
    ) {
      return;
    }
    if (this.state === "attack") {
      // Buffer the input for combo continuation.
      this.buffered = kind;
      this.bufferTimer = this.cfg.inputBufferTime;
      return;
    }
    this.startMove(kind, 0);
  }

  private chainFor(kind: AttackKind): AttackMove[] {
    return kind === "light" ? this.moveset.light : (this.moveset.heavy ?? []);
  }

  /** The move that `(kind, index)` resolves to, or null if the chain is empty. */
  private resolveMove(kind: AttackKind, index: number): AttackMove | null {
    const chain = this.chainFor(kind);
    if (chain.length === 0) return null;
    return chain[index % chain.length];
  }

  /** Commit to a move. Returns false (no state change) if it can't start. */
  private startMove(kind: AttackKind, index: number): boolean {
    const move = this.resolveMove(kind, index);
    if (!move) return false;
    if (this.stamina < move.staminaCost) {
      this.events.onStaminaBlocked?.();
      return false;
    }
    this.spendStamina(move.staminaCost);
    this.comboKind = kind;
    this.comboIndex = index;
    this.currentMove = move;
    this.hitActive = false;
    this.buffered = null;
    this.bufferTimer = 0;
    this.setState("attack");
    this.timer = 0;
    this.events.onMoveStart?.(move, index);
    return true;
  }

  /**
   * Begin a dodge. Allowed from idle, or from the recovery phase of an attack
   * (dodge-cancel). `dir` is the intended travel direction in fighter-local
   * space; it is normalised and forwarded via `onDodge`.
   */
  dodge(dir: DodgeDir = { x: 0, z: 1 }): void {
    if (
      this.state === "dead" ||
      this.state === "stagger" ||
      this.state === "dodge" ||
      this.state === "stunned" ||
      this.state === "fallen"
    ) {
      return;
    }
    if (this.state === "attack") {
      const m = this.currentMove;
      const recoveryStart = m ? m.windup + m.active : 0;
      if (this.timer < recoveryStart) return; // can't cancel windup/active frames
    }
    if (this.stamina < this.cfg.dodge.staminaCost) {
      this.events.onStaminaBlocked?.();
      return;
    }
    this.spendStamina(this.cfg.dodge.staminaCost);
    const len = Math.hypot(dir.x, dir.z) || 1;
    this.dodgeDir = { x: dir.x / len, z: dir.z / len };
    this.currentMove = null;
    this.hitActive = false;
    this.comboKind = null;
    this.comboIndex = -1;
    this.invincible = false;
    this.blockHeld = false;
    this.setState("dodge");
    this.timer = 0;
    this.events.onDodge?.(this.dodgeDir);
  }

  /**
   * Activate a parry. The fighter enters the `parry` state; the `timer` resets
   * so incoming `applyAttack` calls can measure timing accuracy (`age`).
   * Allowed from idle, block stance, or dodge recovery — NOT during attack
   * windup/active frames or while stunned/fallen.
   */
  parry(): void {
    if (
      this.state === "dead" ||
      this.state === "stagger" ||
      this.state === "dodge" ||
      this.state === "stunned" ||
      this.state === "fallen"
    ) {
      return;
    }
    if (this.state === "attack") {
      const m = this.currentMove;
      const recoveryStart = m ? m.windup + m.active : 0;
      if (this.timer < recoveryStart) return;
    }
    if (this.stamina < this.cfg.parry.staminaCost) {
      this.events.onStaminaBlocked?.();
      return;
    }
    this.spendStamina(this.cfg.parry.staminaCost);
    this.currentMove = null;
    this.hitActive = false;
    this.comboKind = null;
    this.comboIndex = -1;
    this.blockHeld = false;
    this.setState("parry");
    this.timer = 0;
    this.events.onParry?.();
  }

  /**
   * Raise a block stance. Holds until {@link endBlock} or stamina is depleted.
   * Allowed from idle (not during attack windup/active or invulnerable states).
   */
  startBlock(): void {
    if (
      this.state === "dead" ||
      this.state === "stagger" ||
      this.state === "stunned" ||
      this.state === "fallen" ||
      this.blockHeld
    ) {
      return;
    }
    if (this.state === "attack") {
      const m = this.currentMove;
      const recoveryStart = m ? m.windup + m.active : 0;
      if (this.timer < recoveryStart) return;
    }
    if (this.stamina < this.cfg.block.staminaCostOnRaise) {
      this.events.onStaminaBlocked?.();
      return;
    }
    this.spendStamina(this.cfg.block.staminaCostOnRaise);
    this.blockHeld = true;
    this.setState("block");
    this.timer = 0;
    this.events.onBlock?.(true);
  }

  /** Release a block stance. */
  endBlock(): void {
    if (!this.blockHeld) return;
    this.blockHeld = false;
    if (this.state === "block") this.toIdle();
    this.events.onBlock?.(false);
  }

  /**
   * Attempt to get up from a fallen/knocked-down state. Allowed only when the
   * fallen timer has elapsed (`timer >= cfg.fallenDuration`). Returns true if
   * the recovery was started.
   */
  getUp(): boolean {
    if (this.state !== "fallen") return false;
    if (this.timer < this.cfg.fallenDuration) return false;
    this.setState("getUp");
    this.timer = 0;
    this.events.onGetUp?.();
    return true;
  }

  /**
   * Apply a FULL defensive exchange: resolves the outcome from the current
   * combat state and fires {@link CombatEvents.onDefensiveOutcome}. Prefer this
   * over the legacy {@link applyHit} when you have force/shieldBreak metadata.
   *
   * The caller is responsible for calling `applyVulnerableState` on the
   * **attacker** if `result.attackerReaction !== "none"`.
   */
  applyAttack(payload: AttackPayload): DefensiveResult {
    if (this.state === "dead") {
      return {
        outcome: "hit",
        damageDealt: 0,
        poiseDamageDealt: 0,
        attackerReaction: "none",
        defenderReaction: "none",
        critWindow: false,
      };
    }

    const defense = this.buildDefensePayload();
    const result = resolveDefense(payload, defense, this.invincible);

    // If we have an open crit window and the outcome is a hit, upgrade to crit.
    const finalResult = this.applyCritUpgrade(result);

    this.processDefensiveResult(finalResult, payload);
    this.events.onDefensiveOutcome?.(finalResult);
    return finalResult;
  }

  /**
   * External call to put this fighter into a vulnerable reaction state (e.g.
   * the attacker calls this on their own controller after `result.attackerReaction`
   * comes back from the OTHER fighter's `applyAttack`).
   */
  applyVulnerableState(vs: VulnerableState): void {
    if (vs === "none" || this.state === "dead") return;
    this.enterVulnerableState(vs);
  }

  /** Apply an incoming hit. Honours dodge i-frames, super armor and poise. */
  applyHit(damage: number, poiseDamage = 0): HitResult {
    const result: HitResult = {
      evaded: false,
      damage: 0,
      staggered: false,
      killed: false,
    };
    if (this.state === "dead") return result;
    if (this.invincible) {
      result.evaded = true;
      return result;
    }

    // Apply crit multiplier if window is open.
    const effectiveDamage = this.critWindowTimer > 0 ? Math.round(damage * CRIT_MULTIPLIER) : damage;

    this.health = Math.max(0, this.health - effectiveDamage);
    result.damage = effectiveDamage;
    this.events.onHealthChange?.(this.health, this.cfg.maxHealth);

    if (this.health <= 0) {
      result.killed = true;
      this.die();
      return result;
    }

    const superArmor = this.state === "attack" && this.currentMove?.superArmor === true;
    if (!superArmor) {
      this.poise = Math.max(0, this.poise - poiseDamage);
      if (this.poise <= 0) {
        result.staggered = true;
        this.stagger();
      }
    }
    return result;
  }

  // ----- update --------------------------------------------------------------

  update(dt: number): void {
    if (dt <= 0) return;
    if (this.state === "dead") return;

    this.timer += dt;

    // Crit window countdown.
    if (this.critWindowTimer > 0) {
      this.critWindowTimer = Math.max(0, this.critWindowTimer - dt);
    }

    // Stamina regen.
    if (this.regenDelay > 0) {
      this.regenDelay = Math.max(0, this.regenDelay - dt);
    } else if (this.stamina < this.cfg.maxStamina) {
      this.stamina = Math.min(
        this.cfg.maxStamina,
        this.stamina + this.cfg.staminaRegenPerSec * dt,
      );
      this.events.onStaminaChange?.(this.stamina, this.cfg.maxStamina);
    }

    // Poise regen (not while staggered or stunned).
    if (this.state !== "stagger" && this.state !== "stunned" && this.poise < this.cfg.maxPoise) {
      this.poise = Math.min(this.cfg.maxPoise, this.poise + this.cfg.poiseRegenPerSec * dt);
    }

    // Input buffer decay.
    if (this.bufferTimer > 0) {
      this.bufferTimer -= dt;
      if (this.bufferTimer <= 0) this.buffered = null;
    }

    // Block stance stamina drain.
    if (this.blockHeld && this.state === "block") {
      this.stamina = Math.max(0, this.stamina - this.cfg.block.staminaDrainPerSec * dt);
      this.events.onStaminaChange?.(this.stamina, this.cfg.maxStamina);
      if (this.stamina <= 0) {
        // Ran out of stamina — force the block to drop.
        this.endBlock();
      }
    }

    switch (this.state) {
      case "attack":
        this.updateAttack();
        break;
      case "dodge":
        this.updateDodge();
        break;
      case "parry":
        // Parry window expires after the deflect window has fully elapsed.
        if (this.timer >= this.cfg.parry.deflectWindow + 0.15) this.toIdle();
        break;
      case "stagger":
        if (this.timer >= this.cfg.staggerDuration) this.toIdle();
        break;
      case "stunned":
        if (this.timer >= this.cfg.stunnedDuration) this.toIdle();
        break;
      case "fallen":
        // Auto get-up after fallen duration if not manually triggered.
        if (this.timer >= this.cfg.fallenDuration + this.cfg.getUpDuration) this.toIdle();
        break;
      case "getUp":
        if (this.timer >= this.cfg.getUpDuration) this.toIdle();
        break;
      default:
        break;
    }
  }

  private updateAttack(): void {
    const m = this.currentMove;
    if (!m) {
      this.toIdle();
      return;
    }
    const activeEnd = m.windup + m.active;

    if (!this.hitActive && this.timer >= m.windup && this.timer < activeEnd) {
      this.hitActive = true;
      this.events.onHitActive?.(m);
    } else if (this.hitActive && this.timer >= activeEnd) {
      this.hitActive = false;
      this.events.onHitEnd?.(m);
    }

    const windowStart = m.comboWindowStart ?? m.windup;
    if (this.buffered && this.timer >= windowStart) {
      const kind = this.buffered;
      const nextIndex = kind === this.comboKind ? this.comboIndex + 1 : 0;
      const next = this.resolveMove(kind, nextIndex);
      if (next && this.stamina >= next.staminaCost) {
        if (this.hitActive) {
          this.hitActive = false;
          this.events.onHitEnd?.(m);
        }
        this.startMove(kind, nextIndex);
        return;
      }
      this.buffered = null;
      this.bufferTimer = 0;
    }

    if (this.timer >= m.duration) {
      if (this.hitActive) {
        this.hitActive = false;
        this.events.onHitEnd?.(m);
      }
      this.toIdle();
    }
  }

  private updateDodge(): void {
    const d = this.cfg.dodge;
    this.invincible = this.timer >= d.iframeStart && this.timer < d.iframeEnd;
    if (this.timer >= d.duration) {
      this.invincible = false;
      this.toIdle();
    }
  }

  // ----- transitions ---------------------------------------------------------

  private stagger(): void {
    this.currentMove = null;
    this.hitActive = false;
    this.comboKind = null;
    this.comboIndex = -1;
    this.buffered = null;
    this.invincible = false;
    this.blockHeld = false;
    this.setState("stagger");
    this.timer = 0;
    this.events.onStagger?.();
  }

  private die(): void {
    this.currentMove = null;
    this.hitActive = false;
    this.invincible = false;
    this.buffered = null;
    this.blockHeld = false;
    this.critWindowTimer = 0;
    this.vulnerableState = "none";
    this.setState("dead");
    this.timer = 0;
    this.events.onDeath?.();
  }

  private toIdle(): void {
    this.currentMove = null;
    this.hitActive = false;
    this.comboKind = null;
    this.comboIndex = -1;
    this.invincible = false;
    this.blockHeld = false;
    this.setState("idle");
    this.timer = 0;
  }

  private setState(next: CombatStateName): void {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    this.events.onStateChange?.(next, prev);
  }

  private spendStamina(amount: number): void {
    this.stamina = Math.max(0, this.stamina - amount);
    this.regenDelay = this.cfg.staminaRegenDelay;
    this.events.onStaminaChange?.(this.stamina, this.cfg.maxStamina);
  }

  // ----- defensive helpers ---------------------------------------------------

  /** Build the defense payload from current state/timer. */
  private buildDefensePayload(): import("./types.js").DefensePayload {
    if (this.state === "parry") {
      return { action: "parry", force: this.cfg.parry.force, age: this.timer };
    }
    if (this.state === "block") {
      return { action: "block", force: this.cfg.block.force, age: this.timer };
    }
    if (this.state === "dodge") {
      return { action: "dodge", force: 0, age: this.timer };
    }
    return { action: "none", force: 0, age: 0 };
  }

  /** Upgrade a plain `hit` to `crit` when the crit window is open. */
  private applyCritUpgrade(result: DefensiveResult): DefensiveResult {
    if (result.outcome === "hit" && this.critWindowTimer > 0) {
      return {
        ...result,
        outcome: "crit",
        damageDealt: Math.round(result.damageDealt * CRIT_MULTIPLIER),
      };
    }
    return result;
  }

  /** Apply health/poise damage and state transitions from a resolved result. */
  private processDefensiveResult(result: DefensiveResult, _payload: AttackPayload): void {
    if (result.damageDealt > 0) {
      this.health = Math.max(0, this.health - result.damageDealt);
      this.events.onHealthChange?.(this.health, this.cfg.maxHealth);
      if (this.health <= 0) {
        this.die();
        return;
      }
    }

    if (result.poiseDamageDealt > 0) {
      const superArmor = this.state === "attack" && this.currentMove?.superArmor === true;
      if (!superArmor) {
        this.poise = Math.max(0, this.poise - result.poiseDamageDealt);
        if (this.poise <= 0) {
          this.stagger();
          return;
        }
      }
    }

    // Defender reaction (e.g. stunned on shieldBreak blockStop).
    if (result.defenderReaction !== "none") {
      this.enterVulnerableState(result.defenderReaction);
      return;
    }

    // Open crit window if this result says to.
    if (result.critWindow) {
      this.critWindowTimer = this.cfg.critWindowDuration;
    }
  }

  /** Enter a vulnerable state (stunned / fallen / parried / dodgePunished). */
  private enterVulnerableState(vs: VulnerableState): void {
    this.vulnerableState = vs;
    this.critWindowTimer = this.cfg.critWindowDuration;
    this.currentMove = null;
    this.hitActive = false;
    this.comboKind = null;
    this.comboIndex = -1;
    this.buffered = null;
    this.invincible = false;
    this.blockHeld = false;

    switch (vs) {
      case "stunned":
        this.setState("stunned");
        this.timer = 0;
        this.events.onStunned?.();
        break;
      case "fallen":
      case "parried":
      case "dodgePunished":
        this.setState("fallen");
        this.timer = 0;
        this.events.onFallen?.();
        break;
      case "none":
        break;
    }
  }

  /** Build the {@link AttackPayload} for the current move (used by hosts). */
  buildAttackPayload(): AttackPayload | null {
    const m = this.currentMove;
    if (!m) return null;
    return {
      force: m.force ?? 1,
      damage: m.damage,
      poiseDamage: m.poiseDamage,
      shieldBreak: m.shieldBreak ?? false,
    };
  }
}
