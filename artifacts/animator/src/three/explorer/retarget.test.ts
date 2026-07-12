import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { retargetMixamoClip } from "./loader";

/**
 * The editor's Mixamo auto-wire passes clips whose track objects are still bound
 * to the imported model's own mixer. `retargetMixamoClip` must therefore produce
 * a fresh clip without mutating the source tracks, or the imported-model preview
 * path would break.
 */
describe("retargetMixamoClip", () => {
  function makeClip(): THREE.AnimationClip {
    const quat = [0, 0, 0, 1, 0, 0, 0, 1];
    return new THREE.AnimationClip("Armature|mixamo.com|Layer0", 1, [
      new THREE.QuaternionKeyframeTrack("mixamorig:Hips.quaternion", [0, 1], quat),
      new THREE.QuaternionKeyframeTrack("mixamorigLeftArm_06.quaternion", [0, 1], quat),
      // position tracks are dropped (rotation-only retarget)
      new THREE.VectorKeyframeTrack("mixamorig:Hips.position", [0, 1], [0, 0, 0, 0, 1, 0]),
    ]);
  }

  it("normalises bone names without the colon and numeric suffix", () => {
    const out = retargetMixamoClip(makeClip());
    const names = out.tracks.map((t) => t.name).sort();
    expect(names).toEqual(["mixamorigHips.quaternion", "mixamorigLeftArm.quaternion"]);
  });

  it("drops non-quaternion (position) tracks", () => {
    const out = retargetMixamoClip(makeClip());
    expect(out.tracks.every((t) => t.name.endsWith(".quaternion"))).toBe(true);
  });

  it("does not mutate the source clip's track names", () => {
    const src = makeClip();
    const before = src.tracks.map((t) => t.name);
    retargetMixamoClip(src);
    expect(src.tracks.map((t) => t.name)).toEqual(before);
  });
});
