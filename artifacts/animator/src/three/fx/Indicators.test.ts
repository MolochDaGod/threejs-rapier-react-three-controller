import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { TelegraphField } from "./Indicators";

/**
 * Regression coverage for the AOE/boss telegraph contract: the ring blinks
 * yellow for `yellowDur`, snaps to solid red for `redDur`, then resolves the
 * impact EXACTLY once — `redDur` after the ring turns red. The resolve must also
 * survive a throwing callback so a bad effect can never break the render loop.
 */
describe("TelegraphField", () => {
  it("resolves once, redDur after the ring turns red (0.5s + 0.5s)", () => {
    const scene = new THREE.Scene();
    const tg = new TelegraphField(scene);
    let resolved = 0;
    tg.add(new THREE.Vector3(0, 0, 0), 3, () => resolved++, 0.5, 0.5);

    // Step through the 0.5s yellow phase — no resolve yet.
    for (let t = 0; t < 0.5; t += 0.1) tg.update(0.1);
    expect(resolved).toBe(0);

    // Step through the 0.5s red phase — still no resolve until it elapses.
    for (let t = 0; t < 0.49; t += 0.1) tg.update(0.1);
    expect(resolved).toBe(0);

    // Crossing yellowDur + redDur fires the impact exactly once...
    tg.update(0.1);
    expect(resolved).toBe(1);

    // ...and never again (the telegraph is removed after resolving).
    tg.update(0.5);
    expect(resolved).toBe(1);

    tg.dispose();
  });

  it("clear() drops in-flight telegraphs WITHOUT resolving them", () => {
    const scene = new THREE.Scene();
    const tg = new TelegraphField(scene);
    let resolved = 0;
    tg.add(new THREE.Vector3(0, 0, 0), 2, () => resolved++);
    tg.update(0.6); // partway into the red phase
    tg.clear();
    tg.update(2); // would have resolved had it survived
    expect(resolved).toBe(0);
    tg.dispose();
  });

  it("a throwing resolve callback cannot break the update loop", () => {
    const scene = new THREE.Scene();
    const tg = new TelegraphField(scene);
    let secondFired = false;
    tg.add(new THREE.Vector3(0, 0, 0), 2, () => {
      throw new Error("bad effect");
    });
    tg.add(new THREE.Vector3(5, 0, 5), 2, () => {
      secondFired = true;
    });
    // One full cycle resolves both; the throwing one must not abort the other.
    expect(() => tg.update(1.01)).not.toThrow();
    expect(secondFired).toBe(true);
    tg.dispose();
  });
});
