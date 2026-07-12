import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  deriveColliderVfxFrame,
  deriveSlashArcOrigin,
  deriveLaunchOrigin,
  deriveLandingZone,
  deriveTurretBase,
  VFX_CHEST_HEIGHT,
  SLASH_LEAD_OUT,
  METEOR_LANDING_DIST,
  SWORD_VOLLEY_LANDING_DIST,
  TURRET_BACK_OUT,
} from "./colliderVfxFrame";

/**
 * The Skill Lab "emit from collider" toggle is a strict opt-in: with it OFF,
 * EVERY VFX case must collapse to the legacy flat frame (srcPos == origin,
 * aimDir == facing, slashQuat == facingQuat). These tests lock that invariant in
 * so a future VFX case can never accidentally read collider state outside the
 * gate and silently shift default behavior. They also pin the ON path: the
 * slash/turret origin must land on the collider center.
 */

function vecEq(a: THREE.Vector3, b: THREE.Vector3): void {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
}

function quatEq(a: THREE.Quaternion, b: THREE.Quaternion): void {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
  expect(a.w).toBeCloseTo(b.w, 6);
}

describe("deriveColliderVfxFrame — OFF path equals the legacy flat frame", () => {
  it("collapses to origin/facing/facingQuat even when collider data is present", () => {
    const origin = new THREE.Vector3(2, 1, -3);
    const facing = new THREE.Vector3(0, 0, 1);
    const facingQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.7, 0));

    // Collider data is supplied but the toggle is OFF, so it must be ignored.
    const frame = deriveColliderVfxFrame({
      origin,
      facing,
      facingQuat,
      slashFromCollider: false,
      colliderPos: new THREE.Vector3(99, 99, 99),
      colliderQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(1, 1, 1)),
    });

    vecEq(frame.srcPos, origin);
    vecEq(frame.aimDir, facing);
    quatEq(frame.slashQuat, facingQuat);
  });

  it("returns fresh objects so callers can mutate the frame without touching inputs", () => {
    const origin = new THREE.Vector3(1, 2, 3);
    const facing = new THREE.Vector3(0, 0, 1);
    const facingQuat = new THREE.Quaternion();

    const frame = deriveColliderVfxFrame({
      origin,
      facing,
      facingQuat,
      slashFromCollider: false,
      colliderPos: null,
      colliderQuat: null,
    });

    expect(frame.srcPos).not.toBe(origin);
    expect(frame.aimDir).not.toBe(facing);
    expect(frame.slashQuat).not.toBe(facingQuat);

    frame.srcPos.set(0, 0, 0);
    frame.aimDir.set(1, 0, 0);
    frame.slashQuat.set(1, 0, 0, 0);
    vecEq(origin, new THREE.Vector3(1, 2, 3));
    vecEq(facing, new THREE.Vector3(0, 0, 1));
  });

  it("stays on the flat frame when ON but no collider position is available", () => {
    const origin = new THREE.Vector3(5, 0, 5);
    const facing = new THREE.Vector3(0, 0, 1);
    const facingQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.4, 0));

    const frame = deriveColliderVfxFrame({
      origin,
      facing,
      facingQuat,
      slashFromCollider: true,
      colliderPos: null,
      colliderQuat: null,
    });

    vecEq(frame.srcPos, origin);
    vecEq(frame.aimDir, facing);
    quatEq(frame.slashQuat, facingQuat);
  });
});

describe("deriveColliderVfxFrame — ON path binds the frame to the collider", () => {
  it("moves the slash/turret origin onto the collider center", () => {
    const origin = new THREE.Vector3(0, 1, 0);
    const facing = new THREE.Vector3(0, 0, 1);
    const facingQuat = new THREE.Quaternion();
    const colliderPos = new THREE.Vector3(1.5, 1.2, 0.8);

    const frame = deriveColliderVfxFrame({
      origin,
      facing,
      facingQuat,
      slashFromCollider: true,
      colliderPos,
      colliderQuat: null,
    });

    vecEq(frame.srcPos, colliderPos);
  });

  it("takes the collider orientation for the slash arc", () => {
    const origin = new THREE.Vector3(0, 1, 0);
    const facing = new THREE.Vector3(0, 0, 1);
    const facingQuat = new THREE.Quaternion();
    const colliderPos = new THREE.Vector3(0, 1, 2);
    const colliderQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.5, -0.2));

    const frame = deriveColliderVfxFrame({
      origin,
      facing,
      facingQuat,
      slashFromCollider: true,
      colliderPos,
      colliderQuat,
    });

    vecEq(frame.srcPos, colliderPos);
    quatEq(frame.slashQuat, colliderQuat);
  });

  it("with no orientation, aims along the outward chest->collider displacement", () => {
    const origin = new THREE.Vector3(0, 1, 0);
    const facing = new THREE.Vector3(0, 0, 1);
    const facingQuat = new THREE.Quaternion();
    const colliderPos = new THREE.Vector3(3, 1, 4);

    const frame = deriveColliderVfxFrame({
      origin,
      facing,
      facingQuat,
      slashFromCollider: true,
      colliderPos,
      colliderQuat: null,
    });

    const expected = colliderPos.clone().sub(origin).normalize();
    vecEq(frame.aimDir, expected);
    expect(frame.aimDir.length()).toBeCloseTo(1, 6);
  });

  it("re-aims along the collider's most-outward orientation axis", () => {
    // Hand quaternion rotates local +X to point outward (+X world). With the
    // collider out to the right of the body, the orientation-forward axis the
    // derivation picks should be that rotated +X, i.e. roughly world +X.
    const origin = new THREE.Vector3(0, 1, 0);
    const facing = new THREE.Vector3(0, 0, 1);
    const facingQuat = new THREE.Quaternion();
    const colliderPos = new THREE.Vector3(2, 1, 0);
    // Identity orientation: local +X stays world +X.
    const colliderQuat = new THREE.Quaternion();

    const frame = deriveColliderVfxFrame({
      origin,
      facing,
      facingQuat,
      slashFromCollider: true,
      colliderPos,
      colliderQuat,
    });

    vecEq(frame.aimDir, new THREE.Vector3(1, 0, 0));
    expect(frame.aimDir.length()).toBeCloseTo(1, 6);
  });
});

describe("deriveSlashArcOrigin — where the cut is emitted", () => {
  const origin = new THREE.Vector3(2, 1, -3);
  const facing = new THREE.Vector3(0, 0, 1);
  const srcPos = new THREE.Vector3(5, 2, 6);

  it("ON: emits from the collider center", () => {
    const at = deriveSlashArcOrigin({ origin, facing, srcPos, slashFromCollider: true, playing: true });
    vecEq(at, srcPos);
  });

  it("OFF + playing: leads out in front along the flat facing", () => {
    const at = deriveSlashArcOrigin({ origin, facing, srcPos, slashFromCollider: false, playing: true });
    vecEq(at, origin.clone().addScaledVector(facing, SLASH_LEAD_OUT));
  });

  it("OFF + static editor: stays at the body origin", () => {
    const at = deriveSlashArcOrigin({ origin, facing, srcPos, slashFromCollider: false, playing: false });
    vecEq(at, origin);
  });

  it("returns a fresh vector (does not alias srcPos/origin)", () => {
    const onAt = deriveSlashArcOrigin({ origin, facing, srcPos, slashFromCollider: true, playing: true });
    const offAt = deriveSlashArcOrigin({ origin, facing, srcPos, slashFromCollider: false, playing: false });
    expect(onAt).not.toBe(srcPos);
    expect(offAt).not.toBe(origin);
  });
});

describe("deriveLaunchOrigin — fire dragon / dark blades launch point", () => {
  const origin = new THREE.Vector3(2, 1, -3);
  const srcPos = new THREE.Vector3(5, 2, 6);

  it("ON: launches from the collider center", () => {
    const at = deriveLaunchOrigin({ origin, srcPos, slashFromCollider: true });
    vecEq(at, srcPos);
  });

  it("OFF: launches from chest height above the body origin (x/z unchanged)", () => {
    const at = deriveLaunchOrigin({ origin, srcPos, slashFromCollider: false });
    vecEq(at, new THREE.Vector3(origin.x, origin.y + VFX_CHEST_HEIGHT, origin.z));
  });

  it("returns a fresh vector", () => {
    const onAt = deriveLaunchOrigin({ origin, srcPos, slashFromCollider: true });
    expect(onAt).not.toBe(srcPos);
  });
});

describe("deriveLandingZone — meteor / sword-volley landing point", () => {
  const srcPos = new THREE.Vector3(5, 2, 6);
  const aimDir = new THREE.Vector3(1, 0, 0);

  it("OFF: returns null so the caller uses the effect's own default", () => {
    expect(
      deriveLandingZone({ srcPos, aimDir, slashFromCollider: false, distance: METEOR_LANDING_DIST }),
    ).toBeNull();
  });

  it("ON: projects the meteor zone out along the collider aim", () => {
    const at = deriveLandingZone({ srcPos, aimDir, slashFromCollider: true, distance: METEOR_LANDING_DIST });
    expect(at).not.toBeNull();
    vecEq(at!, srcPos.clone().addScaledVector(aimDir, METEOR_LANDING_DIST));
  });

  it("ON: projects the sword-volley zone the shorter sword-volley distance", () => {
    const at = deriveLandingZone({
      srcPos,
      aimDir,
      slashFromCollider: true,
      distance: SWORD_VOLLEY_LANDING_DIST,
    });
    vecEq(at!, srcPos.clone().addScaledVector(aimDir, SWORD_VOLLEY_LANDING_DIST));
    // The sword volley lands nearer the swing than the meteor.
    expect(SWORD_VOLLEY_LANDING_DIST).toBeLessThan(METEOR_LANDING_DIST);
  });

  it("ON: returns a fresh vector (does not alias srcPos)", () => {
    const at = deriveLandingZone({ srcPos, aimDir, slashFromCollider: true, distance: METEOR_LANDING_DIST });
    expect(at).not.toBe(srcPos);
  });
});

describe("deriveTurretBase — chassis base + aim", () => {
  const origin = new THREE.Vector3(2, 1, -3);
  const facing = new THREE.Vector3(0, 0, 1);

  it("OFF: stands at the body origin facing the body's flat facing", () => {
    const srcPos = new THREE.Vector3(5, 2, 6);
    const aimDir = new THREE.Vector3(1, 0, 0);
    const { base, aim } = deriveTurretBase({ origin, facing, srcPos, aimDir, slashFromCollider: false });
    vecEq(base, origin);
    vecEq(aim, facing);
  });

  it("ON: backs the chassis out under the collider along the flattened aim", () => {
    const srcPos = new THREE.Vector3(5, 2, 6);
    // Aim has a vertical component; the back-out uses the flattened, normalized aim.
    const aimDir = new THREE.Vector3(1, 1, 0).normalize();
    const { base, aim } = deriveTurretBase({ origin, facing, srcPos, aimDir, slashFromCollider: true });
    const ground = new THREE.Vector3(1, 0, 0); // flatten + normalize of (1,1,0)
    vecEq(base, srcPos.clone().addScaledVector(ground, -TURRET_BACK_OUT));
    vecEq(aim, aimDir);
  });

  it("ON: falls back to +Z back-out when the aim is (near) vertical", () => {
    const srcPos = new THREE.Vector3(5, 2, 6);
    const aimDir = new THREE.Vector3(0, 1, 0);
    const { base } = deriveTurretBase({ origin, facing, srcPos, aimDir, slashFromCollider: true });
    vecEq(base, srcPos.clone().addScaledVector(new THREE.Vector3(0, 0, 1), -TURRET_BACK_OUT));
  });

  it("returns fresh vectors", () => {
    const srcPos = new THREE.Vector3(5, 2, 6);
    const aimDir = new THREE.Vector3(1, 0, 0);
    const on = deriveTurretBase({ origin, facing, srcPos, aimDir, slashFromCollider: true });
    const off = deriveTurretBase({ origin, facing, srcPos, aimDir, slashFromCollider: false });
    expect(on.base).not.toBe(srcPos);
    expect(on.aim).not.toBe(aimDir);
    expect(off.base).not.toBe(origin);
    expect(off.aim).not.toBe(facing);
  });
});
