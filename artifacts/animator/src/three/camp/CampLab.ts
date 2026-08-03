import * as THREE from "three";
import type { ObstacleCircle } from "../types";
import type { LabHarvestDrop } from "../harvest/HarvestLab";
import { sharedGltfLoader } from "../loaders/gltf";
import {
  KENNEY_CATALOG,
  kenneyBrowserRows,
  kenneyById,
  type KenneyPieceDef,
} from "./kenneyCatalog";
import type { PhysicsSystem } from "../PhysicsSystem";

/**
 * Danger Room camp lab — Conan Phase D + kenney GLB pack.
 *
 * 1 m snap grid · kenney-build control map (B / LMB / RMB / R / Y).
 * Blueprint browser data for HUD. Optional Rapier static cuboids (Phase B).
 */

export interface CampWallet {
  wood: number;
  stone: number;
  fiber: number;
  ore: number;
}

export interface CampPlaceResult {
  ok: boolean;
  reason?: string;
  piece?: string;
  cost?: { wood: number; stone: number };
}

export interface CampRemoveResult {
  ok: boolean;
  refund?: { wood: number; stone: number };
}

const GRID = 1;
const PLACE_REACH = 3.2;
const SEED_WALLET: CampWallet = { wood: 14, stone: 10, fiber: 2, ore: 1 };

interface Placed {
  id: string;
  pieceId: string;
  gx: number;
  gz: number;
  yaw: number;
  root: THREE.Group;
  cost: { wood: number; stone: number };
  radius: number;
  half: { x: number; y: number; z: number };
  collider: import("@dimforge/rapier3d-compat").Collider | null;
}

let placeSeq = 0;

export class CampLab {
  readonly group = new THREE.Group();
  private disposed = false;
  private placed: Placed[] = [];
  private wallet: CampWallet = { ...SEED_WALLET };
  private mode = false;
  private browserOpen = true;
  private pieceIndex = 0;
  private yaw = 0;
  private ghost: THREE.Group | null = null;
  private ghostMat: THREE.MeshStandardMaterial | null = null;
  private gridHelper: THREE.GridHelper | null = null;
  private padX = 0;
  private padZ = -9;
  private glbCache = new Map<string, THREE.Object3D>();
  private glbLoading = new Set<string>();
  private physics: PhysicsSystem | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = "CampLab";
    scene.add(this.group);
    this.buildPadMarker();
    // Warm first few GLBs in background
    for (const p of KENNEY_CATALOG.slice(0, 6)) void this.preloadGlb(p);
  }

  /** Wire Rapier for Phase B static colliders on place/remove. */
  setPhysics(physics: PhysicsSystem | null) {
    this.physics = physics;
  }

  get active(): boolean {
    return this.mode;
  }

  get blueprintOpen(): boolean {
    return this.mode && this.browserOpen;
  }

  get currentPieceId(): string {
    return KENNEY_CATALOG[this.pieceIndex]!.id;
  }

  get currentLabel(): string {
    return KENNEY_CATALOG[this.pieceIndex]!.label;
  }

  snapshotWallet(): CampWallet {
    return { ...this.wallet };
  }

  /** Merge external wallet (e.g. after tool craft deduct). */
  setWallet(w: CampWallet) {
    this.wallet = { ...w };
  }

  browserRows() {
    return kenneyBrowserRows();
  }

  addDrops(drops: LabHarvestDrop[]) {
    for (const d of drops) {
      const id = d.resourceId.toLowerCase();
      if (id === "wood" || id === "stone" || id === "fiber" || id === "ore") {
        this.wallet[id] += Math.max(0, d.amount | 0);
      }
    }
  }

  toggleMode(): boolean {
    this.mode = !this.mode;
    if (this.mode) {
      this.browserOpen = true;
      this.ensureGhost();
    } else {
      this.clearGhost();
    }
    if (this.gridHelper) this.gridHelper.visible = this.mode;
    return this.mode;
  }

  setMode(on: boolean) {
    if (this.mode === on) return;
    this.toggleMode();
  }

  toggleBrowser(): boolean {
    if (!this.mode) return false;
    this.browserOpen = !this.browserOpen;
    return this.browserOpen;
  }

  selectPiece(id: string): boolean {
    const idx = KENNEY_CATALOG.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.pieceIndex = idx;
    this.rebuildGhostMesh();
    void this.preloadGlb(KENNEY_CATALOG[idx]!);
    return true;
  }

  cyclePiece() {
    this.pieceIndex = (this.pieceIndex + 1) % KENNEY_CATALOG.length;
    this.rebuildGhostMesh();
    void this.preloadGlb(KENNEY_CATALOG[this.pieceIndex]!);
  }

  rotate() {
    this.yaw = (this.yaw + 90) % 360;
    if (this.ghost) this.ghost.rotation.y = THREE.MathUtils.degToRad(this.yaw);
  }

  updateGhost(from: THREE.Vector3, forward: THREE.Vector3) {
    if (!this.mode || !this.ghost) return;
    const cell = this.snapCell(from, forward);
    this.ghost.position.set(cell.wx, 0, cell.wz);
    this.ghost.rotation.y = THREE.MathUtils.degToRad(this.yaw);
    const def = KENNEY_CATALOG[this.pieceIndex]!;
    const can = this.canAfford(def) && !this.occupied(cell.gx, cell.gz);
    if (this.ghostMat) {
      this.ghostMat.color.setHex(can ? 0x5ecf7a : 0xe06050);
      this.ghostMat.opacity = 0.5;
    }
  }

  tryPlace(from: THREE.Vector3, forward: THREE.Vector3): CampPlaceResult {
    if (!this.mode) return { ok: false, reason: "Build mode off (B)" };
    const def = KENNEY_CATALOG[this.pieceIndex]!;
    if (!this.canAfford(def)) {
      return {
        ok: false,
        reason: `Need wood ${def.cost.wood} · stone ${def.cost.stone}`,
        cost: def.cost,
      };
    }
    const cell = this.snapCell(from, forward);
    if (this.occupied(cell.gx, cell.gz)) {
      return { ok: false, reason: "Cell occupied" };
    }
    this.wallet.wood -= def.cost.wood;
    this.wallet.stone -= def.cost.stone;

    const root = new THREE.Group();
    root.position.set(cell.wx, 0, cell.wz);
    root.rotation.y = THREE.MathUtils.degToRad(this.yaw);
    this.group.add(root);

    const cached = this.glbCache.get(def.id);
    if (cached) {
      const clone = cached.clone(true);
      this.prepPlacedMesh(clone);
      root.add(clone);
    } else {
      root.add(this.makeFallbackMesh(def));
      void this.preloadGlb(def).then((obj) => {
        if (this.disposed || !obj || !root.parent) return;
        // Replace fallback once GLB arrives
        while (root.children.length) {
          const c = root.children[0]!;
          root.remove(c);
          this.disposeObject(c);
        }
        const clone = obj.clone(true);
        this.prepPlacedMesh(clone);
        root.add(clone);
      });
    }

    const half = {
      x: Math.max(0.15, def.sizeX * GRID * 0.5),
      y: Math.max(0.1, def.height * 0.5),
      z: Math.max(0.15, def.sizeZ * GRID * 0.5),
    };
    const radius = Math.max(half.x, half.z) + 0.12;
    const collider = this.addPhysicsCuboid(root.position, half, root.quaternion);

    this.placed.push({
      id: `camp-${++placeSeq}`,
      pieceId: def.id,
      gx: cell.gx,
      gz: cell.gz,
      yaw: this.yaw,
      root,
      cost: { ...def.cost },
      radius,
      half,
      collider,
    });
    return { ok: true, piece: def.id, cost: def.cost };
  }

  tryRemove(from: THREE.Vector3, forward: THREE.Vector3): CampRemoveResult {
    if (!this.mode) return { ok: false };
    const cell = this.snapCell(from, forward);
    let idx = this.placed.findIndex((p) => p.gx === cell.gx && p.gz === cell.gz);
    if (idx < 0) {
      let best = -1;
      let bestD = 1.35;
      const aim = new THREE.Vector3(cell.wx, 0, cell.wz);
      for (let i = 0; i < this.placed.length; i++) {
        const d = this.placed[i]!.root.position.distanceTo(aim);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) return { ok: false };
      idx = best;
    }
    return this.refundAt(idx);
  }

  obstacleCircles(): ObstacleCircle[] {
    return this.placed.map((p) => ({
      x: p.root.position.x,
      z: p.root.position.z,
      r: p.radius,
    }));
  }

  statusLine(): string {
    const w = this.wallet;
    const def = KENNEY_CATALOG[this.pieceIndex]!;
    return `BUILD ${def.label} · W${w.wood} S${w.stone} · B off · R rot · Y next · blueprint HUD`;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.placed) this.removePhysics(p);
    this.clearGhost();
    this.scene.remove(this.group);
    this.disposeObject(this.group);
    this.placed = [];
    this.glbCache.clear();
  }

  // ---- internals ------------------------------------------------------------

  private refundAt(idx: number): CampRemoveResult {
    const p = this.placed[idx]!;
    this.removePhysics(p);
    this.group.remove(p.root);
    this.disposeObject(p.root);
    this.wallet.wood += p.cost.wood;
    this.wallet.stone += p.cost.stone;
    this.placed.splice(idx, 1);
    return { ok: true, refund: { ...p.cost } };
  }

  private addPhysicsCuboid(
    pos: THREE.Vector3,
    half: { x: number; y: number; z: number },
    quat: THREE.Quaternion,
  ) {
    if (!this.physics?.ready) return null;
    return this.physics.addStaticCuboid(
      { x: pos.x, y: pos.y + half.y, z: pos.z },
      half,
      { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
      { friction: 0.9 },
    );
  }

  private removePhysics(p: Placed) {
    if (!p.collider || !this.physics?.world) {
      p.collider = null;
      return;
    }
    try {
      const body = p.collider.parent();
      this.physics.world.removeCollider(p.collider, true);
      if (body) this.physics.world.removeRigidBody(body);
    } catch {
      /* already removed */
    }
    p.collider = null;
  }

  private buildPadMarker() {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(4.5, 32),
      new THREE.MeshStandardMaterial({
        color: 0x3a4a3a,
        roughness: 1,
        metalness: 0,
        transparent: true,
        opacity: 0.35,
      }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(this.padX, 0.02, this.padZ);
    pad.receiveShadow = true;
    this.group.add(pad);

    this.gridHelper = new THREE.GridHelper(8, 8, 0x5a7a5a, 0x2a3a2a);
    this.gridHelper.position.set(this.padX, 0.03, this.padZ);
    this.gridHelper.visible = false;
    this.group.add(this.gridHelper);
  }

  private ensureGhost() {
    if (this.ghost) return;
    this.ghostMat = new THREE.MeshStandardMaterial({
      color: 0x5ecf7a,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      roughness: 0.8,
    });
    this.ghost = new THREE.Group();
    this.ghost.name = "CampGhost";
    this.group.add(this.ghost);
    this.rebuildGhostMesh();
  }

  private rebuildGhostMesh() {
    if (!this.ghost || !this.ghostMat) return;
    while (this.ghost.children.length) {
      const c = this.ghost.children[0]!;
      this.ghost.remove(c);
      this.disposeObject(c);
    }
    const def = KENNEY_CATALOG[this.pieceIndex]!;
    const cached = this.glbCache.get(def.id);
    if (cached) {
      const g = cached.clone(true);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = this.ghostMat!;
          m.castShadow = false;
        }
      });
      this.ghost.add(g);
    } else {
      const mesh = new THREE.Mesh(this.boxGeo(def), this.ghostMat);
      mesh.position.y = def.height * 0.5;
      this.ghost.add(mesh);
      void this.preloadGlb(def).then(() => {
        if (this.mode) this.rebuildGhostMesh();
      });
    }
  }

  private clearGhost() {
    if (this.ghost) {
      this.group.remove(this.ghost);
      this.disposeObject(this.ghost);
      this.ghost = null;
    }
    this.ghostMat = null;
  }

  private boxGeo(def: KenneyPieceDef): THREE.BoxGeometry {
    return new THREE.BoxGeometry(
      Math.max(0.15, def.sizeX * GRID),
      def.height,
      Math.max(0.15, def.sizeZ * GRID),
    );
  }

  private makeFallbackMesh(def: KenneyPieceDef): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: def.category === "floor" ? 0x8b7355 : def.category === "wall" ? 0x9a8570 : 0x7d7468,
      roughness: 0.9,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(this.boxGeo(def), mat);
    mesh.position.y = def.height * 0.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return g;
  }

  private prepPlacedMesh(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat && "map" in mat && mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    });
  }

  private async preloadGlb(def: KenneyPieceDef): Promise<THREE.Object3D | null> {
    if (this.glbCache.has(def.id)) return this.glbCache.get(def.id)!;
    if (this.glbLoading.has(def.id)) return null;
    this.glbLoading.add(def.id);
    try {
      const url = `${import.meta.env.BASE_URL}${def.glb}`.replace(/\/{2,}/g, "/").replace(":/", "://");
      const gltf = await sharedGltfLoader().loadAsync(url);
      const root = gltf.scene;
      root.scale.setScalar(def.scale);
      root.updateMatrixWorld(true);
      // Normalize footprint: center XZ on origin, sit on y=0
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      root.position.x -= center.x;
      root.position.z -= center.z;
      root.position.y -= box.min.y;
      // Soft scale if piece is wildly off 1 m
      const maxXZ = Math.max(size.x, size.z, 0.01);
      if (maxXZ > 2.5 || maxXZ < 0.35) {
        const target = Math.max(def.sizeX, def.sizeZ) * GRID;
        root.scale.multiplyScalar(target / maxXZ);
        root.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(root);
        root.position.y -= box2.min.y;
      }
      this.glbCache.set(def.id, root);
      return root;
    } catch (err) {
      console.warn("[CampLab] kenney GLB failed", def.id, err);
      return null;
    } finally {
      this.glbLoading.delete(def.id);
    }
  }

  private canAfford(def: KenneyPieceDef): boolean {
    return this.wallet.wood >= def.cost.wood && this.wallet.stone >= def.cost.stone;
  }

  private occupied(gx: number, gz: number): boolean {
    return this.placed.some((p) => p.gx === gx && p.gz === gz);
  }

  private snapCell(
    from: THREE.Vector3,
    forward: THREE.Vector3,
  ): { gx: number; gz: number; wx: number; wz: number } {
    const fwd = forward.clone().setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    else fwd.normalize();
    const aim = from.clone().addScaledVector(fwd, Math.min(PLACE_REACH, 2.2));
    const lx = aim.x - this.padX;
    const lz = aim.z - this.padZ;
    let gx = Math.round(lx / GRID);
    let gz = Math.round(lz / GRID);
    gx = THREE.MathUtils.clamp(gx, -4, 4);
    gz = THREE.MathUtils.clamp(gz, -4, 4);
    return {
      gx,
      gz,
      wx: this.padX + gx * GRID,
      wz: this.padZ + gz * GRID,
    };
  }

  private disposeObject(o: THREE.Object3D) {
    o.traverse((child) => {
      const m = child as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat && mat !== this.ghostMat) mat.dispose?.();
    });
  }
}

// re-export for HUD
export { kenneyById, KENNEY_CATALOG };
