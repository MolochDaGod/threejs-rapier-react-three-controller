import * as THREE from "three";
import { meleeDuelWeapons } from "./arsenal";
import type { Targets } from "./Targets";
import { getWeapon } from "./assets";
import type { Difficulty, DuelPhase, DuelState, WeaponId } from "./types";

/**
 * The melee weapons the duel rotates through. Sourced from the arsenal's
 * `duelEligible` prefabs (all distinct blades + hafts; off-hand Shield and all
 * ranged/magic weapons excluded), so the roster stays in sync with the prefabs.
 */
const DUEL_WEAPONS: WeaponId[] = meleeDuelWeapons();

/** Reaction delay (s) given to both fighters — the human-like perceive→commit beat. */
const DUEL_REACTION = 0.35;

/** How far apart (X) the two fighters spawn at the start of a round. */
const SPAWN_X = 5;

const COUNTDOWN_TIME = 3;
const RESULT_TIME = 3.5;

/**
 * Orchestrates an AI-vs-AI Explorer duel inside the Danger Room: it drives the
 * existing {@link Targets} AI (it does not reimplement combat) by spawning two
 * opposing avatar fighters, running a countdown → fight → result loop, scoring
 * by faction survival, and rematching with the next weapon class each round.
 *
 * Fighter A is the ally (spawns left, −X); fighter B is the enemy (right, +X).
 */
export class Duel {
  private phase: DuelPhase = "idle";
  private timer = 0;
  private round = 0;
  private weaponIdx = 0;
  /** The two DIFFERENT weapons in play this round (A = left/ally, B = right/enemy). */
  private weaponA: WeaponId = DUEL_WEAPONS[0];
  private weaponB: WeaponId = DUEL_WEAPONS[1 % DUEL_WEAPONS.length];
  private scoreA = 0;
  private scoreB = 0;
  private lastWinner: "A" | "B" | null = null;
  /** AI tier the fighters run at once the countdown ends. */
  private difficulty: Difficulty = "hard";
  /** Fighters per side this match (1 = 1v1, 2 = 2v2, 3 = 3v3). */
  private teamSize = 1;

  constructor(private readonly targets: Targets) {}

  get isActive(): boolean {
    return this.phase !== "idle";
  }

  /** Set the fighters' AI tier (a duel never runs "passive" — it falls back to hard). */
  setDifficulty(d: Difficulty): void {
    this.difficulty = d === "passive" ? "hard" : d;
  }

  /** Set the per-side fighter count for the next match (clamped to 1..3). */
  setTeamSize(n: number): void {
    this.teamSize = Math.max(1, Math.min(3, Math.floor(n)));
  }

  /** Begin a fresh duel: reset the score + spawn round 1's fighters. */
  start(difficulty?: Difficulty): void {
    if (difficulty) this.setDifficulty(difficulty);
    this.scoreA = 0;
    this.scoreB = 0;
    this.round = 0;
    this.weaponIdx = 0;
    this.lastWinner = null;
    // Slain fighters stay down so a round resolves the instant one falls.
    this.targets.setAutoRespawn(false);
    this.beginRound();
  }

  /** Tear the duel down and restore normal arena behaviour (auto-respawn on). */
  stop(): void {
    this.phase = "idle";
    this.timer = 0;
    this.targets.setAutoRespawn(true);
    this.targets.clear();
  }

  private beginRound(): void {
    this.round += 1;
    this.lastWinner = null;
    // Pick two DIFFERENT melee weapons so a duel is never a mirror match. A walks
    // the roster; B is offset by a stride that's coprime-ish with the count so it
    // never lands back on A and the pairings keep changing round to round.
    const n = DUEL_WEAPONS.length;
    const a = this.weaponIdx % n;
    // offset in 1..n-1 (never 0 → never the same weapon as A).
    const offset = 1 + (this.weaponIdx % (n - 1));
    const b = (a + offset) % n;
    this.weaponA = DUEL_WEAPONS[a];
    this.weaponB = DUEL_WEAPONS[b];
    this.targets.clear();
    // Freeze both fighters during the countdown ("passive" = AI disabled).
    this.targets.setDifficulty("passive");
    const opts = { avatar: true, reactionDelay: DUEL_REACTION } as const;
    // N fighters per side (1v1 / 2v2 / 3v3). Each team shares its weapon class so
    // the A-vs-B matchup stays readable; teammates fan out along Z so they never
    // spawn on top of each other. A round still resolves on full team wipeout.
    const n2 = this.teamSize;
    for (let i = 0; i < n2; i++) {
      const z = (i - (n2 - 1) / 2) * 2.6;
      this.targets.spawnAt?.(new THREE.Vector3(-SPAWN_X, 0, z), this.weaponA, "ally", opts);
      this.targets.spawnAt?.(new THREE.Vector3(SPAWN_X, 0, z), this.weaponB, "enemy", opts);
    }
    this.phase = "countdown";
    this.timer = COUNTDOWN_TIME;
  }

  update(dt: number): void {
    if (this.phase === "idle") return;
    this.timer -= dt;

    if (this.phase === "countdown") {
      if (this.timer <= 0) {
        this.timer = 0;
        this.phase = "fighting";
        // Release the AI at the chosen tier — both fighters engage.
        this.targets.setDifficulty(this.difficulty);
      }
      return;
    }

    if (this.phase === "fighting") {
      const { ally, enemy } = this.targets.factionCounts();
      if (ally === 0 || enemy === 0) {
        this.lastWinner = ally > 0 ? "A" : enemy > 0 ? "B" : null;
        if (this.lastWinner === "A") this.scoreA += 1;
        else if (this.lastWinner === "B") this.scoreB += 1;
        this.phase = "result";
        this.timer = RESULT_TIME;
        // Freeze the survivor while the result is shown.
        this.targets.setDifficulty("passive");
      }
      return;
    }

    // result → rematch with the next weapon class
    if (this.timer <= 0) {
      this.weaponIdx += 1;
      this.beginRound();
    }
  }

  state(): DuelState {
    const labelA = getWeapon(this.weaponA).label;
    const labelB = getWeapon(this.weaponB).label;
    return {
      active: this.phase !== "idle",
      phase: this.phase,
      timer: Math.max(0, Math.ceil(this.timer)),
      round: this.round,
      teamSize: this.teamSize,
      // `weapon` keeps the fighter-A id for any single-weapon HUD readout; the
      // label spells out the actual A-vs-B matchup.
      weapon: this.weaponA,
      weaponLabel: `${labelA} vs ${labelB}`,
      scoreA: this.scoreA,
      scoreB: this.scoreB,
      lastWinner: this.lastWinner,
    };
  }
}
