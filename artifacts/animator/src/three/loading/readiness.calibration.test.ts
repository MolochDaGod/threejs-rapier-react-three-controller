import { describe, expect, it, vi } from "vitest";

import {
  BOOT_SLOW_NOTICE_MS,
  BOOT_STALL_TIMEOUT_MS,
  ReadinessManifest,
} from "./readiness";

/**
 * Calibration tests for the slow-load notice timing (task: "Confirm the slow-load
 * notice appears at the right moment for real players").
 *
 * Unlike readiness.test.ts (which proves the watchdog mechanism with abstract
 * timeouts), these tests pin the *actual production constants* — BOOT_SLOW_NOTICE_MS
 * (8s) and BOOT_STALL_TIMEOUT_MS (30s) — against realistic gated-boot timelines,
 * so the chosen thresholds can't silently drift into "nags healthy loads" or "lets
 * a crawling load feel stuck" territory.
 *
 * Key fact under test: the windows are *per-step no-progress* windows that reset on
 * every forward readiness step — NOT cumulative load time. So a long-but-steadily-
 * progressing boot is safe; only a single step that crawls past 8s trips the notice.
 *
 * Network-throttling note: a live throttled run could not be observed in-repo (the
 * headless preview has no WebGL, so Studio throws in its constructor before the
 * readiness gate ever mounts). These deterministic timelines model the real boot's
 * per-step durations (download + parse / build) instead, driving the same watchdog
 * the engine uses in production.
 */
describe("slow-load notice calibration (real BOOT_* thresholds)", () => {
  // Deterministic clock so the production thresholds run with no real timers.
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

  /** Mirror the engine's gated checklist (Studio.setupReadinessGate) + weights. */
  function bootManifest() {
    const m = new ReadinessManifest();
    m.add("physics", "Initializing physics", 1);
    m.add("character", "Loading fighter", 2);
    m.add("weapon", "Equipping weapon", 1);
    m.add("arena", "Building arena", 3);
    m.add("npcs", "Deploying opponents", 2);
    m.add("shaders", "Warming up shaders", 1);
    return m;
  }

  it("sanity-checks the constants themselves (8s soft notice well under the 30s hard stall)", () => {
    expect(BOOT_SLOW_NOTICE_MS).toBe(8_000);
    expect(BOOT_STALL_TIMEOUT_MS).toBe(30_000);
    // The soft notice must always precede the hard failure with comfortable runway.
    expect(BOOT_SLOW_NOTICE_MS).toBeLessThan(BOOT_STALL_TIMEOUT_MS);
    expect(BOOT_STALL_TIMEOUT_MS - BOOT_SLOW_NOTICE_MS).toBeGreaterThanOrEqual(20_000);
  });

  it("never nags a NORMAL boot: every step resolves in low single-digit seconds", () => {
    const m = bootManifest();
    const clock = fakeClock();
    const onStall = vi.fn();
    m.startWatchdog({
      timeoutMs: BOOT_STALL_TIMEOUT_MS,
      slowMs: BOOT_SLOW_NOTICE_MS,
      onStall,
      ...clock,
    });
    // Healthy boot: each step lands a few seconds apart (every gap < 8s).
    const timeline: Array<[number, string]> = [
      [1200, "physics"],
      [1300, "character"],
      [800, "weapon"],
      [2500, "arena"],
      [900, "npcs"],
      [1500, "shaders"],
    ];
    for (const [dt, key] of timeline) {
      clock.advance(dt);
      m.markReady(key);
      expect(m.snapshot().slow).toBe(false); // notice never appears on a healthy load
    }
    expect(m.snapshot().ready).toBe(true);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("never nags a HEAVY-but-healthy boot: big arena + many NPCs, each step still < 8s", () => {
    const m = bootManifest();
    const clock = fakeClock();
    const onStall = vi.fn();
    m.startWatchdog({
      timeoutMs: BOOT_STALL_TIMEOUT_MS,
      slowMs: BOOT_SLOW_NOTICE_MS,
      onStall,
      ...clock,
    });
    // Heavy boot: worker-meshed arena + a crowd of NPCs are the slow steps, but a
    // healthy machine still finishes each comfortably under the 8s per-step window.
    const timeline: Array<[number, string]> = [
      [2000, "physics"],
      [2500, "character"],
      [1500, "weapon"],
      [7000, "arena"], // big voxel map build — heavy, still < 8s
      [6500, "npcs"], // many opponents + AI brains — heavy, still < 8s
      [3000, "shaders"],
    ];
    for (const [dt, key] of timeline) {
      clock.advance(dt);
      m.markReady(key);
      expect(m.snapshot().slow).toBe(false);
    }
    expect(m.snapshot().ready).toBe(true);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("shows the notice when ONE step genuinely crawls past 8s (slow connection), then clears on resume", () => {
    const m = bootManifest();
    const clock = fakeClock();
    const onStall = vi.fn();
    const cb = vi.fn();
    m.onChange(cb);
    m.startWatchdog({
      timeoutMs: BOOT_STALL_TIMEOUT_MS,
      slowMs: BOOT_SLOW_NOTICE_MS,
      onStall,
      ...clock,
    });
    // Physics + rig land quickly...
    clock.advance(1500);
    m.markReady("physics");
    clock.advance(1500);
    m.markReady("character");
    clock.advance(1000);
    m.markReady("weapon");
    expect(m.snapshot().slow).toBe(false);

    // ...then the arena download crawls on a slow link. Just before 8s: no notice.
    clock.advance(BOOT_SLOW_NOTICE_MS - 1);
    expect(m.snapshot().slow).toBe(false);
    // Crossing 8s of no progress surfaces the soft notice (a fresh snapshot is emitted).
    clock.advance(1);
    expect(m.snapshot().slow).toBe(true);
    expect(cb.mock.calls.at(-1)?.[0].slow).toBe(true);
    // It is still far from the hard failure — the player isn't trapped.
    expect(onStall).not.toHaveBeenCalled();

    // Progress finally resumes → the notice clears instantly.
    clock.advance(2000);
    m.markReady("arena");
    expect(m.snapshot().slow).toBe(false);

    // And the rest of the boot completes normally.
    clock.advance(1000);
    m.markReady("npcs");
    clock.advance(1000);
    m.markReady("shaders");
    expect(m.snapshot().ready).toBe(true);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("a true stall still reaches the 30s hard-failure state (notice at 8s, failure at 30s)", () => {
    const m = bootManifest();
    const clock = fakeClock();
    const onStall = vi.fn();
    m.startWatchdog({
      timeoutMs: BOOT_STALL_TIMEOUT_MS,
      slowMs: BOOT_SLOW_NOTICE_MS,
      onStall,
      ...clock,
    });
    // A loader that never resolves AND never rejects (e.g. a dead CDN).
    clock.advance(BOOT_SLOW_NOTICE_MS);
    expect(m.snapshot().slow).toBe(true); // soft notice at 8s
    expect(onStall).not.toHaveBeenCalled();

    clock.advance(BOOT_STALL_TIMEOUT_MS - BOOT_SLOW_NOTICE_MS - 1);
    expect(onStall).not.toHaveBeenCalled(); // not yet
    clock.advance(1);
    expect(onStall).toHaveBeenCalledTimes(1); // hard failure exactly at 30s
  });
});
