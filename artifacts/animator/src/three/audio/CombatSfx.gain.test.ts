import { describe, expect, it } from "vitest";
import { AMBIENT_BASE, COMBAT_BASE, effectiveGain } from "./CombatSfx";

describe("effectiveGain", () => {
  it("multiplies base × category level × master", () => {
    expect(effectiveGain(COMBAT_BASE, 1, 1)).toBeCloseTo(0.9);
    expect(effectiveGain(COMBAT_BASE, 0.5, 1)).toBeCloseTo(0.45);
    expect(effectiveGain(COMBAT_BASE, 0.5, 0.5)).toBeCloseTo(0.225);
    expect(effectiveGain(AMBIENT_BASE, 1, 1)).toBeCloseTo(0.05);
    expect(effectiveGain(AMBIENT_BASE, 0.5, 0.5)).toBeCloseTo(0.0125);
  });

  it("reproduces the original loudness at level 1.0 × master 1.0", () => {
    expect(effectiveGain(COMBAT_BASE, 1, 1)).toBe(COMBAT_BASE);
    expect(effectiveGain(AMBIENT_BASE, 1, 1)).toBe(AMBIENT_BASE);
  });

  it("a zero category level silences that bucket while others can stay loud", () => {
    expect(effectiveGain(COMBAT_BASE, 0, 1)).toBe(0);
    expect(effectiveGain(AMBIENT_BASE, 1, 1)).toBeGreaterThan(0);
  });

  it("a zero master level silences every bucket", () => {
    expect(effectiveGain(COMBAT_BASE, 1, 0)).toBe(0);
    expect(effectiveGain(AMBIENT_BASE, 1, 0)).toBe(0);
  });

  it("hard-zeroes the result when muted, regardless of the levels", () => {
    expect(effectiveGain(COMBAT_BASE, 1, 1, true)).toBe(0);
    expect(effectiveGain(AMBIENT_BASE, 1, 1, true)).toBe(0);
    // Even maxed levels + master are silenced by mute.
    expect(effectiveGain(1, 1, 1, true)).toBe(0);
  });

  it("defaults to unmuted when the muted flag is omitted", () => {
    expect(effectiveGain(COMBAT_BASE, 1, 1)).toBeGreaterThan(0);
  });
});
