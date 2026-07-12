import { describe, expect, it } from "vitest";
import { footPlantOffset, pelvisDropForFeet, solveTwoBoneIk } from "./footIk";

describe("solveTwoBoneIk", () => {
  it("straightens (unreachable) when the target is past full reach", () => {
    const s = solveTwoBoneIk(1, 1, 2.5);
    expect(s.reachable).toBe(false);
    expect(s.rootAngle).toBe(0);
    expect(s.jointAngle).toBeCloseTo(Math.PI, 6);
  });

  it("a half-folded equilateral case bends the knee to 60deg interior", () => {
    // Equal bones, target at distance == one bone: classic 1-1-1 triangle.
    const s = solveTwoBoneIk(1, 1, 1);
    expect(s.reachable).toBe(true);
    // Interior knee angle of an equilateral triangle is 60deg.
    expect(s.jointAngle).toBeCloseTo(Math.PI / 3, 5);
    // Thigh swings 60deg off the hip->target line.
    expect(s.rootAngle).toBeCloseTo(Math.PI / 3, 5);
  });

  it("nearly-full extension keeps the knee almost straight", () => {
    const s = solveTwoBoneIk(1, 1, 1.99);
    expect(s.reachable).toBe(true);
    expect(s.jointAngle).toBeGreaterThan(2.8); // close to PI
    expect(s.rootAngle).toBeLessThan(0.15); // thigh barely off the line
  });

  it("clamps an over-compressed target so acos stays valid (no NaN)", () => {
    const s = solveTwoBoneIk(2, 1, 0.1); // below |2-1| = 1
    expect(Number.isNaN(s.rootAngle)).toBe(false);
    expect(Number.isNaN(s.jointAngle)).toBe(false);
  });
});

describe("footPlantOffset", () => {
  it("lifts a foot up onto a rise, clamped to maxLift", () => {
    expect(footPlantOffset(0, 0.1, 0.3, 0.3)).toBeCloseTo(0.1, 6);
    expect(footPlantOffset(0, 1.0, 0.3, 0.3)).toBeCloseTo(0.3, 6);
  });
  it("drops a foot into a dip, clamped to maxDrop", () => {
    expect(footPlantOffset(0, -0.1, 0.3, 0.3)).toBeCloseTo(-0.1, 6);
    expect(footPlantOffset(0, -1.0, 0.3, 0.3)).toBeCloseTo(-0.3, 6);
  });
});

describe("pelvisDropForFeet", () => {
  it("returns the deepest required drop (most negative), never positive", () => {
    expect(pelvisDropForFeet([0.1, -0.2])).toBeCloseTo(-0.2, 6);
    expect(pelvisDropForFeet([0.1, 0.05])).toBe(0);
    expect(pelvisDropForFeet([])).toBe(0);
  });
});
