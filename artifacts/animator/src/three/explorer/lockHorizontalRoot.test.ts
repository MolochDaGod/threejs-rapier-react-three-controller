import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { isHipsPositionTrack, lockHorizontalRoot } from "./Animator";

/**
 * Guards the Dressing Room "feet meters away" / meshing-teleport regression:
 * retarget packs author Hips/Bip001/Armature tracks far off-origin. Full XYZ
 * is pinned to bind pose so controller owns world position.
 */
describe("isHipsPositionTrack", () => {
  it("matches the root position track under every naming convention", () => {
    expect(isHipsPositionTrack("mixamorigHips.position")).toBe(true);
    expect(isHipsPositionTrack("Hips.position")).toBe(true);
    expect(isHipsPositionTrack("mixamorig:Hips.position")).toBe(true);
    expect(isHipsPositionTrack("Bip001 Pelvis.position")).toBe(true);
    expect(isHipsPositionTrack("Armature.position")).toBe(true);
  });

  it("ignores non-root and non-position tracks", () => {
    expect(isHipsPositionTrack("mixamorigHips.quaternion")).toBe(false);
    expect(isHipsPositionTrack("mixamorigLeftUpLeg.position")).toBe(false);
    expect(isHipsPositionTrack("mixamorigSpine.position")).toBe(false);
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

  it("re-centres an off-origin retargeted pack to full bind XYZ", () => {
    const clip = hipsClip("Hips.position", [
      [-0.2, 1.1, 60.8],
      [11.2, 1.4, 41.5],
      [5.0, 1.0, 19.3],
    ]);
    lockHorizontalRoot(clip, bind);
    const v = clip.tracks[0].values;
    for (let i = 0; i < v.length; i += 3) {
      expect(v[i]).toBe(bind.x);
      expect(v[i + 1]).toBe(bind.y);
      expect(v[i + 2]).toBe(bind.z);
    }
  });

  it("freezes vertical travel so packs cannot launch through floors", () => {
    const clip = hipsClip("mixamorigHips.position", [
      [0, 1.1, 0],
      [0, 4.4, 0],
      [0, 0.2, 0],
    ]);
    lockHorizontalRoot(clip, bind);
    const v = clip.tracks[0].values;
    expect(v[1]).toBeCloseTo(1.0);
    expect(v[4]).toBeCloseTo(1.0);
    expect(v[7]).toBeCloseTo(1.0);
  });

  it("is a no-op for native in-place clips already at bind", () => {
    const clip = hipsClip("mixamorigHips.position", [
      [0, 1.0, 0],
      [0, 1.0, 0],
    ]);
    lockHorizontalRoot(clip, bind);
    const v = clip.tracks[0].values;
    expect(Array.from(v)).toEqual([0, 1.0, 0, 0, 1.0, 0]);
  });
});
