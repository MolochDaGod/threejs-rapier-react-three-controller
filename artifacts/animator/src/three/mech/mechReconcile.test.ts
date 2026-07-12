import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { MechSystem } from "./MechSystem";
import { MechReconciler, MECH_PILOT_SPEED_MUL, type MechReconcileHost } from "./mechReconcile";
import { DEFAULT_MECH_TIMINGS } from "./mechState";

const T = DEFAULT_MECH_TIMINGS;
/** Time to fully suit up: opening + enclosing → piloted (plus a hair of slack). */
const SUIT_UP = T.opening + T.enclosing + 1e-3;

/**
 * A deterministic stand-in for the Studio surface the reconciler drives. Records
 * the latest pilot visibility + applied speed multiplier so each takeover edge
 * can be asserted without a WebGL context or the full Studio. `spectating` and
 * `base` are mutable to mimic the live getters Studio wires in.
 */
class FakeHost implements MechReconcileHost {
  pilotVisible = true;
  speedMul = 1;
  spectatingFlag = false;
  base = 1;
  /** Latest mech-aim camera state (widened pitch clamp active). */
  aimActive = false;

  spectating(): boolean {
    return this.spectatingFlag;
  }
  baseSpeedMul(): number {
    return this.base;
  }
  setSpeedMultiplier(mul: number): void {
    this.speedMul = mul;
  }
  setPilotVisible(visible: boolean): void {
    this.pilotVisible = visible;
  }
  setMechAimActive(active: boolean): void {
    this.aimActive = active;
  }
  anchor() {
    return { pos: new THREE.Vector3(), yaw: 0, speed: 0 };
  }
}

/** Advance the reconciler by `seconds` in small frames (no GLB ever loads). */
function step(r: MechReconciler, seconds: number, dt = 1 / 60): void {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const s = Math.min(dt, remaining);
    r.update(s);
    remaining -= s;
  }
}

describe("MechReconciler (Studio-side mech transitions)", () => {
  let scene: THREE.Scene;
  let mech: MechSystem;
  let host: FakeHost;
  let rec: MechReconciler;

  beforeEach(() => {
    scene = new THREE.Scene();
    mech = new MechSystem(scene);
    host = new FakeHost();
    rec = new MechReconciler(mech, host);
  });

  /** Suit up and drive frames until fully piloted (pilot hidden, mech speed). */
  function suitUpToPiloted(): void {
    mech.toggle(); // enter
    step(rec, SUIT_UP);
    expect(mech.isPiloted).toBe(true);
    expect(host.pilotVisible).toBe(false);
    expect(host.speedMul).toBe(MECH_PILOT_SPEED_MUL);
  }

  it("update() hides the pilot + takes mech speed once fully piloted", () => {
    expect(mech.isActive).toBe(false);
    suitUpToPiloted();
    expect(rec.prevControlled).toBe(true);
  });

  it("startDuel-style cancel() while piloted tears down the mech + restores the pilot", () => {
    suitUpToPiloted();
    rec.skillCd = 3; // an in-flight slam cooldown should be cleared on teardown

    // This is exactly what Studio.cancelMech() (called by startDuel) delegates to.
    rec.cancel();

    expect(mech.isActive).toBe(false);
    expect(mech.isPiloted).toBe(false);
    expect(host.pilotVisible).toBe(true); // pilot restored (not spectating)
    expect(host.speedMul).toBe(host.base); // base move speed restored
    expect(rec.prevControlled).toBe(false);
    expect(rec.skillCd).toBe(0);
  });

  it("cancel() keeps the pilot hidden when the takeover is a duel spectator", () => {
    suitUpToPiloted();
    host.spectatingFlag = true; // duel hands the avatar to the spectator camera

    rec.cancel();

    expect(mech.isActive).toBe(false);
    // The spectator invariant wins: the hidden pilot must stay hidden.
    expect(host.pilotVisible).toBe(false);
    expect(host.speedMul).toBe(host.base);
  });

  it("cancel() is a no-op when no mech is active and none was controlled", () => {
    host.pilotVisible = false; // some unrelated state — must be left untouched
    host.speedMul = 1.5;

    rec.cancel();

    expect(host.pilotVisible).toBe(false);
    expect(host.speedMul).toBe(1.5);
  });

  it("phantom expiry while piloted leaves the pilot hidden + mech speed intact", () => {
    // Smoke-Phantom buff would have set the pilot invisible + a speed change
    // earlier; then the player suits up. Once piloted the mech owns both.
    suitUpToPiloted();

    // The phantom timer hits zero mid-pilot → Studio calls this restore hook.
    rec.restorePilotIfMechInactive();

    // Because a mech IS active it must NOT clobber the mech-owned state.
    expect(host.pilotVisible).toBe(false);
    expect(host.speedMul).toBe(MECH_PILOT_SPEED_MUL);
  });

  it("phantom expiry with no mech active restores the pilot + base speed", () => {
    // Pilot was hidden + sped/slowed by the buff; no mech in play.
    host.pilotVisible = false;
    host.speedMul = 1.6;

    rec.restorePilotIfMechInactive();

    expect(host.pilotVisible).toBe(true);
    expect(host.speedMul).toBe(host.base);
  });

  it("widens the aim pitch clamp on the piloted edge and restores it on exit", () => {
    expect(host.aimActive).toBe(false);
    suitUpToPiloted();
    expect(host.aimActive).toBe(true);

    // Exit: the widened clamp must come off the moment piloting ends (the exit
    // morph plays under the normal camera), not only when the mech reaches idle.
    mech.toggle();
    step(rec, 1 / 30);
    expect(mech.isPiloted).toBe(false);
    expect(host.aimActive).toBe(false);
    step(rec, T.exiting + 0.2);
    expect(mech.isActive).toBe(false);
    expect(host.aimActive).toBe(false);
  });

  it("cancel() while piloted always restores the default aim pitch clamp", () => {
    suitUpToPiloted();
    expect(host.aimActive).toBe(true);
    rec.cancel();
    expect(host.aimActive).toBe(false);
  });

  it("restores the slow Tank baseline (not a bare 1) on cancel + phantom expiry", () => {
    host.base = 0.6; // Tank/Centurion permanent move penalty
    suitUpToPiloted();
    rec.cancel();
    expect(host.speedMul).toBe(0.6);

    // And the phantom hook restores to the same baseline, never 1.
    host.speedMul = 1.6;
    rec.restorePilotIfMechInactive();
    expect(host.speedMul).toBe(0.6);
  });
});
