import { describe, expect, it, vi } from "vitest";
import { AbilityOrchestrator } from "./abilityOrchestrator";
import type { AbilityDef, AbilityHooks, Vec3Like } from "./abilityTypes";

/**
 * Build a hooks object that records the order phases fire in. `omitStatus`
 * models a def with no status phase, where the host would not supply `onStatus`.
 */
function tracingHooks(
  log: string[],
  extra?: { onTravel?: (hit: (at: Vec3Like | null) => void) => void; omitStatus?: boolean },
): AbilityHooks {
  const hooks: AbilityHooks = {
    onCast: () => log.push("cast"),
    onRelease: () => log.push("release"),
    onTravel: (hit) => {
      log.push("travel");
      extra?.onTravel?.(hit);
    },
    onImpact: (at) => log.push(at ? "impact" : "impact:null"),
  };
  if (!extra?.omitStatus) hooks.onStatus = () => log.push("status");
  return hooks;
}

const projectile: AbilityDef = {
  id: "proj",
  name: "Proj",
  kind: "fireDragon",
  color: 0xff6a1e,
  target: "aimed",
  cast: { duration: 0.5, auraColor: 0xff6a1e },
  travel: { motion: "dragon", maxFlight: 3 },
};

const instantStatus: AbilityDef = {
  id: "buff",
  name: "Buff",
  kind: "nova",
  color: 0xffffff,
  target: "self",
  status: { id: "haste", scope: "self" },
};

const meleeImpact: AbilityDef = {
  id: "melee",
  name: "Melee",
  kind: "slash",
  color: 0x9fe8ff,
  target: "aimed",
  cast: { duration: 0.2 },
};

describe("AbilityOrchestrator", () => {
  it("runs an instant status ability fully within cast() (no ticks needed)", () => {
    const log: string[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(instantStatus, tracingHooks(log));
    // No cast wind-up, no travel: cast -> release -> impact(null) -> status, all sync.
    expect(log).toEqual(["cast", "release", "impact:null", "status"]);
    expect(orch.activeCount).toBe(0);
  });

  it("holds in the cast phase until the wind-up elapses", () => {
    const log: string[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(meleeImpact, tracingHooks(log));
    expect(log).toEqual(["cast"]);
    expect(orch.activeCount).toBe(1);
    orch.update(0.1);
    expect(log).toEqual(["cast"]); // still winding up
    orch.update(0.15); // crosses 0.2s total
    expect(log).toEqual(["cast", "release", "impact:null", "status"]);
    orch.update(0); // sweep finished casts
    expect(orch.activeCount).toBe(0);
  });

  it("waits for the travel hit before impacting, then applies status", () => {
    const log: string[] = [];
    let report: ((at: Vec3Like | null) => void) | null = null;
    const orch = new AbilityOrchestrator();
    orch.cast(
      { ...projectile, status: { id: "burning", scope: "hostile" } },
      tracingHooks(log, { onTravel: (hit) => (report = hit) }),
    );
    orch.update(0.5); // finish wind-up -> release + launch travel
    expect(log).toEqual(["cast", "release", "travel"]);
    orch.update(0.5); // still flying, no hit reported yet
    expect(log).toEqual(["cast", "release", "travel"]);
    report!({ x: 1, y: 2, z: 3 }); // projectile lands
    orch.update(0.016); // next tick consumes the reported hit
    expect(log).toEqual(["cast", "release", "travel", "impact", "status"]);
  });

  it("forces impact via the fail-safe when travel never reports a hit", () => {
    const log: string[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(projectile, tracingHooks(log, { omitStatus: true })); // onTravel never calls hit()
    orch.update(0.5); // release + launch
    expect(log).toEqual(["cast", "release", "travel"]);
    orch.update(2.0); // still under the 3s fail-safe
    expect(log).toEqual(["cast", "release", "travel"]);
    orch.update(1.5); // crosses maxFlight (3s) -> forced impact
    expect(log).toEqual(["cast", "release", "travel", "impact:null"]);
    expect(orch.activeCount).toBe(0);
  });

  it("ignores a late hit report after the fail-safe already impacted", () => {
    const log: string[] = [];
    let report: ((at: Vec3Like | null) => void) | null = null;
    const orch = new AbilityOrchestrator();
    orch.cast(projectile, tracingHooks(log, { onTravel: (hit) => (report = hit), omitStatus: true }));
    orch.update(0.5);
    orch.update(3.0); // fail-safe fires
    expect(log).toEqual(["cast", "release", "travel", "impact:null"]);
    report!({ x: 9, y: 9, z: 9 }); // arrives too late
    orch.update(0.016);
    expect(log).toEqual(["cast", "release", "travel", "impact:null"]); // no second impact
  });

  it("supports several concurrent casts without crosstalk", () => {
    const a: string[] = [];
    const b: string[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(meleeImpact, tracingHooks(a));
    orch.cast(instantStatus, tracingHooks(b)); // resolves immediately
    expect(b).toEqual(["cast", "release", "impact:null", "status"]);
    expect(a).toEqual(["cast"]);
    expect(orch.activeCount).toBe(1); // only the melee is still pending
    orch.update(0.2);
    expect(a).toEqual(["cast", "release", "impact:null", "status"]);
  });

  it("fires onCast synchronously and skips absent hooks", () => {
    const onCast = vi.fn();
    const orch = new AbilityOrchestrator();
    orch.cast(instantStatus, { onCast }); // only onCast provided
    expect(onCast).toHaveBeenCalledTimes(1);
    expect(orch.activeCount).toBe(0);
  });

  it("cancelAll drops in-flight casts", () => {
    const log: string[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(meleeImpact, tracingHooks(log));
    expect(orch.activeCount).toBe(1);
    orch.cancelAll();
    expect(orch.activeCount).toBe(0);
    orch.update(1); // no further phases fire
    expect(log).toEqual(["cast"]);
  });
});

/** A deployable entity (turret / gadget): spawn, repeating ticks, then expire. */
const deployed: AbilityDef = {
  id: "deploy:turret",
  name: "turret",
  kind: "turret",
  color: 0x8fd0ff,
  target: "aoe",
  deploy: { life: 6.0, firstTick: 0.5, interval: 1.4, ticks: 4 },
};

/** Hooks that record deploy/tick/expire ordering and the scheduled tick times. */
function deployHooks(log: string[], ticks: number[], opts?: { omitExpire?: boolean }): AbilityHooks {
  const hooks: AbilityHooks = {
    onDeploy: () => log.push("deploy"),
    onTick: (at) => {
      log.push("tick");
      ticks.push(at);
    },
  };
  if (!opts?.omitExpire) hooks.onExpire = () => log.push("expire");
  return hooks;
}

describe("AbilityOrchestrator deploy lifecycle (turret / gadget)", () => {
  it("spawns synchronously, then stays active across its whole lifetime", () => {
    const log: string[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(deployed, deployHooks(log, []));
    // onDeploy fires inside cast(); the entity is now live (no cast/impact path).
    expect(log).toEqual(["deploy"]);
    expect(orch.activeCount).toBe(1);
    orch.update(0.4); // before the first tick at 0.5s
    expect(log).toEqual(["deploy"]);
    expect(orch.activeCount).toBe(1); // still standing
  });

  it("fires every tick on schedule (firstTick, then each interval) then expires", () => {
    const log: string[] = [];
    const ticks: number[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(deployed, deployHooks(log, ticks));
    // Drive 60fps frames across the full 6s lifetime.
    for (let t = 0; t < 6.5; t += 1 / 60) orch.update(1 / 60);
    // Exactly 4 ticks at the scheduled times 0.5, 1.9, 3.3, 4.7, then a single expire.
    expect(log).toEqual(["deploy", "tick", "tick", "tick", "tick", "expire"]);
    expect(ticks).toHaveLength(4);
    [0.5, 1.9, 3.3, 4.7].forEach((expected, i) => expect(ticks[i]).toBeCloseTo(expected, 5));
    orch.update(0); // sweep the finished cast
    expect(orch.activeCount).toBe(0);
  });

  it("fires multiple due ticks in one oversized frame (like a drained schedule)", () => {
    const log: string[] = [];
    const ticks: number[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(deployed, deployHooks(log, ticks));
    orch.update(2.0); // crosses both the 0.5s and 1.9s ticks in a single step
    expect(log).toEqual(["deploy", "tick", "tick"]);
    expect(ticks).toEqual([0.5, 1.9]);
  });

  it("expires exactly once at end of life, even with no expire hook supplied", () => {
    const log: string[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(deployed, deployHooks(log, [], { omitExpire: true }));
    for (let t = 0; t < 8; t += 0.5) orch.update(0.5);
    // No "expire" entry (hook omitted) and the cast is gone — no further ticks.
    expect(log.filter((e) => e === "tick")).toHaveLength(4);
    expect(log).not.toContain("expire");
    expect(orch.activeCount).toBe(0);
  });

  it("cancelAll stops a deployed entity mid-life (no further ticks or expire)", () => {
    const log: string[] = [];
    const orch = new AbilityOrchestrator();
    orch.cast(deployed, deployHooks(log, []));
    orch.update(0.6); // first tick fired
    expect(log).toEqual(["deploy", "tick"]);
    orch.cancelAll();
    expect(orch.activeCount).toBe(0);
    orch.update(10); // nothing more should fire
    expect(log).toEqual(["deploy", "tick"]);
  });

  it("never fires more ticks than the lifetime allows even if life is generous", () => {
    const log: string[] = [];
    const ticks: number[] = [];
    const orch = new AbilityOrchestrator();
    // 2 ticks budgeted but a long life — the tick cap, not the lifetime, bounds it.
    orch.cast(
      { ...deployed, deploy: { life: 100, firstTick: 0.5, interval: 1.0, ticks: 2 } },
      deployHooks(log, ticks),
    );
    for (let t = 0; t < 10; t += 0.25) orch.update(0.25);
    expect(ticks).toEqual([0.5, 1.5]); // only 2 ticks ever fire
    expect(log).not.toContain("expire"); // still standing (life=100 not reached)
    expect(orch.activeCount).toBe(1);
  });
});

/**
 * The legacy turret used `schedule(0.5 + v * gap, fireVolley)` for v in
 * [0, volleys). This locks the migrated deploy phase firing its ticks on exactly
 * the same frames that bank of independent schedules would, across an uneven dt
 * stream — the same frame-for-frame contract the timed-cast migration holds to.
 */
describe("AbilityOrchestrator deploy timing contract (vs legacy volley schedule)", () => {
  it("fires each tick on the same frame a schedule(0.5 + v*gap) bank would", () => {
    const firstTick = 0.5;
    const gap = 1.4;
    const ticks = 4;
    const dts = [0.3, 0.4, 0.25, 0.5, 0.2, 0.6, 0.3, 0.45, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

    // Reference: a bank of independent schedules, one per volley, recording frames.
    const refScheduler = new RefScheduler();
    const refFrames: number[] = [];
    let frameNow = 0;
    for (let v = 0; v < ticks; v++) {
      refScheduler.schedule(firstTick + v * gap, () => refFrames.push(frameNow));
    }

    // Orchestrator: the migrated deploy phase recording the frame each tick fires.
    const orch = new AbilityOrchestrator();
    const orchFrames: number[] = [];
    orch.cast(
      { ...deployed, deploy: { life: 100, firstTick, interval: gap, ticks } },
      { onTick: () => orchFrames.push(frameNow) },
    );

    for (let frame = 0; frame < dts.length; frame++) {
      frameNow = frame;
      refScheduler.update(dts[frame]);
      orch.update(dts[frame]);
    }

    expect(orchFrames).toEqual(refFrames);
    expect(orchFrames).toHaveLength(ticks);
  });
});

/**
 * Reference re-implementation of Studio's legacy `schedule`/`updatePending`
 * countdown: `t -= dt` each tick and fire once `t <= 0`. The migration (Task
 * #113) replaced these inline `schedule(delay, …)` calls with an orchestrator
 * cast whose `cast.duration` is that same delay. Because `Studio.update` runs
 * `orchestrator.update(dt)` adjacent to `updatePending(dt)` with the SAME dt,
 * the orchestrator's timed impact MUST land on exactly the same frame the old
 * schedule fired. These tests lock that frame-for-frame equivalence in so a
 * future change to the orchestrator's countdown can't silently shift timing.
 */
class RefScheduler {
  private pending: { t: number; fn: () => void }[] = [];
  schedule(delay: number, fn: () => void): void {
    this.pending.push({ t: delay, fn });
  }
  update(dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        this.pending.splice(i, 1);
        p.fn();
      }
    }
  }
}

/** A non-travel, timed cast: wind-up `duration`, then impact (no status). */
function timedCast(duration: number): AbilityDef {
  return { id: "timed", name: "Timed", kind: "slash", color: 0x9fe8ff, target: "aimed", cast: { duration } };
}

describe("AbilityOrchestrator timing contract (vs legacy schedule)", () => {
  it("a timed cast's onImpact fires on the same frame a schedule(delay) would, across an uneven dt sequence", () => {
    const delay = 0.5;
    // An irregular tick stream (variable frame times) that crosses `delay` mid-run.
    const dts = [0.016, 0.1, 0.05, 0.2, 0.09, 0.05, 0.1, 0.016];

    // Reference: drive the legacy schedule, capturing which frame it fires on.
    let refFiredFrame = -1;
    let refDone = false;
    const refScheduler = new RefScheduler();
    refScheduler.schedule(delay, () => {
      refDone = true;
    });

    // Orchestrator: the migrated path records the frame its impact lands on.
    const orch = new AbilityOrchestrator();
    let orchFiredFrame = -1;
    orch.cast(timedCast(delay), { onImpact: () => {} });

    let accum = 0;
    let impactAccum = -1;
    for (let frame = 0; frame < dts.length; frame++) {
      const dt = dts[frame];
      accum += dt;

      const before = refDone;
      refScheduler.update(dt);
      if (!before && refDone && refFiredFrame === -1) refFiredFrame = frame;

      const wasActive = orch.activeCount > 0;
      orch.update(dt);
      if (wasActive && orch.activeCount === 0 && orchFiredFrame === -1) {
        orchFiredFrame = frame;
        impactAccum = accum;
      }
    }

    // Both fired, on the SAME frame, and not before the delay had accumulated.
    expect(refFiredFrame).toBeGreaterThanOrEqual(0);
    expect(orchFiredFrame).toBe(refFiredFrame);
    expect(impactAccum).toBeGreaterThanOrEqual(delay);
    // The prior frame's accumulated time was still under the delay (fires the
    // first frame the countdown crosses zero — exactly like the schedule).
    const prevAccum = impactAccum - dts[orchFiredFrame];
    expect(prevAccum).toBeLessThan(delay);
  });

  it("an instant cast fires onCast synchronously inside cast() with no ticks", () => {
    const orch = new AbilityOrchestrator();
    const order: string[] = [];
    let castReturned = false;
    orch.cast(instantStatus, {
      onCast: () => order.push(castReturned ? "cast:after-return" : "cast:sync"),
      onImpact: () => order.push("impact"),
      onStatus: () => order.push("status"),
    });
    castReturned = true;
    // onCast (and the rest of the instant lifecycle) ran entirely within cast().
    expect(order).toEqual(["cast:sync", "impact", "status"]);
    expect(orch.activeCount).toBe(0);
  });

  it("a wind-up cast holds onImpact until exactly `duration` has accumulated", () => {
    const orch = new AbilityOrchestrator();
    const log: string[] = [];
    orch.cast(timedCast(0.3), { onCast: () => log.push("cast"), onImpact: () => log.push("impact") });
    expect(log).toEqual(["cast"]); // synchronous cast, impact still pending
    orch.update(0.1);
    orch.update(0.1);
    expect(log).toEqual(["cast"]); // 0.2s < 0.3s: still winding up
    orch.update(0.1); // crosses 0.3s
    expect(log).toEqual(["cast", "impact"]);
    expect(orch.activeCount).toBe(0);
  });

  it("the travel fail-safe forces impact the first frame flight time crosses maxFlight (no hit reported)", () => {
    const maxFlight = projectile.travel!.maxFlight; // 3s
    const windup = projectile.cast!.duration; // 0.5s
    // dt stream that finishes the wind-up, then keeps flying until past maxFlight.
    const dts = [0.5, 0.4, 0.6, 0.5, 0.5, 0.5, 0.5];

    const orch = new AbilityOrchestrator();
    let impactFrame = -1;
    let released = false;
    // onTravel intentionally never reports a hit -> the fail-safe must fire.
    orch.cast(projectile, {
      onRelease: () => (released = true),
      onTravel: () => {},
      onImpact: () => {},
      onStatus: () => {},
    });

    // The travel timer starts the frame AFTER release (the release-frame dt is
    // consumed by the wind-up countdown). Accumulate flight time from then on and
    // confirm the forced impact lands the first frame it reaches maxFlight.
    let flightAccum = 0;
    let flightAtImpact = -1;
    let prevFlightAccum = 0;
    let wasReleased = false;
    for (let frame = 0; frame < dts.length; frame++) {
      const dt = dts[frame];
      const wasActive = orch.activeCount > 0;
      // Count flight time only on frames where the cast was already in travel
      // before this update (matches when the orchestrator decrements its timer).
      if (wasReleased) {
        prevFlightAccum = flightAccum;
        flightAccum += dt;
      }
      orch.update(dt);
      if (released) wasReleased = true;
      if (wasActive && orch.activeCount === 0 && impactFrame === -1) {
        impactFrame = frame;
        flightAtImpact = flightAccum;
      }
    }

    expect(impactFrame).toBeGreaterThanOrEqual(0);
    // Impact landed once flight time crossed maxFlight, not before.
    expect(flightAtImpact).toBeGreaterThanOrEqual(maxFlight);
    expect(prevFlightAccum).toBeLessThan(maxFlight);
    // Sanity: total real time elapsed includes the wind-up plus the full flight.
    expect(windup + flightAtImpact).toBeGreaterThanOrEqual(windup + maxFlight);
  });
});
