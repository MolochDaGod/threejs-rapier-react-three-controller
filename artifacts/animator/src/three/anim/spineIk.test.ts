import { describe, expect, it } from "vitest";
import { Object3D, Bone } from "three";
import { SpineIK, findSpineBones } from "./spineIk";

describe("SpineIK", () => {
  it("restores saved bone quaternions", () => {
    const b0 = new Bone();
    const b1 = new Bone();
    b0.add(b1);
    const root = new Object3D();
    root.add(b0);
    const ik = new SpineIK([b0, b1], null);
    b0.quaternion.set(0.1, 0.2, 0.3, 0.9).normalize();
    ik.baseQuats[0].copy(b0.quaternion);
    ik.baseQuats[1].identity();
    b0.quaternion.identity();
    ik.restoreBones();
    expect(b0.quaternion.x).toBeCloseTo(ik.baseQuats[0].x, 5);
  });

  it("findSpineBones discovers Spine* bones", () => {
    const root = new Object3D();
    const hips = new Bone();
    hips.name = "Hips";
    const s1 = new Bone();
    s1.name = "Spine";
    const s2 = new Bone();
    s2.name = "Spine1";
    const head = new Bone();
    head.name = "Head";
    root.add(hips);
    hips.add(s1);
    s1.add(s2);
    s2.add(head);
    const { spine, head: h } = findSpineBones(root);
    expect(spine.length).toBeGreaterThanOrEqual(1);
    expect(h?.name).toMatch(/head/i);
  });
});
