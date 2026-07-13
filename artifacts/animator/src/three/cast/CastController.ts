/**
 * Ground-AOE + target cast acquisition for skillwrite-style skills.
 *
 * - `groundAoe`: mouse ray → ground ring; LMB confirms cast point
 * - `target`: soft-lock hostile (or ally for heals); LMB confirms
 * - Esc / RMB cancels
 */

import * as THREE from "three";
import type { SkillPreset } from "./skillPresets";

export type ActiveCastMode = "none" | "groundAoe" | "target";

export interface CastAimState {
  mode: ActiveCastMode;
  preset: SkillPreset | null;
  /** Ground point for AOE (y ≈ floor). */
  ground: THREE.Vector3 | null;
  /** Locked entity position (target mode). */
  targetPos: THREE.Vector3 | null;
  /** True when aim is valid to confirm. */
  valid: boolean;
  /** Friendly vs hostile for dual-purpose skills (Nature's Healing). */
  targetFriendly: boolean;
}

const EMPTY: CastAimState = {
  mode: "none",
  preset: null,
  ground: null,
  targetPos: null,
  valid: false,
  targetFriendly: false,
};

export class CastController {
  private mode: ActiveCastMode = "none";
  private preset: SkillPreset | null = null;
  private ground = new THREE.Vector3();
  private targetPos = new THREE.Vector3();
  private hasGround = false;
  private hasTarget = false;
  private targetFriendly = false;
  private maxRange = 22;
  private ringRadius = 2.5;

  /** Ground marker ring (owned; host adds to scene). */
  readonly ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;

  constructor() {
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x9fdcff,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 48), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.frustumCulled = false;
  }

  private setRingRadius(r: number): void {
    if (Math.abs(r - this.ringRadius) < 0.05) return;
    this.ringRadius = r;
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.RingGeometry(Math.max(0.15, r * 0.78), r, 48);
  }

  isActive(): boolean {
    return this.mode !== "none" && !!this.preset;
  }

  getPreset(): SkillPreset | null {
    return this.preset;
  }

  /**
   * Arm a skill for placement. Instant presets return false (caller fires now).
   */
  begin(preset: SkillPreset): boolean {
    if (preset.acquire === "instant") return false;
    this.preset = preset;
    this.mode = preset.acquire === "groundAoe" ? "groundAoe" : "target";
    this.hasGround = false;
    this.hasTarget = false;
    this.targetFriendly = false;
    this.ringMat.color.setHex(preset.color);
    this.setRingRadius(preset.aoeRadius ?? 2.5);
    this.ring.visible = this.mode === "groundAoe";
    return true;
  }

  cancel(): void {
    this.mode = "none";
    this.preset = null;
    this.hasGround = false;
    this.hasTarget = false;
    this.ring.visible = false;
  }

  /**
   * Update aim from camera ray (ground plane y=0) and optional soft-lock target.
   */
  updateAim(opts: {
    ray: THREE.Ray;
    /** Soft-lock hostile position, or null. */
    hostilePos: THREE.Vector3 | null;
    /** Soft-lock ally position, or null. */
    allyPos: THREE.Vector3 | null;
    casterPos: THREE.Vector3;
    preferFriendly?: boolean;
  }): CastAimState {
    if (!this.preset || this.mode === "none") return EMPTY;

    if (this.mode === "groundAoe") {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      if (opts.ray.intersectPlane(plane, hit)) {
        const dx = hit.x - opts.casterPos.x;
        const dz = hit.z - opts.casterPos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > this.maxRange) {
          const s = this.maxRange / dist;
          hit.x = opts.casterPos.x + dx * s;
          hit.z = opts.casterPos.z + dz * s;
        }
        hit.y = 0.06;
        this.ground.copy(hit);
        this.hasGround = true;
        this.ring.position.copy(hit);
        this.ring.visible = true;
      }
      return {
        mode: this.mode,
        preset: this.preset,
        ground: this.hasGround ? this.ground.clone() : null,
        targetPos: null,
        valid: this.hasGround,
        targetFriendly: false,
      };
    }

    // target mode
    const preferF = !!opts.preferFriendly || this.preset.vfx === "naturesHealing";
    let pos: THREE.Vector3 | null = null;
    let friendly = false;
    if (preferF && opts.allyPos) {
      pos = opts.allyPos;
      friendly = true;
    } else if (opts.hostilePos) {
      pos = opts.hostilePos;
      friendly = false;
    } else if (opts.allyPos) {
      pos = opts.allyPos;
      friendly = true;
    }
    // Ground fallback under crosshair so moonbeam can still place
    if (!pos) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      if (opts.ray.intersectPlane(plane, hit)) {
        pos = hit.setY(0.1);
        friendly = false;
      }
    }
    if (pos) {
      this.targetPos.copy(pos);
      this.hasTarget = true;
      this.targetFriendly = friendly;
      this.ring.position.set(pos.x, 0.06, pos.z);
      this.ring.visible = true;
      this.setRingRadius(this.preset.aoeRadius ?? 1.4);
    } else {
      this.hasTarget = false;
      this.ring.visible = false;
    }
    return {
      mode: this.mode,
      preset: this.preset,
      ground: null,
      targetPos: this.hasTarget ? this.targetPos.clone() : null,
      valid: this.hasTarget,
      targetFriendly: this.targetFriendly,
    };
  }

  /**
   * Confirm cast. Returns aim snapshot and clears mode, or null if invalid.
   */
  confirm(): CastAimState | null {
    if (!this.preset || this.mode === "none") return null;
    if (this.mode === "groundAoe" && !this.hasGround) return null;
    if (this.mode === "target" && !this.hasTarget) return null;
    const snap: CastAimState = {
      mode: this.mode,
      preset: this.preset,
      ground: this.hasGround ? this.ground.clone() : null,
      targetPos: this.hasTarget ? this.targetPos.clone() : null,
      valid: true,
      targetFriendly: this.targetFriendly,
    };
    this.cancel();
    return snap;
  }

  dispose(): void {
    this.cancel();
    this.ring.geometry.dispose();
    this.ringMat.dispose();
  }
}
