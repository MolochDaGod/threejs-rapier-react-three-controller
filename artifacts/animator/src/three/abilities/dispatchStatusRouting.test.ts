import { describe, expect, it, vi } from "vitest";
import {
  dispatchStatusRouting,
  routeStatusScope,
  type StatusApplySink,
  type StatusRouting,
} from "./statusScopeRouting";

/**
 * Exercises the apply-vs-applyAll layer that {@link Studio.applyStatusScoped}
 * drives — the bridge from a routing decision to the StatusManager. It mirrors
 * the routing test in spirit (pure, THREE-free) but covers what routing does
 * NOT: that the right method fires and the per-target position-provider closures
 * point at the right entity and stay live.
 */

interface Vec {
  x: number;
}

/** A target whose position can move after the closure is built. */
function target(id: string, x: number): { id: string; position: Vec } {
  return { id, position: { x } };
}

/** A recording sink standing in for the real StatusController. */
function recordingSink<P>(): StatusApplySink<P> & {
  applyCalls: Array<() => P | undefined>;
  applyAllCalls: Array<Array<() => P>>;
} {
  const applyCalls: Array<() => P | undefined> = [];
  const applyAllCalls: Array<Array<() => P>> = [];
  return {
    applyCalls,
    applyAllCalls,
    apply: vi.fn((anchor?: () => P) => {
      applyCalls.push(anchor as () => P | undefined);
    }),
    applyAll: vi.fn((anchors: Array<() => P>) => {
      applyAllCalls.push(anchors);
    }),
  };
}

describe("dispatchStatusRouting", () => {
  it("an AOE ally status applies once to every gathered ally", () => {
    const allies = [target("a1", 1), target("a2", 2), target("a3", 3)];
    const routing: StatusRouting<(typeof allies)[number]> = { kind: "aoe", targets: allies };
    const sink = recordingSink<Vec>();

    dispatchStatusRouting(routing, (g) => g.position, sink);

    // applyAll fires exactly once; apply (single/self) never does.
    expect(sink.applyAll).toHaveBeenCalledTimes(1);
    expect(sink.apply).not.toHaveBeenCalled();

    // One anchor per ally, resolving to that ally's own position.
    const anchors = sink.applyAllCalls[0];
    expect(anchors).toHaveLength(allies.length);
    expect(anchors.map((a) => a())).toEqual(allies.map((g) => g.position));
  });

  it("a single-target status applies exactly once to the resolved group", () => {
    const ally = target("ally", 5);
    const routing: StatusRouting<typeof ally> = { kind: "single", target: ally };
    const sink = recordingSink<Vec>();

    dispatchStatusRouting(routing, (g) => g.position, sink);

    expect(sink.apply).toHaveBeenCalledTimes(1);
    expect(sink.applyAll).not.toHaveBeenCalled();

    const anchor = sink.applyCalls[0];
    expect(anchor).toBeTypeOf("function");
    expect(anchor!()).toBe(ally.position);
  });

  it("a self status applies once with no anchor (lands on the caster)", () => {
    const routing: StatusRouting<never> = { kind: "self" };
    const sink = recordingSink<Vec>();

    dispatchStatusRouting(routing, () => ({ x: 0 }), sink);

    expect(sink.apply).toHaveBeenCalledTimes(1);
    expect(sink.applyAll).not.toHaveBeenCalled();
    expect(sink.applyCalls[0]).toBeUndefined();
  });

  it("anchors read positions lazily so a moving target keeps its aura", () => {
    const ally = target("mover", 0);
    const routing: StatusRouting<typeof ally> = { kind: "single", target: ally };
    const sink = recordingSink<Vec>();

    dispatchStatusRouting(routing, (g) => g.position, sink);
    const anchor = sink.applyCalls[0]!;

    // The aura should follow the target frame to frame, not freeze at cast time.
    ally.position = { x: 42 };
    expect(anchor().x).toBe(42);
  });

  it("AOE anchors are independent — each follows only its own ally", () => {
    const allies = [target("a1", 1), target("a2", 2)];
    const routing: StatusRouting<(typeof allies)[number]> = { kind: "aoe", targets: allies };
    const sink = recordingSink<Vec>();

    dispatchStatusRouting(routing, (g) => g.position, sink);
    const [anchor1, anchor2] = sink.applyAllCalls[0];

    allies[0].position = { x: 100 };
    expect(anchor1().x).toBe(100);
    expect(anchor2().x).toBe(2);
  });

  it("end-to-end: an AOE ally scope routes then dispatches to every ally", () => {
    const aoeAllies = [target("a1", 1), target("a2", 2)];
    const routing = routeStatusScope("aoeAlly", { aoeAllies });
    const sink = recordingSink<Vec>();

    dispatchStatusRouting(routing, (g) => g.position, sink);

    expect(sink.applyAll).toHaveBeenCalledTimes(1);
    expect(sink.applyAllCalls[0].map((a) => a())).toEqual(aoeAllies.map((g) => g.position));
  });

  it("end-to-end: an ally scope with no selection falls back to a self cast", () => {
    const routing = routeStatusScope("ally", { selectedAlly: null });
    const sink = recordingSink<Vec>();

    dispatchStatusRouting(routing, (g: { position: Vec }) => g.position, sink);

    expect(sink.apply).toHaveBeenCalledTimes(1);
    expect(sink.applyCalls[0]).toBeUndefined();
    expect(sink.applyAll).not.toHaveBeenCalled();
  });
});
