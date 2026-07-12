import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Renderer-agnostic Rapier physics core for the Danger Room.
 *
 * Rapier is pure simulation — it has no dependency on three.js or the render
 * loop — so this layer is the foundation that survives intact into the planned
 * r3f rewrite. Today it owns one shared `World` that the punching bags (and,
 * later, the player character controller + dynamic props) live in.
 *
 * Rapier's wasm must be initialised once before any world is created; `init()`
 * awaits that, so callers create a `PhysicsSystem` synchronously and `await`
 * its `init()` before reading `world`. The fixed-step accumulator decouples the
 * simulation from the variable render dt for stable, deterministic stepping.
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
   * Add a static (fixed) triangle-mesh collider from raw geometry. Used for the
   * dungeon's walls/stairs/floors so the player capsule collides with the actual
   * Synty mesh. Returns the created collider.
   */
  addStaticTrimesh(vertices: Float32Array, indices: Uint32Array): RAPIER.Collider | null {
    const world = this.world;
    if (!world) return null;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    return world.createCollider(desc, body);
  }

  /**
   * Add a large flat static ground collider whose TOP face sits at `y`. Modelled
   * as a thin cuboid (half-extents `half` × `thickness` × `half`) so the player
   * capsule and any dynamic props rest on solid ground instead of hovering over
   * the Danger Room's purely-visual floor plane. Returns the created collider.
   */
  addGroundPlane(y = 0, half = 60, thickness = 0.5): RAPIER.Collider | null {
    const world = this.world;
    if (!world) return null;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, y - thickness, 0),
    );
    const desc = RAPIER.ColliderDesc.cuboid(half, thickness, half).setFriction(0.9);
    return world.createCollider(desc, body);
  }

  /**
   * Create a kinematic capsule rigid body + collider for the player character at
   * `center` (capsule centre, not feet). `radius` + `halfHeight` describe the
   * capsule (total height = 2*radius + 2*halfHeight).
   */
  makeCapsuleBody(
    center: { x: number; y: number; z: number },
    radius: number,
    halfHeight: number,
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } | null {
    const world = this.world;
    if (!world) return null;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z),
    );
    const collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), body);
    return { body, collider };
  }

  /** Create + configure a kinematic-character controller (autostep + ground snap). */
  makeCharacterController(offset = 0.08): RAPIER.KinematicCharacterController | null {
    const world = this.world;
    if (!world) return null;
    const c = world.createCharacterController(offset);
    c.enableAutostep(0.5, 0.2, true);
    c.enableSnapToGround(0.5);
    c.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    c.setApplyImpulsesToDynamicBodies(false);
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
