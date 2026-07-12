import { describe, it, expect } from "vitest";
import { weaponOWR, classifyEngagement, HOLD_STYLES, type OWR } from "./combat";
import type { WeaponCombat } from "./types";

const sword: WeaponCombat = { intensity: 30, direction: 100, range: [1, 2] };
const greatsword: WeaponCombat = { intensity: 72, direction: 45, range: [1.6, 3] };
const rifleMelee: WeaponCombat = { intensity: 40, direction: 100, range: [0.6, 1.4] };

describe("weaponOWR", () => {
  it("derives a melee envelope from the reach band", () => {
    const owr = weaponOWR(sword, "melee-1h");
    expect(owr.optimalMin).toBe(1);
    expect(owr.optimalMax).toBe(2);
    expect(owr.inner).toBeLessThan(owr.optimalMin);
    expect(owr.outer).toBeGreaterThan(owr.optimalMax);
  });

  it("gives two-handed weapons a longer envelope than one-handed", () => {
    const oneH = weaponOWR(sword, "melee-1h");
    const twoH = weaponOWR(greatsword, "melee-2h");
    expect(twoH.optimalMax).toBeGreaterThan(oneH.optimalMax);
    expect(twoH.outer).toBeGreaterThan(oneH.outer);
  });

  it("gives ranged a real kite band, not the tiny melee range", () => {
    const owr = weaponOWR(rifleMelee, "ranged");
    expect(owr.optimalMin).toBe(HOLD_STYLES.ranged.kite![0]);
    expect(owr.optimalMax).toBe(HOLD_STYLES.ranged.kite![1]);
    // The tiny melee butt-strike becomes the "too close" inner radius.
    expect(owr.inner).toBeCloseTo(rifleMelee.range[1]);
    expect(owr.optimalMin).toBeGreaterThan(owr.inner);
  });

  it("scales the envelope with body size", () => {
    const base = weaponOWR(sword, "melee-1h", 1);
    const big = weaponOWR(sword, "melee-1h", 2);
    expect(big.optimalMax).toBeCloseTo(base.optimalMax * 2);
  });
});

describe("classifyEngagement", () => {
  const atk = weaponOWR(sword, "melee-1h"); // [1,2], outer ~2.9
  const def = weaponOWR(greatsword, "melee-2h"); // [1.6,3]

  it("clean hit at full damage inside your optimal band", () => {
    const v = classifyEngagement({ dist: 1.5, attacker: atk, defender: def });
    expect(v.outcome).toBe("clean");
    expect(v.damageMul).toBe(1);
  });

  it("whiffs out of reach", () => {
    const v = classifyEngagement({ dist: 6, attacker: atk, defender: def });
    expect(v.outcome).toBe("whiff");
    expect(v.damageMul).toBe(0);
  });

  it("spacing disadvantage when inside their range but outside yours", () => {
    // dist 2.6: past sword optimalMax (2) but within greatsword optimalMax (3).
    const v = classifyEngagement({ dist: 2.6, attacker: atk, defender: def });
    expect(v.outcome).toBe("spacingDisadvantage");
    expect(v.damageMul).toBeLessThan(1);
    expect(v.staggerLock).toBe(true);
    expect(v.freeCounter).toBe(true);
  });

  it("rewards a well-timed penetration with big damage + slow-mo", () => {
    const v = classifyEngagement({ dist: 2.4, attacker: atk, defender: def, committedLunge: true, timingQuality: 0.8 });
    expect(v.outcome).toBe("penetrationSuccess");
    expect(v.damageMul).toBeGreaterThan(1);
    expect(v.slowmo).toBe(true);
  });

  it("punishes a mistimed penetration with an expose window + free counter", () => {
    const v = classifyEngagement({ dist: 2.4, attacker: atk, defender: def, committedLunge: true, timingQuality: 0.1 });
    expect(v.outcome).toBe("penetrationFail");
    expect(v.damageMul).toBeLessThan(0.5);
    expect(v.exposeWindow).toBeGreaterThan(0.5);
    expect(v.freeCounter).toBe(true);
  });

  it("is symmetric: a glancing hit when slightly long but still reachable", () => {
    // dist 2.2: just past optimalMax (2) but the defender is also a sword (short reach).
    const shortDef: OWR = weaponOWR(sword, "melee-1h");
    const v = classifyEngagement({ dist: 2.2, attacker: atk, defender: shortDef });
    expect(v.outcome).toBe("clean");
    expect(v.damageMul).toBeLessThan(1);
    expect(v.damageMul).toBeGreaterThan(0);
  });
});
