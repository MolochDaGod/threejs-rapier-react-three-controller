import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  StatusController,
  STATUS_DEFS,
  type StatusAuraHandle,
  type StatusDef,
} from "./StatusFx";

/**
 * Covers the StatusController's own lifetime logic — the part NOT exercised by
 * the routing/dispatch tests: timer countdown/expiry, the aura-pool resize on
 * re-apply (reuse / grow / trim), and per-tick anchor resolution. The real
 * {@link StatusAura} needs a canvas + WebGL, so a fake aura factory is injected
 * to drive the controller in the plain node test env.
 */

/** A WebGL-free aura that records every update center + its disposal. */
class FakeAura implements StatusAuraHandle {
  readonly centers: THREE.Vector3[] = [];
  disposed = false;
  constructor(readonly def: StatusDef) {}
  update(_dt: number, center: THREE.Vector3): void {
    this.centers.push(center.clone());
  }
  dispose(): void {
    this.disposed = true;
  }
  /** The center passed on the most recent update tick. */
  get lastCenter(): THREE.Vector3 | undefined {
    return this.centers[this.centers.length - 1];
  }
}

/** A factory + ledger of every aura it has ever produced. */
function fakeFactory(): {
  make: (def: StatusDef) => FakeAura;
  built: FakeAura[];
} {
  const built: FakeAura[] = [];
  return {
    built,
    make: (def) => {
      const a = new FakeAura(def);
      built.push(a);
      return a;
    },
  };
}

function controller() {
  const factory = fakeFactory();
  // The scene is unused once a factory is injected; a bare Scene avoids WebGL.
  const ctrl = new StatusController(new THREE.Scene(), factory.make);
  return { ctrl, factory };
}

describe("StatusController timers", () => {
  it("counts a timer down and reports remaining via views()", () => {
    const { ctrl } = controller();
    ctrl.apply("burning"); // duration 6
    expect(ctrl.active).toBe(true);
    expect(ctrl.views()[0].remaining).toBeCloseTo(STATUS_DEFS.burning.duration);

    ctrl.update(2, new THREE.Vector3());
    expect(ctrl.views()[0].remaining).toBeCloseTo(STATUS_DEFS.burning.duration - 2);
  });

  it("clears the status and disposes its auras when the timer expires", () => {
    const { ctrl, factory } = controller();
    ctrl.apply("shocked"); // duration 4
    const aura = factory.built[0];

    ctrl.update(3.9, new THREE.Vector3());
    expect(ctrl.active).toBe(true);
    expect(aura.disposed).toBe(false);

    // Crossing the duration clears the timer and tears the aura down.
    ctrl.update(0.2, new THREE.Vector3());
    expect(ctrl.active).toBe(false);
    expect(ctrl.views()).toHaveLength(0);
    expect(aura.disposed).toBe(true);
  });

  it("re-applying refreshes the timer back to full duration", () => {
    const { ctrl } = controller();
    ctrl.apply("frozen"); // duration 5
    ctrl.update(4, new THREE.Vector3());
    expect(ctrl.views()[0].remaining).toBeCloseTo(1);

    ctrl.apply("frozen");
    expect(ctrl.views()[0].remaining).toBeCloseTo(STATUS_DEFS.frozen.duration);
  });
});

describe("StatusController aura-pool resize", () => {
  it("re-applying with FEWER anchors disposes the surplus auras", () => {
    const { ctrl, factory } = controller();
    const anchorsAt = (...xs: number[]) => xs.map((x) => () => new THREE.Vector3(x, 0, 0));

    ctrl.applyAll("regen", anchorsAt(1, 2, 3));
    expect(factory.built).toHaveLength(3);
    const [a0, a1, a2] = factory.built;

    // Re-cast a smaller AOE: the pool trims to one, disposing the extra two.
    ctrl.applyAll("regen", anchorsAt(1));
    expect(a0.disposed).toBe(false); // reused
    expect(a1.disposed).toBe(true); // trimmed
    expect(a2.disposed).toBe(true); // trimmed
    // No new aura was built — the surviving one is reused, not replaced.
    expect(factory.built).toHaveLength(3);
  });

  it("re-applying with MORE anchors grows the pool and reuses survivors", () => {
    const { ctrl, factory } = controller();
    const anchorsAt = (...xs: number[]) => xs.map((x) => () => new THREE.Vector3(x, 0, 0));

    ctrl.applyAll("shielded", anchorsAt(1));
    expect(factory.built).toHaveLength(1);
    const first = factory.built[0];

    ctrl.applyAll("shielded", anchorsAt(1, 2));
    // The original is kept; exactly one new aura is built.
    expect(first.disposed).toBe(false);
    expect(factory.built).toHaveLength(2);
  });

  it("clear() disposes every aura the status owns", () => {
    const { ctrl, factory } = controller();
    const anchorsAt = (...xs: number[]) => xs.map((x) => () => new THREE.Vector3(x, 0, 0));
    ctrl.applyAll("poisoned", anchorsAt(1, 2));

    ctrl.clear("poisoned");
    expect(factory.built.every((a) => a.disposed)).toBe(true);
    expect(ctrl.active).toBe(false);
  });
});

describe("StatusController anchor resolution", () => {
  it("each aura follows its OWN anchor, not the shared center", () => {
    const { ctrl, factory } = controller();
    const anchors = [
      () => new THREE.Vector3(10, 0, 0),
      () => new THREE.Vector3(20, 0, 0),
    ];
    ctrl.applyAll("empowered", anchors);

    ctrl.update(0.1, new THREE.Vector3(99, 99, 99));
    expect(factory.built[0].lastCenter!.x).toBe(10);
    expect(factory.built[1].lastCenter!.x).toBe(20);
  });

  it("an anchorless status tracks the shared center each tick", () => {
    const { ctrl, factory } = controller();
    ctrl.apply("haste"); // no anchor → follows the caster center

    ctrl.update(0.1, new THREE.Vector3(5, 0, 0));
    expect(factory.built[0].lastCenter!.x).toBe(5);

    // A moving caster keeps the aura attached frame to frame.
    ctrl.update(0.1, new THREE.Vector3(7, 0, 0));
    expect(factory.built[0].lastCenter!.x).toBe(7);
  });

  it("anchors are read lazily, so a moving target keeps its aura attached", () => {
    const { ctrl, factory } = controller();
    let pos = new THREE.Vector3(0, 0, 0);
    ctrl.apply("burning", () => pos);

    ctrl.update(0.1, new THREE.Vector3());
    expect(factory.built[0].lastCenter!.x).toBe(0);

    pos = new THREE.Vector3(42, 0, 0);
    ctrl.update(0.1, new THREE.Vector3());
    expect(factory.built[0].lastCenter!.x).toBe(42);
  });
});

describe("StatusController teardown", () => {
  it("dispose() tears down every aura across every status", () => {
    const { ctrl, factory } = controller();
    ctrl.apply("burning");
    ctrl.applyAll("regen", [() => new THREE.Vector3(), () => new THREE.Vector3()]);
    expect(factory.built).toHaveLength(3);

    ctrl.dispose();
    expect(factory.built.every((a) => a.disposed)).toBe(true);
    expect(ctrl.active).toBe(false);
  });
});
