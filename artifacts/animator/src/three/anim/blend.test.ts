import { describe, expect, it } from "vitest";
import { crossfadeAlpha, directionalBlendWeights, resolveBlendTime } from "./blend";

describe("directionalBlendWeights", () => {
  it("idle input yields zero weights", () => {
    expect(directionalBlendWeights(0, 0)).toEqual({ forward: 0, back: 0, left: 0, right: 0 });
  });

  it("pure forward puts all weight on forward", () => {
    const w = directionalBlendWeights(0, 1);
    expect(w.forward).toBeCloseTo(1, 6);
    expect(w.back + w.left + w.right).toBeCloseTo(0, 6);
  });

  it("pure left strafe puts all weight on left", () => {
    const w = directionalBlendWeights(-1, 0);
    expect(w.left).toBeCloseTo(1, 6);
    expect(w.right).toBe(0);
  });

  it("a diagonal does not exceed unit total weight", () => {
    const w = directionalBlendWeights(1, 1);
    const total = w.forward + w.back + w.left + w.right;
    expect(total).toBeLessThanOrEqual(1 + 1e-6);
    expect(w.forward).toBeGreaterThan(0);
    expect(w.right).toBeGreaterThan(0);
  });

  it("scales by speed", () => {
    const w = directionalBlendWeights(0, 1, 0.5);
    expect(w.forward).toBeCloseTo(0.5, 6);
  });
});

describe("crossfadeAlpha", () => {
  it("is 0 at the start and 1 at the end", () => {
    expect(crossfadeAlpha(0, 0.5)).toBeCloseTo(0, 6);
    expect(crossfadeAlpha(0.5, 0.5)).toBeCloseTo(1, 6);
  });
  it("is eased (smoothstep) at the midpoint", () => {
    expect(crossfadeAlpha(0.25, 0.5)).toBeCloseTo(0.5, 6);
  });
  it("returns 1 immediately for a zero duration", () => {
    expect(crossfadeAlpha(0, 0)).toBe(1);
  });
});

describe("resolveBlendTime", () => {
  it("uses the fallback when undefined / non-finite", () => {
    expect(resolveBlendTime(undefined, 0.22)).toBe(0.22);
    expect(resolveBlendTime(NaN, 0.22)).toBe(0.22);
  });
  it("clamps to the allowed range", () => {
    expect(resolveBlendTime(-1, 0.22)).toBe(0);
    expect(resolveBlendTime(99, 0.22)).toBe(1.5);
    expect(resolveBlendTime(0.4, 0.22)).toBe(0.4);
  });
});
