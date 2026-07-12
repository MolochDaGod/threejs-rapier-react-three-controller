import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { AleBot } from "./AleBot";
import type { DuelState, FighterView } from "../types";

/**
 * A.L.E.'s auto-replay TRIGGER logic: when a mid-round highlight (or a KO) earns
 * an instant replay. This locks in the gates the host relies on:
 *   - a KO always earns a replay, even while the post-replay cooldown is hot;
 *   - a crit / parry / big-hit only earns one when excitement clears the bar;
 *   - the post-replay cooldown blocks back-to-back mid-round replays;
 *   - flipping the autoReplay toggle off disables all auto-triggering.
 *
 * The bot derives its own DuelEvents from frame-to-frame fighter diffs, so these
 * tests drive it through update() with lightweight node-only FighterView fakes
 * (no WebGL): plain THREE.Group anchors + null avatars. A null avatar records an
 * empty replay frame, which is all the trigger logic needs (>= 2 buffered frames).
 */

/** Far enough apart that proximity contributes nothing to excitement (>= 5m). */
const APART = 6;

function makeView(side: "A" | "B", overrides: Partial<FighterView> = {}): FighterView {
  const group = new THREE.Group();
  if (side === "B") group.position.x = APART;
  return {
    id: side === "A" ? 1 : 2,
    faction: side === "A" ? "ally" : "enemy",
    dead: false,
    group,
    avatar: null,
    health: 100,
    maxHealth: 100,
    poise: 100,
    stamina: 100,
    state: "idle",
    ...overrides,
  };
}

function fightingState(round = 1): DuelState {
  return {
    active: true,
    phase: "fighting",
    timer: 0,
    round,
    weapon: "sword",
    weaponLabel: "Sword",
    scoreA: 0,
    scoreB: 0,
    lastWinner: null,
  };
}

/** Run idle fighting frames to fill the replay buffer (a replay needs >= 2). */
function warm(bot: AleBot, views: FighterView[], state: DuelState, frames = 20): void {
  for (let i = 0; i < frames; i++) bot.update(0.05, views, state);
}

/** Pump live frames (no new events) until a replay starts, or give up. */
function pumpUntilReplay(
  bot: AleBot,
  views: FighterView[],
  state: DuelState,
  max = 60,
): boolean {
  for (let i = 0; i < max && !bot.isReplaying; i++) bot.update(0.05, views, state);
  return bot.isReplaying;
}

/** Drive an in-flight replay to completion (host loop calls updateReplay). */
function finishReplay(bot: AleBot, views: FighterView[]): void {
  for (let i = 0; i < 1000 && bot.isReplaying; i++) bot.updateReplay(0.5, views);
}

function newDuel(): { bot: AleBot; views: FighterView[]; state: DuelState } {
  const bot = new AleBot();
  const views = [makeView("A"), makeView("B")];
  const state = fightingState();
  bot.onDuelStart(state);
  return { bot, views, state };
}

describe("AleBot — auto-replay triggers", () => {
  it("fires a replay on a KO", () => {
    const { bot, views, state } = newDuel();
    warm(bot, views, state);
    views[1].state = "dead";
    expect(pumpUntilReplay(bot, views, state)).toBe(true);
  });

  it("fires a replay on a crit once excitement clears the bar", () => {
    const { bot, views, state } = newDuel();
    warm(bot, views, state);
    // A big chunk of health → a CRIT event that spikes excitement to the top.
    views[1].health = 80;
    expect(pumpUntilReplay(bot, views, state)).toBe(true);
  });

  it("does NOT fire on a low-excitement big hit below the threshold", () => {
    const { bot, views, state } = newDuel();
    warm(bot, views, state);
    // A 1-point chip is a big-hit event but never lifts excitement past the gate.
    views[1].health = 99;
    expect(pumpUntilReplay(bot, views, state)).toBe(false);
  });

  it("blocks a second mid-round replay while the cooldown is hot", () => {
    const { bot, views, state } = newDuel();
    warm(bot, views, state);

    // First highlight earns a replay; play it out so the cooldown arms.
    views[1].health = 80;
    expect(pumpUntilReplay(bot, views, state)).toBe(true);
    finishReplay(bot, views);
    expect(bot.isReplaying).toBe(false);

    // Another crit immediately after — the cooldown must swallow it.
    views[1].health = 60;
    expect(pumpUntilReplay(bot, views, state)).toBe(false);
  });

  it("still fires on a KO even while the cooldown is hot", () => {
    const { bot, views, state } = newDuel();
    warm(bot, views, state);

    views[1].health = 80;
    expect(pumpUntilReplay(bot, views, state)).toBe(true);
    finishReplay(bot, views);
    expect(bot.isReplaying).toBe(false);

    // The finish overrides the cooldown — a KO always earns its replay.
    views[1].state = "dead";
    expect(pumpUntilReplay(bot, views, state)).toBe(true);
  });

  it("never auto-triggers when the autoReplay toggle is off", () => {
    const { bot, views, state } = newDuel();
    bot.setReplayFrequency("off");
    warm(bot, views, state);

    // Neither a crit nor a KO should start a replay with auto-trigger disabled.
    views[1].health = 80;
    expect(pumpUntilReplay(bot, views, state)).toBe(false);
    views[1].state = "dead";
    expect(pumpUntilReplay(bot, views, state)).toBe(false);
  });
});
