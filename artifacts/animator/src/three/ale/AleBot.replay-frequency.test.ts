import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { AleBot } from "./AleBot";
import type { DuelState, FighterView, ReplayFrequency } from "../types";
import type { CombatStateName } from "@workspace/epicfight";

/**
 * Replay-frequency pacing (REPLAY_PROFILES in AleBot). The viewer-chosen
 * frequency maps to (a) whether a KO auto-triggers a replay, (b) the excitement
 * a mid-round highlight must reach to earn one, and (c) the anti-spam cooldown
 * after a replay ends. These tests drive the public AleBot.update() pipeline with
 * synthetic fighter reads to lock that pacing in:
 *
 *  - "off" must never arm an auto-replay (KO or highlight),
 *  - "ko" replays the finish but never a mid-round highlight,
 *  - higher-frequency levels fire highlights at lower excitement and recover with
 *    shorter cooldowns,
 *  - the chosen frequency survives onDuelStart / onDuelStop.
 *
 * Fighters are placed far apart so the director's proximity floor is 0 and the
 * only excitement comes from the events we inject. Avatars are null (no WebGL):
 * the replay buffer still records frames, which is all startReplay() needs.
 */

const MAX_HP = 100;
/** A short frame; used to lay down baseline replay frames before a trigger. */
const FRAME = 0.016;
/**
 * A long step on the triggering frame: longer than both auto-replay delays
 * (0.7 KO / 0.6 highlight) so the armed replay fires within that single update.
 */
const FIRE_DT = 0.8;

/** A duel fighter read. Positions default far apart (proximity floor → 0). */
function view(
  id: number,
  faction: FighterView["faction"],
  health: number,
  state: CombatStateName,
  z: number,
): FighterView {
  const group = new THREE.Group();
  group.position.set(0, 0, z);
  return {
    id,
    faction,
    dead: state === "dead",
    group,
    avatar: null,
    health,
    maxHealth: MAX_HP,
    poise: 1,
    stamina: 1,
    state,
  };
}

function duelState(phase: DuelState["phase"], round = 1): DuelState {
  return {
    active: true,
    phase,
    timer: 0,
    round,
    weapon: "sword",
    weaponLabel: "Sword",
    scoreA: 0,
    scoreB: 0,
    lastWinner: null,
  };
}

/**
 * A running duel harness around an AleBot: tracks each fighter's health/state and
 * exposes high-level pokes (idle frame, deal damage, KO) that translate into the
 * FighterView reads AleBot.update() consumes.
 */
function harness(freq: ReplayFrequency) {
  const bot = new AleBot();
  const state = duelState("fighting");
  bot.onDuelStart(state);
  bot.setReplayFrequency(freq);

  // A is the ally (left, far) and B the enemy (right) — kept far apart.
  const hp = { A: MAX_HP, B: MAX_HP };
  const st: Record<"A" | "B", CombatStateName> = { A: "idle", B: "idle" };

  const views = (): FighterView[] => [
    view(1, "ally", hp.A, st.A, 0),
    view(2, "enemy", hp.B, st.B, 12),
  ];

  return {
    bot,
    /** Advance a quiet frame (records a replay frame, no events). */
    idle(dt = FRAME) {
      bot.update(dt, views(), state);
    },
    /** Drop B's health by `dmg` (a crit if ≥18% max, else a big hit). */
    hitB(dmg: number, dt = FIRE_DT) {
      hp.B = Math.max(0, hp.B - dmg);
      bot.update(dt, views(), state);
    },
    /** KO B (state → dead, health → 0). */
    koB(dt = FIRE_DT) {
      hp.B = 0;
      st.B = "dead";
      bot.update(dt, views(), state);
    },
  };
}

describe("AleBot replay frequency — off", () => {
  it("never arms a replay on a KO", () => {
    const h = harness("off");
    h.idle();
    h.koB();
    expect(h.bot.isReplaying).toBe(false);
  });

  it("never arms a replay on a high-excitement mid-round highlight", () => {
    const h = harness("off");
    h.idle();
    h.hitB(40); // big crit → excitement maxes out
    expect(h.bot.isReplaying).toBe(false);
  });
});

describe("AleBot replay frequency — ko", () => {
  it("replays a finishing KO", () => {
    const h = harness("ko");
    h.idle();
    h.koB();
    expect(h.bot.isReplaying).toBe(true);
  });

  it("does NOT replay a high-excitement mid-round highlight", () => {
    const h = harness("ko");
    h.idle();
    h.hitB(40); // crit maxes excitement, but ko-only never fires on a highlight
    expect(h.bot.isReplaying).toBe(false);
  });
});

describe("AleBot replay frequency — highlight excitement bar", () => {
  // A small big-hit (dmg 1.7) lands excitement at ~0.705: above "frequent"
  // (0.6) but below "highlights" (0.8) and "rare" (0.92).
  const MID_DMG = 1.7;

  it("frequent fires a highlight at a lower excitement than highlights/rare accept", () => {
    const h = harness("frequent");
    h.idle();
    h.hitB(MID_DMG);
    expect(h.bot.isReplaying).toBe(true);
  });

  it.each<ReplayFrequency>(["highlights", "rare"])(
    "%s does NOT fire a highlight at that lower excitement",
    (freq) => {
      const h = harness(freq);
      h.idle();
      h.hitB(MID_DMG);
      expect(h.bot.isReplaying).toBe(false);
    },
  );

  it("highlights fires once excitement clears its higher bar", () => {
    const h = harness("highlights");
    h.idle();
    h.hitB(40); // crit → excitement maxes, clearing 0.8
    expect(h.bot.isReplaying).toBe(true);
  });
});

describe("AleBot replay frequency — post-replay cooldown", () => {
  /**
   * Fire a highlight replay (a crit, which maxes excitement and clears every
   * frequency's bar), then end it so a post-replay cooldown is in effect. A crit
   * keeps B alive so the follow-up crit in each test still deals damage.
   */
  function primeCooldown(freq: ReplayFrequency) {
    const h = harness(freq);
    h.idle();
    h.hitB(20); // crit → fires the first replay (cooldown starts at 0)
    expect(h.bot.isReplaying).toBe(true);
    h.bot.stopReplay();
    expect(h.bot.isReplaying).toBe(false);
    return h;
  }

  // After a replay ends, a fresh crit (excitement maxed) tries to fire again.
  // The same 5s gap clears "frequent"'s 4s cooldown but not "rare"'s 14s one.
  const GAP = 5;

  it("frequent's short cooldown lets a new highlight fire after the gap", () => {
    const h = primeCooldown("frequent");
    h.idle();
    h.hitB(40, GAP);
    expect(h.bot.isReplaying).toBe(true);
  });

  it("rare's long cooldown still suppresses a new highlight after the same gap", () => {
    const h = primeCooldown("rare");
    h.idle();
    h.hitB(40, GAP);
    expect(h.bot.isReplaying).toBe(false);
  });

  it("rare's highlight does fire once its full cooldown elapses", () => {
    const h = primeCooldown("rare");
    h.idle();
    h.hitB(40, 15); // past rare's 14s cooldown
    expect(h.bot.isReplaying).toBe(true);
  });
});

describe("AleBot replay frequency — persistence across duel lifecycle", () => {
  it("defaults to 'highlights' before any choice", () => {
    const bot = new AleBot();
    expect(bot.snapshot().replayFrequency).toBe("highlights");
  });

  it.each<ReplayFrequency>(["off", "ko", "rare", "highlights", "frequent"])(
    "keeps '%s' across onDuelStart and onDuelStop",
    (freq) => {
      const bot = new AleBot();
      bot.setReplayFrequency(freq);
      bot.onDuelStart(duelState("countdown"));
      expect(bot.snapshot().replayFrequency).toBe(freq);
      bot.onDuelStop();
      expect(bot.snapshot().replayFrequency).toBe(freq);
    },
  );
});
