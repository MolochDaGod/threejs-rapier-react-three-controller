import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FootGrounder, findLegChain } from "./legIk";

/**
 * Build a minimal metre-scaled biped skeleton (Bip001 naming) so the grounder's
 * name-based bone resolution + pelvis-drop can be exercised with pure Object3D
 * math (no WebGL / renderer needed).
 *
 *   root
 *    └─ Bip001_Pelvis            (hip, y = 0.9)
 *        ├─ Bip001_L_Thigh → _L_Calf → _L_Foot   (each 0.45 down)
 *        └─ Bip001_R_Thigh → _R_Calf → _R_Foot
 *
 * Feet rest at world y = 0. The returned `pelvis` starts at local y = 0.9.
 */
function makeBiped(): { root: THREE.Object3D; pelvis: THREE.Bone } {
  const root = new THREE.Object3D();
  const pelvis = new THREE.Bone();
  pelvis.name = "Bip001_Pelvis";
  pelvis.position.set(0, 0.9, 0);
  root.add(pelvis);

  for (const side of ["L", "R"] as const) {
    const thigh = new THREE.Bone();
    thigh.name = `Bip001_${side}_Thigh`;
    thigh.position.set(side === "L" ? 0.1 : -0.1, 0, 0);
    const calf = new THREE.Bone();
    calf.name = `Bip001_${side}_Calf`;
    calf.position.set(0, -0.45, 0);
    const foot = new THREE.Bone();
    foot.name = `Bip001_${side}_Foot`;
    foot.position.set(0, -0.45, 0);
    thigh.add(calf);
    calf.add(foot);
    pelvis.add(thigh);
  }
  root.updateMatrixWorld(true);
  return { root, pelvis };
}

describe("findLegChain (Bip001 naming)", () => {
  it("resolves thigh/calf/foot for each side", () => {
    const { root } = makeBiped();
    const l = findLegChain(root, "L");
    const r = findLegChain(root, "R");
    expect(l?.upper.name).toBe("Bip001_L_Thigh");
    expect(l?.lower.name).toBe("Bip001_L_Calf");
    expect(l?.foot.name).toBe("Bip001_L_Foot");
    expect(r?.upper.name).toBe("Bip001_R_Thigh");
  });
});

describe("FootGrounder pelvis-drop idempotency", () => {
  // Ground below the resting feet forces a downward pelvis drop every frame.
  const belowGround = () => ({ y: -0.2, normal: null });

  // One engine frame in the documented order: undo last frame's drop PRE-mixer
  // (beginFrame), let the "mixer" write the animated pose, then run the grounding
  // pass. `mixer` is omitted for a rotation-only clip (nothing rewrites the
  // pelvis position between frames — the historical accumulation regression).
  function frame(g: FootGrounder, mixer?: () => void): void {
    g.beginFrame();
    mixer?.();
    g.apply(1 / 60);
  }

  it("does NOT accumulate the drop for a rotation-only clip (no pelvis track)", () => {
    const { root, pelvis } = makeBiped();
    const g = new FootGrounder();
    g.bind(root);
    g.setGroundSampler(belowGround);
    g.setEnabled(true);

    let minY = Infinity;
    for (let i = 0; i < 240; i++) {
      frame(g);
      minY = Math.min(minY, pelvis.position.y);
    }

    // The pelvis settles near base(0.9) + drop, never spiraling far below it.
    // Pre-fix this ran away toward large negative values over 240 frames.
    expect(pelvis.position.y).toBeGreaterThan(0.9 - 0.45);
    expect(minY).toBeGreaterThan(0.9 - 0.45);
    expect(pelvis.position.y).toBeLessThan(0.9); // a drop really did apply
  });

  it("matches the animated-pelvis case (mixer re-writes the pose each frame)", () => {
    const settle = (withTrack: boolean): number => {
      const { root, pelvis } = makeBiped();
      const g = new FootGrounder();
      g.bind(root);
      g.setGroundSampler(belowGround);
      g.setEnabled(true);
      const mixer = withTrack
        ? () => {
            pelvis.position.set(0, 0.9, 0);
            pelvis.updateWorldMatrix(false, true);
          }
        : undefined;
      for (let i = 0; i < 240; i++) frame(g, mixer);
      return pelvis.position.y;
    };

    // A rotation-only rig and one with a pelvis translation track must converge
    // to the same settled pelvis height.
    expect(settle(false)).toBeCloseTo(settle(true), 3);
  });

  it("does not leak a drop across one-shot clip cycles (mixer save/restore of original state)", () => {
    const { root, pelvis } = makeBiped();
    const g = new FootGrounder();
    g.bind(root);
    g.setGroundSampler(belowGround);
    g.setEnabled(true);

    // Model three.js AnimationMixer semantics for a one-shot clip: when the clip
    // STARTS the mixer saves the pelvis value it observes that frame (which is
    // post-beginFrame, i.e. the clean bind base); when it FINISHES the mixer
    // writes that saved value back. This used to leak one extra drop per cycle
    // (evade / idle re-trigger) — repeated cycles must NOT drift downward now.
    let saved: number | null = null;
    const settled: number[] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      frame(g, () => {
        saved = pelvis.position.y; // clip starts: mixer saves "original state"
      });
      for (let i = 0; i < 20; i++) frame(g); // clip runs (rotation-only)
      frame(g, () => {
        if (saved != null) pelvis.position.y = saved; // clip finishes: restore
      });
      for (let i = 0; i < 20; i++) frame(g); // settle
      settled.push(pelvis.position.y);
    }

    for (const y of settled) expect(y).toBeCloseTo(settled[0], 3);
    expect(settled[0]).toBeGreaterThan(0.9 - 0.45);
    expect(settled[0]).toBeLessThan(0.9);
  });

  it("restores the bind pose when disabled", () => {
    const { root, pelvis } = makeBiped();
    const g = new FootGrounder();
    g.bind(root);
    g.setGroundSampler(belowGround);
    g.setEnabled(true);
    for (let i = 0; i < 30; i++) frame(g);
    expect(pelvis.position.y).toBeLessThan(0.9); // dropped while enabled
    g.setEnabled(false);
    expect(pelvis.position.y).toBeCloseTo(0.9, 6); // bind pose restored on disable
  });
});
