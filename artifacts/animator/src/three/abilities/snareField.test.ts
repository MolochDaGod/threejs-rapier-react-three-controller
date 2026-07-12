import { describe, expect, it } from "vitest";
import { AbilityOrchestrator } from "./abilityOrchestrator";
import { getAbility } from "./abilityRegistry";

/**
 * The snare field is the second user of the deploy ability lifecycle (after the
 * turret) and the support / zone-control counterpart to it: a persistent zone
 * that re-pulses a movement slow + chip damage on whoever stands in it. Its
 * gameplay (slow / chip / VFX) is supplied by the Studio host hooks, so the only
 * PURE thing to lock is its deploy tick / lifetime SHAPE — how many pulses fire,
 * at what times, and that it expires once and stops. These tests pin that shape
 * directly against the seeded `deploy:snareField` def so a future tuning change
 * can't silently change the pulse cadence.
 */
describe("snare field deploy shape (deploy:snareField)", () => {
  it("is seeded as a deploy-phase ability (no cast/travel/impact)", () => {
    const def = getAbility("deploy:snareField");
    expect(def).toBeDefined();
    expect(def!.id).toBe("deploy:snareField");
    expect(def!.cast).toBeUndefined();
    expect(def!.travel).toBeUndefined();
    expect(def!.impact).toBeUndefined();
    expect(def!.status).toBeUndefined();
    expect(def!.deploy).toBeDefined();
  });

  it("derives 6 pulses from its lifetime (floor((6.0 - 0.4) / 0.8))", () => {
    // 5.6 / 0.8 is 6.9999… in float, so the tail-trimmed lifetime floors to 6 —
    // pin it so a future tuning tweak can't silently change the pulse count.
    const deploy = getAbility("deploy:snareField")!.deploy!;
    expect(deploy).toEqual({ life: 6.0, firstTick: 0.4, interval: 0.8, ticks: 6 });
  });

  it("pulses on schedule across its whole lifetime, then expires exactly once", () => {
    const def = getAbility("deploy:snareField")!;
    const log: string[] = [];
    const pulses: number[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(def, {
      onDeploy: () => log.push("deploy"),
      onTick: (at) => {
        log.push("tick");
        pulses.push(at);
      },
      onExpire: () => log.push("expire"),
    });
    // onDeploy fires synchronously inside cast(); the field is now standing.
    expect(log).toEqual(["deploy"]);

    // Drive 60fps frames a little past the 6s lifetime.
    for (let t = 0; t < 6.5; t += 1 / 60) orch.update(1 / 60);

    // 6 pulses at 0.4, 1.2, 2.0, 2.8, 3.6, 4.4, then a single expire at 6.0s.
    expect(log).toEqual([
      "deploy",
      "tick",
      "tick",
      "tick",
      "tick",
      "tick",
      "tick",
      "expire",
    ]);
    expect(pulses).toHaveLength(6);
    [0.4, 1.2, 2.0, 2.8, 3.6, 4.4].forEach((expected, i) =>
      expect(pulses[i]).toBeCloseTo(expected, 5),
    );
    orch.update(0); // sweep the finished cast
    expect(orch.activeCount).toBe(0);
  });

  it("stops pulsing the instant it is cancelled (cancelAll teardown)", () => {
    const def = getAbility("deploy:snareField")!;
    const pulses: number[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(def, { onTick: (at) => pulses.push(at) });
    orch.update(0.5); // first pulse (at 0.4s) has fired
    expect(pulses).toEqual([0.4]);
    orch.cancelAll();
    orch.update(10); // nothing more should fire after teardown
    expect(pulses).toEqual([0.4]);
    expect(orch.activeCount).toBe(0);
  });
});
