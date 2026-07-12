import { describe, it, expect } from "vitest";
import {
  BEAR_ATTACKS,
  BEAR_ATTACK_DURATION,
  bearAttackPose,
  nextBearAttack,
  telegraphBlink,
  type BearAttackName,
} from "./bearAttacks";

const NAMES: BearAttackName[] = ["swipe", "maul", "slam"];

describe("bear attack kit", () => {
  it("has three distinct named attacks", () => {
    expect(BEAR_ATTACKS).toHaveLength(3);
    const names = new Set(BEAR_ATTACKS.map((a) => a.name));
    expect(names.size).toBe(3);
  });

  it("the heavier attacks telegraph longer than the light swipe", () => {
    const swipe = BEAR_ATTACKS.find((a) => a.name === "swipe")!;
    const slam = BEAR_ATTACKS.find((a) => a.name === "slam")!;
    expect(slam.windupScale).toBeGreaterThan(swipe.windupScale);
    expect(slam.damageMul).toBeGreaterThan(swipe.damageMul);
  });

  it("only the slam is an AoE (ground-telegraph) attack", () => {
    for (const a of BEAR_ATTACKS) {
      if (a.name === "slam") expect(a.radiusBonus).toBeGreaterThan(0);
      else expect(a.radiusBonus).toBe(0);
    }
  });
});

describe("nextBearAttack rotation", () => {
  it("cycles through all three in order and wraps", () => {
    let idx = -1;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = nextBearAttack(idx);
      idx = r.index;
      seen.push(r.attack.name);
    }
    expect(seen).toEqual(["swipe", "maul", "slam", "swipe"]);
  });
});

describe("telegraphBlink", () => {
  it("is zero outside the wind-up / for a zero duration", () => {
    expect(telegraphBlink(0, 0)).toBe(0);
    expect(telegraphBlink(0, 1)).toBeCloseTo(0);
  });
  it("pulses (reaches full brightness) during the wind-up", () => {
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.05) peak = Math.max(peak, telegraphBlink(t, 1, 2));
    expect(peak).toBeGreaterThan(0.9);
  });
  it("never goes negative", () => {
    for (let t = 0; t <= 1; t += 0.05) expect(telegraphBlink(t, 1, 2)).toBeGreaterThanOrEqual(0);
  });
});

describe("BEAR_ATTACK_DURATION", () => {
  it("has a positive duration for every attack, scaling with weight", () => {
    for (const n of NAMES) expect(BEAR_ATTACK_DURATION[n]).toBeGreaterThan(0);
    expect(BEAR_ATTACK_DURATION.slam).toBeGreaterThan(BEAR_ATTACK_DURATION.maul);
    expect(BEAR_ATTACK_DURATION.maul).toBeGreaterThan(BEAR_ATTACK_DURATION.swipe);
  });
});

describe("bearAttackPose", () => {
  it("settles to a neutral pose at the start and end of every attack", () => {
    for (const n of NAMES) {
      for (const phase of [0, 1]) {
        const pose = bearAttackPose(n, phase);
        expect(pose.pitch).toBeCloseTo(0, 5);
        expect(pose.lift).toBeCloseTo(0, 5);
        expect(pose.lunge).toBeCloseTo(0, 5);
      }
    }
  });

  it("clamps out-of-range phases to the neutral endpoints", () => {
    for (const n of NAMES) {
      for (const phase of [-0.5, 1.5]) {
        const pose = bearAttackPose(n, phase);
        expect(pose.pitch).toBeCloseTo(0, 5);
        expect(pose.lift).toBeCloseTo(0, 5);
        expect(pose.lunge).toBeCloseTo(0, 5);
      }
    }
  });

  it("gives each attack a distinct mid-motion silhouette", () => {
    const sample = (n: BearAttackName) => {
      let peakLift = 0;
      let peakLunge = 0;
      let minPitch = 0;
      for (let p = 0; p <= 1; p += 0.02) {
        const pose = bearAttackPose(n, p);
        peakLift = Math.max(peakLift, pose.lift);
        peakLunge = Math.max(peakLunge, pose.lunge);
        minPitch = Math.min(minPitch, pose.pitch);
      }
      return { peakLift, peakLunge, minPitch };
    };
    const swipe = sample("swipe");
    const maul = sample("maul");
    const slam = sample("slam");
    // The slam rears highest off the ground (the AoE pound), the swipe never lifts.
    expect(swipe.peakLift).toBeCloseTo(0, 5);
    expect(slam.peakLift).toBeGreaterThan(maul.peakLift);
    expect(maul.peakLift).toBeGreaterThan(swipe.peakLift);
    // Every attack drives forward at some point.
    for (const s of [swipe, maul, slam]) expect(s.peakLunge).toBeGreaterThan(0);
    // The heavy chop/slam crash downward (negative pitch); the light swipe dips only slightly.
    expect(maul.minPitch).toBeLessThan(swipe.minPitch);
    expect(slam.minPitch).toBeLessThan(0);
  });
});
