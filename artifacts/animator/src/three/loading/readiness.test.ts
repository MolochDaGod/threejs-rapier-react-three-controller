import { describe, expect, it, vi } from "vitest";
import { ReadinessManifest } from "./readiness";

describe("ReadinessManifest", () => {
  it("starts not-ready with progress 0 while items are pending", () => {
    const m = new ReadinessManifest();
    m.add("a", "Load A").add("b", "Load B");
    const s = m.snapshot();
    expect(s.ready).toBe(false);
    expect(s.failed).toBe(false);
    expect(s.progress).toBe(0);
    expect(s.current).toBe("Load A");
    expect(s.error).toBeNull();
  });

  it("reports the first pending item as `current` in registration order", () => {
    const m = new ReadinessManifest();
    m.add("a", "Load A").add("b", "Load B").add("c", "Load C");
    m.markReady("a");
    expect(m.snapshot().current).toBe("Load B");
    m.markReady("b");
    expect(m.snapshot().current).toBe("Load C");
  });

  it("becomes ready with progress 1 once every item is ready", () => {
    const m = new ReadinessManifest();
    m.add("a", "Load A").add("b", "Load B");
    m.markReady("a");
    expect(m.snapshot().ready).toBe(false);
    expect(m.snapshot().progress).toBe(0.5);
    m.markReady("b");
    const s = m.snapshot();
    expect(s.ready).toBe(true);
    expect(s.progress).toBe(1);
    expect(s.current).toBeNull();
  });

  it("weights progress by item weight, not item count", () => {
    const m = new ReadinessManifest();
    m.add("light", "Light", 1).add("heavy", "Heavy", 3);
    m.markReady("light");
    expect(m.snapshot().progress).toBe(0.25);
    m.markReady("heavy");
    expect(m.snapshot().progress).toBe(1);
  });

  it("surfaces the first failure and counts it toward progress (bar never hangs)", () => {
    const m = new ReadinessManifest();
    m.add("a", "Load A").add("b", "Load B");
    m.markFailed("a", "boom");
    const s = m.snapshot();
    expect(s.failed).toBe(true);
    expect(s.error).toBe("boom");
    expect(s.ready).toBe(false);
    // Failed weight counts as "done" so the progress bar advances on failure.
    expect(s.progress).toBe(0.5);
  });

  it("a failed item keeps the manifest from ever being ready", () => {
    const m = new ReadinessManifest();
    m.add("a", "Load A").add("b", "Load B");
    m.markReady("b");
    m.markFailed("a", "nope");
    expect(m.snapshot().ready).toBe(false);
  });

  it("allReadyExcept gates pre-warm: true only when non-excluded items are all ready", () => {
    const m = new ReadinessManifest();
    m.add("character", "Char").add("arena", "Arena").add("shaders", "Shaders");
    expect(m.allReadyExcept("shaders")).toBe(false);
    m.markReady("character");
    expect(m.allReadyExcept("shaders")).toBe(false);
    m.markReady("arena");
    // Everything but the excluded "shaders" is ready → pre-warm may run.
    expect(m.allReadyExcept("shaders")).toBe(true);
    expect(m.snapshot().ready).toBe(false);
    m.markReady("shaders");
    expect(m.snapshot().ready).toBe(true);
  });

  it("notifies the listener on every state change", () => {
    const m = new ReadinessManifest();
    m.add("a", "Load A");
    const cb = vi.fn();
    m.onChange(cb);
    m.markReady("a");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].ready).toBe(true);
  });

  it("is idempotent: re-marking a ready item does not re-notify", () => {
    const m = new ReadinessManifest();
    m.add("a", "Load A");
    const cb = vi.fn();
    m.onChange(cb);
    m.markReady("a");
    m.markReady("a");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("ignores marks against unregistered keys (e.g. an absent NPC item)", () => {
    const m = new ReadinessManifest();
    m.add("a", "Load A");
    const cb = vi.fn();
    m.onChange(cb);
    m.markReady("npcs"); // never registered (map had no NPCs)
    expect(cb).not.toHaveBeenCalled();
    expect(m.has("npcs")).toBe(false);
  });

  describe("stall watchdog", () => {
    // A tiny controllable clock so the tests are deterministic (no real timers).
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
        pending: () => timers.size,
      };
    }

    it("fires onStall when no progress is made for the timeout window", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A").add("b", "Load B");
      const clock = fakeClock();
      const onStall = vi.fn();
      m.startWatchdog({ timeoutMs: 1000, onStall, ...clock });
      clock.advance(999);
      expect(onStall).not.toHaveBeenCalled();
      clock.advance(1);
      expect(onStall).toHaveBeenCalledTimes(1);
    });

    it("resets the timer whenever progress advances (slow-but-healthy loads survive)", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A").add("b", "Load B").add("c", "Load C");
      const clock = fakeClock();
      const onStall = vi.fn();
      m.startWatchdog({ timeoutMs: 1000, onStall, ...clock });
      // Each step lands just before the window expires — total boot far exceeds it.
      clock.advance(900);
      m.markReady("a");
      clock.advance(900);
      m.markReady("b");
      clock.advance(900);
      m.markReady("c");
      clock.advance(900);
      // Despite 3600ms total, no single step ever stalled for 1000ms.
      expect(onStall).not.toHaveBeenCalled();
    });

    it("stops once the load is ready so onStall can never fire late", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A");
      const clock = fakeClock();
      const onStall = vi.fn();
      m.startWatchdog({ timeoutMs: 1000, onStall, ...clock });
      m.markReady("a"); // ready → watchdog auto-stops
      expect(clock.pending()).toBe(0);
      clock.advance(5000);
      expect(onStall).not.toHaveBeenCalled();
    });

    it("stops on a hard failure (the failure path already drives the recovery UI)", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A").add("b", "Load B");
      const clock = fakeClock();
      const onStall = vi.fn();
      m.startWatchdog({ timeoutMs: 1000, onStall, ...clock });
      m.markFailed("a", "boom");
      expect(clock.pending()).toBe(0);
      clock.advance(5000);
      expect(onStall).not.toHaveBeenCalled();
    });

    it("stopWatchdog cancels a pending timer and is idempotent", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A");
      const clock = fakeClock();
      const onStall = vi.fn();
      m.startWatchdog({ timeoutMs: 1000, onStall, ...clock });
      m.stopWatchdog();
      m.stopWatchdog();
      clock.advance(5000);
      expect(onStall).not.toHaveBeenCalled();
      expect(clock.pending()).toBe(0);
    });
  });

  describe("soft slow-notice", () => {
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
        pending: () => timers.size,
      };
    }

    it("flips `slow` true and emits after the slow window, before the stall fires", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A").add("b", "Load B");
      const clock = fakeClock();
      const onStall = vi.fn();
      const cb = vi.fn();
      m.onChange(cb);
      m.startWatchdog({ timeoutMs: 1000, slowMs: 200, onStall, ...clock });
      expect(m.snapshot().slow).toBe(false);
      clock.advance(199);
      expect(m.snapshot().slow).toBe(false);
      clock.advance(1);
      // Soft notice fired, emitted a snapshot, but the load has NOT failed/stalled.
      expect(m.snapshot().slow).toBe(true);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].slow).toBe(true);
      expect(cb.mock.calls[0][0].failed).toBe(false);
      expect(onStall).not.toHaveBeenCalled();
    });

    it("clears `slow` when progress resumes (emitted snapshot reflects it)", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A").add("b", "Load B");
      const clock = fakeClock();
      const onStall = vi.fn();
      const cb = vi.fn();
      m.onChange(cb);
      m.startWatchdog({ timeoutMs: 1000, slowMs: 200, onStall, ...clock });
      clock.advance(200);
      expect(m.snapshot().slow).toBe(true);
      m.markReady("a"); // forward progress
      expect(m.snapshot().slow).toBe(false);
      // The progress-emit snapshot already carries the cleared flag.
      const last = cb.mock.calls[cb.mock.calls.length - 1][0];
      expect(last.slow).toBe(false);
    });

    it("re-arms the slow notice after a recovery so a later stall still flags it", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A").add("b", "Load B");
      const clock = fakeClock();
      const onStall = vi.fn();
      m.startWatchdog({ timeoutMs: 1000, slowMs: 200, onStall, ...clock });
      clock.advance(200);
      expect(m.snapshot().slow).toBe(true);
      m.markReady("a");
      expect(m.snapshot().slow).toBe(false);
      clock.advance(200);
      expect(m.snapshot().slow).toBe(true);
    });

    it("a slow-but-healthy load that keeps progressing never flags slow", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A").add("b", "Load B").add("c", "Load C");
      const clock = fakeClock();
      const onStall = vi.fn();
      m.startWatchdog({ timeoutMs: 1000, slowMs: 200, onStall, ...clock });
      clock.advance(150);
      m.markReady("a");
      clock.advance(150);
      m.markReady("b");
      clock.advance(150);
      m.markReady("c");
      expect(m.snapshot().slow).toBe(false);
      expect(onStall).not.toHaveBeenCalled();
    });

    it("stops the slow timer once the load is ready", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A");
      const clock = fakeClock();
      const onStall = vi.fn();
      m.startWatchdog({ timeoutMs: 1000, slowMs: 200, onStall, ...clock });
      m.markReady("a");
      expect(clock.pending()).toBe(0);
      clock.advance(5000);
      expect(m.snapshot().slow).toBe(false);
    });

    it("arms no slow timer when slowMs is omitted (back-compat)", () => {
      const m = new ReadinessManifest();
      m.add("a", "Load A");
      const clock = fakeClock();
      const onStall = vi.fn();
      m.startWatchdog({ timeoutMs: 1000, onStall, ...clock });
      // Only the stall timer should be armed.
      expect(clock.pending()).toBe(1);
      clock.advance(999);
      expect(m.snapshot().slow).toBe(false);
    });
  });
});
