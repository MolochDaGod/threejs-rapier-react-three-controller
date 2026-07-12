import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { isHipsPositionTrack, lockHorizontalRoot } from "./Animator";

/**
 * Guards the Dressing Room "feet meters away" regression: several "Retargeted
 * Clip" packs author the Hips track tens of units off-origin (and some keep a
 * bare `Hips.position` name), so lockHorizontalRoot must (a) recognise the hips
 * track under either naming convention and (b) re-baseline X/Z to the rig's
 * bind pose — NOT the clip's first frame — while keeping the vertical bob.
 */
describe("isHipsPositionTrack", () => {
  it("matches the hips position track under every naming convention", () => {
    expect(isHipsPositionTrack("mixamorigHips.position")).toBe(true);
    expect(isHipsPositionTrack("Hips.position")).toBe(true);
    expect(isHipsPositionTrack("mixamorig:Hips.position")).toBe(true);
  });

  it("ignores non-root and non-position tracks", () => {
    expect(isHipsPositionTrack("mixamorigHips.quaternion")).toBe(false);
    expect(isHipsPositionTrack("mixamorigLeftUpLeg.position")).toBe(false);
    expect(isHipsPositionTrack("mixamorigSpine.position")).toBe(false);
    expect(isHipsPositionTrack("Armature.position")).toBe(false);
  });
});

describe("lockHorizontalRoot", () => {
  const bind = { x: 0, y: 1.0, z: 0 };

  function hipsClip(name: string, frames: [number, number, number][]) {
    const values = frames.flat();
    const times = frames.map((_, i) => i / 30);
    return new THREE.AnimationClip("c", -1, [
      new THREE.VectorKeyframeTrack(name, times, values),
    ]);
  }

  it("re-centres an off-origin retargeted pack to the bind pose (X/Z)", () => {
    // Mirrors the real backwards-jump pack: starts ~60 units off-origin and
    // travels tens of units in Z.
    const clip = hipsClip("Hips.position", [
      [-0.2, 1.1, 60.8],
      [11.2, 1.4, 41.5],
      [5.0, 1.0, 19.3],
    ]);
    lockHorizontalRoot(clip, bind);
    const v = clip.tracks[0].values;
    for (let i = 0; i < v.length; i += 3) {
      expect(v[i]).toBe(bind.x);
      expect(v[i + 2]).toBe(bind.z);
    }
  });

  it("keeps the relative vertical bob, re-baselined to bind height", () => {
    const clip = hipsClip("mixamorigHips.position", [
      [0, 1.1, 0],
      [0, 1.4, 0],
      [0, 1.0, 0],
    ]);
    lockHorizontalRoot(clip, bind);
    const v = clip.tracks[0].values;
    // First frame sits exactly at bind height; the bob (delta from frame 0) is
    // preserved: +0.3 then -0.1 relative to the start.
    expect(v[1]).toBeCloseTo(1.0);
    expect(v[4]).toBeCloseTo(1.3);
    expect(v[7]).toBeCloseTo(0.9);
  });

  it("is a no-op for native in-place clips already at origin", () => {
    const clip = hipsClip("mixamorigHips.position", [
      [0, 1.0, 0],
      [0, 1.0, 0],
    ]);
    lockHorizontalRoot(clip, bind);
    const v = clip.tracks[0].values;
    expect(Array.from(v)).toEqual([0, 1.0, 0, 0, 1.0, 0]);
  });
});
