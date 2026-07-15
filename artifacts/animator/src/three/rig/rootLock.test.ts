import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  isRootPositionTrack,
  lockInPlaceRoot,
  sampleBindRoot,
  stabilizeClipForPlayback,
  stripNonRootPositions,
} from "./rootLock";

describe("isRootPositionTrack", () => {
  it("matches Mixamo, bare Hips, Bip001 pelvis, Armature", () => {
    expect(isRootPositionTrack("mixamorigHips.position")).toBe(true);
    expect(isRootPositionTrack("mixamorig:Hips.position")).toBe(true);
    expect(isRootPositionTrack("Hips.position")).toBe(true);
    expect(isRootPositionTrack("Bip001 Pelvis.position")).toBe(true);
    expect(isRootPositionTrack("Bip001_Pelvis.position")).toBe(true);
    expect(isRootPositionTrack("Armature.position")).toBe(true);
    expect(isRootPositionTrack("Root.position")).toBe(true);
    expect(isRootPositionTrack("Motion.position")).toBe(true);
  });

  it("ignores limb positions and rotations", () => {
    expect(isRootPositionTrack("mixamorigHips.quaternion")).toBe(false);
    expect(isRootPositionTrack("mixamorigLeftUpLeg.position")).toBe(false);
    expect(isRootPositionTrack("Bip001 R Hand.position")).toBe(false);
  });
});

describe("lockInPlaceRoot", () => {
  const bind = { x: 0.05, y: 1.0, z: -0.02 };

  function hipsClip(name: string, frames: [number, number, number][]) {
    return new THREE.AnimationClip("c", -1, [
      new THREE.VectorKeyframeTrack(name, frames.map((_, i) => i / 30), frames.flat()),
    ]);
  }

  it("pins off-origin retarget packs to full bind XYZ (not frame 0)", () => {
    const clip = hipsClip("Hips.position", [
      [-0.2, 1.1, 60.8],
      [11.2, 1.4, 41.5],
      [5.0, 1.0, 19.3],
    ]);
    lockInPlaceRoot(clip, bind);
    const v = clip.tracks[0].values;
    for (let i = 0; i < v.length; i += 3) {
      expect(v[i]).toBeCloseTo(bind.x);
      expect(v[i + 1]).toBeCloseTo(bind.y);
      expect(v[i + 2]).toBeCloseTo(bind.z);
    }
  });

  it("freezes vertical travel so packs cannot launch through floors", () => {
    const clip = hipsClip("mixamorigHips.position", [
      [0, 1.1, 0],
      [0, 4.4, 0],
      [0, 0.2, 0],
    ]);
    lockInPlaceRoot(clip, bind);
    const v = clip.tracks[0].values;
    expect(v[1]).toBeCloseTo(bind.y);
    expect(v[4]).toBeCloseTo(bind.y);
    expect(v[7]).toBeCloseTo(bind.y);
  });

  it("locks Bip001 pelvis the same way", () => {
    const clip = hipsClip("Bip001 Pelvis.position", [
      [3, 0.9, -8],
      [4, 1.0, -9],
    ]);
    lockInPlaceRoot(clip, bind);
    const v = clip.tracks[0].values;
    expect(v[0]).toBeCloseTo(bind.x);
    expect(v[1]).toBeCloseTo(bind.y);
    expect(v[2]).toBeCloseTo(bind.z);
    expect(v[3]).toBeCloseTo(bind.x);
    expect(v[5]).toBeCloseTo(bind.z);
  });
});

describe("stripNonRootPositions", () => {
  it("keeps hips position and all quaternions, drops limb positions", () => {
    const clip = new THREE.AnimationClip("c", 1, [
      new THREE.VectorKeyframeTrack("mixamorigHips.position", [0], [0, 1, 0]),
      new THREE.VectorKeyframeTrack("mixamorigLeftArm.position", [0], [1, 0, 0]),
      new THREE.QuaternionKeyframeTrack("mixamorigLeftArm.quaternion", [0], [0, 0, 0, 1]),
    ]);
    const out = stripNonRootPositions(clip);
    expect(out.tracks.map((t) => t.name).sort()).toEqual([
      "mixamorigHips.position",
      "mixamorigLeftArm.quaternion",
    ]);
  });
});

describe("sampleBindRoot", () => {
  it("reads mixamorigHips when present", () => {
    const root = new THREE.Group();
    const hips = new THREE.Bone();
    hips.name = "mixamorigHips";
    hips.position.set(0.1, 0.95, -0.05);
    root.add(hips);
    const b = sampleBindRoot(root);
    expect(b.y).toBeCloseTo(0.95);
    expect(b.x).toBeCloseTo(0.1);
  });
});

describe("stabilizeClipForPlayback", () => {
  it("strips limbs and locks root in one pass", () => {
    const root = new THREE.Group();
    const hips = new THREE.Bone();
    hips.name = "Hips";
    hips.position.set(0, 0.9, 0);
    root.add(hips);
    const clip = new THREE.AnimationClip("swing", 1, [
      new THREE.VectorKeyframeTrack("Hips.position", [0, 0.5], [10, 2, 30, 12, 3, 40]),
      new THREE.VectorKeyframeTrack("LeftArm.position", [0], [1, 0, 0]),
      new THREE.QuaternionKeyframeTrack("LeftArm.quaternion", [0], [0, 0, 0, 1]),
    ]);
    const out = stabilizeClipForPlayback(root, clip);
    expect(out.tracks.some((t) => t.name === "LeftArm.position")).toBe(false);
    const hipsTrack = out.tracks.find((t) => t.name === "Hips.position")!;
    expect(hipsTrack.values[0]).toBeCloseTo(0);
    expect(hipsTrack.values[1]).toBeCloseTo(0.9);
    expect(hipsTrack.values[2]).toBeCloseTo(0);
  });
});
