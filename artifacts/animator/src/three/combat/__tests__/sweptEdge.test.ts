import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  capsuleCapsule,
  closestSegmentSegment,
  sweepSteps,
  sweptEdgeVsCapsule,
  type Capsule,
} from "../sweptEdge";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const cap = (a: THREE.Vector3, b: THREE.Vector3, radius: number): Capsule => ({ a, b, radius });

describe("closestSegmentSegment", () => {
  it("finds the gap between two parallel offset segments", () => {
    const o1 = v(0, 0, 0);
    const o2 = v(0, 0, 0);
    const d2 = closestSegmentSegment(v(0, 0, 0), v(1, 0, 0), v(0, 2, 0), v(1, 2, 0), o1, o2);
    expect(Math.sqrt(d2)).toBeCloseTo(2, 5);
  });

  it("returns zero when segments cross", () => {
    const o1 = v(0, 0, 0);
    const o2 = v(0, 0, 0);
    const d2 = closestSegmentSegment(v(-1, 0, 0), v(1, 0, 0), v(0, -1, 0), v(0, 1, 0), o1, o2);
    expect(d2).toBeCloseTo(0, 6);
    expect(o1.distanceTo(v(0, 0, 0))).toBeCloseTo(0, 5);
  });

  it("handles a degenerate (point) segment", () => {
    const o1 = v(0, 0, 0);
    const o2 = v(0, 0, 0);
    const d2 = closestSegmentSegment(v(5, 0, 0), v(5, 0, 0), v(0, 0, 0), v(10, 0, 0), o1, o2);
    expect(d2).toBeCloseTo(0, 6);
  });
});

describe("capsuleCapsule", () => {
  it("reports overlap depth when capsules interpenetrate", () => {
    const x = cap(v(0, 0, 0), v(2, 0, 0), 0.5);
    const y = cap(v(1, 0.5, 0), v(1, 2, 0), 0.5);
    const p = v(0, 0, 0);
    const depth = capsuleCapsule(x, y, p);
    // gap between edges is 0.5, radii sum 1.0 → depth 0.5
    expect(depth).toBeCloseTo(0.5, 5);
  });

  it("reports a negative gap when capsules are apart", () => {
    const x = cap(v(0, 0, 0), v(1, 0, 0), 0.2);
    const y = cap(v(0, 3, 0), v(1, 3, 0), 0.2);
    expect(capsuleCapsule(x, y)).toBeLessThan(0);
  });
});

describe("sweptEdgeVsCapsule", () => {
  const body = cap(v(2, 0, 0), v(2, 1.8, 0), 0.4);

  it("misses when the edge stays clear across the whole sweep", () => {
    const hit = sweptEdgeVsCapsule(v(-1, 1, 0), v(-1, 1.5, 0), v(0, 1, 0), v(0, 1.5, 0), 0.1, body, 8);
    expect(hit).toBeNull();
  });

  it("hits when the edge ends inside the target", () => {
    const hit = sweptEdgeVsCapsule(v(0, 1, 0), v(0, 1.5, 0), v(2, 1, 0), v(2, 1.5, 0), 0.1, body, 8);
    expect(hit).not.toBeNull();
    expect(hit!.depth).toBeGreaterThan(0);
  });

  it("catches a fast pass-through via sub-stepping (no tunneling)", () => {
    // A thin edge jumps from one side of the body to the other in one frame.
    const thin = cap(v(2, 0.8, 0), v(2, 1.0, 0), 0.15);
    const near = sweptEdgeVsCapsule(v(0, 0.9, 0), v(0, 0.9, 0.001), v(4, 0.9, 0), v(4, 0.9, 0.001), 0.05, thin, 8);
    expect(near).not.toBeNull();
    // With only 1 step the endpoints straddle the target and it tunnels.
    const tunneled = sweptEdgeVsCapsule(v(0, 0.9, 0), v(0, 0.9, 0.001), v(4, 0.9, 0), v(4, 0.9, 0.001), 0.05, thin, 1);
    expect(tunneled).toBeNull();
  });
});

describe("sweepSteps", () => {
  it("uses one step when barely moving", () => {
    expect(sweepSteps(0.001, 0.4)).toBe(1);
  });
  it("scales up with travel distance and clamps to max", () => {
    expect(sweepSteps(0.4, 0.4)).toBe(2);
    expect(sweepSteps(100, 0.4, 8)).toBe(8);
  });
});
