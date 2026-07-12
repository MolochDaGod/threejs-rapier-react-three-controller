import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { asset } from "../assets";
import { PhysicsSystem } from "../PhysicsSystem";
import type { CollisionProvider } from "../Controller";
import { makeGrid, nearestWalkable, worldToCell, type NavGrid } from "./navmesh";

/** Default dungeon level behind the Danger Room door. */
const DEFAULT_DUNGEON_FILE = "models/minecraft-kit.glb";

/**
 * Tiny diorama-style kits (a few units across) are scaled UP so the playable
 * footprint is large enough for combat (spawn min-distance is ~6m). Huge cm
 * models are still scaled DOWN. Forge-sized maps (already in this band) pass
 * through untouched.
 */
const TARGET_FOOTPRINT = 46;

/** Vertical level extension below the surface map (all in world units). */
const WATER_DEPTH = 30; // translucent water volume hanging under the map
const PIT_GAP = 20; // air gap between the water floor and the pit floor
const PIT_MARGIN = 8; // pit/water footprint extends this far beyond the map
const WALL_THICK = 1.5; // pit perimeter wall thickness
const NAV_INSET = 2; // keep the pit navmesh off the walls

/** Player capsule dimensions (total height = 2*radius + 2*halfHeight). */
const CAP_RADIUS = 0.35;
const CAP_HALF = 0.55;
const CAP_CENTER_OFF = CAP_RADIUS + CAP_HALF; // feet → capsule centre

/** Nav grid cell size (m) + how much headroom a cell needs to be walkable. */
const NAV_CELL = 0.6;
const MIN_HEADROOM = 1.8;
const MAX_GRID = 220; // cap per-axis cells so huge scenes don't explode the grid

/**
 * The dungeon level: loads the Synty forge-scene GLB, bakes trimesh colliders
 * into its own gravity-free Rapier world (the player KCC owns vertical motion),
 * samples a walkable grid navmesh by downward raycasts, and exposes a
 * `CollisionProvider` the Controller reconciles against. Fully disposable.
 */
export class Dungeon {
  group = new THREE.Group();
  nav!: NavGrid;
  spawn = new THREE.Vector3(0, 0, 0);
  /** Meshes the camera pulls in front of (walls/props). */
  occluders: THREE.Object3D[] = [];

  /** Flat navmesh for the sealed end-game pit far below the surface map. */
  pitNav!: NavGrid;
  /** Centre of the pit floor — the boss/brute spawn anchor. */
  pitSpawn = new THREE.Vector3(0, 0, 0);
  /** Water volume vertical band (world Y); the player sinks while inside it. */
  waterTop = 0;
  waterBottom = 0;
  /** Solid floor level of the pit. */
  pitFloorY = 0;

  private scene: THREE.Scene;
  private file: string;
  /** Per-map explicit scale multiplier applied on top of the auto-fit (1 = none). */
  private scaleMul: number;
  private physics = new PhysicsSystem();
  private meshes: THREE.Mesh[] = [];
  private charBody: import("@dimforge/rapier3d-compat").RigidBody | null = null;
  private charCollider: import("@dimforge/rapier3d-compat").Collider | null = null;
  private controller: import("@dimforge/rapier3d-compat").KinematicCharacterController | null = null;
  private gltfScene: THREE.Group | null = null;
  private extras: THREE.Mesh[] = []; // owned water/pit meshes (disposed on teardown)
  private disposed = false;

  constructor(scene: THREE.Scene, opts: { file?: string; scale?: number } = {}) {
    this.scene = scene;
    this.file = opts.file ?? DEFAULT_DUNGEON_FILE;
    this.scaleMul = opts.scale && opts.scale > 0 ? opts.scale : 1;
  }

  /** Load the GLB, build colliders + navmesh + the player KCC. */
  async load(): Promise<void> {
    const loader = new GLTFLoader();
    // Large voxel-world stages ship meshopt-compressed (EXT_meshopt_compression);
    // the decoder is a no-op for uncompressed kits, so it's safe to always set.
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(asset(this.file));
    if (this.disposed) return;
    const root = gltf.scene;

    // Auto-scale: huge cm models shrink; tiny diorama kits grow to a playable
    // footprint; forge-sized maps pass through.
    const rawBox = new THREE.Box3().setFromObject(root);
    const rawSize = rawBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(rawSize.x, rawSize.z);
    if (maxDim > 300) root.scale.setScalar(0.01);
    else if (maxDim > 0.01 && maxDim < TARGET_FOOTPRINT) {
      root.scale.setScalar(TARGET_FOOTPRINT / maxDim);
    }

    // Per-map explicit multiplier (e.g. a deliberately oversized test town),
    // applied on top of the auto-fit so it scales relative to the fitted size.
    if (this.scaleMul !== 1) root.scale.multiplyScalar(this.scaleMul);

    root.updateMatrixWorld(true);
    this.gltfScene = root;
    this.group.add(root);
    this.scene.add(this.group);

    await this.physics.init(0); // gravity 0 — the Controller drives vertical motion
    if (this.disposed || !this.physics.world) return;

    this.collectMeshesAndColliders(root);
    this.buildNavmesh();
    this.buildDepths();
    this.buildCharacter();
  }

  /** Bake every mesh into a static trimesh collider + collect render meshes. */
  private collectMeshesAndColliders(root: THREE.Object3D) {
    const tmp = new THREE.Vector3();
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      this.meshes.push(mesh);
      this.occluders.push(mesh);

      const geo = mesh.geometry;
      const posAttr = geo.getAttribute("position");
      if (!posAttr) return;
      const verts = new Float32Array(posAttr.count * 3);
      for (let i = 0; i < posAttr.count; i++) {
        tmp.fromBufferAttribute(posAttr as THREE.BufferAttribute, i);
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
    });
  }

  /**
   * Build a walkable grid by raycasting straight down onto the dungeon meshes
   * from above each cell; a cell is walkable when it has a near-flat floor hit
   * with enough headroom for the player capsule.
   */
  private buildNavmesh() {
    const box = new THREE.Box3().setFromObject(this.group);
    const min = box.min;
    const max = box.max;
    const cols = Math.min(MAX_GRID, Math.max(2, Math.ceil((max.x - min.x) / NAV_CELL)));
    const rows = Math.min(MAX_GRID, Math.max(2, Math.ceil((max.z - min.z) / NAV_CELL)));
    const originX = min.x + NAV_CELL / 2;
    const originZ = min.z + NAV_CELL / 2;
    const grid = makeGrid(cols, rows, NAV_CELL, originX, originZ);

    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const top = max.y + 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = originX + c * NAV_CELL;
        const z = originZ + r * NAV_CELL;
        ray.set(new THREE.Vector3(x, top, z), down);
        ray.far = top - min.y + 2;
        const hits = ray.intersectObjects(this.meshes, false);
        if (hits.length === 0) continue;
        // Hits are ordered top→bottom. We want a STANDABLE floor (an up-facing
        // surface) that has clearance above it for the capsule — never the roof
        // (down-facing, rejected by the normal test). The surface above a floor
        // is the previous hit (or open sky for hit 0). Keep the LOWEST valid
        // floor so we land on the true ground, not a balcony/ledge above it.
        let floorY: number | null = null;
        for (let h = 0; h < hits.length; h++) {
          const hit = hits[h];
          const n = hit.face?.normal;
          if (n) {
            const worldN = n.clone().transformDirection(hit.object.matrixWorld);
            if (worldN.dot(up) < 0.6) continue; // wall or ceiling — not standable
          }
          const y = hit.point.y;
          const ceilY = h > 0 ? hits[h - 1].point.y : top;
          if (ceilY - y < MIN_HEADROOM) continue; // not enough headroom
          floorY = y; // lower valid floors override (hits go top→bottom)
        }
        if (floorY === null) continue;
        const idx = r * cols + c;
        grid.walkable[idx] = 1;
        grid.height[idx] = floorY;
      }
    }

    this.nav = grid;
    this.pickSpawn();
  }

  /** Choose a spawn at the most central walkable cell. */
  private pickSpawn() {
    const g = this.nav;
    const cx = (g.originX + (g.cols - 1) * g.cell + g.originX) / 2;
    const cz = (g.originZ + (g.rows - 1) * g.cell + g.originZ) / 2;
    const { c, r } = worldToCell(g, cx, cz);
    const cell = nearestWalkable(g, c, r, Math.max(g.cols, g.rows)) ?? { c: 0, r: 0 };
    const x = g.originX + cell.c * g.cell;
    const z = g.originZ + cell.r * g.cell;
    const y = g.height[cell.r * g.cols + cell.c];
    this.spawn.set(x, y + 0.05, z);
  }

  /**
   * Extend the level downward: a translucent water volume hanging under the map,
   * an air gap, then a sealed pit (solid floor + perimeter walls) packed by the
   * enemy system. The player drops off the surface map's edge, sinks through the
   * water, and lands on the pit floor for the climax fight.
   */
  private buildDepths() {
    // Footprint of the surface map ONLY (extras are added below, after this read).
    const box = new THREE.Box3().setFromObject(this.group);
    const min = box.min;
    const max = box.max;
    const floorY = min.y;
    const x0 = min.x - PIT_MARGIN;
    const x1 = max.x + PIT_MARGIN;
    const z0 = min.z - PIT_MARGIN;
    const z1 = max.z + PIT_MARGIN;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = x1 - x0;
    const d = z1 - z0;

    this.waterTop = floorY;
    this.waterBottom = floorY - WATER_DEPTH;
    this.pitFloorY = this.waterBottom - PIT_GAP;
    this.pitSpawn.set(cx, this.pitFloorY, cz);

    // Water volume — translucent, non-solid (the player sinks straight through).
    const waterGeo = new THREE.BoxGeometry(w, WATER_DEPTH, d);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x2a6f97,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
      roughness: 0.15,
      metalness: 0.0,
      emissive: 0x0a2a3a,
      emissiveIntensity: 0.4,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(cx, (this.waterTop + this.waterBottom) / 2, cz);
    this.group.add(water);
    this.extras.push(water);

    // Pit shaft — solid floor + 4 perimeter walls rising to the surface, sealing
    // the drop. These collide but are NOT added to `this.meshes`, so the surface
    // navmesh never sees them (the pit gets its own flat grid below).
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x26262e,
      roughness: 0.95,
      metalness: 0.0,
    });
    this.addSolidBox(cx, this.pitFloorY - 0.5, cz, w, 1, d, stoneMat); // floor slab
    const wallH = this.waterTop - this.pitFloorY;
    const wallCY = (this.pitFloorY + this.waterTop) / 2;
    this.addSolidBox(x0 + WALL_THICK / 2, wallCY, cz, WALL_THICK, wallH, d, stoneMat, true);
    this.addSolidBox(x1 - WALL_THICK / 2, wallCY, cz, WALL_THICK, wallH, d, stoneMat, true);
    this.addSolidBox(cx, wallCY, z0 + WALL_THICK / 2, w, wallH, WALL_THICK, stoneMat, true);
    this.addSolidBox(cx, wallCY, z1 - WALL_THICK / 2, w, wallH, WALL_THICK, stoneMat, true);

    // Pit navmesh — a flat walkable grid across the interior floor.
    this.pitNav = this.buildFlatNav(
      x0 + NAV_INSET,
      x1 - NAV_INSET,
      z0 + NAV_INSET,
      z1 - NAV_INSET,
      this.pitFloorY,
    );
  }

  /** Build a render box, bake a static trimesh collider, and track it. */
  private addSolidBox(
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    occlude = false,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(cx, cy, cz);
    this.group.add(mesh);
    mesh.updateMatrixWorld(true);
    this.extras.push(mesh);
    if (occlude) this.occluders.push(mesh);
    this.bakeMeshCollider(mesh);
  }

  /** Bake a single mesh's geometry into a static world-space trimesh collider. */
  private bakeMeshCollider(mesh: THREE.Mesh) {
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute("position");
    if (!posAttr) return;
    const tmp = new THREE.Vector3();
    const verts = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      tmp.fromBufferAttribute(posAttr as THREE.BufferAttribute, i);
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

  /** A fully-walkable flat grid at a single height (used by the pit). */
  private buildFlatNav(x0: number, x1: number, z0: number, z1: number, y: number): NavGrid {
    const cols = Math.min(MAX_GRID, Math.max(2, Math.ceil((x1 - x0) / NAV_CELL)));
    const rows = Math.min(MAX_GRID, Math.max(2, Math.ceil((z1 - z0) / NAV_CELL)));
    const originX = x0 + NAV_CELL / 2;
    const originZ = z0 + NAV_CELL / 2;
    const grid = makeGrid(cols, rows, NAV_CELL, originX, originZ);
    for (let i = 0; i < cols * rows; i++) {
      grid.walkable[i] = 1;
      grid.height[i] = y;
    }
    return grid;
  }

  /** Create the kinematic capsule body + character controller for the player. */
  private buildCharacter() {
    const center = { x: this.spawn.x, y: this.spawn.y + CAP_CENTER_OFF, z: this.spawn.z };
    const cap = this.physics.makeCapsuleBody(center, CAP_RADIUS, CAP_HALF);
    if (!cap) return;
    this.charBody = cap.body;
    this.charCollider = cap.collider;
    this.controller = this.physics.makeCharacterController(0.08);
    // Build the broad phase once so the first KCC query sees the colliders.
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
        return {
          pos: new THREE.Vector3(nc.x, nc.y - CAP_CENTER_OFF, nc.z),
          grounded,
        };
      },
    };
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.group);
    if (this.gltfScene) {
      this.gltfScene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        }
      });
    }
    // Owned water/pit meshes use a small set of shared materials — dispose each
    // geometry, and each unique material once.
    const mats = new Set<THREE.Material>();
    for (const m of this.extras) {
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
      else if (mat) mats.add(mat);
    }
    mats.forEach((m) => m.dispose());
    this.extras.length = 0;
    this.group.clear();
    this.meshes.length = 0;
    this.occluders.length = 0;
    this.physics.dispose();
  }
}
