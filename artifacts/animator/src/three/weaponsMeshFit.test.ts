import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { mountWeapon, unmountWeapon } from "./Weapons";
import { getWeapon } from "./assets";

/**
 * Coverage for the mesh-fitted weapon collider: the blade capsule (edgeA/edgeB/
 * edgeRadius) and the per-slice wrap profile must come from the ACTUAL mounted
 * geometry, not the stock per-group HIT_DEFAULTS radius. Exercised through the
 * synchronous procedural mount path (real production code, no WebGL needed).
 */

function mount(id: Parameters<typeof mountWeapon>[0]) {
  const right = new THREE.Object3D();
  const left = new THREE.Object3D();
  return mountWeapon(id, right, left);
}

describe("mesh-fitted weapon collider", () => {
  it("sword: profile wraps the mesh and the capsule is tighter than the stock radius", () => {
    const m = mount("sword");
    try {
      expect(m.edgeA).not.toBeNull();
      expect(m.edgeB).not.toBeNull();
      expect(m.profile).not.toBeNull();
      expect(m.profile!.length).toBeGreaterThanOrEqual(8);
      // Procedural sword blade is a 0.08 x 1.0 x 0.02 box → half-diagonal ≈ 0.041.
      // Stock melee-1h default was 0.11; the fit (+ small pad) must be tighter.
      expect(m.edgeRadius).toBeLessThan(0.11);
      expect(m.edgeRadius).toBeGreaterThanOrEqual(0.05);
      // Slices near the tip must hug the thin blade, not the wide guard.
      const tipY = m.edgeB!.position.y;
      const nearTip = m.profile!.filter((s) => s.y > tipY * 0.7);
      expect(nearTip.length).toBeGreaterThan(0);
      for (const s of nearTip) expect(s.r).toBeLessThan(0.08);
    } finally {
      unmountWeapon(m);
    }
  });

  it("axe: capsule centreline leans into the offset head and radius covers it", () => {
    const m = mount("axe");
    try {
      expect(m.profile).not.toBeNull();
      // Head box is offset to +Z (z centre 0.12) — the fitted centreline follows.
      expect(m.edgeB!.position.z).toBeGreaterThan(0.01);
      // Head extends ~0.32 in Z near the top — far beyond the 0.04 handle.
      expect(m.edgeRadius).toBeGreaterThan(0.1);
      const headSlices = m.profile!.filter((s) => s.y > 0.75 && s.y < 1.05);
      expect(Math.max(...headSlices.map((s) => s.r))).toBeGreaterThan(0.15);
      // Mid-handle slices stay thin — the wrap is NOT one fat cylinder.
      const handleSlices = m.profile!.filter((s) => s.y > 0.3 && s.y < 0.6);
      expect(handleSlices.length).toBeGreaterThan(0);
      for (const s of handleSlices) expect(s.r).toBeLessThan(0.09);
    } finally {
      unmountWeapon(m);
    }
  });

  it("non-blade weapons still mount with no blade collider", () => {
    const m = mount("bow");
    try {
      expect(m.edgeA).toBeNull();
      expect(m.edgeB).toBeNull();
      expect(m.profile).toBeNull();
    } finally {
      unmountWeapon(m);
    }
  });

  it("hand-authored def.hit wins verbatim over the mesh fit", () => {
    const def = getWeapon("sword");
    const prevHit = def.hit;
    def.hit = { a: [0, 0.4, 0], b: [0, 1.0, 0], radius: 0.2 };
    try {
      const m = mount("sword");
      try {
        expect(m.edgeRadius).toBeCloseTo(0.2, 5);
        expect(m.edgeA!.position.y).toBeCloseTo(0.4, 5);
        expect(m.edgeB!.position.y).toBeCloseTo(1.0, 5);
        // The wrap profile is still computed for visualization.
        expect(m.profile).not.toBeNull();
      } finally {
        unmountWeapon(m);
      }
    } finally {
      def.hit = prevHit;
    }
  });
});
