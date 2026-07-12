import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { TelegraphField } from "./fx/Indicators";
import { Targets } from "./Targets";

const TG_YELLOW = 0xffcf3a;
const TG_RED = 0xff2a2a;

/** The single mesh a {@link TelegraphField} owns while one telegraph is in flight. */
function activeMesh(scene: THREE.Scene): THREE.Mesh | undefined {
  return scene.children.find((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
}

/**
 * The boss AoE telegraph is a timing contract: the ring blinks yellow for
 * `yellowDur`, snaps to solid red for `redDur` (the pre-impact warning), and the
 * hit (`onResolve`) lands exactly `redDur` after it turns red — so a player who
 * leaves the circle in time is spared. These tests drive `update(dt)` across the
 * three phases and lock the timing + the exception-safe resolve.
 */
describe("TelegraphField (boss AoE telegraph timing)", () => {
  it("blinks yellow, turns red, then resolves once at impact (yellowDur + redDur)", () => {
    const scene = new THREE.Scene();
    const field = new TelegraphField(scene);
    let resolves = 0;
    // yellow [0, 0.5), red [0.5, 1.0), resolve at t >= 1.0.
    field.add(new THREE.Vector3(0, 0, 0), 3, () => resolves++, 0.5, 0.5);

    // --- Yellow phase (t = 0.3): blinking yellow, not resolved. ---
    field.update(0.3);
    expect(resolves).toBe(0);
    expect(activeMesh(scene)).toBeDefined();
    expect((activeMesh(scene)!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(TG_YELLOW);

    // --- Red phase (t = 0.6 then 0.9): solid red, still not resolved. ---
    field.update(0.3);
    expect(resolves).toBe(0);
    expect((activeMesh(scene)!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(TG_RED);

    field.update(0.3);
    expect(resolves).toBe(0);
    expect((activeMesh(scene)!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(TG_RED);

    // --- Impact (t = 1.2 >= yellowDur + redDur): resolves exactly once. ---
    field.update(0.3);
    expect(resolves).toBe(1);
    // The ring is torn down at resolve (removed from the scene).
    expect(activeMesh(scene)).toBeUndefined();

    // Further ticks must not re-fire a resolved telegraph.
    field.update(0.3);
    field.update(1.0);
    expect(resolves).toBe(1);

    field.dispose();
  });

  it("does not resolve before the full yellow + red window has elapsed", () => {
    const scene = new THREE.Scene();
    const field = new TelegraphField(scene);
    let resolves = 0;
    field.add(new THREE.Vector3(0, 0, 0), 3, () => resolves++, 0.5, 0.5);

    // Advance to t = 0.9 — still inside the red warning, the hit has NOT landed.
    for (let i = 0; i < 9; i++) field.update(0.1);
    expect(resolves).toBe(0);
    expect(activeMesh(scene)).toBeDefined();

    field.dispose();
  });

  it("swallows an exception from onResolve and still tears the telegraph down", () => {
    const scene = new THREE.Scene();
    const field = new TelegraphField(scene);
    field.add(
      new THREE.Vector3(0, 0, 0),
      3,
      () => {
        throw new Error("resolve blew up");
      },
      0.5,
      0.5,
    );

    // A throwing resolver must never break the render loop, and the ring must
    // still be removed so it doesn't leak or fire again.
    expect(() => field.update(1.2)).not.toThrow();
    expect(activeMesh(scene)).toBeUndefined();
    expect(() => field.update(0.3)).not.toThrow();

    field.dispose();
  });
});

/** Build a dummy at (x, z) of the given faction and register it on a Targets. */
function addDummy(targets: Targets, x: number, z: number, faction: "enemy" | "ally") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = targets as any;
  const d = t.makeDummy(new THREE.Vector3(x, 0, z), "sword", faction);
  t.dummies.push(d);
  return d;
}

/**
 * `blastFaction` is how an AoE telegraph actually applies its effect at impact:
 * it damages every living combatant of the targeted faction inside the circle,
 * scaled by `aoeFalloff`. These tests prove it only hits the targeted faction
 * and respects the radius gate + falloff, so a boss skill aimed at the player's
 * allies can't touch the enemy ranks (or vice-versa).
 */
describe("Targets.blastFaction (faction-gated AoE resolve)", () => {
  it("only damages the targeted faction inside the radius", () => {
    const scene = new THREE.Scene();
    const targets = new Targets(scene, 0, 8);

    const allyIn = addDummy(targets, 0, 0, "ally"); // dead-center, fully inside
    const allyOut = addDummy(targets, 20, 0, "ally"); // far outside the radius
    const enemyIn = addDummy(targets, 0, 0, "enemy"); // inside, but wrong faction

    const center = new THREE.Vector3(0, 1.1, 0); // chest height of a (x,0,z) dummy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits = (targets as any).blastFaction(center, 3, 40, 1, "ally");

    expect(hits).toBe(1);
    expect(allyIn.cc.getHealth()).toBeLessThan(allyIn.maxHealth);
    expect(allyOut.cc.getHealth()).toBe(allyOut.maxHealth);
    expect(enemyIn.cc.getHealth()).toBe(enemyIn.maxHealth);

    targets.dispose();
  });

  it("respects AoE falloff — a closer target loses more health than a farther one", () => {
    const scene = new THREE.Scene();
    const targets = new Targets(scene, 0, 8);

    const near = addDummy(targets, 0, 0, "enemy"); // falloff = 1 (center)
    const far = addDummy(targets, 0, 2.5, "enemy"); // inside radius 3, near the edge

    const center = new THREE.Vector3(0, 1.1, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits = (targets as any).blastFaction(center, 3, 60, 1, "enemy");

    expect(hits).toBe(2);
    const nearLost = near.maxHealth - near.cc.getHealth();
    const farLost = far.maxHealth - far.cc.getHealth();
    expect(nearLost).toBeGreaterThan(farLost);
    expect(farLost).toBeGreaterThan(0);

    targets.dispose();
  });
});
