import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEpicFightModel } from "./model.js";
import { buildAnimationClip } from "./animation.js";
import { EpicFightCharacter } from "./character.js";
import type { EFAnimationJson, EFModelJson } from "./types.js";

const FIX = join(import.meta.dirname, "__fixtures__");
const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(join(FIX, file), "utf8")) as T;

const biped = (): EFModelJson => readJson<EFModelJson>("biped.json");
const axe1 = (): EFAnimationJson => readJson<EFAnimationJson>("axe_auto1.json");

describe("loadEpicFightModel", () => {
  it("builds a skeleton whose bone order matches the joint list", () => {
    const json = biped();
    const model = loadEpicFightModel(json);
    expect(model.bones.length).toBe(json.armature!.joints.length);
    expect(model.bones.map((b) => b.name)).toEqual(json.armature!.joints);
    // Weapon mount points are present (used to attach weapons later).
    expect(model.boneByName.get("Tool_R")).toBeDefined();
    expect(model.boneByName.get("Tool_L")).toBeDefined();
  });

  it("produces a bound skinned mesh with normalized skin weights", () => {
    const model = loadEpicFightModel(biped());
    const g = model.skinnedMesh.geometry;
    expect(g.getAttribute("position")).toBeTruthy();
    expect(g.getAttribute("skinIndex")).toBeTruthy();
    const sw = g.getAttribute("skinWeight");
    expect(sw).toBeTruthy();
    expect(model.skinnedMesh.skeleton).toBe(model.skeleton);
    for (let i = 0; i < sw.count; i++) {
      const sum = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
      expect(sum).toBeGreaterThan(0.99);
      expect(sum).toBeLessThan(1.01);
    }
  });

  it("exposes the named body-part colliders", () => {
    const model = loadEpicFightModel(biped());
    expect(Object.keys(model.parts)).toEqual(
      expect.arrayContaining(["head", "torso", "leftArm", "rightArm"]),
    );
    expect(model.parts.head.length).toBeGreaterThan(0);
  });
});

describe("buildAnimationClip", () => {
  it("creates per-bone TRS tracks with the right duration", () => {
    const json = axe1();
    const clip = buildAnimationClip(json, "axe_auto1");
    // Last keyframe time in the fixture is 1.0s.
    expect(clip.duration).toBeCloseTo(1.0, 2);
    expect(clip.tracks.length).toBe(json.animation.length * 3);
    const names = clip.tracks.map((t) => t.name);
    expect(names).toContain("Root.position");
    expect(names).toContain("Root.quaternion");
    expect(names).toContain("Root.scale");
  });
});

describe("EpicFightCharacter", () => {
  it("plays a clip and the mixer drives the bones", () => {
    const model = loadEpicFightModel(biped());
    const char = new EpicFightCharacter(model);
    char.addClip("axe", buildAnimationClip(axe1(), "axe"));

    const root = model.boneByName.get("Root")!;
    const rest = root.quaternion.clone();

    char.play("axe", { loop: true, fade: 0 });
    char.update(0.3);

    expect(rest.angleTo(root.quaternion)).toBeGreaterThan(0.001);
    char.dispose();
  });
});
