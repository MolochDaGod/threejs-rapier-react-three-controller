import { describe, expect, it } from "vitest";
import { SUPPORT_PAD, supportHeightAt } from "./support";
import type { ObstacleCircle } from "./types";

const crate: ObstacleCircle = { x: 0, z: 0, r: 0.7, top: 1.0 };
const pillar: ObstacleCircle = { x: 5, z: 0, r: 0.6 }; // infinite — never support

describe("supportHeightAt", () => {
  it("returns the floor (0) on open ground", () => {
    expect(supportHeightAt([crate, pillar], 10, 10, 2)).toBe(0);
  });

  it("returns a landable top when the feet fell from above it", () => {
    expect(supportHeightAt([crate], 0, 0, 1.5)).toBe(1.0);
  });

  it("supports standing exactly at the top height (small slack)", () => {
    expect(supportHeightAt([crate], 0, 0, 1.0)).toBe(1.0);
  });

  it("ignores tops above the feet — a wall face is not a floor", () => {
    expect(supportHeightAt([crate], 0, 0, 0.3)).toBe(0);
  });

  it("never treats infinite cylinders (no top) as support", () => {
    expect(supportHeightAt([pillar], 5, 0, 10)).toBe(0);
  });

  it("applies edge forgiveness out to r + pad, then drops support", () => {
    const justInside = crate.r + SUPPORT_PAD - 0.01;
    const justOutside = crate.r + SUPPORT_PAD + 0.01;
    expect(supportHeightAt([crate], justInside, 0, 1.5)).toBe(1.0);
    expect(supportHeightAt([crate], justOutside, 0, 1.5)).toBe(0);
  });

  it("picks the highest reachable top when props overlap", () => {
    const low: ObstacleCircle = { x: 0, z: 0, r: 1.2, top: 0.5 };
    const high: ObstacleCircle = { x: 0.3, z: 0, r: 0.7, top: 1.1 };
    expect(supportHeightAt([low, high], 0.2, 0, 2)).toBe(1.1);
    // Falling from between the two tops only reaches the low one.
    expect(supportHeightAt([low, high], 0.2, 0, 0.8)).toBe(0.5);
  });
});
