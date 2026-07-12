/**
 * Hair / beard motion rig — cheap "physics" for hanging protrusion boxes.
 *
 * The composed head tags hanging hair volume (dread locks, curtains, fringe,
 * beard braids) with a {@link BoxMotion}: a pivot anchor near the roots plus
 * sway/gravity coefficients. Renderers wrap each tagged box mesh in a pivot
 * group and, per frame, the rig applies:
 *
 *  - **wind sway** — a small deterministic pendulum (per-anchor phase, so all
 *    segments of one braided lock swing together as a rigid rope), and
 *  - **gravity lean** — when the head tilts, hanging parts counter-rotate a
 *    fraction of the way toward world-down, so dreads/beards keep hanging
 *    down instead of sticking out sideways.
 *
 * Everything angle-related is pure and unit-testable ({@link gravityLean},
 * {@link motionPhase}); only {@link createHairMotionRig} touches THREE.
 */
import * as THREE from "three";
import { hash01 } from "./pixels";
import type { BoxMotion, ProtrusionBox } from "./composeHead";

/** Hard cap on how far gravity can lean a part (radians). */
export const MAX_GRAVITY_LEAN = 0.7;

/** Wind pendulum frequency (rad/s-ish); light fringe flutters faster. */
export const WIND_FREQ = 1.5;
export const WIND_FREQ_LIGHT = 2.6;

/**
 * Rotation (about the pivot's X/Z) that leans a hanging part toward
 * world-down, given world-down expressed in head-local space `(dx, dy, dz)`.
 * `gravity` scales how much of the full lean the part adopts (0 = rigid,
 * 1 = always hangs plumb). Clamped to {@link MAX_GRAVITY_LEAN} so extreme
 * head tilts don't fold hair through the skull. Pure.
 */
export function gravityLean(
  dx: number,
  dy: number,
  dz: number,
  gravity: number,
  maxLean = MAX_GRAVITY_LEAN,
): { rx: number; rz: number } {
  // The hang axis is -Y in head space; lean toward the down vector's lateral
  // components. Guard the denominator so an upside-down head saturates at the
  // clamp instead of exploding.
  const down = Math.max(0.15, -dy);
  const clamp = (v: number) => Math.min(maxLean, Math.max(-maxLean, v));
  return {
    rx: clamp(-Math.atan2(dz, down)) * gravity,
    rz: clamp(Math.atan2(dx, down)) * gravity,
  };
}

/**
 * Deterministic wind phase for a pivot anchor. Boxes sharing an anchor (the
 * segments of one braided lock) get the same phase, so they swing in
 * lockstep as one rope. Pure.
 */
export function motionPhase(ax: number, az: number): number {
  return hash01(Math.round(ax * 512), Math.round(az * 512), 29) * Math.PI * 2;
}

interface MotionEntry {
  pivot: THREE.Group;
  motion: BoxMotion;
  phase: number;
}

/** Live rig: wrap motion-tagged box meshes, then update once per frame. */
export interface HairMotionRig {
  /**
   * Parent `mesh` (already positioned in head-local space) under a pivot at
   * the motion anchor and return the pivot to add to the head group.
   */
  wrap(box: ProtrusionBox & { motion: BoxMotion }, mesh: THREE.Object3D): THREE.Object3D;
  /** Number of wrapped parts (0 = nothing to animate). */
  readonly size: number;
  /**
   * Advance wind + gravity. `headQuat` is the head's current world (or
   * stage-local) orientation used to derive where "down" is; omit for an
   * upright head (wind only).
   */
  update(timeSec: number, headQuat?: THREE.Quaternion): void;
}

const SCRATCH_Q = new THREE.Quaternion();
const SCRATCH_DOWN = new THREE.Vector3();

/** Build an empty rig; renderers create one per protrusion rebuild. */
export function createHairMotionRig(): HairMotionRig {
  const entries: MotionEntry[] = [];
  return {
    wrap(box, mesh) {
      const m = box.motion;
      const pivot = new THREE.Group();
      pivot.position.set(m.ax, m.ay, m.az);
      mesh.position.set(box.x - m.ax, box.y - m.ay, box.z - m.az);
      pivot.add(mesh);
      entries.push({ pivot, motion: m, phase: motionPhase(m.ax, m.az) });
      return pivot;
    },
    get size() {
      return entries.length;
    },
    update(timeSec, headQuat) {
      if (entries.length === 0) return;
      let dx = 0;
      let dy = -1;
      let dz = 0;
      if (headQuat) {
        SCRATCH_Q.copy(headQuat).invert();
        SCRATCH_DOWN.set(0, -1, 0).applyQuaternion(SCRATCH_Q);
        dx = SCRATCH_DOWN.x;
        dy = SCRATCH_DOWN.y;
        dz = SCRATCH_DOWN.z;
      }
      for (const e of entries) {
        const m = e.motion;
        const lean = gravityLean(dx, dy, dz, m.gravity);
        const freq = m.light ? WIND_FREQ_LIGHT : WIND_FREQ;
        e.pivot.rotation.x = lean.rx + Math.sin(timeSec * freq + e.phase) * m.sway;
        e.pivot.rotation.z =
          lean.rz + Math.cos(timeSec * freq * 0.77 + e.phase) * m.sway * 0.7;
      }
    },
  };
}
