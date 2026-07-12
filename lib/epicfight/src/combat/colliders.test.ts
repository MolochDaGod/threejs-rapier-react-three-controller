import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { loadEpicFightModel } from "../model.js";
import { attackSphere, buildHurtboxes, queryHurtboxes } from "./colliders.js";
import { DEFAULT_HITBOX } from "./movesets.js";
import type { EFModelJson } from "../types.js";

const FIX = join(import.meta.dirname, "..", "__fixtures__");
const biped = (): EFModelJson =>
  JSON.parse(readFileSync(join(FIX, "biped.json"), "utf8")) as EFModelJson;

describe("hurtboxes", () => {
  it("collapses cosmetic parts onto representative bones with positive radii", () => {
    const model = loadEpicFightModel(biped());
    const hbs = buildHurtboxes(model);
    const names = hbs.map((h) => h.name).sort();
    expect(names).toEqual(["Arm_L", "Arm_R", "Chest", "Head", "Leg_L", "Leg_R"]);
    for (const hb of hbs) expect(hb.radius).toBeGreaterThan(0);
  });

  it("detects an attack sphere that reaches the target and misses one that doesn't", () => {
    const model = loadEpicFightModel(biped());
    model.root.position.set(2, 0, 0);
    model.root.updateMatrixWorld(true);
    const hbs = buildHurtboxes(model);

    // Attacker at origin facing +x toward the target at x=2.
    const origin = new THREE.Vector3(0, 0, 0);
    const forward = new THREE.Vector3(1, 0, 0);

    const reach = attackSphere(origin, forward, { forward: 1.6, up: 1.0, radius: 1.2 });
    expect(queryHurtboxes(reach, hbs)).not.toBeNull();

    const tooShort = attackSphere(origin, forward, { forward: 0.2, up: 1.0, radius: 0.3 });
    expect(queryHurtboxes(tooShort, hbs)).toBeNull();
  });

  it("places the default hitbox in front of the attacker", () => {
    const origin = new THREE.Vector3(5, 0, 5);
    const forward = new THREE.Vector3(0, 0, 1);
    const s = attackSphere(origin, forward, DEFAULT_HITBOX);
    expect(s.center.z).toBeCloseTo(5 + DEFAULT_HITBOX.forward, 5);
    expect(s.center.y).toBeCloseTo(DEFAULT_HITBOX.up, 5);
    expect(s.radius).toBe(DEFAULT_HITBOX.radius);
  });
});
