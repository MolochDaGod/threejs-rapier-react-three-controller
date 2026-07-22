import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  closestPointOnSegment,
  computeParryRebound,
  isParryableProjectileKind,
  isProjectileParryState,
  pickProjectileParryClips,
  pointHitsWeaponCollider,
  PARRY_REBOUND_SPEED_MUL,
} from "./projectileParry";

describe("projectileParry", () => {
  it("closestPointOnSegment clamps to ends", () => {
    const a = new THREE.Vector3(0, 0, 0);
    const b = new THREE.Vector3(0, 1, 0);
    const out = new THREE.Vector3();
    closestPointOnSegment(new THREE.Vector3(0, -1, 0), a, b, out);
    expect(out.y).toBeCloseTo(0, 5);
    closestPointOnSegment(new THREE.Vector3(0, 2, 0), a, b, out);
    expect(out.y).toBeCloseTo(1, 5);
    closestPointOnSegment(new THREE.Vector3(0.1, 0.5, 0), a, b, out);
    expect(out.y).toBeCloseTo(0.5, 5);
  });

  it("pointHitsWeaponCollider uses blade capsule", () => {
    const col = {
      a: new THREE.Vector3(0, 0, 0),
      b: new THREE.Vector3(0, 1, 0),
      radius: 0.15,
    };
    expect(pointHitsWeaponCollider(new THREE.Vector3(0, 0.5, 0.1), col)).toBe(true);
    expect(pointHitsWeaponCollider(new THREE.Vector3(0, 0.5, 0.5), col)).toBe(false);
  });

  it("computeParryRebound is 2× speed and aims toward caster", () => {
    const incoming = new THREE.Vector3(0, 0, 10); // flying +Z
    const hit = new THREE.Vector3(0, 1, 5);
    const caster = new THREE.Vector3(0, 1, 0); // behind the shot
    const r = computeParryRebound(incoming, hit, caster, PARRY_REBOUND_SPEED_MUL);
    expect(r.outSpeed).toBeCloseTo(20, 5);
    expect(r.vel.length()).toBeCloseTo(20, 5);
    // Should fly mostly toward -Z (caster)
    expect(r.dir.z).toBeLessThan(0);
  });

  it("isProjectileParryState only accepts parry", () => {
    expect(isProjectileParryState("parry")).toBe(true);
    expect(isProjectileParryState("block")).toBe(false);
    expect(isProjectileParryState("idle")).toBe(false);
  });

  it("isParryableProjectileKind allows arrows/bullets/orbs only", () => {
    expect(isParryableProjectileKind("bolt")).toBe(true);
    expect(isParryableProjectileKind("muzzle")).toBe(true);
    expect(isParryableProjectileKind("soul")).toBe(true);
    expect(isParryableProjectileKind("arrow")).toBe(true);
    expect(isParryableProjectileKind("bullet")).toBe(true);
    expect(isParryableProjectileKind("orb")).toBe(true);
    // excluded
    expect(isParryableProjectileKind("nova")).toBe(false);
    expect(isParryableProjectileKind("meteor")).toBe(false);
    expect(isParryableProjectileKind("slam")).toBe(false);
    expect(isParryableProjectileKind("throwBomb")).toBe(false);
    expect(isParryableProjectileKind("grenade")).toBe(false);
    expect(isParryableProjectileKind("thrown")).toBe(false);
    expect(isParryableProjectileKind("ultimate")).toBe(false);
  });

  it("pickProjectileParryClips blends directional + family clips", () => {
    expect(pickProjectileParryClips("bolt", "front").primary).toBe("parryReact");
    expect(pickProjectileParryClips("bolt", "left").secondary).toBe("blockLeft");
    expect(pickProjectileParryClips("muzzle", "front").secondary).toBe("blockReactHeavy");
    expect(pickProjectileParryClips("soul", "front").secondary).toBe("blockReact");
  });
});
