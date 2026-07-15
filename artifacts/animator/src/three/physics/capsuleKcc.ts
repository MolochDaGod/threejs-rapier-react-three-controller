import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { CollisionProvider } from "../Controller";

/**
 * Shared player capsule dimensions (metres).
 * Total height = 2*radius + 2*halfHeight ≈ 1.8m for default values.
 */
export const CAP_RADIUS = 0.35;
export const CAP_HALF = 0.55;
/** Feet → capsule geometric centre. */
export const CAP_CENTER_OFF = CAP_RADIUS + CAP_HALF;

/** Skin gap between capsule and environment (Rapier character offset). */
export const KCC_OFFSET = 0.1;

/** Max metres of desired translation per KCC sub-step (anti-tunnel). */
const MAX_SUBSTEP = 0.28;
/** Extra settle iterations that push the capsule out of deep overlaps. */
const DEEP_RESOLVE_ITERS = 3;

export interface CapsuleKccParts {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  /** Override feet → centre offset (defaults to CAP_CENTER_OFF). */
  centerOff?: number;
}

/**
 * Tune a Rapier kinematic character controller for playable mesh worlds:
 * autostep platforms, snap to ground, climb/slide slopes, leave a visible-safe gap.
 */
export function configureCharacterController(
  c: RAPIER.KinematicCharacterController,
  opts: { offset?: number } = {},
): void {
  // Offset is fixed at create time on the controller; callers pass the same
  // value they used for world.createCharacterController(offset).
  void opts.offset;
  c.setUp({ x: 0, y: 1, z: 0 });
  c.enableAutostep(0.45, 0.22, true);
  c.enableSnapToGround(0.45);
  c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  c.setMinSlopeSlideAngle((32 * Math.PI) / 180);
  c.setApplyImpulsesToDynamicBodies(true);
  // Optional APIs across rapier minors — enable when present.
  const anyC = c as unknown as {
    setSlideEnabled?: (v: boolean) => void;
    setNormalNudgeFactor?: (v: number) => void;
    setMaxCharacterPenetrationCorrection?: (v: number) => void;
  };
  anyC.setSlideEnabled?.(true);
  anyC.setNormalNudgeFactor?.(0.05);
  anyC.setMaxCharacterPenetrationCorrection?.(0.25);
}

/**
 * One KCC integration step: place capsule, compute corrected movement, advance.
 * Returns new centre + grounded flag.
 */
function stepKcc(
  parts: CapsuleKccParts,
  center: { x: number; y: number; z: number },
  desired: { x: number; y: number; z: number },
): { center: { x: number; y: number; z: number }; grounded: boolean } {
  const { body, collider, controller } = parts;
  body.setTranslation(center, true);
  controller.computeColliderMovement(collider, desired);
  const mv = controller.computedMovement();
  const next = {
    x: center.x + mv.x,
    y: center.y + mv.y,
    z: center.z + mv.z,
  };
  body.setTranslation(next, true);
  return { center: next, grounded: controller.computedGrounded() };
}

/**
 * Project the capsule out of solid geometry when it starts the frame meshed
 * inside a collider. Must NOT apply free-space motion (that would float the
 * character every frame). We only keep KCC results that look like corrections:
 * lateral eject, unexpected upward lift off an embedded floor, or downward
 * push from a ceiling.
 */
function depenetrate(
  parts: CapsuleKccParts,
  center: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  // Tiny rest resolve — Rapier projects out of overlaps before applying desired.
  const settle = stepKcc(parts, center, { x: 0, y: 0.01, z: 0 });
  const dx = settle.center.x - center.x;
  const dy = settle.center.y - center.y;
  const dz = settle.center.z - center.z;
  const lateral = Math.hypot(dx, dz);
  // Horizontal correction ⇒ we were inside a wall / mesh volume.
  if (lateral > 0.002) {
    parts.body.setTranslation(settle.center, true);
    return settle.center;
  }
  // More upward than the tiny desired nudge ⇒ embedded in a floor / platform.
  if (dy > 0.02) {
    const lifted = {
      x: center.x,
      y: center.y + Math.min(dy, 0.2),
      z: center.z,
    };
    parts.body.setTranslation(lifted, true);
    return lifted;
  }
  // Pushed down ⇒ ceiling embed.
  if (dy < -0.005) {
    parts.body.setTranslation(settle.center, true);
    return settle.center;
  }

  // Still stuck? Try short cardinal probes and keep only *partial* results
  // (blocked/redirected), never a full free-space travel of the probe.
  const probes: { x: number; y: number; z: number }[] = [
    { x: 0.25, y: 0, z: 0 },
    { x: -0.25, y: 0, z: 0 },
    { x: 0, y: 0, z: 0.25 },
    { x: 0, y: 0, z: -0.25 },
    { x: 0, y: 0.2, z: 0 },
  ];
  let best = center;
  let bestScore = 0;
  for (const p of probes) {
    const res = stepKcc(parts, center, p);
    const mx = res.center.x - center.x;
    const my = res.center.y - center.y;
    const mz = res.center.z - center.z;
    const desiredLen = Math.hypot(p.x, p.y, p.z);
    const actualLen = Math.hypot(mx, my, mz);
    // Free air: actual ≈ desired along the probe → ignore.
    if (actualLen > desiredLen * 0.85 && actualLen < desiredLen * 1.15) continue;
    // Correction: got sideways motion while probing up, or partial travel, etc.
    const sideways =
      Math.hypot(mx - p.x * (actualLen > 1e-6 ? 1 : 0), mz - p.z * (actualLen > 1e-6 ? 1 : 0));
    const score = sideways + (my > p.y + 0.02 ? my - p.y : 0);
    if (score > bestScore + 1e-4) {
      bestScore = score;
      best = res.center;
    }
  }
  parts.body.setTranslation(best, true);
  return best;
}

/**
 * Build a Controller {@link CollisionProvider} that:
 *  1. Sub-steps large translations (anti-tunnel through thin walls / platforms)
 *  2. Depenetrates when the capsule starts meshed inside solid colliders
 *  3. Reports grounded from the Rapier KCC
 */
export function makeCapsuleCollisionProvider(parts: CapsuleKccParts): CollisionProvider {
  const centerOff = parts.centerOff ?? CAP_CENTER_OFF;
  return {
    move(from, delta) {
      const { body, controller, world } = parts;
      if (!body || !controller || !world) {
        return { pos: from.clone().add(delta), grounded: delta.y <= 0 };
      }

      let center = {
        x: from.x,
        y: from.y + centerOff,
        z: from.z,
      };

      // Free the capsule if it was left overlapping (teleport, spawn, mesh load).
      for (let i = 0; i < DEEP_RESOLVE_ITERS; i++) {
        const before = center;
        center = depenetrate(parts, center);
        const moved =
          Math.abs(center.x - before.x) +
          Math.abs(center.y - before.y) +
          Math.abs(center.z - before.z);
        if (moved < 1e-4) break;
      }

      const len = Math.hypot(delta.x, delta.y, delta.z);
      const steps = Math.max(1, Math.min(12, Math.ceil(len / MAX_SUBSTEP) || 1));
      const sx = delta.x / steps;
      const sy = delta.y / steps;
      const sz = delta.z / steps;

      let grounded = false;
      for (let i = 0; i < steps; i++) {
        const res = stepKcc(parts, center, { x: sx, y: sy, z: sz });
        center = res.center;
        grounded = res.grounded;
      }

      // Light post-move settle only (no free-space probes) — clears residual sink.
      center = depenetrate(parts, center);
      body.setTranslation(center, true);
      grounded = controller.computedGrounded() || grounded;

      // Refresh broadphase once per resolved move (static-only worlds are cheap).
      world.step();

      return {
        pos: new THREE.Vector3(center.x, center.y - centerOff, center.z),
        grounded,
      };
    },
  };
}

/**
 * Bake a THREE.Mesh's world-space triangles into Float32 vertices + Uint32 indices
 * suitable for Rapier trimesh colliders. Skips empty / non-position geometries.
 */
export function meshWorldTriangles(mesh: THREE.Mesh): {
  vertices: Float32Array;
  indices: Uint32Array;
} | null {
  mesh.updateMatrixWorld(true);
  const geo = mesh.geometry;
  const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!posAttr || posAttr.count < 3) return null;

  // Skip obviously non-solid helpers / collider wireframes.
  if (mesh.userData?.isColliderHelper || mesh.userData?.noCollision) return null;

  const tmp = new THREE.Vector3();
  const vertices = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    tmp.fromBufferAttribute(posAttr, i);
    mesh.localToWorld(tmp);
    vertices[i * 3] = tmp.x;
    vertices[i * 3 + 1] = tmp.y;
    vertices[i * 3 + 2] = tmp.z;
  }

  let indices: Uint32Array;
  if (geo.index) {
    indices = new Uint32Array(geo.index.array);
  } else {
    indices = new Uint32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) indices[i] = i;
  }
  if (indices.length < 3) return null;
  return { vertices, indices };
}
