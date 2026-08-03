import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { resolveFireAim } from "./resolveFireAim";

function makeCamera(pos: THREE.Vector3, lookAt: THREE.Vector3): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.copy(pos);
  cam.lookAt(lookAt);
  cam.updateMatrixWorld(true);
  return cam;
}

describe("resolveFireAim", () => {
  it("leads a moving target when projSpeed > 0", () => {
    const origin = new THREE.Vector3(0, 1, 0);
    const cam = makeCamera(new THREE.Vector3(0, 1.6, 4), new THREE.Vector3(0, 1, 0));
    const r = resolveFireAim({
      origin,
      camera: cam,
      target: {
        position: new THREE.Vector3(0, 0, -10),
        velocity: new THREE.Vector3(5, 0, 0),
      },
      projSpeed: 20,
      maxLeadFraction: 0.5,
      aimHeight: 1,
    });
    expect(r.locked).toBe(true);
    // Lead should push aim to the right of pure target XZ
    expect(r.aimPoint.x).toBeGreaterThan(0);
    expect(r.dir.length()).toBeCloseTo(1, 5);
  });

  it("falls back to screen-centre ray without target", () => {
    const origin = new THREE.Vector3(0, 1, 0);
    const cam = makeCamera(new THREE.Vector3(0, 1.6, 4), new THREE.Vector3(0, 1, -10));
    const r = resolveFireAim({
      origin,
      camera: cam,
      target: null,
      projSpeed: 0,
    });
    expect(r.locked).toBe(false);
    expect(r.dir.z).toBeLessThan(0);
  });
});
