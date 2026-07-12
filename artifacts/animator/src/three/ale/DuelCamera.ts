import * as THREE from "three";
import type { AleCameraMode } from "../types";

/** Per-frame spatial read the camera rig needs to frame the action. */
export interface CameraFrame {
  aPos: THREE.Vector3;
  bPos: THREE.Vector3;
  aHead: THREE.Vector3;
  bHead: THREE.Vector3;
  /** Director hotspot the drone auto-aims at (world space). */
  hotspot: THREE.Vector3;
  /** Closing/exciting-ness 0..1 — tightens the drone framing when high. */
  intensity: number;
}

const EYE = 1.55;

/** Exponential smoothing toward a target (frame-rate independent). */
function damp(cur: number, target: number, lambda: number, dt: number): number {
  return target + (cur - target) * Math.exp(-lambda * dt);
}

function dampVec(cur: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  cur.x = damp(cur.x, target.x, lambda, dt);
  cur.y = damp(cur.y, target.y, lambda, dt);
  cur.z = damp(cur.z, target.z, lambda, dt);
}

/**
 * A.L.E. director camera rig. Owns its own desired pose per mode and damps the
 * live camera toward it, so switching modes is always a smooth glide rather than
 * a cut. Fully decoupled from the player Controller — Studio only hands it the
 * camera to write into while a duel camera is active.
 */
export class DuelCamera {
  private mode: AleCameraMode = "director";
  private readonly pos = new THREE.Vector3(0, 6, 9);
  private readonly look = new THREE.Vector3();
  private azimuth = 0;
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  /** True until the first update, so we snap (not glide) on the opening frame. */
  private fresh = true;

  setMode(mode: AleCameraMode): void {
    this.mode = mode;
  }

  getMode(): AleCameraMode {
    return this.mode;
  }

  /** Recompute the desired pose for the active mode and damp toward it. */
  update(dt: number, f: CameraFrame): void {
    this.computeDesired(dt, f);
    if (this.fresh) {
      this.pos.copy(this.desiredPos);
      this.look.copy(this.desiredLook);
      this.fresh = false;
      return;
    }
    // Director drone reacts faster as the action heats up; POV/orbit stay calm.
    const posLambda = this.mode === "director" ? 3 + f.intensity * 4 : 4;
    dampVec(this.pos, this.desiredPos, posLambda, dt);
    dampVec(this.look, this.desiredLook, 8, dt);
  }

  /** Write the damped pose into the live camera. */
  applyTo(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
  }

  private computeDesired(dt: number, f: CameraFrame): void {
    const mid = this.tmp.copy(f.aPos).add(f.bPos).multiplyScalar(0.5);
    const sep = f.aPos.distanceTo(f.bPos);

    switch (this.mode) {
      case "povA":
        this.overShoulder(f.aPos, f.aHead, f.bHead);
        break;
      case "povB":
        this.overShoulder(f.bPos, f.bHead, f.aHead);
        break;
      case "orbit": {
        this.azimuth += dt * 0.35;
        const r = Math.max(5, sep * 1.4 + 3.5);
        this.desiredPos.set(
          mid.x + Math.cos(this.azimuth) * r,
          mid.y + 3.2,
          mid.z + Math.sin(this.azimuth) * r,
        );
        this.desiredLook.set(mid.x, mid.y + EYE * 0.7, mid.z);
        break;
      }
      case "director":
      default: {
        // Drone: pull in & lower as intensity rises; orbit slowly so it feels alive.
        this.azimuth += dt * (0.15 + f.intensity * 0.25);
        const r = THREE.MathUtils.lerp(
          Math.max(6, sep * 1.5 + 4.5),
          Math.max(4, sep * 1.05 + 2.6),
          f.intensity,
        );
        const h = THREE.MathUtils.lerp(3.6, 1.9, f.intensity);
        this.desiredPos.set(
          f.hotspot.x + Math.cos(this.azimuth) * r,
          f.hotspot.y + h,
          f.hotspot.z + Math.sin(this.azimuth) * r,
        );
        this.desiredLook.copy(f.hotspot);
        break;
      }
    }
  }

  /** Over-the-shoulder POV: sit behind `self`, look toward `foe`. */
  private overShoulder(self: THREE.Vector3, selfHead: THREE.Vector3, foeHead: THREE.Vector3): void {
    const fwd = this.tmp2.copy(foeHead).sub(selfHead);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    // Behind & above the shoulder, nudged to the right for an over-shoulder feel.
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    this.desiredPos
      .copy(self)
      .addScaledVector(fwd, -2.6)
      .addScaledVector(right, 0.7);
    this.desiredPos.y = self.y + EYE + 0.45;
    this.desiredLook.copy(foeHead);
  }

  dispose(): void {
    /* no GPU resources owned */
  }
}
