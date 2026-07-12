import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  segmentFrame,
  captureBoneInBody,
  boneWorldFromBody,
  worldToLocal,
  worldPointToBodyLocal,
} from "./ragdollMath";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const near = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) <= eps;
const vNear = (a: THREE.Vector3, b: THREE.Vector3, eps = 1e-5) =>
  near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.z, b.z, eps);
/** Quaternions q and -q are the same rotation, so compare on |dot| → 1. */
const qNear = (a: THREE.Quaternion, b: THREE.Quaternion, eps = 1e-5) =>
  1 - Math.abs(a.dot(b)) <= eps;

describe("segmentFrame", () => {
  it("centres between endpoints and reports half-length", () => {
    const f = segmentFrame(V(0, 0, 0), V(0, 2, 0));
    expect(vNear(f.center, V(0, 1, 0))).toBe(true);
    expect(near(f.halfLength, 1)).toBe(true);
  });

  it("leaves +Y aligned segments unrotated", () => {
    const f = segmentFrame(V(1, 0, 1), V(1, 4, 1));
    const dir = V(0, 1, 0).applyQuaternion(f.quat);
    expect(vNear(dir, V(0, 1, 0))).toBe(true);
    expect(near(f.halfLength, 2)).toBe(true);
  });

  it("rotates local +Y onto an arbitrary head→tail direction", () => {
    const head = V(0, 0, 0);
    const tail = V(2, 0, 0);
    const f = segmentFrame(head, tail);
    const dir = V(0, 1, 0).applyQuaternion(f.quat);
    expect(vNear(dir, V(1, 0, 0))).toBe(true);
    expect(vNear(f.center, V(1, 0, 0))).toBe(true);
  });

  it("falls back to identity for coincident endpoints", () => {
    const f = segmentFrame(V(3, 3, 3), V(3, 3, 3));
    expect(qNear(f.quat, new THREE.Quaternion())).toBe(true);
    expect(near(f.halfLength, 0)).toBe(true);
  });

  it("handles a downward (antiparallel) segment", () => {
    const f = segmentFrame(V(0, 5, 0), V(0, 1, 0));
    const dir = V(0, 1, 0).applyQuaternion(f.quat);
    expect(vNear(dir, V(0, -1, 0))).toBe(true);
  });
});

describe("captureBoneInBody / boneWorldFromBody round-trip", () => {
  it("reconstructs the original bone world transform", () => {
    const bonePos = V(1.2, 0.7, -0.3);
    const boneQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.1, 0.5));
    const bodyPos = V(0.4, 1.0, 0.2);
    const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0.9, 0.1));

    const cap = captureBoneInBody(bonePos, boneQuat, bodyPos, bodyQuat);
    const { pos, quat } = boneWorldFromBody(bodyPos, bodyQuat, cap);

    expect(vNear(pos, bonePos)).toBe(true);
    expect(qNear(quat, boneQuat)).toBe(true);
  });

  it("moves the bone rigidly when the body moves", () => {
    const bonePos = V(0, 2, 0);
    const boneQuat = new THREE.Quaternion();
    const bodyPos = V(0, 1, 0);
    const bodyQuat = new THREE.Quaternion();
    const cap = captureBoneInBody(bonePos, boneQuat, bodyPos, bodyQuat);

    // Body rotates 90° about +Z and translates: the bone offset (0,+1,0) above the
    // body should swing to (-1,0,0) relative to the new body position.
    const newPos = V(5, 5, 5);
    const newQuat = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2);
    const { pos } = boneWorldFromBody(newPos, newQuat, cap);
    expect(vNear(pos, V(4, 5, 5))).toBe(true);
  });
});

describe("worldToLocal", () => {
  it("is identity under an identity parent", () => {
    const wp = V(2, 3, 4);
    const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.3, 0.4));
    const { pos, quat } = worldToLocal(wp, wq, V(0, 0, 0), new THREE.Quaternion());
    expect(vNear(pos, wp)).toBe(true);
    expect(qNear(quat, wq)).toBe(true);
  });

  it("undoes a rotated + translated parent (matches three's worldToLocal)", () => {
    const parent = new THREE.Object3D();
    parent.position.set(1, 2, 3);
    parent.quaternion.setFromEuler(new THREE.Euler(0.5, -0.7, 1.2));
    parent.updateMatrixWorld(true);

    const childWorldPos = V(2.5, 1.5, 4.5);
    const childWorldQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.9, 0.3));

    const pPos = new THREE.Vector3();
    const pQuat = new THREE.Quaternion();
    parent.getWorldPosition(pPos);
    parent.getWorldQuaternion(pQuat);
    const { pos } = worldToLocal(childWorldPos, childWorldQuat, pPos, pQuat, 1);

    const expected = parent.worldToLocal(childWorldPos.clone());
    expect(vNear(pos, expected)).toBe(true);
  });

  it("divides out a uniform parent scale", () => {
    const { pos } = worldToLocal(V(2, 0, 0), new THREE.Quaternion(), V(0, 0, 0), new THREE.Quaternion(), 2);
    expect(vNear(pos, V(1, 0, 0))).toBe(true);
  });

  it("round-trips with boneWorldFromBody-style composition", () => {
    const parentPos = V(0.3, 1.4, -0.8);
    const parentQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.2, -0.3));
    const worldPos = V(1.1, 2.2, 0.4);
    const worldQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.6, 0.2));

    const local = worldToLocal(worldPos, worldQuat, parentPos, parentQuat, 1);
    // Recompose world = parent ∘ local.
    const back = local.pos.clone().applyQuaternion(parentQuat).add(parentPos);
    const backQ = parentQuat.clone().multiply(local.quat);
    expect(vNear(back, worldPos)).toBe(true);
    expect(qNear(backQ, worldQuat)).toBe(true);
  });
});

describe("worldPointToBodyLocal", () => {
  it("returns the offset rotated into the body frame", () => {
    const bodyPos = V(0, 1, 0);
    const bodyQuat = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2);
    // World joint one metre along +X from the body; in a body yawed +90° about Y,
    // world +X maps to body-local −Z... verify by reconstructing the world point.
    const worldPt = V(1, 1, 0);
    const local = worldPointToBodyLocal(worldPt, bodyPos, bodyQuat);
    const back = local.clone().applyQuaternion(bodyQuat).add(bodyPos);
    expect(vNear(back, worldPt)).toBe(true);
  });
});
