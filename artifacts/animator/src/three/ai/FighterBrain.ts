/**
 * The sparring fighter's concrete goal-driven brain, built on the generic
 * {@link Goal}/{@link Think} core. It is pure decision logic over a
 * {@link FighterAgent} abstraction: it READS a perception snapshot + difficulty
 * bias and CALLS opaque action hooks. It owns no Three.js / engine state, so the
 * whole brain (arbitration, subgoal lifecycle, reaction-latency gating) is
 * exercised in unit tests against a mock agent.
 *
 * The host (Targets) implements {@link FighterAgent}: it refreshes the
 * perception each frame and routes the action hooks into the existing combat
 * contract (executeStrike / commitDefense), which this layer never touches.
 */

import { Goal } from "./Goal";
import { type GoalEvaluator, Think } from "./Think";

/** Difficulty-derived weights that bend the evaluators (not engine tuning). */
export interface FighterBias {
  /** Scales how strongly the fighter wants to press an attack. */
  aggression: number;
  /** Scales how strongly it wants to defend against a telegraphed threat. */
  caution: number;
  /** 0..1 chance a committed wind-up becomes a flashy skill swing. */
  skillFrequency: number;
}

/** A per-frame read of the fighter + its target the brain reasons over. */
export interface FighterPerception {
  hasTarget: boolean;
  /** Horizontal distance to the current target (m); Infinity when none. */
  distance: number;
  /** Outer engage range (weapon max reach + padding). */
  engageRange: number;
  /** Inner comfortable range (weapon min reach); closer than this = crowded. */
  innerRange: number;
  /**
   * Upper bound of the gap-close band: a target beyond `engageRange` but within
   * `lungeRange` can be closed with a single committed dash (weapon reach + dash
   * distance). Beyond this the fighter just walks in (Engage).
   */
  lungeRange: number;
  /**
   * Weapon-derived hard cap on melee combo length (1 for ranged/thrown, longer
   * for light 1H weapons). Omitted → AttackGoal falls back to its default of 3.
   */
  comboMax?: number;
  /** True while the target is in a telegraphed wind-up (incoming threat). */
  targetWindingUp: boolean;
  /**
   * True while the target is in attack recovery / just whiffed — a punish window
   * where pressing an attack is heavily favoured.
   */
  targetRecovering: boolean;
  /** True when the fighter's attack cooldown has elapsed. */
  attackReady: boolean;
  /**
   * True when a ranged spell is off cooldown, the fighter has stamina to cast,
   * and the host can actually route a cast (a {@link FighterActions.releaseCast}
   * sink exists). When false the fighter falls back to melee only.
   */
  spellReady: boolean;
  /**
   * True when a deployable turret is off cooldown, the fighter has stamina, has
   * no turret of its own already standing, and the host can route a deploy
   * ({@link FighterActions.releaseDeploy} sink exists). Paces the hazard so it
   * stays an occasional stand-off play rather than a constant one.
   */
  turretReady: boolean;
  /** Max distance (m) at which the fighter will commit a ranged spell cast. */
  spellRange: number;
  /** True when a defensive move can be committed (not shield-broken / on cd). */
  canDefend: boolean;
  /** 0..1 normalized combat resources. */
  health01: number;
  stamina01: number;
  poise01: number;
}

/** Opaque action hooks the goals fire; the host maps these onto the engine. */
export interface FighterActions {
  /** Rotate to face the target this frame. */
  face(dt: number): void;
  /** Step toward the target (mul scales the base approach speed). */
  advance(dt: number, mul?: number): void;
  /** Step away from the target (keep spacing / back off). */
  retreat(dt: number, mul?: number): void;
  /** Circle-strafe around the target (dir = +1 / -1) to hold spacing without backpedalling. */
  strafe(dt: number, dir: number): void;
  /** Commit a single quick dash to close a gap-close-band target. */
  gapClose(): void;
  /** Drift toward the home post (no hostile present). */
  returnHome(dt: number): void;
  /** Enter the attack wind-up (telegraph). Rolls the skill flag from bias. */
  beginWindup(): void;
  /** Advance the active wind-up, creeping forward; true once ready to land. */
  tickWindup(dt: number): boolean;
  /** Resolve the wound-up strike against the target. */
  releaseStrike(): void;
  /** Reset a half-started wind-up (when an attack is abandoned mid-commit). */
  cancelWindup(): void;
  /** Begin a ranged spell cast: pick the spell + start its charge-up aura tell. */
  beginCast(): void;
  /** Advance the cast charge; true once the projectile should fire. */
  tickCast(dt: number): boolean;
  /** Fire the charged spell projectile (homing onto the target). */
  releaseCast(): void;
  /** Abandon a half-charged cast (when the cast is interrupted mid-commit). */
  cancelCast(): void;
  /** Begin deploying a turret: start its charge-up aura tell. */
  beginDeploy(): void;
  /** Advance the deploy charge; true once the turret should drop. */
  tickDeploy(dt: number): boolean;
  /** Drop the charged turret (a standing hazard that fires over time). */
  releaseDeploy(): void;
  /** Abandon a half-charged deploy (when interrupted mid-commit). */
  cancelDeploy(): void;
  /**
   * Host gate for chaining another swing immediately after a landed strike (the
   * host decides from stamina / RNG). Returns true to extend the combo string.
   */
  continueCombo(): boolean;
  /** Commit a defensive move (parry/dodge/block chosen by the host). */
  defend(): void;
}

/** The brain's owner: a live perception snapshot, bias, and action hooks. */
export interface FighterAgent {
  readonly bias: FighterBias;
  /** Activation latency (s) between perceiving a cue and committing (0 = instant). */
  readonly reactionDelay: number;
  /** Mutable snapshot the host refreshes before each {@link Think.process}. */
  readonly perception: FighterPerception;
  readonly actions: FighterActions;
}

// ── Goals ────────────────────────────────────────────────────────────────────

/** No hostile in play: drift back to the home post. */
class IdleGoal extends Goal<FighterAgent> {
  process(dt: number) {
    this.owner.actions.returnHome(dt);
    return this.setActive();
  }
}

/** Close the gap to the target until it's within engage range. */
class EngageGoal extends Goal<FighterAgent> {
  process(dt: number) {
    const { perception: p, actions } = this.owner;
    actions.face(dt);
    if (!p.hasTarget) return this.setFailed();
    if (p.distance <= p.engageRange) return this.setCompleted();
    actions.advance(dt);
    return this.setActive();
  }
}

/**
 * Commit an attack: wait out the reaction latency (facing the target), then
 * wind up + creep in, and resolve the strike. If the brain abandons the goal
 * mid-wind-up (e.g. to defend), {@link FighterActions.cancelWindup} unwinds it.
 */
class AttackGoal extends Goal<FighterAgent> {
  private phase: "wait" | "windup" | "done" = "wait";
  private latency = 0;
  /** Strikes landed so far in this string. */
  private hits = 0;
  /** Hard cap on the combo length (more aggressive fighters chain longer). */
  private maxHits = 1;

  activate() {
    this.latency = this.owner.reactionDelay;
    this.phase = "wait";
    this.hits = 0;
    // Combo length scales with aggression, capped by the weapon's combo ceiling.
    // The aggression term is normalised to the cap so the formula reduces to the
    // legacy `round(1 + aggression)` at the default cap of 3 (1 hit at aggression
    // 0 → up to the cap at high aggression); ranged/thrown weapons (cap 1) never
    // chain a melee string.
    const cap = this.owner.perception.comboMax ?? 3;
    this.maxHits = Math.max(1, Math.min(cap, Math.round(1 + (this.owner.bias.aggression * (cap - 1)) / 2)));
  }

  process(dt: number) {
    const { actions, perception: p } = this.owner;
    actions.face(dt);
    if (this.phase === "wait") {
      this.latency -= dt;
      if (this.latency <= 0) {
        actions.beginWindup();
        this.phase = "windup";
      }
      return this.setActive();
    }
    if (this.phase === "windup") {
      if (actions.tickWindup(dt)) {
        actions.releaseStrike();
        this.hits += 1;
        // Chain a follow-up immediately (no fresh reaction beat) while the
        // target stays in reach, the cap allows it, and the host gate agrees.
        if (
          this.hits < this.maxHits &&
          p.hasTarget &&
          p.distance <= p.engageRange * 1.1 &&
          actions.continueCombo()
        ) {
          actions.beginWindup();
          return this.setActive();
        }
        this.phase = "done";
        return this.setCompleted();
      }
      return this.setActive();
    }
    return this.setCompleted();
  }

  terminate() {
    if (this.phase === "windup") this.owner.actions.cancelWindup();
  }
}

/**
 * Cast a ranged spell: wait out the reaction latency (facing the target), spin
 * up the charge aura as a readable tell, then loose the homing projectile. If
 * the brain abandons the goal mid-charge (e.g. to defend / on hitstun),
 * {@link FighterActions.cancelCast} unwinds it so no orphaned cast fires.
 */
class CastGoal extends Goal<FighterAgent> {
  private phase: "wait" | "charge" | "done" = "wait";
  private latency = 0;

  activate() {
    this.latency = this.owner.reactionDelay;
    this.phase = "wait";
  }

  process(dt: number) {
    const { actions } = this.owner;
    actions.face(dt);
    if (this.phase === "wait") {
      this.latency -= dt;
      if (this.latency <= 0) {
        actions.beginCast();
        this.phase = "charge";
      }
      return this.setActive();
    }
    if (this.phase === "charge") {
      if (actions.tickCast(dt)) {
        actions.releaseCast();
        this.phase = "done";
        return this.setCompleted();
      }
      return this.setActive();
    }
    return this.setCompleted();
  }

  terminate() {
    if (this.phase === "charge") this.owner.actions.cancelCast();
  }
}

/**
 * Deploy a turret: wait out the reaction latency (facing the target), spin up
 * the charge aura as a readable tell, then drop the standing hazard. Mirrors
 * {@link CastGoal} but the released entity persists and fires over time (its
 * lifecycle + faction-aware damage live host-side). {@link FighterActions.cancelDeploy}
 * unwinds an abandoned charge so no orphaned turret drops.
 */
class DeployGoal extends Goal<FighterAgent> {
  private phase: "wait" | "charge" | "done" = "wait";
  private latency = 0;

  activate() {
    this.latency = this.owner.reactionDelay;
    this.phase = "wait";
  }

  process(dt: number) {
    const { actions } = this.owner;
    actions.face(dt);
    if (this.phase === "wait") {
      this.latency -= dt;
      if (this.latency <= 0) {
        actions.beginDeploy();
        this.phase = "charge";
      }
      return this.setActive();
    }
    if (this.phase === "charge") {
      if (actions.tickDeploy(dt)) {
        actions.releaseDeploy();
        this.phase = "done";
        return this.setCompleted();
      }
      return this.setActive();
    }
    return this.setCompleted();
  }

  terminate() {
    if (this.phase === "charge") this.owner.actions.cancelDeploy();
  }
}

/**
 * Close a gap-close-band target with a committed dash, then walk in the rest of
 * the way until it's within engage range (hands off to Attack next tick).
 */
class GapCloseGoal extends Goal<FighterAgent> {
  activate() {
    this.owner.actions.gapClose();
  }

  process(dt: number) {
    const { perception: p, actions } = this.owner;
    actions.face(dt);
    if (!p.hasTarget) return this.setFailed();
    if (p.distance <= p.engageRange) return this.setCompleted();
    actions.advance(dt, 1.7);
    return this.setActive();
  }
}

/** React to a telegraph: wait the reaction beat, then commit a defensive move. */
class DefendGoal extends Goal<FighterAgent> {
  private latency = 0;

  activate() {
    this.latency = this.owner.reactionDelay;
  }

  process(dt: number) {
    const { actions } = this.owner;
    actions.face(dt);
    this.latency -= dt;
    if (this.latency <= 0) {
      actions.defend();
      return this.setCompleted();
    }
    return this.setActive();
  }
}

/**
 * Hold spacing while on cooldown / crowded / winded. Circle-strafes around the
 * target (periodically reversing) so the fighter zones instead of pure
 * backpedalling, but actively peels OUT when the target has pressed inside a
 * comfortable fighting distance — so opponents keep a "warrior's distance"
 * between exchanges instead of standing nose-to-nose trading instant death.
 */
class RepositionGoal extends Goal<FighterAgent> {
  private dir = 1;
  private t = 0;

  activate() {
    // Alternate the opening strafe direction so repeated peels don't always
    // circle the same way.
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.t = 0;
  }

  process(dt: number) {
    const { perception: p, actions } = this.owner;
    actions.face(dt);
    if (!p.hasTarget) return this.setFailed();
    this.t += dt;
    if (this.t > 1.4) {
      this.dir = -this.dir;
      this.t = 0;
    }
    if (p.distance < p.innerRange) {
      // Genuinely crowded → a firm peel straight out.
      actions.retreat(dt, 1.3);
    } else if (p.distance < p.engageRange * 0.7) {
      // Inside comfortable range → drift out WHILE circling so the fighter
      // re-opens to its preferred ~3/4-reach orbit instead of crowding in.
      actions.retreat(dt, 0.6);
      actions.strafe(dt, this.dir);
    } else {
      actions.strafe(dt, this.dir);
    }
    // Arbitration switches this out once attacking becomes the better option.
    return this.setActive();
  }
}

/**
 * A ranged-capable fighter holds poke distance: back off (with a strafe) when the
 * target has pressed inside the comfortable casting band, so it can re-open the
 * gap and keep lobbing spells instead of being dragged into melee. This is what
 * gives spells with reach their skill expression — the caster stays a moving
 * target at distance, so the player has to read spacing and lead their aim to land
 * a hit. Arbitration hands back to {@link CastGoal} once the gap is re-established
 * (or to {@link AttackGoal} if it gets cornered and decides to brawl).
 */
class KiteGoal extends Goal<FighterAgent> {
  private dir = 1;
  private t = 0;

  activate() {
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.t = 0;
  }

  process(dt: number) {
    const { perception: p, actions } = this.owner;
    actions.face(dt);
    if (!p.hasTarget) return this.setFailed();
    this.t += dt;
    if (this.t > 1.1) {
      this.dir = -this.dir;
      this.t = 0;
    }
    actions.retreat(dt, 1.2);
    actions.strafe(dt, this.dir);
    return this.setActive();
  }
}

// ── Evaluators (desirability scoring) ─────────────────────────────────────────

const GOAL_IDLE = "idle";
const GOAL_ENGAGE = "engage";
const GOAL_GAP_CLOSE = "gapClose";
const GOAL_ATTACK = "attack";
const GOAL_CAST = "cast";
const GOAL_DEPLOY = "deploy";
const GOAL_DEFEND = "defend";
const GOAL_REPOSITION = "reposition";
const GOAL_KITE = "kite";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const idleEvaluator: GoalEvaluator<FighterAgent> = {
  tag: GOAL_IDLE,
  calculateDesirability: (a) => (a.perception.hasTarget ? 0 : 0.5),
  setGoal: (brain, a) => brain.switchGoal(GOAL_IDLE, () => new IdleGoal(a)),
};

const engageEvaluator: GoalEvaluator<FighterAgent> = {
  tag: GOAL_ENGAGE,
  calculateDesirability: (a) => {
    const p = a.perception;
    if (!p.hasTarget || p.distance <= p.engageRange) return 0;
    // Inside the gap-close band a dash (GapClose) is preferred for an aggressive,
    // ready fighter; plain walk-in still wins when that goal is suppressed.
    return 0.6;
  },
  setGoal: (brain, a) => brain.switchGoal(GOAL_ENGAGE, () => new EngageGoal(a)),
};

const gapCloseEvaluator: GoalEvaluator<FighterAgent> = {
  tag: GOAL_GAP_CLOSE,
  calculateDesirability: (a) => {
    const p = a.perception;
    // Only when just out of reach but inside dash range, ready, and aggressive.
    if (!p.hasTarget || !p.attackReady) return 0;
    if (p.distance <= p.engageRange || p.distance > p.lungeRange) return 0;
    let d = 0.7;
    if (p.targetRecovering) d = 0.9; // dash in to punish a whiff from range
    d *= 0.5 + 0.5 * p.stamina01;
    return clamp01(d) * a.bias.aggression;
  },
  setGoal: (brain, a) => brain.switchGoal(GOAL_GAP_CLOSE, () => new GapCloseGoal(a)),
};

const attackEvaluator: GoalEvaluator<FighterAgent> = {
  tag: GOAL_ATTACK,
  calculateDesirability: (a) => {
    const p = a.perception;
    if (!p.hasTarget || p.distance > p.engageRange || !p.attackReady) return 0;
    // Press harder into a clean opening; hold back when the gas tank is low.
    let d = p.targetWindingUp ? 0.6 : 0.75;
    // A whiffing / recovering target is a free punish — press hard regardless.
    if (p.targetRecovering) d = 0.97;
    d *= 0.4 + 0.6 * p.stamina01;
    return clamp01(d) * a.bias.aggression;
  },
  setGoal: (brain, a) => brain.switchGoal(GOAL_ATTACK, () => new AttackGoal(a)),
};

const castEvaluator: GoalEvaluator<FighterAgent> = {
  tag: GOAL_CAST,
  calculateDesirability: (a) => {
    const p = a.perception;
    // Gated entirely by the host's spell cooldown/stamina (spellReady) + range,
    // so pacing lives in data; once ready the fighter genuinely wants to cast.
    if (!p.hasTarget || !p.spellReady || p.distance > p.spellRange) return 0;
    // Strong stand-off poke: at range (where melee Attack scores 0) this should
    // beat plain Engage so the fighter loses a spell instead of just walking in.
    let d = p.distance > p.engageRange ? 0.9 : 0.62;
    // In melee, casting fills the dead beat while the swing is on cooldown
    // (it then out-scores Reposition) but stays below a ready melee Attack.
    if (p.distance <= p.engageRange && !p.attackReady) d = 0.62;
    d *= 0.5 + 0.5 * p.stamina01;
    // The difficulty's skill-frequency bias nudges it without zeroing it out, so
    // even cautious tiers occasionally cast when the (long) cooldown comes up.
    return clamp01(d) * (0.7 + 0.6 * a.bias.skillFrequency);
  },
  setGoal: (brain, a) => brain.switchGoal(GOAL_CAST, () => new CastGoal(a)),
};

const deployEvaluator: GoalEvaluator<FighterAgent> = {
  tag: GOAL_DEPLOY,
  calculateDesirability: (a) => {
    const p = a.perception;
    // Gated by the host's long turret cooldown / stamina / one-at-a-time rule
    // (turretReady) + spell range. A stand-off zoning play: best at range, where
    // it scores below a ready spell Cast (so casting stays the default poke) but
    // above plain Engage so the fighter drops a hazard instead of just walking in.
    if (!p.hasTarget || !p.turretReady || p.distance > p.spellRange) return 0;
    let d = p.distance > p.engageRange ? 0.82 : 0.36;
    d *= 0.5 + 0.5 * p.stamina01;
    // Nudge with skill-frequency without zeroing it, so even cautious tiers
    // occasionally deploy when the (long) cooldown comes up.
    return clamp01(d) * (0.6 + 0.6 * a.bias.skillFrequency);
  },
  setGoal: (brain, a) => brain.switchGoal(GOAL_DEPLOY, () => new DeployGoal(a)),
};

const defendEvaluator: GoalEvaluator<FighterAgent> = {
  tag: GOAL_DEFEND,
  calculateDesirability: (a) => {
    const p = a.perception;
    if (!p.hasTarget || !p.canDefend || p.distance > p.engageRange * 1.3) return 0;
    let d = p.targetWindingUp ? 0.85 : 0;
    d += (1 - p.health01) * 0.2;
    return clamp01(d) * a.bias.caution;
  },
  setGoal: (brain, a) => brain.switchGoal(GOAL_DEFEND, () => new DefendGoal(a)),
};

const repositionEvaluator: GoalEvaluator<FighterAgent> = {
  tag: GOAL_REPOSITION,
  calculateDesirability: (a) => {
    const p = a.perception;
    if (!p.hasTarget || p.distance > p.engageRange) return 0;
    let d = 0;
    if (!p.attackReady) d = 0.5; // cooling down → keep spacing rather than crowd
    if (p.distance < p.innerRange * 0.9) d = Math.max(d, 0.55); // too close → peel off
    if (p.stamina01 < 0.25) d = Math.max(d, 0.5); // winded → break to recover
    return d;
  },
  setGoal: (brain, a) => brain.switchGoal(GOAL_REPOSITION, () => new RepositionGoal(a)),
};

const kiteEvaluator: GoalEvaluator<FighterAgent> = {
  tag: GOAL_KITE,
  calculateDesirability: (a) => {
    const p = a.perception;
    // Only ranged-capable fighters kite, and only once the target has closed
    // inside the comfortable casting band — out at poke range they just Cast.
    if (!p.hasTarget || !p.spellReady) return 0;
    if (p.distance > p.engageRange * 1.6) return 0;
    // Pressed into melee → open up harder than when merely a little close.
    let d = p.distance < p.engageRange ? 0.7 : 0.62;
    d *= 0.5 + 0.5 * p.stamina01;
    // Bruisers (high aggression) would rather brawl; cautious casters peel. The
    // attenuation is tuned so kite stays strictly below a *ready* melee Attack
    // across every difficulty tier (incl. the cautious easy profile, aggression
    // 0.7), so a fighter never flees a free swing — it only kites when the swing
    // is on cooldown or when its aggression is low enough to favour the spell.
    d *= 1 - 0.42 * clamp01(a.bias.aggression);
    return clamp01(d);
  },
  setGoal: (brain, a) => brain.switchGoal(GOAL_KITE, () => new KiteGoal(a)),
};

/** Build the sparring brain for `agent` with the full evaluator set installed. */
export function createFighterBrain(agent: FighterAgent): Think<FighterAgent> {
  const brain = new Think<FighterAgent>(agent);
  brain.addEvaluator(idleEvaluator);
  brain.addEvaluator(engageEvaluator);
  brain.addEvaluator(gapCloseEvaluator);
  brain.addEvaluator(attackEvaluator);
  brain.addEvaluator(castEvaluator);
  brain.addEvaluator(deployEvaluator);
  brain.addEvaluator(defendEvaluator);
  brain.addEvaluator(repositionEvaluator);
  brain.addEvaluator(kiteEvaluator);
  return brain;
}
