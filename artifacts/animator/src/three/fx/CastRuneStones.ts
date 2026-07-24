/**
 * Overhead cast-stone / rune channel VFX (staff & skillwrite).
 * Lightweight Three.js group that follows the caster while channeling.
 */
import * as THREE from "three";

export interface CastRuneShowOpts {
  skillId?: string;
  element?: string;
  school?: string;
  vfx?: string;
  channelColor?: number | string;
}

export interface CastRuneUpdateOpts {
  channeling?: boolean;
  intensity?: number;
}

function toColor(c?: number | string): THREE.Color {
  if (typeof c === "number") return new THREE.Color(c);
  if (typeof c === "string") {
    try {
      return new THREE.Color(c);
    } catch {
      /* fall through */
    }
  }
  return new THREE.Color(0xfbbf24);
}

export class CastRuneStones {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private visible = false;
  private releaseT = 0;
  private baseY = 2.05;
  private spin = 0;
  private color = new THREE.Color(0xfbbf24);

  constructor() {
    this.group.name = "CastRuneStones";
    this.group.visible = false;
  }

  async preload(): Promise<void> {
    if (this.mesh) return;
    const geo = new THREE.IcosahedronGeometry(0.18, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: this.color,
      emissive: this.color,
      emissiveIntensity: 0.85,
      metalness: 0.2,
      roughness: 0.35,
      transparent: true,
      opacity: 0.92,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = false;
    this.group.add(this.mesh);

    // Soft glow disc under the stone
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.28, 24),
      new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.22;
    this.group.add(disc);
  }

  show(opts: CastRuneShowOpts = {}): void {
    void this.preload();
    this.color = toColor(opts.channelColor);
    if (this.mesh) {
      const mat = this.mesh.material as THREE.MeshStandardMaterial;
      mat.color.copy(this.color);
      mat.emissive.copy(this.color);
      mat.opacity = 0.92;
    }
    this.visible = true;
    this.releaseT = 0;
    this.group.visible = true;
  }

  /** Pulse then hide after `duration` seconds. */
  release(duration = 0.4): void {
    this.releaseT = Math.max(0.05, duration);
  }

  hide(): void {
    this.visible = false;
    this.releaseT = 0;
    this.group.visible = false;
  }

  update(
    dt: number,
    casterPos: THREE.Vector3 | null,
    opts?: CastRuneUpdateOpts,
  ): void {
    if (!this.visible && this.releaseT <= 0) {
      this.group.visible = false;
      return;
    }
    if (casterPos) {
      this.group.position.set(casterPos.x, casterPos.y + this.baseY, casterPos.z);
    }
    this.spin += dt * (opts?.channeling ? 4.2 : 2.2);
    if (this.mesh) {
      this.mesh.rotation.y = this.spin;
      this.mesh.rotation.x = Math.sin(this.spin * 0.7) * 0.25;
      const bob = Math.sin(this.spin * 2.1) * 0.04;
      this.mesh.position.y = bob;
      const mat = this.mesh.material as THREE.MeshStandardMaterial;
      const intensity = opts?.intensity ?? (opts?.channeling ? 0.7 : 0.35);
      mat.emissiveIntensity = 0.55 + intensity * 0.9;
    }
    if (this.releaseT > 0) {
      this.releaseT -= dt;
      if (this.mesh) {
        const mat = this.mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = Math.max(0, this.releaseT * 2.2);
      }
      if (this.releaseT <= 0) this.hide();
    }
    this.group.visible = this.visible || this.releaseT > 0;
  }

  dispose(): void {
    this.hide();
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
    this.group.clear();
    this.mesh = null;
  }
}
