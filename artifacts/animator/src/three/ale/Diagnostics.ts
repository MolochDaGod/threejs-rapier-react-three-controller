import * as THREE from "three";
import type { AvatarMarkers } from "../types";

/** Conceptual collider radii (the combat model is sphere/distance based). */
const CHEST_RADIUS = 0.45;
const REACH_RADIUS = 1.5;

/** Per-fighter diagnostics input the lens draws each frame. */
export interface DiagFighter {
  id: number;
  markers: AvatarMarkers;
  /** True on the contact frame(s) where a hit volume is conceptually active. */
  striking: boolean;
  /** True when missing-collider motion was flagged this frame (AleBot decides). */
  flagged: boolean;
}

interface FighterGizmos {
  chest: THREE.LineSegments;
  reach: THREE.LineSegments;
  markers: THREE.Mesh[];
}

/**
 * Diagnostics lens: a toggleable, purely-visual overlay that draws conceptual
 * colliders (chest sphere + attack-reach sphere) and pins markers to
 * head/hands/feet/weapon. Detection of "missing-collider motion" lives in the
 * AleBot (so telemetry accrues even when the lens is hidden); this class only
 * renders. Gizmos exist only while visible — hiding the lens frees them and
 * stale fighter ids are pruned each frame, so nothing leaks across rounds.
 */
export class Diagnostics {
  readonly group = new THREE.Group();
  private readonly perFighter = new Map<number, FighterGizmos>();
  private visible = false;
  private readonly chestGeo: THREE.WireframeGeometry;
  private readonly reachGeo: THREE.WireframeGeometry;
  private readonly markerGeo: THREE.SphereGeometry;
  private readonly chestMat: THREE.LineBasicMaterial;
  private readonly reachMat: THREE.LineBasicMaterial;
  private readonly markerMat: THREE.MeshBasicMaterial;
  private readonly weaponMat: THREE.MeshBasicMaterial;
  private readonly flagMat: THREE.MeshBasicMaterial;

  constructor() {
    this.group.visible = false;
    this.group.name = "ale-diagnostics";
    this.chestGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(CHEST_RADIUS, 10, 6));
    this.reachGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(REACH_RADIUS, 14, 8));
    this.markerGeo = new THREE.SphereGeometry(0.07, 8, 6);
    this.chestMat = new THREE.LineBasicMaterial({ color: 0x36c5ff, transparent: true, opacity: 0.55 });
    this.reachMat = new THREE.LineBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.3 });
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0x9be15d });
    this.weaponMat = new THREE.MeshBasicMaterial({ color: 0xff4d6d });
    this.flagMat = new THREE.MeshBasicMaterial({ color: 0xff2030 });
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.group.visible = on;
    if (!on) this.clearGizmos();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Position gizmos for the live fighters. Call only while the lens is visible. */
  update(fighters: DiagFighter[]): void {
    const seen = new Set<number>();
    for (const f of fighters) {
      seen.add(f.id);
      const g = this.ensure(f.id);
      const m = f.markers;
      g.chest.position.set(m.head.x, (m.head.y + m.leftFoot.y) * 0.5 + 0.1, m.head.z);
      g.reach.position.copy(g.chest.position);
      const pts = [m.head, m.leftHand, m.rightHand, m.leftFoot, m.rightFoot, m.weapon];
      for (let i = 0; i < g.markers.length; i++) g.markers[i].position.copy(pts[i]);
      g.markers[5].material = f.flagged || f.striking ? this.flagMat : this.weaponMat;
    }
    this.prune(seen);
  }

  private ensure(id: number): FighterGizmos {
    let g = this.perFighter.get(id);
    if (g) return g;
    const chest = new THREE.LineSegments(this.chestGeo, this.chestMat);
    const reach = new THREE.LineSegments(this.reachGeo, this.reachMat);
    const markers: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      markers.push(new THREE.Mesh(this.markerGeo, i === 5 ? this.weaponMat : this.markerMat));
    }
    this.group.add(chest, reach, ...markers);
    g = { chest, reach, markers };
    this.perFighter.set(id, g);
    return g;
  }

  /** Drop gizmos for fighter ids absent this frame (respawns get fresh ids). */
  private prune(seen: Set<number>): void {
    for (const [id, g] of this.perFighter) {
      if (seen.has(id)) continue;
      this.group.remove(g.chest, g.reach, ...g.markers);
      this.perFighter.delete(id);
    }
  }

  private clearGizmos(): void {
    for (const g of this.perFighter.values()) {
      this.group.remove(g.chest, g.reach, ...g.markers);
    }
    this.perFighter.clear();
  }

  dispose(): void {
    this.clearGizmos();
    this.chestGeo.dispose();
    this.reachGeo.dispose();
    this.markerGeo.dispose();
    this.chestMat.dispose();
    this.reachMat.dispose();
    this.markerMat.dispose();
    this.weaponMat.dispose();
    this.flagMat.dispose();
    this.group.clear();
  }
}
