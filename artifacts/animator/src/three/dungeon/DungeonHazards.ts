/**
 * DungeonHazards — seed mobile-game obstacle traps into surface + pit nav grids.
 *
 * Loads multipack once, clones named nodes, bakes optional solid colliders via
 * Dungeon physics (caller can pass bakeMesh), animates spin/bob, and applies
 * proximity damage to the player each frame.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { asset } from "../assets";
import {
  cellCenter,
  heightAt,
  isWalkable,
  type NavGrid,
} from "./navmesh";
import {
  DUNGEON_TRAP_POOL,
  MOBILE_OBSTACLES_MODEL,
  OBSTACLE_PIECES,
  dungeonTrapCounts,
  mulberry32,
  pickWeighted,
  type ObstaclePieceDef,
} from "./obstacleCatalog";

export interface HazardInstance {
  id: number;
  def: ObstaclePieceDef;
  root: THREE.Object3D;
  pos: THREE.Vector3;
  baseY: number;
  phase: number;
  cooldown: number;
  /** Bomb consumed after fire */
  spent: boolean;
}

export class DungeonHazards {
  group = new THREE.Group();
  private scene: THREE.Scene;
  private hazards: HazardInstance[] = [];
  private pack: THREE.Object3D | null = null;
  private nextId = 1;
  private seed: number;
  private onDamage: ((amount: number, at: THREE.Vector3, label: string) => void) | null = null;
  private onBomb: ((at: THREE.Vector3) => void) | null = null;
  private bakeSolid: ((mesh: THREE.Mesh) => void) | null = null;

  constructor(scene: THREE.Scene, seed = 42) {
    this.scene = scene;
    this.seed = seed;
    this.group.name = "DungeonHazards";
    this.scene.add(this.group);
  }

  setDamageHandler(fn: (amount: number, at: THREE.Vector3, label: string) => void): void {
    this.onDamage = fn;
  }

  setBombHandler(fn: (at: THREE.Vector3) => void): void {
    this.onBomb = fn;
  }

  /** Optional: bake solid trap meshes into dungeon physics. */
  setSolidBaker(fn: (mesh: THREE.Mesh) => void): void {
    this.bakeSolid = fn;
  }

  async seed(surfaceNav: NavGrid, surfaceSpawn: THREE.Vector3, pitNav?: NavGrid, pitSpawn?: THREE.Vector3): Promise<void> {
    await this.ensurePack();
    if (!this.pack) return;
    const rand = mulberry32(this.seed);
    const counts = dungeonTrapCounts(this.seed);

    this.placeOnNav(surfaceNav, surfaceSpawn, counts.surface, 7, rand, 2.8);
    if (pitNav && pitSpawn) {
      this.placeOnNav(pitNav, pitSpawn, counts.pit, 4, rand, 3.2);
    }
    console.info(
      `[DungeonHazards] seeded ${this.hazards.length} traps (seed=${this.seed})`,
    );
  }

  private async ensurePack(): Promise<void> {
    if (this.pack) return;
    try {
      const gltf = await new GLTFLoader().loadAsync(asset(MOBILE_OBSTACLES_MODEL));
      this.pack = gltf.scene;
      // Materials already PBR-upgraded in GLB; enable shadows on template.
      this.pack.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
    } catch (err) {
      console.warn("[DungeonHazards] obstacle pack load failed", err);
      this.pack = null;
    }
  }

  private placeOnNav(
    nav: NavGrid,
    avoid: THREE.Vector3,
    count: number,
    minDist: number,
    rand: () => number,
    spacing: number,
  ): void {
    const placed: THREE.Vector3[] = [];
    let guard = 0;
    while (placed.length < count && guard < 5000) {
      guard++;
      const c = Math.floor(rand() * nav.cols);
      const r = Math.floor(rand() * nav.rows);
      if (!isWalkable(nav, c, r)) continue;
      const ctr = cellCenter(nav, c, r);
      const y = heightAt(nav, ctr.x, ctr.z, 0);
      const p = new THREE.Vector3(ctr.x, y, ctr.z);
      if (p.distanceTo(avoid) < minDist) continue;
      if (placed.some((q) => q.distanceTo(p) < spacing)) continue;

      const pieceId = pickWeighted(DUNGEON_TRAP_POOL, rand);
      const def = OBSTACLE_PIECES[pieceId];
      if (!def) continue;
      const inst = this.spawnAt(def, p, rand() * Math.PI * 2);
      if (inst) placed.push(p);
    }
  }

  private spawnAt(def: ObstaclePieceDef, pos: THREE.Vector3, yaw: number): HazardInstance | null {
    if (!this.pack) return null;
    const src = this.pack.getObjectByName(def.nodeName);
    if (!src) {
      console.warn(`[DungeonHazards] node missing: ${def.nodeName}`);
      return null;
    }
    const clone = src.clone(true);
    // Recenter for placement
    const box = new THREE.Box3().setFromObject(clone);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      clone.position.sub(center);
      const box2 = new THREE.Box3().setFromObject(clone);
      if (!box2.isEmpty()) clone.position.y -= box2.min.y;
    }
    clone.scale.setScalar(def.scale);
    clone.rotation.y = yaw;

    // Clone materials so emissive/bomb glow is independent
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (Array.isArray(m.material)) {
        m.material = m.material.map((x) => x.clone());
      } else if (m.material) {
        m.material = (m.material as THREE.Material).clone();
      }
      m.castShadow = true;
      m.receiveShadow = true;
      if (def.solid && this.bakeSolid) {
        m.updateMatrixWorld(true);
        this.bakeSolid(m);
      }
    });

    const root = new THREE.Group();
    root.name = `hazard_${def.id}_${this.nextId}`;
    root.position.copy(pos);
    root.add(clone);
    this.group.add(root);

    const inst: HazardInstance = {
      id: this.nextId++,
      def,
      root,
      pos: pos.clone(),
      baseY: pos.y,
      phase: Math.random() * Math.PI * 2,
      cooldown: 0.4 + Math.random() * 0.6,
      spent: false,
    };
    this.hazards.push(inst);
    return inst;
  }

  /**
   * Tick animations + damage. Returns total damage applied this frame (for HUD).
   */
  update(dt: number, playerPos: THREE.Vector3 | null): number {
    let totalDmg = 0;
    if (!playerPos) {
      // still animate
      for (const h of this.hazards) this.animate(h, dt);
      return 0;
    }

    for (const h of this.hazards) {
      if (h.spent) continue;
      this.animate(h, dt);
      h.cooldown = Math.max(0, h.cooldown - dt);

      const dx = playerPos.x - h.pos.x;
      const dz = playerPos.z - h.pos.z;
      const distSq = dx * dx + dz * dz;
      const r = h.def.hazardRadius;
      if (distSq > r * r) continue;
      // vertical proximity — ignore if player far above (flying / pit jump)
      if (Math.abs(playerPos.y - h.pos.y) > 3.5) continue;

      if (h.def.tickSec <= 0) {
        // one-shot bomb
        h.spent = true;
        h.root.visible = false;
        totalDmg += h.def.damage;
        this.onDamage?.(h.def.damage, h.pos, h.def.label);
        this.onBomb?.(h.pos);
        continue;
      }

      if (h.cooldown > 0) continue;
      h.cooldown = h.def.tickSec;
      totalDmg += h.def.damage;
      this.onDamage?.(h.def.damage, h.pos, h.def.label);
    }
    return totalDmg;
  }

  private animate(h: HazardInstance, dt: number): void {
    h.phase += dt;
    const mode = h.def.animate;
    if (mode === "spin_y") {
      h.root.rotation.y += dt * (h.def.id.includes("gear") ? 1.8 : 2.4);
    } else if (mode === "bob_y") {
      h.root.position.y = h.baseY + Math.sin(h.phase * 3.2) * 0.35;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.group.clear();
    this.hazards.length = 0;
    this.pack = null;
  }
}
