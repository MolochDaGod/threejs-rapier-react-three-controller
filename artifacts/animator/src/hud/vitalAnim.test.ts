import { describe, expect, it } from "vitest";
import {
  createVitalAnim,
  DAMAGE_FLASH_S,
  GHOST_HOLD_S,
  HEAL_SHIMMER_S,
  retargetVitalAnim,
  stepVitalAnim,
  vitalAnimSettled,
} from "./vitalAnim";

/** Step in small fixed increments (like rAF frames) for `seconds`. */
function run(s: ReturnType<typeof createVitalAnim>, seconds: number, dt = 1 / 60) {
  let cur = s;
  for (let t = 0; t < seconds; t += dt) cur = stepVitalAnim(cur, dt);
  return cur;
}

describe("vitalAnim", () => {
  it("starts settled at the clamped value", () => {
    const s = createVitalAnim(150, 100);
    expect(s.fill).toBe(100);
    expect(s.ghost).toBe(100);
    expect(vitalAnimSettled(s)).toBe(true);
    const neg = createVitalAnim(-5, 100);
    expect(neg.fill).toBe(0);
  });

  it("damage arms the flash + ghost hold and keeps the ghost at the old value", () => {
    let s = createVitalAnim(100, 100);
    s = retargetVitalAnim(s, 60, 100);
    expect(s.target).toBe(60);
    expect(s.ghost).toBe(100);
    expect(s.holdT).toBe(GHOST_HOLD_S);
    expect(s.flashT).toBe(DAMAGE_FLASH_S);
    // During the hold window the ghost stays put while the fill drains.
    const mid = run(s, GHOST_HOLD_S * 0.5);
    expect(mid.fill).toBeLessThan(100);
    expect(mid.ghost).toBe(100);
  });

  it("ghost drains after the hold and everything settles on the target", () => {
    let s = retargetVitalAnim(createVitalAnim(100, 100), 40, 100);
    s = run(s, 3);
    expect(s.fill).toBe(40);
    expect(s.ghost).toBe(40);
    expect(vitalAnimSettled(s)).toBe(true);
  });

  it("ghost never drops below the fill", () => {
    let s = retargetVitalAnim(createVitalAnim(100, 100), 30, 100);
    for (let i = 0; i < 240; i++) {
      s = stepVitalAnim(s, 1 / 60);
      expect(s.ghost).toBeGreaterThanOrEqual(s.fill);
    }
  });

  it("heal rises without a ghost lag and arms the shimmer", () => {
    let s = run(retargetVitalAnim(createVitalAnim(100, 100), 20, 100), 3);
    s = retargetVitalAnim(s, 80, 100);
    expect(s.healT).toBe(HEAL_SHIMMER_S);
    expect(s.flashT).toBe(0);
    const mid = run(s, 0.15);
    expect(mid.fill).toBeGreaterThan(20);
    expect(mid.ghost).toBe(mid.fill); // ghost rides the fill up
    const done = run(s, 3);
    expect(done.fill).toBe(80);
    expect(vitalAnimSettled(done)).toBe(true);
  });

  it("re-damage during a drain re-arms the hold and keeps the highest ghost", () => {
    let s = retargetVitalAnim(createVitalAnim(100, 100), 70, 100);
    s = run(s, 0.1);
    const ghostBefore = s.ghost;
    s = retargetVitalAnim(s, 40, 100);
    expect(s.ghost).toBe(ghostBefore);
    expect(s.holdT).toBe(GHOST_HOLD_S);
  });

  it("a capacity change snaps instead of tweening across units", () => {
    let s = retargetVitalAnim(createVitalAnim(100, 100), 50, 100);
    s = retargetVitalAnim(s, 200, 250);
    expect(s.fill).toBe(200);
    expect(s.ghost).toBe(200);
    expect(vitalAnimSettled(s)).toBe(true);
  });

  it("zero/negative dt and settled states are no-ops", () => {
    const s = createVitalAnim(50, 100);
    expect(stepVitalAnim(s, 0)).toBe(s);
    expect(stepVitalAnim(s, -1)).toBe(s);
    expect(stepVitalAnim(s, 1 / 60)).toBe(s);
  });
});
