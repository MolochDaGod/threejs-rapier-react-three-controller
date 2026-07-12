import { describe, expect, it, vi } from "vitest";

import { BootGate, type BootGateItems, type BootGateOptions } from "./bootGate";
import { BOOT_SLOW_NOTICE_MS, BOOT_STALL_TIMEOUT_MS } from "./readiness";

/**
 * End-to-end coverage for the gated play/danger boot wiring — the glue that the
 * engine (`Studio`) uses to drive the loading screen.
 *
 * `Studio` itself can't be constructed headlessly (its constructor builds a
 * `WebGLRenderer`, which throws with no GL context), so the readiness-gate
 * plumbing was extracted into the WebGL-free `BootGate`. These tests drive that
 * gate exactly the way `Studio.setupReadinessGate` wires it — same checklist,
 * same production BOOT_* windows, same callbacks — with a deterministic clock,
 * and assert the four boot outcomes the player actually experiences:
 *
 *   1. a healthy stepwise boot never flips `slow` and opens the gate exactly once
 *   2. an 8s-stalled step surfaces the slow notice (without failing)
 *   3. resumed progress clears the notice
 *   4. a 30s stall reaches the hard-failure state (pending items marked failed)
 *
 * This is the coverage that would catch a regression from reordering/adding boot
 * steps or rewiring the gate — none of which the per-module unit tests see.
 */
describe("BootGate boot wiring", () => {
  /** Deterministic clock so the real BOOT_* thresholds run with no wall-clock waiting. */
  function fakeClock() {
    let now = 0;
    let seq = 0;
    const timers = new Map<number, { fireAt: number; fn: () => void }>();
    return {
      setTimer: (fn: () => void, ms: number) => {
        const id = ++seq;
        timers.set(id, { fireAt: now + ms, fn });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (h: ReturnType<typeof setTimeout>) => {
        timers.delete(h as unknown as number);
      },
      advance: (ms: number) => {
        now += ms;
        for (const [id, t] of [...timers]) {
          if (t.fireAt <= now) {
            timers.delete(id);
            t.fn();
          }
        }
      },
    };
  }

  /**
   * Build a BootGate harness wired the way `Studio` wires it: `onReadiness`
   * mirrors snapshots out (the React `setLoading`), `onAssetsReady` flips a
   * `ready` flag (Studio's pre-warm + gate-open), and `isReady`/`isDisposed`
   * read host flags. Returns the gate + the captured state for assertions.
   */
  function harness(
    items: BootGateItems,
    overrides: Partial<BootGateOptions> = {},
  ) {
    const clock = fakeClock();
    const snapshots: ReturnType<BootGate["snapshot"]>[] = [];
    const state = { ready: false, disposed: false, assetsReadyCalls: 0 };
    const gate = new BootGate(items, {
      onReadiness: (s) => snapshots.push(s),
      onAssetsReady: () => {
        // Mirror Studio.prewarmAndOpen: mark the shader pre-warm done then open.
        state.assetsReadyCalls++;
        gate.markReady("shaders");
        state.ready = true;
        gate.stopWatchdog();
      },
      isReady: () => state.ready,
      isDisposed: () => state.disposed,
      timers: { setTimer: clock.setTimer, clearTimer: clock.clearTimer },
      ...overrides,
    });
    return { gate, clock, snapshots, state };
  }

  const FULL_ARENA: BootGateItems = { hasArena: true, npcCount: 3 };

  it("registers the gated checklist (Studio.setupReadinessGate parity)", () => {
    const { gate } = harness(FULL_ARENA);
    expect(gate.snapshot().items.map((i) => i.key)).toEqual([
      "physics",
      "character",
      "requiredClips",
      "weapon",
      "doors",
      "arena",
      "npcs",
      "shaders",
    ]);
  });

  it("omits the arena + npcs items for a plain (no-arena) play session", () => {
    const { gate } = harness({ hasArena: false, npcCount: 0 });
    expect(gate.snapshot().items.map((i) => i.key)).toEqual([
      "physics",
      "character",
      "requiredClips",
      "weapon",
      "doors",
      "shaders",
    ]);
  });

  it("omits only the npcs item for an empty arena (no authored opponents)", () => {
    const { gate } = harness({ hasArena: true, npcCount: 0 });
    expect(gate.snapshot().items.map((i) => i.key)).toEqual([
      "physics",
      "character",
      "requiredClips",
      "weapon",
      "doors",
      "arena",
      "shaders",
    ]);
  });

  it("a healthy stepwise boot never flips `slow` and opens the gate exactly once", () => {
    const { gate, clock, snapshots, state } = harness(FULL_ARENA);
    const timeline: Array<[number, string]> = [
      [400, "doors"],
      [1200, "physics"],
      [1300, "character"],
      [200, "requiredClips"],
      [800, "weapon"],
      [2500, "arena"],
      [900, "npcs"],
    ];
    for (const [dt, key] of timeline) {
      clock.advance(dt);
      gate.markReady(key);
      expect(gate.snapshot().slow).toBe(false);
    }
    // All assets in → the gate pre-warmed + opened (shaders marked ready, ready true).
    expect(state.assetsReadyCalls).toBe(1);
    expect(state.ready).toBe(true);
    const last = snapshots.at(-1)!;
    expect(last.ready).toBe(true);
    expect(last.failed).toBe(false);
    expect(last.slow).toBe(false);
    // No snapshot along the way ever surfaced the slow notice or a failure.
    expect(snapshots.some((s) => s.slow)).toBe(false);
    expect(snapshots.some((s) => s.failed)).toBe(false);
  });

  it("surfaces the slow notice when one step crawls past 8s, then clears on resume", () => {
    const { gate, clock, snapshots, state } = harness(FULL_ARENA);
    gate.markReady("doors");
    clock.advance(1500);
    gate.markReady("physics");
    clock.advance(1500);
    gate.markReady("character");
    gate.markReady("requiredClips");
    clock.advance(1000);
    gate.markReady("weapon");
    expect(gate.snapshot().slow).toBe(false);

    // Arena download crawls. Just before 8s of no progress: still no notice.
    clock.advance(BOOT_SLOW_NOTICE_MS - 1);
    expect(gate.snapshot().slow).toBe(false);
    // Crossing 8s surfaces the soft notice via a fresh forwarded snapshot...
    clock.advance(1);
    expect(gate.snapshot().slow).toBe(true);
    expect(snapshots.at(-1)?.slow).toBe(true);
    // ...without failing or opening the gate (the player isn't trapped or dumped in).
    expect(snapshots.some((s) => s.failed)).toBe(false);
    expect(state.assetsReadyCalls).toBe(0);

    // Progress resumes → the notice clears instantly.
    clock.advance(2000);
    gate.markReady("arena");
    expect(gate.snapshot().slow).toBe(false);
    clock.advance(1000);
    gate.markReady("npcs");
    // Boot completes cleanly after the recovery.
    expect(state.ready).toBe(true);
    expect(snapshots.at(-1)?.ready).toBe(true);
  });

  it("a 30s hard stall fails the still-pending items (loading screen → error state)", () => {
    const { gate, clock, snapshots, state } = harness(FULL_ARENA);
    // Physics lands, then the rig load dies silently (never resolves nor rejects).
    clock.advance(2000);
    gate.markReady("physics");

    // Soft notice at 8s of no further progress.
    clock.advance(BOOT_SLOW_NOTICE_MS);
    expect(gate.snapshot().slow).toBe(true);
    expect(gate.snapshot().failed).toBe(false);

    // Hard failure exactly at the 30s window (measured from the last forward step).
    clock.advance(BOOT_STALL_TIMEOUT_MS - BOOT_SLOW_NOTICE_MS - 1);
    expect(gate.snapshot().failed).toBe(false);
    clock.advance(1);

    const snap = gate.snapshot();
    expect(snap.failed).toBe(true);
    // Every still-pending item is failed with a timed-out message; physics stays ready.
    expect(snap.items.find((i) => i.key === "physics")?.state).toBe("ready");
    for (const key of [
      "character",
      "requiredClips",
      "weapon",
      "doors",
      "arena",
      "npcs",
      "shaders",
    ]) {
      const item = snap.items.find((i) => i.key === key)!;
      expect(item.state).toBe("failed");
      expect(item.error).toContain("timed out");
    }
    // The failure was forwarded to the loading screen; the gate never opened.
    expect(snapshots.at(-1)?.failed).toBe(true);
    expect(state.assetsReadyCalls).toBe(0);
  });

  it("uses the production BOOT_* windows by default (no override needed)", () => {
    // Drive a gate WITHOUT passing stallMs/slowMs to prove the defaults are wired.
    const clock = fakeClock();
    const onStallSnap: boolean[] = [];
    const state = { ready: false, disposed: false };
    const gate = new BootGate(
      { hasArena: false, npcCount: 0 },
      {
        onReadiness: (s) => onStallSnap.push(s.slow),
        onAssetsReady: () => {
          state.ready = true;
        },
        isReady: () => state.ready,
        isDisposed: () => state.disposed,
        timers: { setTimer: clock.setTimer, clearTimer: clock.clearTimer },
      },
    );
    clock.advance(BOOT_SLOW_NOTICE_MS - 1);
    expect(gate.snapshot().slow).toBe(false);
    clock.advance(1);
    expect(gate.snapshot().slow).toBe(true); // default slow window = BOOT_SLOW_NOTICE_MS
    clock.advance(BOOT_STALL_TIMEOUT_MS - BOOT_SLOW_NOTICE_MS);
    expect(gate.snapshot().failed).toBe(true); // default stall window = BOOT_STALL_TIMEOUT_MS
  });

  it("suppresses late marks + stall handling once disposed", () => {
    const { gate, clock, state } = harness(FULL_ARENA);
    state.disposed = true;
    gate.markReady("physics");
    // Disposed: the mark is ignored, so physics stays pending.
    expect(gate.snapshot().items.find((i) => i.key === "physics")?.state).toBe("pending");
    // And a stall can't fail items on a torn-down session.
    clock.advance(BOOT_STALL_TIMEOUT_MS + 1);
    expect(gate.snapshot().failed).toBe(false);
  });

  it("ignores a stall handler firing after the gate already opened", () => {
    // Guards the failPending `isReady` early-return: a queued onStall must no-op
    // if the boot already succeeded.
    const { gate, clock, state } = harness({ hasArena: false, npcCount: 0 });
    gate.markReady("doors");
    clock.advance(500);
    gate.markReady("physics");
    clock.advance(500);
    gate.markReady("character");
    gate.markReady("requiredClips");
    clock.advance(500);
    gate.markReady("weapon");
    expect(state.ready).toBe(true);
    // Long after opening, no stray failure can appear.
    clock.advance(BOOT_STALL_TIMEOUT_MS + 1);
    expect(gate.snapshot().failed).toBe(false);
    expect(gate.snapshot().ready).toBe(true);
  });

  it("holds the gate closed until the door portal is confirmed placed", () => {
    // Doors is a first-class required item: with every other asset in, an
    // unconfirmed door placement must keep the session from opening.
    const { gate, state } = harness({ hasArena: false, npcCount: 0 });
    gate.markReady("physics");
    gate.markReady("character");
    gate.markReady("requiredClips");
    gate.markReady("weapon");
    expect(state.assetsReadyCalls).toBe(0);
    expect(state.ready).toBe(false);
    gate.markReady("doors");
    expect(state.assetsReadyCalls).toBe(1);
    expect(state.ready).toBe(true);
  });

  it("holds the gate closed until the required animation clips are confirmed", () => {
    // requiredClips is a first-class required item: a fighter whose clip
    // library never bound must not open the session (frozen T-pose guard).
    const { gate, state } = harness({ hasArena: false, npcCount: 0 });
    gate.markReady("doors");
    gate.markReady("physics");
    gate.markReady("character");
    gate.markReady("weapon");
    expect(state.assetsReadyCalls).toBe(0);
    expect(state.ready).toBe(false);
    gate.markReady("requiredClips");
    expect(state.assetsReadyCalls).toBe(1);
    expect(state.ready).toBe(true);
  });

  it("a failed doors / requiredClips item surfaces failure instead of opening", () => {
    const { gate, state, snapshots } = harness({ hasArena: false, npcCount: 0 });
    gate.markReady("physics");
    gate.markReady("character");
    gate.markReady("weapon");
    gate.markReady("doors");
    gate.markFailed("requiredClips", "Required animation clips failed to load.");
    expect(state.assetsReadyCalls).toBe(0);
    expect(state.ready).toBe(false);
    const snap = gate.snapshot();
    expect(snap.failed).toBe(true);
    expect(snap.items.find((i) => i.key === "requiredClips")?.state).toBe("failed");
    // The failure reached the loading screen (error/recovery state, not a hang).
    expect(snapshots.at(-1)?.failed).toBe(true);
  });

  it("fires onAssetsReady exactly once even as later snapshots arrive", () => {
    const onAssetsReady = vi.fn();
    const clock = fakeClock();
    const state = { ready: false, disposed: false };
    const gate = new BootGate(
      { hasArena: false, npcCount: 0 },
      {
        onReadiness: () => {},
        onAssetsReady: () => {
          onAssetsReady();
          state.ready = true;
          gate.markReady("shaders");
        },
        isReady: () => state.ready,
        isDisposed: () => state.disposed,
        timers: { setTimer: clock.setTimer, clearTimer: clock.clearTimer },
      },
    );
    gate.markReady("physics");
    gate.markReady("character");
    gate.markReady("requiredClips");
    gate.markReady("weapon");
    gate.markReady("doors"); // all assets in → trigger
    expect(onAssetsReady).toHaveBeenCalledTimes(1);
    // Re-marking a ready item emits more snapshots but must not re-fire the trigger.
    gate.markReady("physics");
    expect(onAssetsReady).toHaveBeenCalledTimes(1);
  });
});
