import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  MAX_GRAVITY_LEAN,
  createHairMotionRig,
  gravityLean,
  motionPhase,
} from "./hairMotion";
import type { BoxMotion, ProtrusionBox } from "./composeHead";

const box = (over: Partial<ProtrusionBox> & { motion: BoxMotion }): ProtrusionBox & { motion: BoxMotion } => ({
  x: 0,
  y: -0.5,
  z: 0,
  w: 0.1,
  h: 0.5,
  d: 0.1,
  color: 0x333333,
  ...over,
});

describe("gravityLean", () => {
  it("is zero for an upright head (down = -Y)", () => {
    const { rx, rz } = gravityLean(0, -1, 0, 1);
    expect(rx).toBeCloseTo(0, 12);
    expect(rz).toBeCloseTo(0, 12);
  });

  it("leans toward the lateral down components with the right signs", () => {
    // down drifts toward +Z (head pitched back) → hair rotates -X to follow
    expect(gravityLean(0, -1, 0.5, 1).rx).toBeLessThan(0);
    expect(gravityLean(0, -1, -0.5, 1).rx).toBeGreaterThan(0);
    // down drifts toward +X → hair rotates +Z
    expect(gravityLean(0.5, -1, 0, 1).rz).toBeGreaterThan(0);
    expect(gravityLean(-0.5, -1, 0, 1).rz).toBeLessThan(0);
  });

  it("scales with the gravity coefficient and is zero at gravity 0", () => {
    const full = gravityLean(0.4, -1, 0, 1).rz;
    const half = gravityLean(0.4, -1, 0, 0.5).rz;
    expect(half).toBeCloseTo(full / 2, 10);
    expect(gravityLean(0.4, -1, 0, 0).rz).toBe(0);
  });

  it("clamps extreme tilts (even upside-down) to the max lean", () => {
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [0, 1, 0.9],
      [-1, 1, 1],
    ] as const) {
      const { rx, rz } = gravityLean(dx, dy, dz, 1);
      expect(Math.abs(rx)).toBeLessThanOrEqual(MAX_GRAVITY_LEAN + 1e-9);
      expect(Math.abs(rz)).toBeLessThanOrEqual(MAX_GRAVITY_LEAN + 1e-9);
    }
  });
});

describe("motionPhase", () => {
  it("is deterministic and shared for a shared anchor", () => {
    expect(motionPhase(0.5, -0.53)).toBe(motionPhase(0.5, -0.53));
  });

  it("differs across distinct anchors", () => {
    const phases = new Set(
      [-0.39, -0.13, 0.13, 0.39].map((x) => motionPhase(x, -0.53)),
    );
    expect(phases.size).toBe(4);
  });
});

describe("createHairMotionRig", () => {
  it("wraps a mesh in a pivot at the anchor with a root-relative offset", () => {
    const rig = createHairMotionRig();
    const mesh = new THREE.Mesh();
    const b = box({ y: -0.6, motion: { ax: 0.1, ay: 0.4, az: -0.5, sway: 0.05, gravity: 0.5 } });
    const pivot = rig.wrap(b, mesh);
    expect(rig.size).toBe(1);
    expect(pivot.position.toArray()).toEqual([0.1, 0.4, -0.5]);
    expect(mesh.position.x).toBeCloseTo(b.x - 0.1);
    expect(mesh.position.y).toBeCloseTo(b.y - 0.4);
    expect(mesh.position.z).toBeCloseTo(b.z - (-0.5));
    // world position of the mesh is unchanged by the pivot wrap
    pivot.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    mesh.getWorldPosition(world);
    expect(world.x).toBeCloseTo(b.x);
    expect(world.y).toBeCloseTo(b.y);
    expect(world.z).toBeCloseTo(b.z);
  });

  it("segments sharing one anchor swing in lockstep (rigid braid)", () => {
    const rig = createHairMotionRig();
    const motion: BoxMotion = { ax: 0.2, ay: 0.42, az: -0.53, sway: 0.06, gravity: 0.6 };
    const p1 = rig.wrap(box({ y: -0.2, motion }), new THREE.Mesh());
    const p2 = rig.wrap(box({ y: -0.6, motion }), new THREE.Mesh());
    rig.update(1.7);
    expect(p1.rotation.x).toBeCloseTo(p2.rotation.x, 12);
    expect(p1.rotation.z).toBeCloseTo(p2.rotation.z, 12);
    expect(Math.abs(p1.rotation.x) + Math.abs(p1.rotation.z)).toBeGreaterThan(0);
  });

  it("distinct anchors get distinct phases (no metronome hair)", () => {
    const rig = createHairMotionRig();
    const mk = (ax: number) =>
      rig.wrap(box({ motion: { ax, ay: 0.42, az: -0.53, sway: 0.06, gravity: 0.6 } }), new THREE.Mesh());
    const a = mk(-0.39);
    const b = mk(0.39);
    rig.update(0.9);
    expect(a.rotation.x).not.toBeCloseTo(b.rotation.x, 6);
  });

  it("a tilted head quaternion produces a gravity lean on top of the sway", () => {
    const rig = createHairMotionRig();
    const motion: BoxMotion = { ax: 0, ay: 0.42, az: -0.53, sway: 0, gravity: 1 };
    const pivot = rig.wrap(box({ motion }), new THREE.Mesh());
    // upright: no sway, no lean
    rig.update(0, new THREE.Quaternion());
    expect(pivot.rotation.x).toBeCloseTo(0, 9);
    expect(pivot.rotation.z).toBeCloseTo(0, 9);
    // roll the head about Z: down acquires a local X component → Z lean
    const rolled = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.6));
    rig.update(0, rolled);
    expect(Math.abs(pivot.rotation.z)).toBeGreaterThan(0.1);
  });
});
