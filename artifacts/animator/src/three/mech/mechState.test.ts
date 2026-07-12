import { describe, it, expect } from "vitest";
import {
  MechStateMachine,
  DEFAULT_MECH_TIMINGS,
  ENCLOSE_THRESHOLD,
  type MechPhase,
} from "./mechState";

const T = DEFAULT_MECH_TIMINGS;

/** Advance a machine by `seconds` in small steps so derived flags stay sampled. */
function step(m: MechStateMachine, seconds: number, dt = 1 / 60): void {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const s = Math.min(dt, remaining);
    m.update(s);
    remaining -= s;
  }
}

describe("MechStateMachine", () => {
  it("starts idle with the pilot visible and no mech", () => {
    const m = new MechStateMachine();
    const s = m.snapshot;
    expect(s.phase).toBe("idle");
    expect(s.pilotVisible).toBe(true);
    expect(s.mechVisible).toBe(false);
    expect(s.mechControlled).toBe(false);
    expect(s.enclosed).toBe(false);
    expect(s.closure).toBe(0);
    expect(m.isActive).toBe(false);
  });

  it("enter() only works from idle and starts the opening phase", () => {
    const m = new MechStateMachine();
    expect(m.enter()).toBe(true);
    expect(m.current).toBe("opening");
    expect(m.snapshot.mechVisible).toBe(true);
    // Already transitioning: a second enter is a no-op.
    expect(m.enter()).toBe(false);
    expect(m.current).toBe("opening");
  });

  it("progresses idle → opening → enclosing → piloted in order over time", () => {
    const m = new MechStateMachine();
    m.enter();
    const seen: MechPhase[] = [m.current];
    const total = T.opening + T.enclosing + 0.001;
    let elapsed = 0;
    const dt = 1 / 120;
    while (elapsed < total) {
      m.update(dt);
      elapsed += dt;
      if (seen[seen.length - 1] !== m.current) seen.push(m.current);
    }
    expect(seen).toEqual(["opening", "enclosing", "piloted"]);
    expect(m.isPiloted).toBe(true);
  });

  it("hides the pilot only once sealed inside during enclosing", () => {
    const m = new MechStateMachine();
    m.enter();
    // End of opening: closure ~0.5, pilot still visible (below threshold).
    step(m, T.opening);
    expect(m.current).toBe("enclosing");
    expect(m.snapshot.pilotVisible).toBe(true);
    // Near the end of enclosing the armour seals and the pilot is hidden.
    step(m, T.enclosing - 1e-3);
    const s = m.snapshot;
    expect(s.closure).toBeGreaterThanOrEqual(ENCLOSE_THRESHOLD);
    expect(s.enclosed).toBe(true);
    expect(s.pilotVisible).toBe(false);
  });

  it("is fully piloted: pilot hidden, mech controlled, closure 1", () => {
    const m = new MechStateMachine();
    m.enter();
    step(m, T.opening + T.enclosing);
    const s = m.snapshot;
    expect(s.phase).toBe("piloted");
    expect(s.pilotVisible).toBe(false);
    expect(s.mechVisible).toBe(true);
    expect(s.mechControlled).toBe(true);
    expect(s.closure).toBe(1);
    expect(s.enclosed).toBe(true);
  });

  it("exit() only works from piloted and re-opens the armour", () => {
    const m = new MechStateMachine();
    // Cannot exit before piloted.
    expect(m.exit()).toBe(false);
    m.enter();
    expect(m.exit()).toBe(false); // mid opening
    step(m, T.opening + T.enclosing);
    expect(m.isPiloted).toBe(true);
    expect(m.exit()).toBe(true);
    expect(m.current).toBe("exiting");
    // Control is released immediately when exiting begins.
    expect(m.snapshot.mechControlled).toBe(false);
  });

  it("exiting releases the pilot and returns fully to idle", () => {
    const m = new MechStateMachine();
    m.enter();
    step(m, T.opening + T.enclosing);
    m.exit();
    // Partway through exit the armour re-opens past the seal threshold and the
    // pilot reappears.
    step(m, T.exiting * 0.9);
    expect(m.snapshot.pilotVisible).toBe(true);
    // Finish exiting → idle, mech gone, pilot restored.
    step(m, T.exiting);
    const s = m.snapshot;
    expect(s.phase).toBe("idle");
    expect(s.mechVisible).toBe(false);
    expect(s.pilotVisible).toBe(true);
    expect(s.closure).toBe(0);
    expect(m.isActive).toBe(false);
  });

  it("toggle() enters from idle, exits from piloted, and ignores transitions", () => {
    const m = new MechStateMachine();
    expect(m.toggle()).toBe("enter");
    expect(m.current).toBe("opening");
    // Mid-transition toggles are ignored (no abort).
    expect(m.toggle()).toBe(null);
    step(m, T.opening + T.enclosing);
    expect(m.isPiloted).toBe(true);
    expect(m.toggle()).toBe("exit");
    expect(m.current).toBe("exiting");
    expect(m.toggle()).toBe(null);
  });

  it("forceIdle() resets from any phase", () => {
    const m = new MechStateMachine();
    m.enter();
    step(m, T.opening + T.enclosing);
    expect(m.isPiloted).toBe(true);
    m.forceIdle();
    expect(m.current).toBe("idle");
    expect(m.snapshot.pilotVisible).toBe(true);
    expect(m.snapshot.mechVisible).toBe(false);
  });

  it("progress stays clamped to [0,1] and closure is monotonic across a full cycle", () => {
    const m = new MechStateMachine();
    m.enter();
    let prev = 0;
    let rising = true;
    const dt = 1 / 90;
    // Opening + enclosing: closure should rise monotonically to 1.
    for (let i = 0; i < Math.ceil((T.opening + T.enclosing) / dt); i++) {
      m.update(dt);
      const s = m.snapshot;
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(1);
      if (rising) expect(s.closure).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = s.closure;
    }
    // Cross the final boundary into the steady piloted phase (closure locks to 1).
    step(m, dt * 2);
    expect(m.isPiloted).toBe(true);
    expect(m.snapshot.closure).toBe(1);
    m.exit();
    // Exiting: closure should fall monotonically back toward 0.
    prev = 1;
    for (let i = 0; i < Math.ceil(T.exiting / dt) + 2; i++) {
      m.update(dt);
      const s = m.snapshot;
      expect(s.closure).toBeLessThanOrEqual(prev + 1e-6);
      prev = s.closure;
    }
    expect(m.snapshot.closure).toBe(0);
  });

  it("zero / negative dt does not advance the machine", () => {
    const m = new MechStateMachine();
    m.enter();
    m.update(0);
    m.update(-5);
    expect(m.current).toBe("opening");
    expect(m.snapshot.progress).toBe(0);
  });
});
