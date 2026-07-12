import { describe, expect, it } from "vitest";
import { interceptTime, leadTarget } from "./predictiveLead";

const V = (x: number, y: number, z: number) => ({ x, y, z });

describe("interceptTime", () => {
  it("a stationary target intercepts at distance / projSpeed", () => {
    const t = interceptTime(V(0, 0, 0), V(10, 0, 0), V(0, 0, 0), 5);
    expect(t).toBeCloseTo(2, 6);
  });

  it("a target fleeing along the shot line needs more time than the static case", () => {
    const tStatic = interceptTime(V(0, 0, 0), V(10, 0, 0), V(0, 0, 0), 5);
    const tFlee = interceptTime(V(0, 0, 0), V(10, 0, 0), V(2, 0, 0), 5);
    expect(tFlee).toBeGreaterThan(tStatic);
  });

  it("falls back to straight-line time when the target outruns the projectile", () => {
    // Target faster than projectile and fleeing → no positive intercept root.
    const t = interceptTime(V(0, 0, 0), V(10, 0, 0), V(20, 0, 0), 5);
    expect(t).toBeCloseTo(2, 6); // 10 / 5
  });

  it("returns 0 for a non-positive projectile speed", () => {
    expect(interceptTime(V(0, 0, 0), V(10, 0, 0), V(0, 0, 0), 0)).toBe(0);
  });
});

describe("leadTarget", () => {
  it("leads a crossing target ahead of its current position", () => {
    const aim = leadTarget(V(0, 0, 0), V(10, 0, 0), V(0, 0, 5), 10);
    expect(aim.z).toBeGreaterThan(0); // led in the direction of travel
    expect(aim.x).toBeCloseTo(10, 6);
  });

  it("clamps the lead so a close fast juke stays beatable", () => {
    // Huge crossing velocity, modest projectile speed: lead would be enormous,
    // but it is clamped to maxLeadFraction (default 0.5) of the 10-unit distance.
    const aim = leadTarget(V(0, 0, 0), V(10, 0, 0), V(0, 0, 50), 10);
    expect(aim.z).toBeLessThanOrEqual(5 + 1e-6);
  });

  it("does not lead a stationary target", () => {
    const aim = leadTarget(V(0, 0, 0), V(10, 0, 0), V(0, 0, 0), 10);
    expect(aim).toEqual(V(10, 0, 0));
  });
});
