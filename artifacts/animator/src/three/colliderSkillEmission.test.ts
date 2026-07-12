import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { Studio } from "./Studio";
import { Vfx } from "./Vfx";
import { CHARACTERS } from "./assets";
import type { SkillKind } from "./types";

/** A character whose `colliderVfx` flag is unset — used to exercise the OFF gate.
 *  Derived from the live roster so it can't go stale when a rig gains the flag. */
const NO_COLLIDER_VFX_ID = CHARACTERS.find((c) => !c.colliderVfx)?.id ?? "";

/**
 * Coverage for the collider-bound skill emission path (the live-combat twin of
 * the Skill Lab's `slashFromCollider` preview):
 *
 *  - `Studio.colliderPose()` is a strict opt-in gated on `CharacterDef.colliderVfx`.
 *    OFF rigs must return `null` (legacy flat-facing behavior); ON rigs must return
 *    the swinging hand's world pose + an aim taken from the hand ORIENTATION
 *    (most-outward local axis), not just its displacement.
 *  - `Vfx.playSkill(..., collider)` must launch the slash arc + GLB spells from the
 *    collider pose (position/angle) while homing spells still curve toward `aim`.
 *
 * Both are exercised via the real methods bound to a hand-built `this`, so the
 * tested code is the production code — no parallel re-implementation. We avoid
 * constructing the full Studio/Vfx (which need a WebGL renderer / DOM) by calling
 * the methods with a minimal stub receiver; this also sidesteps the pre-existing
 * `document is not defined` failure in `fxTextures.ts` under the node test env.
 */

function vecEq(a: THREE.Vector3, b: THREE.Vector3): void {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
  expect(a.z).toBeCloseTo(b.z, 5);
}

function quatEq(a: THREE.Quaternion, b: THREE.Quaternion): void {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
  expect(a.z).toBeCloseTo(b.z, 5);
  expect(a.w).toBeCloseTo(b.w, 5);
}

const colliderPose = (Studio.prototype as unknown as {
  colliderPose: () => { pos: THREE.Vector3; quat: THREE.Quaternion; aim: THREE.Vector3 } | null;
}).colliderPose;

/** Build a minimal `this` for `colliderPose`: a right hand at a known world pose. */
function studioStub(opts: {
  characterId: string;
  hand?: THREE.Object3D | null;
  rootPos?: THREE.Vector3;
  hasCharacter?: boolean;
}) {
  const root = new THREE.Object3D();
  root.position.copy(opts.rootPos ?? new THREE.Vector3(0, 0, 0));
  const character =
    opts.hasCharacter === false
      ? null
      : { rightHand: opts.hand === undefined ? new THREE.Object3D() : opts.hand, root };
  return {
    character,
    characterId: opts.characterId,
    facing: () => new THREE.Vector3(0, 0, 1),
  };
}

describe("Studio.colliderPose — opt-in gate", () => {
  it("returns null when the character's colliderVfx flag is unset", () => {
    // A roster character that has no colliderVfx flag (derived dynamically so the
    // test can't go stale when a specific rig is given the flag later).
    const hand = new THREE.Object3D();
    hand.position.set(2, 1.2, 0);
    hand.updateWorldMatrix(true, false);
    const stub = studioStub({ characterId: NO_COLLIDER_VFX_ID, hand });
    expect(colliderPose.call(stub)).toBeNull();
  });

  it("returns null when there is no character at all", () => {
    const stub = studioStub({ characterId: "archmage", hasCharacter: false });
    expect(colliderPose.call(stub)).toBeNull();
  });

  it("returns null when the rig has no right hand even if the flag is set", () => {
    const stub = studioStub({ characterId: "archmage", hand: null });
    expect(colliderPose.call(stub)).toBeNull();
  });
});

describe("Studio.colliderPose — ON path derives the hand world pose + aim", () => {
  it("returns the hand world position/orientation and aims along its most-outward axis", () => {
    // Hand out to the body's right (+X), identity orientation. The chest->hand
    // displacement only disambiguates sign; the aim is the rotated local axis
    // pointing most outward, which for identity is world +X.
    const hand = new THREE.Object3D();
    hand.position.set(2, 1.2, 0);
    hand.updateWorldMatrix(true, false);
    const stub = studioStub({ characterId: "archmage", hand, rootPos: new THREE.Vector3(0, 0, 0) });

    const pose = colliderPose.call(stub);
    expect(pose).not.toBeNull();
    vecEq(pose!.pos, new THREE.Vector3(2, 1.2, 0));
    quatEq(pose!.quat, new THREE.Quaternion());
    vecEq(pose!.aim, new THREE.Vector3(1, 0, 0));
    expect(pose!.aim.length()).toBeCloseTo(1, 5);
  });

  it("re-aims from the hand ORIENTATION, not the chest->hand displacement", () => {
    // Hand out to +X (displacement is purely horizontal, y == 0) but TILTED 30deg
    // about Z. The displacement still selects the local +X axis as "most outward",
    // but that axis is now rotated, so the returned aim carries a Y component the
    // raw displacement never had — proving aim follows orientation, not position.
    const a = Math.PI / 6; // 30deg
    const hand = new THREE.Object3D();
    hand.position.set(2, 1.0, 0);
    hand.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
    hand.updateWorldMatrix(true, false);
    const stub = studioStub({ characterId: "archmage", hand, rootPos: new THREE.Vector3(0, 0, 0) });

    const pose = colliderPose.call(stub);
    expect(pose).not.toBeNull();
    // local +X rotated by +30deg about Z = (cos30, sin30, 0).
    vecEq(pose!.aim, new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    // A displacement-derived aim would be flat (y == 0); orientation gives y ~= 0.5.
    expect(pose!.aim.y).toBeCloseTo(0.5, 5);
  });

  it("honors a parent transform when computing the hand world pose", () => {
    const parent = new THREE.Object3D();
    parent.position.set(5, 0, -3);
    const hand = new THREE.Object3D();
    hand.position.set(1, 1, 0);
    parent.add(hand);
    parent.updateWorldMatrix(true, true);
    const stub = studioStub({ characterId: "archmage", hand, rootPos: new THREE.Vector3(5, 0, -3) });

    const pose = colliderPose.call(stub);
    expect(pose).not.toBeNull();
    vecEq(pose!.pos, new THREE.Vector3(6, 1, -3));
  });
});

type SkillSpy = ReturnType<typeof vi.fn>;
type VfxStub = Record<string, SkillSpy>;

const playSkill = (Vfx.prototype as unknown as {
  playSkill: (
    kind: SkillKind,
    origin: THREE.Vector3,
    forward: THREE.Vector3,
    quat: THREE.Quaternion,
    aim?: THREE.Vector3,
    onImpact?: (p: THREE.Vector3) => void,
    collider?: { pos: THREE.Vector3; quat: THREE.Quaternion; aim: THREE.Vector3 },
  ) => void;
}).playSkill;

/** A Vfx receiver whose every effect method is a spy so we can read launch args. */
function vfxStub(): VfxStub {
  const names = [
    "castAura",
    "slashArc",
    "burst",
    "shockwave",
    "bolt",
    "nova",
    "muzzle",
    "castDragon",
    "castDragonAt",
    "castMeteor",
    "castTurret",
    "castDarkBlades",
    "castDarkBladesAt",
    "castSwordVolley",
    "castSoul",
    "castSoulAt",
    "castLaser",
    "castLaserAt",
  ];
  const stub: VfxStub = {};
  for (const n of names) stub[n] = vi.fn();
  return stub;
}

describe("Vfx.playSkill — collider-bound launch origin/angle", () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion();
  const collider = {
    pos: new THREE.Vector3(1.5, 1.2, 0.8),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.5, -0.2)),
    aim: new THREE.Vector3(1, 0, 0),
  };

  it("launches the slash arc from the collider position + orientation", () => {
    const stub = vfxStub();
    playSkill.call(stub, "slash", origin, forward, quat, undefined, undefined, collider);

    expect(stub.slashArc).toHaveBeenCalledTimes(1);
    const [at, q] = stub.slashArc.mock.calls[0];
    vecEq(at as THREE.Vector3, collider.pos);
    quatEq(q as THREE.Quaternion, collider.quat);
  });

  it("falls back to the flat front/facing for slash when no collider is given", () => {
    const stub = vfxStub();
    playSkill.call(stub, "slash", origin, forward, quat);

    const [at, q] = stub.slashArc.mock.calls[0];
    // front = origin + forward*1.2, y = origin.y + 1.1
    vecEq(at as THREE.Vector3, new THREE.Vector3(0, 1.1, 1.2));
    quatEq(q as THREE.Quaternion, quat);
  });

  it("launches a non-homing GLB spell from the collider pos along the collider aim", () => {
    const stub = vfxStub();
    // No `aim` arg -> non-homing branch uses dir3 (collider.aim) + slashAt.
    playSkill.call(stub, "fireDragon", origin, forward, quat, undefined, undefined, collider);

    expect(stub.castDragon).toHaveBeenCalledTimes(1);
    expect(stub.castDragonAt).not.toHaveBeenCalled();
    const [from, dir] = stub.castDragon.mock.calls[0];
    vecEq(from as THREE.Vector3, collider.pos);
    vecEq(dir as THREE.Vector3, collider.aim);
  });

  it("stands the turret ahead of the caster body along the flattened aim", () => {
    const stub = vfxStub();
    playSkill.call(stub, "turret", origin, forward, quat, undefined, undefined, collider);

    expect(stub.castTurret).toHaveBeenCalledTimes(1);
    const [at, dir] = stub.castTurret.mock.calls[0];
    // Matches the deployed-gameplay turret: it stands ahead of the caster BODY
    // (origin), not the collider hand. ground = collider.aim flattened+normalized
    // = (1,0,0); cast at origin + ground*0.7 (castTurret then shifts +1.5 along aim).
    vecEq(at as THREE.Vector3, origin.clone().addScaledVector(new THREE.Vector3(1, 0, 0), 0.7));
    vecEq(dir as THREE.Vector3, collider.aim);
  });
});

describe("Vfx.playSkill — homing spells still target aim", () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion();
  const aim = new THREE.Vector3(7, 1, -4);
  const collider = {
    pos: new THREE.Vector3(1.5, 1.2, 0.8),
    quat: new THREE.Quaternion(),
    aim: new THREE.Vector3(1, 0, 0),
  };

  it("homes fireDragon to aim while launching from the collider position", () => {
    const stub = vfxStub();
    playSkill.call(stub, "fireDragon", origin, forward, quat, aim, undefined, collider);

    expect(stub.castDragonAt).toHaveBeenCalledTimes(1);
    expect(stub.castDragon).not.toHaveBeenCalled();
    const [from, to] = stub.castDragonAt.mock.calls[0];
    vecEq(from as THREE.Vector3, collider.pos);
    vecEq(to as THREE.Vector3, aim);
  });

  it("homes darkBlades to aim (raised) while launching from the collider position", () => {
    const stub = vfxStub();
    playSkill.call(stub, "darkBlades", origin, forward, quat, aim, undefined, collider);

    expect(stub.castDarkBladesAt).toHaveBeenCalledTimes(1);
    const [from, to] = stub.castDarkBladesAt.mock.calls[0];
    vecEq(from as THREE.Vector3, collider.pos);
    vecEq(to as THREE.Vector3, aim.clone().setY(aim.y + 0.8));
  });

  it("keeps homing to aim even with no collider (flat launch point)", () => {
    const stub = vfxStub();
    playSkill.call(stub, "fireDragon", origin, forward, quat, aim);

    const [from, to] = stub.castDragonAt.mock.calls[0];
    // cast = origin with y + 1.1
    vecEq(from as THREE.Vector3, new THREE.Vector3(0, 1.1, 0));
    vecEq(to as THREE.Vector3, aim);
  });
});

/**
 * The ground-targeted model spells (meteor, swordVolley): the rig always casts
 * from `origin`, but the *aimTarget* (where the projectile resolves to) is what
 * the collider/aim move. Without an explicit `aim`, a collider pushes the target
 * a fixed distance ahead of the HAND position along the hand aim; without a
 * collider it falls back to letting the cast method derive it from body facing
 * (aimTarget === undefined). An explicit `aim` always wins.
 */
describe("Vfx.playSkill — ground-targeted spells (meteor / swordVolley)", () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion();
  const aim = new THREE.Vector3(7, 1, -4);
  const collider = {
    pos: new THREE.Vector3(1.5, 1.2, 0.8),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.5, -0.2)),
    aim: new THREE.Vector3(1, 0, 0),
  };

  // [castMethod name, ahead-distance the no-aim collider branch projects].
  const cases: ReadonlyArray<[SkillKind, string, number]> = [
    ["meteor", "castMeteor", 6],
    ["swordVolley", "castSwordVolley", 4],
  ];

  for (const [kind, method, ahead] of cases) {
    describe(kind, () => {
      it(`casts from origin and targets ${ahead} ahead of the collider hand along its aim`, () => {
        const stub = vfxStub();
        playSkill.call(stub, kind, origin, forward, quat, undefined, undefined, collider);

        expect(stub[method]).toHaveBeenCalledTimes(1);
        const [from, dir, , , aimTarget] = stub[method].mock.calls[0];
        vecEq(from as THREE.Vector3, origin);
        vecEq(dir as THREE.Vector3, collider.aim);
        vecEq(
          aimTarget as THREE.Vector3,
          collider.pos.clone().addScaledVector(collider.aim, ahead),
        );
      });

      it("casts from origin along body facing and defers the target when flat (no collider)", () => {
        const stub = vfxStub();
        playSkill.call(stub, kind, origin, forward, quat);

        const [from, dir, , , aimTarget] = stub[method].mock.calls[0];
        vecEq(from as THREE.Vector3, origin);
        vecEq(dir as THREE.Vector3, forward);
        // No collider + no aim -> let the cast method derive the landing spot.
        expect(aimTarget).toBeUndefined();
      });

      it("resolves toward the explicit aim regardless of the collider", () => {
        const withCollider = vfxStub();
        playSkill.call(withCollider, kind, origin, forward, quat, aim, undefined, collider);
        vecEq(withCollider[method].mock.calls[0][4] as THREE.Vector3, aim);

        const flat = vfxStub();
        playSkill.call(flat, kind, origin, forward, quat, aim);
        vecEq(flat[method].mock.calls[0][4] as THREE.Vector3, aim);
      });
    });
  }
});

/**
 * The straight-fire model spells (soul, laser) intentionally IGNORE the collider:
 * soul always leaves the chest-height `cast` point, laser always leaves the
 * forward `front` muzzle point. The collider must not move their launch origin —
 * only an explicit `aim` redirects them (homing to a raised aim). This is the
 * regression these tests guard: wiring the collider into either path would be a
 * silent behavior change.
 */
describe("Vfx.playSkill — straight-fire spells ignore the collider (soul / laser)", () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion();
  const aim = new THREE.Vector3(7, 1, -4);
  const collider = {
    pos: new THREE.Vector3(1.5, 1.2, 0.8),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.5, -0.2)),
    aim: new THREE.Vector3(1, 0, 0),
  };
  // cast = chest-height origin; front = one stride ahead along forward, chest-height.
  const cast = new THREE.Vector3(0, 1.1, 0);
  const front = new THREE.Vector3(0, 1.1, 1.2);

  describe("soul", () => {
    it("fires straight forward from the chest-height cast point when no aim", () => {
      const stub = vfxStub();
      playSkill.call(stub, "soul", origin, forward, quat);

      expect(stub.castSoul).toHaveBeenCalledTimes(1);
      expect(stub.castSoulAt).not.toHaveBeenCalled();
      const [from, dir] = stub.castSoul.mock.calls[0];
      vecEq(from as THREE.Vector3, cast);
      vecEq(dir as THREE.Vector3, forward);
    });

    it("homes to a raised aim from the cast point even when a collider is supplied", () => {
      const stub = vfxStub();
      playSkill.call(stub, "soul", origin, forward, quat, aim, undefined, collider);

      expect(stub.castSoulAt).toHaveBeenCalledTimes(1);
      expect(stub.castSoul).not.toHaveBeenCalled();
      const [from, to] = stub.castSoulAt.mock.calls[0];
      vecEq(from as THREE.Vector3, cast); // unmoved by the collider
      vecEq(to as THREE.Vector3, aim.clone().setY(aim.y + 0.8));
    });
  });

  describe("laser", () => {
    it("fires straight forward from the front muzzle point when no aim", () => {
      const stub = vfxStub();
      playSkill.call(stub, "laser", origin, forward, quat);

      expect(stub.castLaser).toHaveBeenCalledTimes(1);
      expect(stub.castLaserAt).not.toHaveBeenCalled();
      const [from, dir] = stub.castLaser.mock.calls[0];
      vecEq(from as THREE.Vector3, front);
      vecEq(dir as THREE.Vector3, forward);
    });

    it("homes to a raised aim from the front point even when a collider is supplied", () => {
      const stub = vfxStub();
      playSkill.call(stub, "laser", origin, forward, quat, aim, undefined, collider);

      expect(stub.castLaserAt).toHaveBeenCalledTimes(1);
      expect(stub.castLaser).not.toHaveBeenCalled();
      const [from, to] = stub.castLaserAt.mock.calls[0];
      vecEq(from as THREE.Vector3, front); // unmoved by the collider
      vecEq(to as THREE.Vector3, aim.clone().setY(aim.y + 0.8));
    });
  });
});
