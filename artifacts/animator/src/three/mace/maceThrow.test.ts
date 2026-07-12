import { describe, it, expect } from "vitest";
import { MaceThrowMachine, type MaceThrowConfig } from "./maceThrow";

const CFG: MaceThrowConfig = { outbound: 0.3, inbound: 0.3, failSafe: 3 };

describe("MaceThrowMachine", () => {
  it("starts idle and not out", () => {
    const m = new MaceThrowMachine(CFG);
    expect(m.phase).toBe("idle");
    expect(m.isOut).toBe(false);
    expect(m.progress()).toBe(0);
  });

  it("press from idle launches the throw with no events", () => {
    const m = new MaceThrowMachine(CFG);
    expect(m.press()).toEqual([]);
    expect(m.phase).toBe("outbound");
    expect(m.isOut).toBe(true);
  });

  it("step does nothing while idle", () => {
    const m = new MaceThrowMachine(CFG);
    expect(m.step(0.5)).toEqual([]);
    expect(m.phase).toBe("idle");
  });

  it("outbound completes into an impact + returning", () => {
    const m = new MaceThrowMachine(CFG);
    m.press();
    expect(m.step(0.2)).toEqual([]); // mid-flight
    expect(m.phase).toBe("outbound");
    expect(m.step(0.2)).toEqual(["impact"]); // crosses 0.3
    expect(m.phase).toBe("returning");
  });

  it("returning completes into a caught + idle", () => {
    const m = new MaceThrowMachine(CFG);
    m.press();
    m.step(0.3); // → impact, returning (t resets to 0)
    expect(m.step(0.2)).toEqual([]); // mid-return
    expect(m.step(0.2)).toEqual(["caught"]); // crosses 0.3
    expect(m.phase).toBe("idle");
    expect(m.isOut).toBe(false);
  });

  it("re-press while outbound recalls + dashes", () => {
    const m = new MaceThrowMachine(CFG);
    m.press();
    m.step(0.1);
    expect(m.press()).toEqual(["dash", "caught"]);
    expect(m.phase).toBe("idle");
  });

  it("re-press while returning recalls + dashes", () => {
    const m = new MaceThrowMachine(CFG);
    m.press();
    m.step(0.3); // → returning
    m.step(0.1);
    expect(m.press()).toEqual(["dash", "caught"]);
    expect(m.phase).toBe("idle");
  });

  it("fail-safe forces a recall when the mace lingers too long", () => {
    // Long flights but a short watchdog: the mace can never reach impact/return.
    const m = new MaceThrowMachine({ outbound: 100, inbound: 100, failSafe: 1 });
    m.press();
    expect(m.step(0.5)).toEqual([]);
    expect(m.phase).toBe("outbound");
    expect(m.step(0.6)).toEqual(["caught"]); // total 1.1 ≥ failSafe
    expect(m.phase).toBe("idle");
  });

  it("cancel reports whether the mace was out and resets to idle", () => {
    const m = new MaceThrowMachine(CFG);
    expect(m.cancel()).toBe(false); // idle → nothing to clean up
    m.press();
    m.step(0.1);
    expect(m.cancel()).toBe(true); // was out
    expect(m.phase).toBe("idle");
    expect(m.isOut).toBe(false);
    // Fully reset: a fresh throw behaves like the first.
    expect(m.press()).toEqual([]);
    expect(m.phase).toBe("outbound");
  });

  it("progress advances 0..1 within a phase and resets across phases", () => {
    const m = new MaceThrowMachine(CFG);
    m.press();
    m.step(0.15);
    expect(m.progress()).toBeCloseTo(0.5, 5);
    m.step(0.15); // → impact, returning, t back to 0
    expect(m.progress()).toBeCloseTo(0, 5);
    m.step(0.3); // caught
    expect(m.progress()).toBe(0);
  });

  it("progress never exceeds 1 even past the phase duration", () => {
    const m = new MaceThrowMachine(CFG);
    m.press();
    m.step(0.29);
    expect(m.progress()).toBeLessThanOrEqual(1);
    expect(m.progress()).toBeGreaterThan(0.9);
  });
});
