import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  CAP_HALF,
  CAP_RADIUS,
  KCC_OFFSET,
  configureCharacterController,
  meshWorldTriangles,
} from "./physics/capsuleKcc";

/**
 * Renderer-agnostic Rapier physics core for play modes (Danger Room props,
 * dungeon/arena trimesh, editor play colliders).
 *
 * Rapier is pure simulation — no dependency on the render loop. Callers create
 * a `PhysicsSystem` synchronously and `await init()` before reading `world`.
 * The fixed-step accumulator keeps dynamics stable when dynamic bodies exist;
 * kinematic character motion is advanced by the KCC provider separately.
 */
export class PhysicsSystem {
  world: RAPIER.World | null = null;
  ready = false;

  private accum = 0;
  private readonly fixed = 1 / 60;

  /** Initialise the wasm runtime + world. Safe to call once per instance. */
  async init(gravityY = -12): Promise<void> {
    await ensureRapier();
    this.world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
    this.world.timestep = this.fixed;
    this.ready = true;
  }

  /** Advance the simulation by `dt` seconds in fixed sub-steps. */
  step(dt: number): void {
    const world = this.world;
    if (!world) return;
    this.accum += Math.min(dt, 0.1);
    let steps = 0;
    while (this.accum >= this.fixed && steps < 5) {
      world.step();
      this.accum -= this.fixed;
      steps++;
    }
  }

  /**
   * Add a static triangle-mesh collider from raw world-space geometry.
   * Used for dungeon walls/stairs/floors and solid editor meshes so the player
   * capsule collides with real platform geometry (not just XZ circles).
   */
  addStaticTrimesh(
    vertices: Float32Array,
    indices: Uint32Array,
    opts: { friction?: number } = {},
  ): RAPIER.Collider | null {
    const world = this.world;
    if (!world || vertices.length < 9 || indices.length < 3) return null;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // Prefer FIX_INTERNAL_EDGES when available (reduces ghost collisions on edges).
    const flags = (RAPIER as unknown as { TriMeshFlags?: { FIX_INTERNAL_EDGES?: number } })
      .TriMeshFlags;
    let desc: RAPIER.ColliderDesc;
    try {
      if (flags?.FIX_INTERNAL_EDGES !== undefined) {
        desc = RAPIER.ColliderDesc.trimesh(vertices, indices, flags.FIX_INTERNAL_EDGES);
      } else {
        desc = RAPIER.ColliderDesc.trimesh(vertices, indices);
      }
    } catch {
      desc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    }
    desc.setFriction(opts.friction ?? 0.85);
    desc.setRestitution(0);
    return world.createCollider(desc, body);
  }

  /** Bake a THREE.Mesh into a static trimesh collider (world-space triangles). */
  addStaticMesh(mesh: THREE.Mesh, opts: { friction?: number } = {}): RAPIER.Collider | null {
    const tri = meshWorldTriangles(mesh);
    if (!tri) return null;
    return this.addStaticTrimesh(tri.vertices, tri.indices, opts);
  }

  /**
   * Static cuboid at world centre with half-extents (Rapier convention).
   * Preferred for editor box colliders and simple platforms.
   */
  addStaticCuboid(
    center: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number; w: number },
    opts: { friction?: number } = {},
  ): RAPIER.Collider | null {
    const world = this.world;
    if (!world) return null;
    let bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
    if (rotation) bodyDesc = bodyDesc.setRotation(rotation);
    const body = world.createRigidBody(bodyDesc);
    const desc = RAPIER.ColliderDesc.cuboid(
      Math.max(0.01, halfExtents.x),
      Math.max(0.01, halfExtents.y),
      Math.max(0.01, halfExtents.z),
    )
      .setFriction(opts.friction ?? 0.9)
      .setRestitution(0);
    return world.createCollider(desc, body);
  }

  /** Static ball collider. */
  addStaticBall(
    center: { x: number; y: number; z: number },
    radius: number,
    opts: { friction?: number } = {},
  ): RAPIER.Collider | null {
    const world = this.world;
    if (!world) return null;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z),
    );
    const desc = RAPIER.ColliderDesc.ball(Math.max(0.01, radius))
      .setFriction(opts.friction ?? 0.85)
      .setRestitution(0);
    return world.createCollider(desc, body);
  }

  /** Static capsule (Y-aligned) collider. */
  addStaticCapsule(
    center: { x: number; y: number; z: number },
    halfHeight: number,
    radius: number,
    opts: { friction?: number } = {},
  ): RAPIER.Collider | null {
    const world = this.world;
    if (!world) return null;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z),
    );
    const desc = RAPIER.ColliderDesc.capsule(Math.max(0.01, halfHeight), Math.max(0.01, radius))
      .setFriction(opts.friction ?? 0.85)
      .setRestitution(0);
    return world.createCollider(desc, body);
  }

  /**
   * Large flat static ground whose TOP face sits at `y`.
   * Cuboid half-extents so capsules rest on solid ground.
   */
  addGroundPlane(y = 0, half = 60, thickness = 0.5): RAPIER.Collider | null {
    const world = this.world;
    if (!world) return null;
    return this.addStaticCuboid(
      { x: 0, y: y - thickness, z: 0 },
      { x: half, y: thickness, z: half },
      undefined,
      { friction: 0.95 },
    );
  }

  /**
   * Kinematic capsule body for the player at `center` (capsule centre, not feet).
   */
  makeCapsuleBody(
    center: { x: number; y: number; z: number },
    radius: number = CAP_RADIUS,
    halfHeight: number = CAP_HALF,
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } | null {
    const world = this.world;
    if (!world) return null;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setFriction(0.6)
        .setRestitution(0)
        .setDensity(0),
      body,
    );
    return { body, collider };
  }

  /** Create + configure a kinematic character controller (autostep + ground snap + slide). */
  makeCharacterController(offset = KCC_OFFSET): RAPIER.KinematicCharacterController | null {
    const world = this.world;
    if (!world) return null;
    const c = world.createCharacterController(offset);
    configureCharacterController(c, { offset });
    return c;
  }

  dispose(): void {
    this.world?.free();
    this.world = null;
    this.ready = false;
  }
}

let initPromise: Promise<void> | null = null;

/** Initialise the Rapier wasm runtime exactly once across all instances. */
function ensureRapier(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export { RAPIER };
