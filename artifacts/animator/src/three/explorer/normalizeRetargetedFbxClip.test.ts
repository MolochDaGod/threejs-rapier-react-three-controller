import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { normalizeRetargetedFbxClip } from "./loader";

/**
 * The great-sword family of FBX clips (shared by every two-handed melee class
 * via `TWO_HAND_MELEE_LOCO`) ship on a non-`mixamorig` "Retargeted Clip"
 * skeleton, so their tracks bind to nothing on the `mixamorig*` box rig and the
 * heavy classes had dead idles + locomotion. `normalizeRetargetedFbxClip` renames
 * those tracks onto the rig. These tests lock the bone mapping + track policy.
 */
describe("normalizeRetargetedFbxClip", () => {
  const quat = [0, 0, 0, 1, 0, 0, 0, 1];
  const q = (bone: string) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], quat);
  const p = (bone: string) =>
    new THREE.VectorKeyframeTrack(`${bone}.position`, [0, 1], [0, 0, 0, 0, 1, 0]);

  it("maps the Spine11/Spine21/Head1 variant onto rig bones", () => {
    const out = normalizeRetargetedFbxClip(
      new THREE.AnimationClip("c", 1, [q("Hips"), q("Spine"), q("Spine11"), q("Spine21"), q("Neck"), q("Head1")]),
    );
    expect(out.tracks.map((t) => t.name).sort()).toEqual(
      [
        "mixamorigHead.quaternion",
        "mixamorigHips.quaternion",
        "mixamorigNeck.quaternion",
        "mixamorigSpine.quaternion",
        "mixamorigSpine1.quaternion",
        "mixamorigSpine2.quaternion",
      ].sort(),
    );
  });

  it("maps the Spine01/Spine02/Head/neck variant onto rig bones", () => {
    const out = normalizeRetargetedFbxClip(
      new THREE.AnimationClip("c", 1, [q("Spine01"), q("Spine02"), q("Head"), q("neck"), q("LeftForeArm")]),
    );
    expect(out.tracks.map((t) => t.name).sort()).toEqual(
      [
        "mixamorigHead.quaternion",
        "mixamorigLeftForeArm.quaternion",
        "mixamorigNeck.quaternion",
        "mixamorigSpine1.quaternion",
        "mixamorigSpine2.quaternion",
      ].sort(),
    );
  });

  it("keeps the root (Hips) position but drops limb position tracks", () => {
    const out = normalizeRetargetedFbxClip(
      new THREE.AnimationClip("c", 1, [q("Hips"), p("Hips"), p("LeftFoot"), q("LeftFoot")]),
    );
    const names = out.tracks.map((t) => t.name).sort();
    expect(names).toEqual(
      ["mixamorigHips.position", "mixamorigHips.quaternion", "mixamorigLeftFoot.quaternion"].sort(),
    );
  });

  it("drops non-rig container/leaf bones (Armature, headfront, *_End)", () => {
    const out = normalizeRetargetedFbxClip(
      new THREE.AnimationClip("c", 1, [q("Armature"), q("headfront"), q("HeadTop_End"), q("Hips")]),
    );
    expect(out.tracks.map((t) => t.name)).toEqual(["mixamorigHips.quaternion"]);
  });

  it("does not mutate the source clip's track names", () => {
    const src = new THREE.AnimationClip("c", 1, [q("Spine01"), p("Hips")]);
    const before = src.tracks.map((t) => t.name);
    normalizeRetargetedFbxClip(src);
    expect(src.tracks.map((t) => t.name)).toEqual(before);
  });
});
