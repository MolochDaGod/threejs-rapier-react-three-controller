import { describe, it, expect } from "vitest";
import { ExoArmor } from "./exoArmor";

/**
 * Footstep-cadence ("heavy walk feel") tests for {@link ExoArmor.updateLocomotion}.
 *
 * The procedural locomotion only touches the wrapper's own THREE groups, so an
 * instance can be exercised WITHOUT loading the GLB template (no WebGL needed) —
 * the foot-plant detection is pure timing math on the smoothed speed + stride
 * phase. These cover the "weighty mech" feel that has no other coverage.
 */

/**
 * Drive `updateLocomotion` for `seconds` at a fixed normalized `speed`, returning
 * every foot-plant side emitted (in order). `dt` is fixed so the smoothed-speed
 * ramp + stride advance stay deterministic.
 */
function collectFootsteps(
  armor: ExoArmor,
  seconds: number,
  speed: number,
  piloted: boolean,
  dt = 1 / 60,
): Array<-1 | 1> {
  const sides: Array<-1 | 1> = [];
  let elapsed = 0;
  while (elapsed < seconds) {
    const fp = armor.updateLocomotion(dt, speed, piloted);
    if (fp) sides.push(fp.side);
    elapsed += dt;
  }
  return sides;
}

describe("ExoArmor.updateLocomotion (heavy-step cadence)", () => {
  it("plants feet only while piloted and moving", () => {
    const armor = new ExoArmor();
    const sides = collectFootsteps(armor, 4, 1, true);
    expect(sides.length).toBeGreaterThanOrEqual(2);
  });

  it("alternates left/right on consecutive foot-plants", () => {
    const armor = new ExoArmor();
    const sides = collectFootsteps(armor, 5, 1, true);
    expect(sides.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < sides.length; i++) {
      expect(sides[i]).toBe(sides[i - 1] === 1 ? -1 : 1);
    }
  });

  it("scales cadence with speed: faster pilots plant more feet over the same time", () => {
    const fast = new ExoArmor();
    const slow = new ExoArmor();
    const seconds = 6;
    const fastSteps = collectFootsteps(fast, seconds, 1.0, true).length;
    const slowSteps = collectFootsteps(slow, seconds, 0.4, true).length;
    expect(fastSteps).toBeGreaterThan(slowSteps);
    expect(slowSteps).toBeGreaterThanOrEqual(1);
  });

  it("returns no foot-plant when stopped (speed 0), even over a long window", () => {
    const armor = new ExoArmor();
    const sides = collectFootsteps(armor, 5, 0, true);
    expect(sides).toEqual([]);
  });

  it("returns no foot-plant when not piloted, even at full speed", () => {
    const armor = new ExoArmor();
    const sides = collectFootsteps(armor, 5, 1, false);
    expect(sides).toEqual([]);
  });

  it("eases the stride out so a mech that stops mid-walk stops planting feet", () => {
    const armor = new ExoArmor();
    // Walk up to a steady cadence first.
    const moving = collectFootsteps(armor, 4, 1, true);
    expect(moving.length).toBeGreaterThanOrEqual(2);
    // Now stop: the smoothed speed eases down through the foot-plant threshold,
    // so at most a brief tail of steps may remain before it fully settles.
    const afterStop = collectFootsteps(armor, 5, 0, true);
    const tail = collectFootsteps(armor, 5, 0, true);
    // Once settled there are zero further plants.
    expect(tail).toEqual([]);
    // And the stopping tail is strictly shorter than continuous walking.
    expect(afterStop.length).toBeLessThan(moving.length);
  });

  it("ignores non-positive dt", () => {
    const armor = new ExoArmor();
    expect(armor.updateLocomotion(0, 1, true)).toBeNull();
    expect(armor.updateLocomotion(-1 / 60, 1, true)).toBeNull();
  });
});
