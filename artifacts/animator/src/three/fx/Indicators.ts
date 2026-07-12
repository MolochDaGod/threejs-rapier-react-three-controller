import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { asset } from "../assets";
import { telegraphTexture, unitGroundPlane } from "./fxTextures";

/**
 * Ground target-indicators + AoE telegraphs for the Danger Room.
 *
 * {@link TargetIndicators} draws a recoloured glowing disc under every live
 * combatant — Red = the primary (Tab-locked) hostile, Yellow = other hostiles,
 * Green = the selected (Shift+Tab) ally, Blue = other friendly/neutral. The disc
 * art is the shared `yellow_light` GLB: each instance gets its OWN
 * MeshBasicMaterial that reuses the GLB's texture as an `alphaMap` (so the disc
 * shape survives) under a flat tint colour — recolouring by multiplying the
 * yellow base texture would crush blue/green, so the texture is used for SHAPE
 * only. The shared geometry + texture are NEVER disposed here; only the cloned
 * per-instance materials are.
 *
 * {@link TelegraphField} draws AoE warning circles: a circle blinks yellow,
 * snaps to solid red for the final `redDur` (the 0.5s pre-impact warning), then
 * fires its `onResolve` (the actual effect) — i.e. the hit lands `redDur` after
 * the ring turns red, so a player who leaves the circle in time is spared.
 */

export type IndicatorColor = "red" | "yellow" | "green" | "blue";

export interface IndicatorItem {
  /** Ground-plane world position of the combatant. */
  x: number;
  z: number;
  /** Combatant's base Y (the disc sits just above it). */
  y: number;
  color: IndicatorColor;
  /**
   * 0..1 danger level for YELLOW (un-locked hostile) discs: the ring grows and
   * brightens with how much of a threat the enemy poses to the player. Ignored
   * for red/green/blue. Defaults to 0.5 when omitted.
   */
  threat?: number;
}

/** Flat tint per relationship/selection bucket. */
const TINT: Record<IndicatorColor, number> = {
  red: 0xff2e2e,
  yellow: 0xffcf3a,
  green: 0x37e070,
  blue: 0x3aa6ff,
};

interface Disc {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  color: IndicatorColor;
  /** Cached 0..1 threat for yellow discs (drives size + intensity). */
  threat: number;
}

export class TargetIndicators {
  private scene: THREE.Scene;
  private root = new THREE.Group();
  /** Shared geometry + texture pulled from the GLB template (never disposed here). */
  private geo: THREE.BufferGeometry | null = null;
  private tex: THREE.Texture | null = null;
  private pool: Disc[] = [];
  /** Snapshot received before the GLB finished loading, replayed on load. */
  private pending: IndicatorItem[] | null = null;
  private clock = 0;
  private loaded = false;
  /** Camera-facing red dot floating over the locked target's head (or null). */
  private overhead: THREE.Sprite | null = null;
  private overheadTex: THREE.Texture | null = null;
  /** World point the overhead dot tracks (set per-frame; bobbed in update). */
  private overheadBase = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root.name = "TargetIndicators";
    scene.add(this.root);
    void this.load();
  }

  private async load() {
    try {
      const loader = new GLTFLoader();
      const g = await loader.loadAsync(asset("models/vfx/target-ring.glb"));
      let mesh: THREE.Mesh | null = null;
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!mesh && m.isMesh) mesh = m;
      });
      if (mesh) {
        const found = mesh as THREE.Mesh;
        this.geo = found.geometry;
        const mat = found.material as THREE.MeshStandardMaterial;
        this.tex = mat.map ?? null;
      }
    } catch {
      // Asset missing / failed to decode — indicators silently disable.
    }
    this.loaded = true;
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.set(p);
    }
  }

  /** Replace the full set of live discs from this frame's snapshot. */
  set(items: IndicatorItem[]): void {
    if (!this.loaded) {
      this.pending = items;
      return;
    }
    if (!this.geo) return;
    while (this.pool.length < items.length) this.pool.push(this.makeDisc());
    for (let i = 0; i < this.pool.length; i++) {
      const disc = this.pool[i];
      const item = items[i];
      if (!item) {
        disc.mesh.visible = false;
        continue;
      }
      disc.mesh.visible = true;
      disc.mesh.position.set(item.x, item.y + 0.06, item.z);
      disc.threat = item.threat ?? 0.5;
      if (disc.color !== item.color) {
        disc.color = item.color;
        disc.mat.color.setHex(TINT[item.color]);
      }
    }
  }

  private makeDisc(): Disc {
    const mat = new THREE.MeshBasicMaterial({
      color: TINT.yellow,
      alphaMap: this.tex ?? undefined,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // GLB disc geometry is already a flat XZ plane (radius 1) — scale to footprint.
    const mesh = new THREE.Mesh(this.geo!, mat);
    mesh.scale.setScalar(0.85);
    mesh.visible = false;
    this.root.add(mesh);
    return { mesh, mat, color: "yellow", threat: 0.5 };
  }

  /**
   * Place (or hide) the camera-facing red dot that hovers over the locked
   * target's head. Pass the head world point each frame, or `null` to hide it.
   */
  setOverhead(pos: THREE.Vector3 | null): void {
    if (!pos) {
      if (this.overhead) this.overhead.visible = false;
      return;
    }
    if (!this.overhead) {
      this.overheadTex = this.makeDotTexture();
      const mat = new THREE.SpriteMaterial({
        map: this.overheadTex,
        transparent: true,
        depthWrite: false,
        // Draw over geometry so the marker never hides behind the target body.
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      this.overhead = new THREE.Sprite(mat);
      this.overhead.renderOrder = 999;
      this.root.add(this.overhead);
    }
    this.overhead.visible = true;
    this.overheadBase.copy(pos);
  }

  /** Soft radial red dot for the overhead marker (camera-facing sprite). */
  private makeDotTexture(): THREE.Texture {
    const s = 64;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,120,120,1)");
    g.addColorStop(0.4, "rgba(255,46,46,0.95)");
    g.addColorStop(1, "rgba(255,30,30,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  update(dt: number): void {
    this.clock += dt;
    const calm = 0.5 + 0.5 * Math.sin(this.clock * 4);
    for (const d of this.pool) {
      if (!d.mesh.visible) continue;
      if (d.color === "red") {
        // Primary / attacking hostile pops with a brighter, faster pulse.
        d.mat.opacity = 0.5 + 0.42 * (0.5 + 0.5 * Math.sin(this.clock * 7.5));
        d.mesh.scale.setScalar(0.92 + 0.06 * Math.sin(this.clock * 7.5));
      } else if (d.color === "yellow") {
        // Size + intensity ramp with threat: a distant idle enemy reads small and
        // dim; a close, aggressive one swells and brightens toward red's footprint.
        const t = d.threat;
        const size = 0.62 + 0.6 * t;
        d.mesh.scale.setScalar(size * (1 + 0.04 * (0.3 + 0.7 * t) * calm));
        d.mat.opacity = (0.28 + 0.52 * t) * (0.72 + 0.28 * calm);
      } else {
        d.mat.opacity = 0.5 + 0.28 * calm;
        d.mesh.scale.setScalar(0.85);
      }
    }
    if (this.overhead?.visible) {
      const bob = 0.08 * Math.sin(this.clock * 4);
      this.overhead.position.set(
        this.overheadBase.x,
        this.overheadBase.y + bob,
        this.overheadBase.z,
      );
      this.overhead.scale.setScalar(0.34 + 0.04 * Math.sin(this.clock * 6));
    }
  }

  dispose(): void {
    for (const d of this.pool) {
      this.root.remove(d.mesh);
      d.mat.dispose();
    }
    this.pool.length = 0;
    if (this.overhead) {
      this.root.remove(this.overhead);
      (this.overhead.material as THREE.SpriteMaterial).dispose();
      this.overhead = null;
    }
    this.overheadTex?.dispose();
    this.overheadTex = null;
    this.scene.remove(this.root);
    // Shared GLB geometry + texture belong to the template — never disposed here.
    this.geo = null;
    this.tex = null;
  }
}

const TG_YELLOW = 0xffcf3a;
const TG_RED = 0xff2a2a;

interface ActiveTelegraph {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  yellowDur: number;
  redDur: number;
  onResolve: () => void;
  done: boolean;
}

export class TelegraphField {
  private scene: THREE.Scene;
  /** Shared flat unit XZ-plane, scaled per telegraph (radius). */
  private geo: THREE.PlaneGeometry;
  /** Shared reticle texture (white-on-transparent, tinted per material). */
  private tex: THREE.Texture;
  private active: ActiveTelegraph[] = [];
  private clock = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.geo = unitGroundPlane();
    this.tex = telegraphTexture();
  }

  /**
   * Schedule an AoE telegraph at `center` with ground `radius`. It blinks yellow
   * for `yellowDur`, snaps to solid red for `redDur`, then fires `onResolve` —
   * the hit lands `redDur` after the ring turns red.
   */
  add(center: THREE.Vector3, radius: number, onResolve: () => void, yellowDur = 0.5, redDur = 0.5): void {
    const mat = new THREE.MeshBasicMaterial({
      color: TG_YELLOW,
      map: this.tex,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.set(center.x, 0.05, center.z);
    // The reticle's visible rim sits at ~0.46 of the plane size, so scale up to
    // make the rim land on the requested ground radius.
    mesh.scale.setScalar(Math.max(0.3, radius) * 2.17);
    this.scene.add(mesh);
    this.active.push({ mesh, mat, t: 0, yellowDur, redDur, onResolve, done: false });
  }

  update(dt: number): void {
    this.clock += dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.t += dt;
      if (a.t < a.yellowDur) {
        a.mat.color.setHex(TG_YELLOW);
        a.mat.opacity = 0.16 + 0.22 * (0.5 + 0.5 * Math.sin(this.clock * 18));
      } else if (a.t < a.yellowDur + a.redDur) {
        a.mat.color.setHex(TG_RED);
        const k = (a.t - a.yellowDur) / a.redDur;
        a.mat.opacity = 0.3 + 0.45 * k;
      } else {
        if (!a.done) {
          a.done = true;
          try {
            a.onResolve();
          } catch {
            // A telegraph resolving must never break the render loop.
          }
        }
        this.scene.remove(a.mesh);
        a.mat.dispose();
        this.active.splice(i, 1);
      }
    }
  }

  /** Drop all in-flight telegraphs WITHOUT resolving them (e.g. mode swap). */
  clear(): void {
    for (const a of this.active) {
      this.scene.remove(a.mesh);
      a.mat.dispose();
    }
    this.active.length = 0;
  }

  dispose(): void {
    this.clear();
    // geo + tex are shared module singletons — never disposed here.
  }
}
