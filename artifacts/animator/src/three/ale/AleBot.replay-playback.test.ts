import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { AleBot } from "./AleBot";
import type { ExplorerPose } from "./replay";
import type { ExplorerCharacter } from "../ExplorerCharacter";
import type { DuelState, FighterView } from "../types";

/**
 * A.L.E.'s instant-replay PLAYBACK + RESTORATION path (the other half of the
 * trigger tests). Once a replay is armed, the host loop drives `updateReplay`,
 * which re-poses the live fighters from the recorded buffer in slow-mo and forces
 * a cinematic camera, then `finishReplay` must put the fighters back into their
 * exact live poses and restore the prior camera mode. This locks in:
 *   - updateReplay advances the playhead in slow-mo and ends at the buffer's end;
 *   - the first replay frame snapshots the live poses and forces a cinematic
 *     camera when the viewer was on the free/off view;
 *   - finishReplay restores the captured live poses + the previous camera mode;
 *   - a manual startReplay() refuses when there's no duel / < 2 buffered frames.
 *
 * All node-only (no WebGL): fighters are a lightweight {@link FakeChar} that
 * implements just capturePose/applyPose/applyPoseLerp (+ a null getMarkers),
 * cast to the ExplorerCharacter the views are typed against.
 */

/** Far enough apart that proximity never lifts excitement (kept calm). */
const APART = 6;

/** A captured pose tagged with `px` so capture/restore can be asserted. */
function makePose(px: number): ExplorerPose {
  return { px, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, bones: new Float32Array([0]) };
}

/**
 * Minimal stand-in for the Explorer rig: capturePose snapshots its mutable
 * `pose` (so recorded frames vs. the live pose can differ), and applyPose /
 * applyPoseLerp record what was last written so restoration is observable.
 */
class FakeChar {
  pose: ExplorerPose;
  captures = 0;
  lastApplied: ExplorerPose | null = null;

  constructor(px: number) {
    this.pose = makePose(px);
  }

  getMarkers(): null {
    return null;
  }

  capturePose(): ExplorerPose {
    this.captures += 1;
    return makePose(this.pose.px);
  }

  applyPose(p: ExplorerPose): void {
    this.lastApplied = p;
  }

  applyPoseLerp(a: ExplorerPose, b: ExplorerPose, alpha: number): void {
    this.lastApplied = alpha < 0.5 ? a : b;
  }
}

function makeView(side: "A" | "B", avatar: FakeChar | null): FighterView {
  const group = new THREE.Group();
  if (side === "B") group.position.x = APART;
  return {
    id: side === "A" ? 1 : 2,
    faction: side === "A" ? "ally" : "enemy",
    dead: false,
    group,
    avatar: (avatar as unknown as ExplorerCharacter) ?? null,
    health: 100,
    maxHealth: 100,
    poise: 100,
    stamina: 100,
    state: "idle",
  };
}

function fightingState(): DuelState {
  return {
    active: true,
    phase: "fighting",
    timer: 0,
    round: 1,
    weapon: "sword",
    weaponLabel: "Sword",
    scoreA: 0,
    scoreB: 0,
    lastWinner: null,
  };
}

interface Duel {
  bot: AleBot;
  views: FighterView[];
  a: FakeChar;
  b: FakeChar;
  state: DuelState;
}

/**
 * Fresh duel with real fake rigs. Auto-replay is turned off so the playback
 * tests only ever fire a replay via the manual startReplay() they call.
 */
function newDuel(recordPx = 1): Duel {
  const bot = new AleBot();
  const a = new FakeChar(recordPx);
  const b = new FakeChar(recordPx);
  const views = [makeView("A", a), makeView("B", b)];
  const state = fightingState();
  bot.onDuelStart(state);
  bot.setReplayFrequency("off");
  return { bot, views, a, b, state };
}

/** Run fighting frames so the rolling buffer fills with recorded poses. */
function warm({ bot, views, state }: Duel, frames = 20): void {
  for (let i = 0; i < frames; i++) bot.update(0.05, views, state);
}

/** Drive an in-flight replay to completion; returns the frame count it took. */
function driveToFinish(bot: AleBot, views: FighterView[], dt: number): number {
  let steps = 0;
  for (; steps < 5000 && bot.isReplaying; steps++) bot.updateReplay(dt, views);
  return steps;
}

describe("AleBot — instant-replay playback + restoration", () => {
  it("advances the playhead in slow-mo and ends at the buffer's end", () => {
    const duel = newDuel();
    warm(duel);
    const { bot, views } = duel;

    expect(bot.startReplay()).toBe(true);
    bot.setReplaySpeed(0.5);

    // First frame nudges the playhead off zero…
    bot.updateReplay(0.05, views);
    let prev = bot.snapshot().replayProgress;
    expect(prev).toBeGreaterThan(0);

    // …and progress climbs monotonically until the replay ends on its own.
    for (let i = 0; i < 5000 && bot.isReplaying; i++) {
      bot.updateReplay(0.05, views);
      if (bot.isReplaying) {
        const p = bot.snapshot().replayProgress;
        expect(p).toBeGreaterThanOrEqual(prev);
        prev = p;
      }
    }
    expect(bot.isReplaying).toBe(false);

    // Slow-mo really slows playback: half-speed needs more frames than realtime.
    const slow = newDuel();
    warm(slow);
    slow.bot.startReplay();
    slow.bot.setReplaySpeed(0.5);
    const slowFrames = driveToFinish(slow.bot, slow.views, 0.05);

    const fast = newDuel();
    warm(fast);
    fast.bot.startReplay();
    fast.bot.setReplaySpeed(1);
    const fastFrames = driveToFinish(fast.bot, fast.views, 0.05);

    expect(slowFrames).toBeGreaterThan(fastFrames);
  });

  it("captures live poses and forces a cinematic camera from the off view on the first frame", () => {
    const duel = newDuel();
    warm(duel);
    const { bot, views, a, b } = duel;

    // Viewer is on the free/off camera when the replay starts.
    bot.setCameraMode("off");
    expect(bot.startReplay()).toBe(true);

    // The live pose snapshot hasn't happened until the first replay frame runs.
    const aCapturesBefore = a.captures;
    const bCapturesBefore = b.captures;

    bot.updateReplay(0.05, views);

    // Both fighters' live poses were captured exactly once for restoration…
    expect(a.captures).toBe(aCapturesBefore + 1);
    expect(b.captures).toBe(bCapturesBefore + 1);
    // …and the off view was bumped to a cinematic (director) framing.
    const snap = bot.snapshot();
    expect(snap.replaying).toBe(true);
    expect(snap.replayCamera).toBe("director");
  });

  it("restores the captured live poses and the previous camera mode on finish", () => {
    // Start from a real cinematic mode so we can prove it's restored (an "off"
    // view would be force-bumped and become ambiguous to assert against).
    const duel = newDuel(1);
    warm(duel);
    const { bot, views, a, b } = duel;
    bot.setCameraMode("orbit");

    // The fighters' live pose at replay-start differs from every recorded frame.
    a.pose = makePose(999);
    b.pose = makePose(888);

    expect(bot.startReplay()).toBe(true);
    bot.updateReplay(0.05, views); // captures live poses; prevMode = orbit (no force)

    // A viewer cuts the camera mid-replay; it must NOT survive the replay.
    bot.setReplayCamera("povA");
    expect(bot.snapshot().replayCamera).toBe("povA");

    driveToFinish(bot, views, 0.05);
    expect(bot.isReplaying).toBe(false);

    // Fighters end on their exact captured live poses, not a frozen replay pose.
    expect(a.lastApplied?.px).toBe(999);
    expect(b.lastApplied?.px).toBe(888);

    // The previous camera mode (orbit) is restored — observable because the next
    // replay snapshots the live camera as its prevMode and (orbit != off) keeps it.
    expect(bot.startReplay()).toBe(true);
    bot.updateReplay(0.05, views);
    expect(bot.snapshot().replayCamera).toBe("orbit");
  });

  it("refuses a manual startReplay with no duel or < 2 buffered frames", () => {
    // No duel running at all.
    const cold = new AleBot();
    expect(cold.startReplay()).toBe(false);

    // Duel active but the buffer is empty.
    const duel = newDuel();
    expect(duel.bot.startReplay()).toBe(false);

    // A single recorded frame still isn't enough (need a bracketing pair).
    duel.bot.update(0.05, duel.views, duel.state);
    expect(duel.bot.startReplay()).toBe(false);

    // Two+ frames: now it arms.
    duel.bot.update(0.05, duel.views, duel.state);
    expect(duel.bot.startReplay()).toBe(true);
  });
});
