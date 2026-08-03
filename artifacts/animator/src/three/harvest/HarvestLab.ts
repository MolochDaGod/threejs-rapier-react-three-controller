import * as THREE from "three";
import { HealthBar } from "../HealthBar";
import type { ObstacleCircle } from "../types";
import { harvestMatchMul } from "../../game/inventory/harvestTools";

/**
 * Danger Room harvest lab — Conan Phase C slice.
 *
 * Staged resource props (tree / rock). Melee strikes near a node advance stages;
 * on break, emit drops + respawn. Soft-lock can aim at live nodes when no foe
 * is preferred. Pure Three visuals — no second physics engine, no Open harvest
 * monorepo fork. Bag flush is optional via {@link onDrop}.
 */

export type HarvestKind = "wood" | "stone";

export interface LabHarvestDrop {
  resourceId: string;
  amount: number;
}

export interface HarvestHitResult {
  hit: boolean;
  kind: HarvestKind | null;
  stage: number;
  maxStages: number;
  finished: boolean;
  drops: LabHarvestDrop[];
  matched: boolean;
  wrongTool: boolean;
}

interface Node {
  kind: HarvestKind;
  root: THREE.Group;
  visual: THREE.Group;
  bar: HealthBar;
  /** Collision / soft-lock radius (m). */
  radius: number;
  stage: number;
  maxStages: number;
  /** HP remaining in current stage (each stage needs this much damage). */
  stageHp: number;
  stageMaxHp: number;
  respawnT: number;
  dead: boolean;
  baseScale: number;
  mats: THREE.MeshStandardMaterial[];
}

const TREE_LAYOUT: ReadonlyArray<readonly [number, number]> = [
  [-7.5, -2.5],
  [7.2, -3.0],
];
const ROCK_LAYOUT: ReadonlyArray<readonly [number, number]> = [
  [-6.0, 3.5],
  [6.5, 2.8],
];

const STAGE_HP = 28;
const TREE_STAGES = 4;
const ROCK_STAGES = 3;
const RESPAWN_S = 9;

export class HarvestLab {
  readonly group = new THREE.Group();
  private nodes: Node[] = [];
  private disposed = false;
  /** Optional bag / HUD sink for finished gathers. */
  onDrop: ((drops: LabHarvestDrop[], at: THREE.Vector3) => void) | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = "HarvestLab";
    scene.add(this.group);
    this.spawnDefault();
  }

  private spawnDefault() {
    for (const [x, z] of TREE_LAYOUT) this.addNode("wood", x, z);
    for (const [x, z] of ROCK_LAYOUT) this.addNode("stone", x, z);
  }

  private addNode(kind: HarvestKind, x: number, z: number) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    const visual = new THREE.Group();
    root.add(visual);
    const mats: THREE.MeshStandardMaterial[] = [];

    if (kind === "wood") {
      const trunkMat = new THREE.MeshStandardMaterial({
        color: 0x6b4423,
        roughness: 0.92,
        metalness: 0.02,
      });
      const leafMat = new THREE.MeshStandardMaterial({
        color: 0x3d8b4a,
        roughness: 0.85,
        metalness: 0,
      });
      mats.push(trunkMat, leafMat);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.6, 8), trunkMat);
      trunk.position.y = 0.8;
      trunk.castShadow = true;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 8), leafMat);
      crown.position.y = 2.15;
      crown.castShadow = true;
      visual.add(trunk, crown);
    } else {
      const rockMat = new THREE.MeshStandardMaterial({
        color: 0x7a7e86,
        roughness: 0.95,
        metalness: 0.08,
      });
      mats.push(rockMat);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), rockMat);
      rock.position.y = 0.55;
      rock.rotation.set(0.3, 0.5, 0.1);
      rock.castShadow = true;
      visual.add(rock);
    }

    const bar = new HealthBar(0.9, 0.1);
    bar.group.position.y = kind === "wood" ? 2.9 : 1.35;
    root.add(bar.group);

    const maxStages = kind === "wood" ? TREE_STAGES : ROCK_STAGES;
    const node: Node = {
      kind,
      root,
      visual,
      bar,
      radius: kind === "wood" ? 0.55 : 0.7,
      stage: 0,
      maxStages,
      stageHp: STAGE_HP,
      stageMaxHp: STAGE_HP,
      respawnT: 0,
      dead: false,
      baseScale: 1,
      mats,
    };
    this.applyStageVisual(node);
    this.group.add(root);
    this.nodes.push(node);
  }

  private applyStageVisual(n: Node) {
    const remain = 1 - n.stage / n.maxStages;
    const s = 0.55 + 0.45 * Math.max(0.15, remain);
    n.visual.scale.setScalar(s);
    // Absolute darken from stage (not cumulative) so re-apply is stable.
    const base = n.kind === "wood" ? [0x6b4423, 0x3d8b4a] : [0x7a7e86];
    n.mats.forEach((m, i) => {
      const hex = base[Math.min(i, base.length - 1)];
      m.color.setHex(hex);
      m.color.offsetHSL(0, 0, -0.06 * n.stage);
    });
    n.bar.setRatio(Math.max(0, n.stageHp / n.stageMaxHp));
    n.bar.group.visible = !n.dead;
    n.visual.visible = !n.dead;
  }

  /**
   * Soft-lock aim point for a living node in the camera-forward cone, or null.
   * Same scoring spirit as combat soft lock (distance + facing).
   */
  acquireSoft(
    from: THREE.Vector3,
    forward: THREE.Vector3,
    maxDist = 12,
  ): THREE.Vector3 | null {
    const maxD2 = maxDist * maxDist;
    const fwd = forward.clone().setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    else fwd.normalize();
    let best: Node | null = null;
    let bestScore = Infinity;
    for (const n of this.nodes) {
      if (n.dead) continue;
      const to = n.root.position.clone().sub(from);
      to.y = 0;
      const d2 = to.lengthSq();
      if (d2 > maxD2 || d2 < 1e-6) continue;
      const dist = Math.sqrt(d2);
      const cos = to.multiplyScalar(1 / dist).dot(fwd);
      if (cos < 0.2) continue;
      const score = dist * (1.4 - cos);
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (!best) return null;
    // Aim at chest-ish height of the prop
    return new THREE.Vector3(
      best.root.position.x,
      best.kind === "wood" ? 1.2 : 0.6,
      best.root.position.z,
    );
  }

  /**
   * Apply a strike sphere to any living node. Returns first finished break or
   * a hit summary for HUD.
   * @param activityTool Open-style tool id (`axe` / `pick` / …) for match mul.
   */
  hitNear(
    center: THREE.Vector3,
    radius: number,
    damage: number,
    activityTool = "axe",
  ): HarvestHitResult {
    const empty: HarvestHitResult = {
      hit: false,
      kind: null,
      stage: 0,
      maxStages: 0,
      finished: false,
      drops: [],
      matched: false,
      wrongTool: false,
    };
    if (damage <= 0 || radius <= 0) return empty;
    let result = empty;
    for (const n of this.nodes) {
      if (n.dead) continue;
      const dx = n.root.position.x - center.x;
      const dz = n.root.position.z - center.z;
      const reach = n.radius + radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      // Prefer slightly elevated strike center for trees
      const dy = (n.kind === "wood" ? 1.0 : 0.5) - center.y;
      if (Math.abs(dy) > 2.2) continue;

      const match = harvestMatchMul(activityTool, n.kind);
      const applied = Math.max(1, Math.round(damage * Math.max(0.05, match.mul)));
      n.stageHp -= applied;
      let finished = false;
      const drops: LabHarvestDrop[] = [];
      while (n.stageHp <= 0 && !n.dead) {
        n.stage += 1;
        if (n.stage >= n.maxStages) {
          n.dead = true;
          n.respawnT = RESPAWN_S;
          n.visual.visible = false;
          n.bar.group.visible = false;
          finished = true;
          drops.push(...this.rollDrops(n.kind));
          break;
        }
        n.stageHp += n.stageMaxHp;
        this.applyStageVisual(n);
      }
      if (!n.dead) this.applyStageVisual(n);
      result = {
        hit: true,
        kind: n.kind,
        stage: n.stage,
        maxStages: n.maxStages,
        finished,
        drops,
        matched: match.matched,
        wrongTool: match.wrongTool,
      };
      if (finished && drops.length) {
        this.onDrop?.(drops, n.root.position.clone());
      }
      // One node per strike (closest first would need sort; first in list is OK for lab)
      break;
    }
    return result;
  }

  private rollDrops(kind: HarvestKind): LabHarvestDrop[] {
    if (kind === "wood") {
      return [
        { resourceId: "wood", amount: 2 + Math.floor(Math.random() * 3) },
        { resourceId: "fiber", amount: Math.random() > 0.5 ? 1 : 0 },
      ].filter((d) => d.amount > 0);
    }
    return [
      { resourceId: "stone", amount: 2 + Math.floor(Math.random() * 2) },
      { resourceId: "ore", amount: Math.random() > 0.65 ? 1 : 0 },
    ].filter((d) => d.amount > 0);
  }

  /** Footprint circles for Controller obstacle push-out. */
  obstacleCircles(): ObstacleCircle[] {
    const out: ObstacleCircle[] = [];
    for (const n of this.nodes) {
      if (n.dead) continue;
      out.push({
        x: n.root.position.x,
        z: n.root.position.z,
        r: n.radius,
      });
    }
    return out;
  }

  update(dt: number, camera: THREE.Camera) {
    for (const n of this.nodes) {
      if (n.dead) {
        n.respawnT -= dt;
        if (n.respawnT <= 0) this.respawn(n);
        continue;
      }
      n.bar.group.quaternion.copy(camera.quaternion);
    }
  }

  private respawn(n: Node) {
    n.dead = false;
    n.stage = 0;
    n.stageHp = n.stageMaxHp;
    n.respawnT = 0;
    // Reset materials toward authored colors
    if (n.kind === "wood") {
      n.mats[0]?.color.setHex(0x6b4423);
      n.mats[1]?.color.setHex(0x3d8b4a);
    } else {
      n.mats[0]?.color.setHex(0x7a7e86);
    }
    n.visual.visible = true;
    n.bar.group.visible = true;
    this.applyStageVisual(n);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      }
    });
    this.nodes = [];
  }
}
