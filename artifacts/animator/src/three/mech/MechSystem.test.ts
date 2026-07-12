import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { MechSystem, type MechAnchor } from "./MechSystem";
import { DEFAULT_MECH_TIMINGS } from "./mechState";

/**
 * Staged-transform "feel moment" tests for {@link MechSystem.update}.
 *
 * The discrete punctuation flags (`justOpened` / `justSealed` / `justReleased`)
 * are edge-detected purely from the machine snapshot, independent of whether the
 * GLB template has finished loading — so they can be asserted in the node test
 * env without WebGL. A regression here would silently drop the VFX / audio /
 * camera-shake cues that sell the suit-up + exit moments.
 */

const T = DEFAULT_MECH_TIMINGS;

function makeAnchor(): MechAnchor {
  return { pos: new THREE.Vector3(0, 0, 0), yaw: 0, speed: 0 };
}

/**
 * Drive the system across a full suit-up → piloted → exit → idle cycle, calling
 * `toggle()` at the right moments, and tally how many frames raised each staged
 * feel flag. `dt` is small + fixed so every phase edge is sampled.
 */
function runFullCycle(dt = 1 / 60): {
  opened: number;
  sealed: number;
  released: number;
  openedPhaseOk: boolean;
  releasedPhaseOk: boolean;
} {
  const sys = new MechSystem(new THREE.Scene());
  const anchor = makeAnchor();
  let opened = 0;
  let sealed = 0;
  let released = 0;
  let openedPhaseOk = true;
  let releasedPhaseOk = true;

  // Suit up.
  expect(sys.toggle()).toBe("enter");

  // Opening + enclosing → piloted (plus a margin to settle into piloted).
  const suitUp = T.opening + T.enclosing + 0.2;
  for (let t = 0; t < suitUp; t += dt) {
    const f = sys.update(dt, anchor);
    if (f.justOpened) {
      opened++;
      if (f.snap.phase !== "opening") openedPhaseOk = false;
    }
    if (f.justSealed) sealed++;
    if (f.justReleased) released++;
  }
  expect(sys.isPiloted).toBe(true);

  // Exit.
  expect(sys.toggle()).toBe("exit");
  const exitTime = T.exiting + 0.2;
  for (let t = 0; t < exitTime; t += dt) {
    const f = sys.update(dt, anchor);
    if (f.justOpened) opened++;
    if (f.justSealed) sealed++;
    if (f.justReleased) {
      released++;
      if (f.snap.phase !== "exiting") releasedPhaseOk = false;
    }
  }
  expect(sys.isActive).toBe(false);

  return { opened, sealed, released, openedPhaseOk, releasedPhaseOk };
}

describe("MechSystem staged-transform feel moments", () => {
  it("raises justOpened exactly once, on the opening edge", () => {
    const r = runFullCycle();
    expect(r.opened).toBe(1);
    expect(r.openedPhaseOk).toBe(true);
  });

  it("raises justSealed exactly once across the whole cycle", () => {
    const r = runFullCycle();
    expect(r.sealed).toBe(1);
  });

  it("raises justReleased exactly once, on the exiting edge", () => {
    const r = runFullCycle();
    expect(r.released).toBe(1);
    expect(r.releasedPhaseOk).toBe(true);
  });

  it("raises no feel-moment flags while idle before suiting up", () => {
    const sys = new MechSystem(new THREE.Scene());
    const anchor = makeAnchor();
    const f = sys.update(1 / 60, anchor);
    expect(f.justOpened).toBe(false);
    expect(f.justSealed).toBe(false);
    expect(f.justReleased).toBe(false);
    expect(f.snap.phase).toBe("idle");
    expect(f.footstep).toBeNull();
  });

  it("justOpened fires the frame after enter, before the next phase", () => {
    const sys = new MechSystem(new THREE.Scene());
    const anchor = makeAnchor();
    sys.toggle();
    const first = sys.update(1 / 60, anchor);
    expect(first.justOpened).toBe(true);
    expect(first.snap.phase).toBe("opening");
    // Subsequent opening frames must NOT re-raise it.
    const second = sys.update(1 / 60, anchor);
    expect(second.justOpened).toBe(false);
  });

  it("emits no footstep while the GLB template is unloaded", () => {
    // In the node test env the mech template never loads, so the procedural
    // walk never runs — the footstep channel must simply stay null.
    const sys = new MechSystem(new THREE.Scene());
    const anchor: MechAnchor = { pos: new THREE.Vector3(), yaw: 0, speed: 1 };
    sys.toggle();
    let sawFootstep = false;
    for (let t = 0; t < T.opening + T.enclosing + 1; t += 1 / 60) {
      const f = sys.update(1 / 60, anchor);
      if (f.footstep) sawFootstep = true;
    }
    expect(sawFootstep).toBe(false);
  });

  it("forceIdle resets the edge-detection state so a re-entry re-opens cleanly", () => {
    const sys = new MechSystem(new THREE.Scene());
    const anchor = makeAnchor();
    sys.toggle();
    for (let t = 0; t < T.opening + T.enclosing + 0.2; t += 1 / 60) {
      sys.update(1 / 60, anchor);
    }
    expect(sys.isPiloted).toBe(true);
    sys.forceIdle();
    expect(sys.isActive).toBe(false);
    // A fresh suit-up after a forced reset must still raise justOpened once.
    expect(sys.toggle()).toBe("enter");
    const f = sys.update(1 / 60, anchor);
    expect(f.justOpened).toBe(true);
  });
});
