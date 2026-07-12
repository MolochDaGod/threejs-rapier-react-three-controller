import * as THREE from "three";
import { PhysicsSystem } from "../PhysicsSystem";
import { HealthBar } from "../HealthBar";
import type { CollisionProvider } from "../Controller";
import type { WeaponId } from "../types";
import {
  DIFFICULTY_DAMAGE,
  DIFFICULTY_HEALTH,
  DIFFICULTY_SCALE,
  PROPS,
  type BlockData,
  type DeployableData,
  type Difficulty,
  type PieceShape,
  type PropId,
  type VoxelMap,
} from "./types";
import { loadPropTemplate } from "./props";

/** Half-extent of the editor grid (must match VoxelEditor's GRID). */
const GRID = 24;

/** Player capsule dimensions (mirrors the Dungeon KCC). */
const CAP_RADIUS = 0.35;
const CAP_HALF = 0.55;
const CAP_CENTER_OFF = CAP_RADIUS + CAP_HALF; // feet → capsule centre

/** Physics-bag sway tuning (a damped spring tilting it back upright on its post). */
const BAG_STIFFNESS = 26;
const BAG_DAMP = 3.2;
const BAG_TILT = 0.55;
const BAG_MAX_TILT = 0.7;

/** Post-mounted bag dimensions (metres) — a freestanding bag on a metal stand. */
const BAG_HALF = 0.7;
const BAG_RADIUS = 0.4;
/** Pivot height = arm tip the bag hangs from (top of the post). */
const BAG_PIVOT_Y = 2.0;
/** Hit points per bag before it "dies" (then respawns), matching the dummies. */
const BAG_MAX_HEALTH = 120;
/** Seconds a depleted bag stays down before respawning. */
const BAG_RESPAWN = 3.2;

/** One authored NPC ready to be spawned into the live combat population. */
export interface ArenaNpc {
  pos: THREE.Vector3;
  weapon: WeaponId;
  scale: number;
  maxHealth: number;
  damageMul: number;
}

interface PhysBag {
  /** The bag visual, pivoted at the top of the post; tilts (never translates). */
  group: THREE.Group;
  /** World pivot (post top) — the bar floats above here; the post is static. */
  pivot: THREE.Vector3;
  /** Horizontal sway of the bag bottom from rest + its velocity (damped spring). */
  sway: THREE.Vector3;
  vel: THREE.Vector3;
  bar: HealthBar;
  health: number;
  dead: boolean;
  respawnT: number;
}

/**
 * A playable instance of an authored {@link VoxelMap}. Mirrors the Dungeon: it
 * rebuilds the saved blocks as real meshes, bakes them (plus a ground plane and
 * any heavy bags) into a gravity-free Rapier world so the player KCC can walk
 * the map, exposes a {@link CollisionProvider} for the Controller, lists the
 * authored NPCs for the caller to spawn as combatants, and drives physics-bag
 * knockback. Fully disposable. No `@workspace/*` imports.
 */
export class VoxelArena {
  group = new THREE.Group();
  spawn = new THREE.Vector3(0, 0, 0);
  /** Wider than the Danger Room so spawned NPCs can roam the authored grid. */
  bounds = GRID;
  /** Meshes the camera pulls in front of (blocks/heavy bags). */
  occluders: THREE.Object3D[] = [];
  /** Authored combatants for the host to drop into the live population. */
  npcs: ArenaNpc[] = [];

  private scene: THREE.Scene;
  private physics = new PhysicsSystem();
  private ownGeos: THREE.BufferGeometry[] = [];
  private ownMats: THREE.Material[] = [];
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  private shapeCache = new Map<PieceShape, THREE.BufferGeometry>();
  private physBags: PhysBag[] = [];
  private charBody: import("@dimforge/rapier3d-compat").RigidBody | null = null;
  private charCollider: import("@dimforge/rapier3d-compat").Collider | null = null;
  private controller: import("@dimforge/rapier3d-compat").KinematicCharacterController | null = null;
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Build the map meshes + colliders + the player KCC from a serialized map. */
  async load(map: VoxelMap): Promise<void> {
    await this.physics.init(0); // gravity 0 — the Controller drives vertical motion
    if (this.disposed || !this.physics.world) return;

    this.buildBlocks(map.blocks ?? []);
    this.buildFloorCollider();
    const propLoads = this.buildDeployables(map.deployables ?? [], !!map.dungeon);
    this.scene.add(this.group);
    this.buildCharacter();
    await Promise.all(propLoads);
  }

  // ── Geometry / material caches ──────────────────────────────────────────────

  private material(color: number, doubleSide = false): THREE.MeshStandardMaterial {
    const k = `${color}:${doubleSide ? "d" : "s"}`;
    let m = this.matCache.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.2,
        side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      });
      this.matCache.set(k, m);
      this.ownMats.push(m);
    }
    return m;
  }

  private shapeGeo(shape: PieceShape): THREE.BufferGeometry {
    let g = this.shapeCache.get(shape);
    if (g) return g;
    switch (shape) {
      case "block":
        g = new THREE.BoxGeometry(1, 1, 1);
        break;
      case "slab":
        g = new THREE.BoxGeometry(1, 0.5, 1).translate(0, -0.25, 0);
        break;
      case "wall":
        g = new THREE.BoxGeometry(1, 1, 0.22).translate(0, 0, -0.39);
        break;
      case "pillar":
        g = new THREE.CylinderGeometry(0.34, 0.34, 1, 16);
        break;
      case "ramp":
        g = this.rampGeo();
        break;
    }
    this.shapeCache.set(shape, g);
    this.ownGeos.push(g);
    return g;
  }

  /** A triangular-prism ramp filling the cell, sloping up toward +Z. */
  private rampGeo(): THREE.BufferGeometry {
    const v = new Float32Array([
      -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
      0.5,
    ]);
    const idx = [0, 2, 1, 0, 3, 2, 3, 4, 5, 3, 5, 2, 0, 1, 5, 0, 5, 4, 0, 4, 3, 1, 2, 5];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(v, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  // ── Block / floor colliders ─────────────────────────────────────────────────

  private buildBlocks(blocks: BlockData[]): void {
    for (const b of blocks) {
      const mesh = new THREE.Mesh(this.shapeGeo(b.shape), this.material(b.color, b.shape === "ramp"));
      mesh.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      mesh.rotation.y = (b.rotation * Math.PI) / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.occluders.push(mesh);
      this.bakeCollider(mesh);
    }
  }

  /** Bake one mesh's world-space triangles into a static Rapier trimesh. */
  private bakeCollider(mesh: THREE.Mesh): void {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return;
    const tmp = new THREE.Vector3();
    const verts = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      tmp.fromBufferAttribute(posAttr, i);
      mesh.localToWorld(tmp);
      verts[i * 3] = tmp.x;
      verts[i * 3 + 1] = tmp.y;
      verts[i * 3 + 2] = tmp.z;
    }
    let indices: Uint32Array;
    if (geo.index) {
      indices = new Uint32Array(geo.index.array);
    } else {
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) indices[i] = i;
    }
    this.physics.addStaticTrimesh(verts, indices);
  }

  /** A flat ground plane collider at y=0 spanning the whole grid. */
  private buildFloorCollider(): void {
    const g = GRID;
    const verts = new Float32Array([-g, 0, -g, g, 0, -g, g, 0, g, -g, 0, g]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    this.physics.addStaticTrimesh(verts, indices);
  }

  // ── Deployables ──────────────────────────────────────────────────────────────

  private buildDeployables(deployables: DeployableData[], dungeon: boolean): Promise<void>[] {
    const propLoads: Promise<void>[] = [];
    for (const d of deployables) {
      // Honor continuous Select-tool overrides (free move/rotate/scale); when
      // absent, fall back to the grid cell + quarter-turn rotation.
      const x = d.px !== undefined ? d.px : d.x + 0.5;
      const y = d.py !== undefined ? d.py : Math.max(0, d.y);
      const z = d.pz !== undefined ? d.pz : d.z + 0.5;
      const yaw = d.yaw !== undefined ? d.yaw : (d.rotation * Math.PI) / 2;
      const sc = d.scale ?? 1;
      switch (d.kind) {
        case "start":
          this.spawn.set(x, y, z);
          break;
        case "npc": {
          const tier: Difficulty = dungeon ? d.difficulty ?? "normal" : "normal";
          this.npcs.push({
            pos: new THREE.Vector3(x, y, z),
            weapon: this.npcWeapon(d.weapon),
            scale: DIFFICULTY_SCALE[tier] * sc,
            maxHealth: DIFFICULTY_HEALTH[tier],
            damageMul: DIFFICULTY_DAMAGE[tier],
          });
          break;
        }
        case "heavyBag":
        case "physicsBag":
          this.buildPostBag(x, y, z, yaw, sc);
          break;
        case "prop":
          if (d.prop) propLoads.push(this.buildProp(d.prop, x, y, z, yaw, sc));
          break;
      }
    }
    return propLoads;
  }

  /** Clone the shared (cached) prop template, place it, and bake a static collider. */
  private async buildProp(
    id: PropId,
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale: number,
  ): Promise<void> {
    const tpl = await loadPropTemplate(id);
    if (this.disposed || !tpl) return;
    const model = tpl.clone(true);
    model.position.set(x, y, z);
    model.rotation.y = yaw;
    if (scale !== 1) model.scale.multiplyScalar(scale);
    this.group.add(model);
    this.occluders.push(model);
    if (PROPS[id].collide && this.physics.world) {
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) this.bakeCollider(mesh);
      });
    }
  }

  /** Map an authored weapon onto a melee-capable one (NPC AI is melee-only). */
  private npcWeapon(weapon: WeaponId | undefined): WeaponId {
    if (!weapon || weapon === "none") return "sword";
    if (weapon === "bow" || weapon === "pistol" || weapon === "rifle") return "sword";
    return weapon;
  }

  /**
   * Build a post-mounted, hittable bag: a fixed metal stand (base plate + pole +
   * arm) planted on the ground that NEVER moves, plus a bag hung from the arm tip
   * that wobbles on hit (a damped tilt spring pivoting at the post top) and tracks
   * health with a billboard bar — the same target treatment as the Danger Room.
   */
  private buildPostBag(x: number, y: number, z: number, yaw = 0, scale = 1): void {
    const baseY = y;
    // ── Static stand (planted on the ground; baked solid; never moves) ──
    const stand = new THREE.Group();
    const poleZ = -(BAG_RADIUS + 0.45); // pole sits behind the bag centre
    const plate = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.5, 0.58, 0.14, 18)), this.material(0x1a1e26));
    plate.position.set(0, 0.07, poleZ);
    plate.receiveShadow = true;
    const pole = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.07, 0.08, BAG_PIVOT_Y, 12)), this.material(0x2c333f));
    pole.position.set(0, BAG_PIVOT_Y / 2, poleZ);
    pole.castShadow = true;
    const armLen = -poleZ; // reach from pole forward to the bag centre
    const arm = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.055, 0.055, armLen + 0.16, 12)), this.material(0x2c333f));
    arm.position.set(0, BAG_PIVOT_Y, poleZ / 2);
    arm.rotation.x = Math.PI / 2;
    arm.castShadow = true;
    stand.add(plate, pole, arm);
    stand.position.set(x, baseY, z);
    stand.rotation.y = yaw;
    if (scale !== 1) stand.scale.setScalar(scale);
    this.group.add(stand);
    this.occluders.push(stand);
    // Bake the stand so the player bumps the post (it stays put regardless).
    // Baking reads the world matrix, so the yaw/scale above are captured.
    stand.updateMatrixWorld(true);
    this.bakeCollider(plate);
    this.bakeCollider(pole);

    // ── Swinging bag (pivoted at the post top, hangs below the arm) ──
    const bag = new THREE.Group();
    const body = new THREE.Mesh(
      this.geo(new THREE.CylinderGeometry(BAG_RADIUS, BAG_RADIUS, BAG_HALF * 2, 18)),
      this.material(0x0a0a0c),
    );
    body.position.y = -(0.2 + BAG_HALF); // hang below the pivot
    body.castShadow = true;
    const cap = new THREE.Mesh(
      this.geo(new THREE.SphereGeometry(BAG_RADIUS, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
      this.material(0x16161a),
    );
    cap.position.y = -0.2;
    bag.add(body, cap);
    const pivotY = baseY + BAG_PIVOT_Y * scale;
    bag.position.set(x, pivotY, z);
    if (scale !== 1) bag.scale.setScalar(scale);
    this.group.add(bag);
    this.occluders.push(bag);

    const bar = new HealthBar();
    this.group.add(bar.group);

    this.physBags.push({
      group: bag,
      pivot: new THREE.Vector3(x, pivotY, z),
      sway: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      bar,
      health: BAG_MAX_HEALTH,
      dead: false,
      respawnT: 0,
    });
  }

  private geo(g: THREE.BufferGeometry): THREE.BufferGeometry {
    this.ownGeos.push(g);
    return g;
  }

  // ── Player KCC ───────────────────────────────────────────────────────────────

  private buildCharacter(): void {
    const center = { x: this.spawn.x, y: this.spawn.y + CAP_CENTER_OFF, z: this.spawn.z };
    const cap = this.physics.makeCapsuleBody(center, CAP_RADIUS, CAP_HALF);
    if (!cap) return;
    this.charBody = cap.body;
    this.charCollider = cap.collider;
    this.controller = this.physics.makeCharacterController(0.08);
    this.physics.world?.step();
  }

  /** The Controller's pluggable collision backend (KCC capsule reconciliation). */
  get collision(): CollisionProvider {
    return {
      move: (from, delta) => {
        const body = this.charBody;
        const collider = this.charCollider;
        const controller = this.controller;
        const world = this.physics.world;
        if (!body || !collider || !controller || !world) {
          return { pos: from.clone().add(delta), grounded: delta.y <= 0 };
        }
        const center = { x: from.x, y: from.y + CAP_CENTER_OFF, z: from.z };
        body.setTranslation(center, true);
        controller.computeColliderMovement(collider, { x: delta.x, y: delta.y, z: delta.z });
        const mv = controller.computedMovement();
        const nc = { x: center.x + mv.x, y: center.y + mv.y, z: center.z + mv.z };
        body.setTranslation(nc, true);
        const grounded = controller.computedGrounded();
        world.step();
        return { pos: new THREE.Vector3(nc.x, nc.y - CAP_CENTER_OFF, nc.z), grounded };
      },
    };
  }

  // ── Physics-bag knockback ────────────────────────────────────────────────────

  /**
   * Set every live bag within `radius` of `center` swinging AND deal `damage`,
   * both scaled by distance falloff — a single hit wobbles the bag on its post
   * and drains its health bar (depleting it "kills" it until it respawns).
   */
  blastBags(center: THREE.Vector3, radius: number, force: number, damage = 0): void {
    const out = new THREE.Vector3();
    for (const b of this.physBags) {
      if (b.dead) continue;
      out.set(b.pivot.x - center.x, 0, b.pivot.z - center.z);
      const dist = out.length();
      if (dist > radius) continue;
      const falloff = 1 - dist / Math.max(0.001, radius);
      if (dist < 1e-3) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      out.normalize();
      b.vel.addScaledVector(out, force * 0.06 * (0.4 + 0.6 * falloff));
      if (damage > 0) {
        b.health -= damage * (0.5 + 0.5 * falloff);
        if (b.health <= 0) this.killBag(b);
      }
    }
  }

  private killBag(b: PhysBag): void {
    b.dead = true;
    b.respawnT = BAG_RESPAWN;
    b.group.visible = false;
    b.bar.setVisible(false);
  }

  private respawnBag(b: PhysBag): void {
    b.health = BAG_MAX_HEALTH;
    b.dead = false;
    b.sway.set(0, 0, 0);
    b.vel.set(0, 0, 0);
    b.group.rotation.set(0, 0, 0);
    b.group.visible = true;
    b.bar.setVisible(true);
  }

  /**
   * Advance bag sway (a damped tilt spring pivoting at the post top) + respawn
   * timers, and billboard each health bar to `camera`.
   */
  update(dt: number, camera?: THREE.Camera): void {
    const damp = Math.exp(-BAG_DAMP * dt);
    const barPos = new THREE.Vector3();
    for (const b of this.physBags) {
      if (b.dead) {
        b.respawnT -= dt;
        if (b.respawnT <= 0) this.respawnBag(b);
        continue;
      }
      // Spring the horizontal sway of the bag bottom back to rest.
      b.vel.x += -b.sway.x * BAG_STIFFNESS * dt;
      b.vel.z += -b.sway.z * BAG_STIFFNESS * dt;
      b.vel.multiplyScalar(damp);
      b.sway.x += b.vel.x * dt;
      b.sway.z += b.vel.z * dt;
      // Tilt the bag around its top pivot from the sway offset.
      b.group.rotation.z = THREE.MathUtils.clamp(-b.sway.x * BAG_TILT, -BAG_MAX_TILT, BAG_MAX_TILT);
      b.group.rotation.x = THREE.MathUtils.clamp(b.sway.z * BAG_TILT, -BAG_MAX_TILT, BAG_MAX_TILT);
      b.bar.setRatio(b.health / BAG_MAX_HEALTH);
      if (camera) {
        barPos.set(b.pivot.x, b.pivot.y + 0.4, b.pivot.z);
        b.bar.place(barPos, camera);
      }
    }
  }

  // ── Teardown ─────────────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    for (const b of this.physBags) b.bar.dispose();
    this.scene.remove(this.group);
    this.group.clear();
    for (const g of this.ownGeos) g.dispose();
    for (const m of this.ownMats) m.dispose();
    this.ownGeos.length = 0;
    this.ownMats.length = 0;
    this.matCache.clear();
    this.shapeCache.clear();
    this.occluders.length = 0;
    this.physBags.length = 0;
    this.npcs.length = 0;
    this.physics.dispose();
  }
}
