import * as THREE from "three";
import type { StatusId, StatusKind, StatusView } from "../types";
import { runeRingTexture, softDiscTexture, unitGroundPlane } from "./fxTextures";

/**
 * Self-contained status-effect VFX, ported in spirit from the CC0 BinbunVFX
 * (Vol.2) Godot packs: a ground ring + soft additive particle column + a pulsing
 * point light per active status, plus the timing/notifier data the HUD reads.
 *
 * The Godot originals are procedural shaders + GPUParticles; here every effect is
 * rebuilt natively in three.js (no @workspace imports — this artifact vendors its
 * own libs). Particle motion is CPU-driven (counts are small) so the styles read
 * clearly: "rise" (flame/poison/heal columns), "orbit" (frost/shield shards),
 * "spark" (shock/haste flicker).
 */

type AuraStyle = "rise" | "orbit" | "spark";

export interface StatusDef {
  id: StatusId;
  name: string;
  kind: StatusKind;
  /** Core color (hex). */
  color: number;
  /** Highlight color particles fade toward (hex). */
  color2: number;
  /** A non-emoji symbol glyph shown on the notifier chip. */
  glyph: string;
  /** Seconds the status lasts when applied. */
  duration: number;
  style: AuraStyle;
}

export const STATUS_DEFS: Record<StatusId, StatusDef> = {
  burning: { id: "burning", name: "Burning", kind: "debuff", color: 0xff6a1e, color2: 0xffd27a, glyph: "▲", duration: 6, style: "rise" },
  frozen: { id: "frozen", name: "Frozen", kind: "debuff", color: 0x7ad0ff, color2: 0xeaffff, glyph: "◆", duration: 5, style: "orbit" },
  poisoned: { id: "poisoned", name: "Poisoned", kind: "debuff", color: 0x8cff5a, color2: 0xdcff9e, glyph: "✦", duration: 7, style: "rise" },
  shocked: { id: "shocked", name: "Shocked", kind: "debuff", color: 0xfff15a, color2: 0xffffff, glyph: "✱", duration: 4, style: "spark" },
  hexed: { id: "hexed", name: "Hexed", kind: "debuff", color: 0xb15cff, color2: 0xe4b6ff, glyph: "❖", duration: 6, style: "orbit" },
  regen: { id: "regen", name: "Regen", kind: "buff", color: 0x6affa0, color2: 0xe0ffec, glyph: "✚", duration: 8, style: "rise" },
  empowered: { id: "empowered", name: "Empowered", kind: "buff", color: 0xffc24a, color2: 0xfff0c0, glyph: "✦", duration: 8, style: "rise" },
  shielded: { id: "shielded", name: "Shielded", kind: "buff", color: 0x5ad0ff, color2: 0xd6f4ff, glyph: "⬡", duration: 10, style: "orbit" },
  haste: { id: "haste", name: "Haste", kind: "buff", color: 0x9a7aff, color2: 0xe6dcff, glyph: "✱", duration: 8, style: "spark" },
};

export const STATUS_IDS = Object.keys(STATUS_DEFS) as StatusId[];

/** CSS hex string for a status' core color (for HUD chips / dock buttons). */
export function statusCss(id: StatusId): string {
  return "#" + STATUS_DEFS[id].color.toString(16).padStart(6, "0");
}

/** Lightweight catalog the tap-to-apply dock renders (no THREE objects). */
export interface StatusMenuItem {
  id: StatusId;
  name: string;
  kind: StatusKind;
  glyph: string;
  color: string;
}
export const STATUS_MENU: StatusMenuItem[] = STATUS_IDS.map((id) => ({
  id,
  name: STATUS_DEFS[id].name,
  kind: STATUS_DEFS[id].kind,
  glyph: STATUS_DEFS[id].glyph,
  color: statusCss(id),
}));

/** Shared soft round sprite for additive glow particles (module-lived). */
let SOFT_TEX: THREE.Texture | null = null;
function softTexture(): THREE.Texture {
  if (SOFT_TEX) return SOFT_TEX;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.65)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  SOFT_TEX = tex;
  return tex;
}

const COUNT = 46;

/**
 * The slice of an aura the {@link StatusController} actually drives each frame:
 * a per-tick `update(dt, center)` and teardown. Extracting this interface lets
 * the controller's timer / pool-resize / anchor logic be unit-tested with a
 * fake factory — the real {@link StatusAura} needs a canvas + WebGL, which the
 * node test env (and headless CI) cannot provide.
 */
export interface StatusAuraHandle {
  update(dt: number, center: THREE.Vector3): void;
  dispose(): void;
}

/**
 * Builds the aura for a status when it is (re)applied. Injectable into
 * {@link StatusController} so tests can substitute a WebGL-free stand-in.
 */
export type StatusAuraFactory = (def: StatusDef) => StatusAuraHandle;

class StatusAura implements StatusAuraHandle {
  readonly group = new THREE.Group();
  private ring: THREE.Mesh;
  private glow: THREE.Mesh;
  private light: THREE.PointLight;
  private points: THREE.Points;
  private geom: THREE.BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  private alpha: Float32Array;
  // per-particle sim state
  private life = new Float32Array(COUNT);
  private max = new Float32Array(COUNT);
  private vx = new Float32Array(COUNT);
  private vy = new Float32Array(COUNT);
  private vz = new Float32Array(COUNT);
  private ang = new Float32Array(COUNT);
  private rad = new Float32Array(COUNT);
  private base = new Float32Array(COUNT);
  private age = 0;
  private cBase = new THREE.Color();
  private cHi = new THREE.Color();

  constructor(
    private scene: THREE.Scene,
    private def: StatusDef,
  ) {
    this.cBase.setHex(def.color);
    this.cHi.setHex(def.color2);

    // Ground ring (additive) — the textured magic-circle "footprint" of the
    // status. Shared flat XZ-plane + rune texture, tinted per status color.
    const ringMat = new THREE.MeshBasicMaterial({
      color: def.color,
      map: runeRingTexture(),
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(unitGroundPlane(), ringMat);
    // Rune rim sits at ~0.46 of the plane; scale so the footprint reads ~1.3m.
    this.ring.scale.setScalar(1.3);
    this.ring.position.y = 0.03;
    this.group.add(this.ring);

    // Soft inner glow disc.
    const glowMat = new THREE.MeshBasicMaterial({
      color: def.color,
      map: softDiscTexture(),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.glow = new THREE.Mesh(unitGroundPlane(), glowMat);
    this.glow.scale.setScalar(1.2);
    this.glow.position.y = 0.02;
    this.group.add(this.glow);

    // Pulsing colored light.
    this.light = new THREE.PointLight(def.color, 0, 4.5, 2);
    this.light.position.set(0, 1.1, 0);
    this.group.add(this.light);

    // Particle field.
    this.geom = new THREE.BufferGeometry();
    this.pos = new Float32Array(COUNT * 3);
    this.col = new Float32Array(COUNT * 3);
    this.alpha = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) this.spawn(i, true);
    this.geom.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geom.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.geom.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.PointsMaterial({
      size: this.def.style === "spark" ? 0.16 : 0.2,
      map: softTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    // Fold the per-particle alpha into the additive color (additive blending has
    // no real alpha channel, so dimming the color is the fade).
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aAlpha;\nvarying float vAlpha;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAlpha = aAlpha;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vAlpha;")
        .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( diffuse * vAlpha, opacity );");
    };
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    scene.add(this.group);
  }

  private spawn(i: number, initial = false) {
    const s = this.def.style;
    const a = Math.random() * Math.PI * 2;
    this.ang[i] = a;
    if (s === "rise") {
      const r = 0.12 + Math.random() * 0.34;
      this.rad[i] = r;
      this.pos[i * 3] = Math.cos(a) * r;
      this.pos[i * 3 + 1] = initial ? Math.random() * 1.6 : 0.05 + Math.random() * 0.1;
      this.pos[i * 3 + 2] = Math.sin(a) * r;
      this.vy[i] = 0.6 + Math.random() * 1.0;
      this.vx[i] = (Math.random() - 0.5) * 0.2;
      this.vz[i] = (Math.random() - 0.5) * 0.2;
      this.max[i] = 1.1 + Math.random() * 0.9;
    } else if (s === "orbit") {
      const r = 0.5 + Math.random() * 0.18;
      this.rad[i] = r;
      this.base[i] = 0.15 + Math.random() * 1.5;
      this.pos[i * 3] = Math.cos(a) * r;
      this.pos[i * 3 + 1] = this.base[i];
      this.pos[i * 3 + 2] = Math.sin(a) * r;
      this.vy[i] = 0.4 + Math.random() * 0.8; // used as orbit speed
      this.max[i] = 2 + Math.random() * 2;
    } else {
      // spark
      const r = Math.random() * 0.5;
      this.rad[i] = r;
      this.pos[i * 3] = Math.cos(a) * r;
      this.pos[i * 3 + 1] = 0.4 + Math.random() * 1.3;
      this.pos[i * 3 + 2] = Math.sin(a) * r;
      this.vx[i] = (Math.random() - 0.5) * 2.4;
      this.vy[i] = (Math.random() - 0.5) * 2.4;
      this.vz[i] = (Math.random() - 0.5) * 2.4;
      this.max[i] = 0.15 + Math.random() * 0.35;
    }
    this.life[i] = initial ? Math.random() * this.max[i] : 0;
  }

  update(dt: number, center: THREE.Vector3) {
    this.age += dt;
    this.group.position.copy(center);

    // Ring + glow pulse.
    const pulse = 0.85 + Math.sin(this.age * 4) * 0.15;
    this.ring.rotation.y += dt * 0.8;
    this.ring.scale.setScalar(1.3 * pulse);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.25 * pulse;
    (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.08 * pulse;
    this.light.intensity = 1.6 + Math.sin(this.age * (this.def.style === "spark" ? 18 : 6)) * 1.0;

    const s = this.def.style;
    for (let i = 0; i < COUNT; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) {
        this.spawn(i);
        continue;
      }
      const t = this.life[i] / this.max[i];
      const ix = i * 3;
      if (s === "rise") {
        this.pos[ix] += this.vx[i] * dt;
        this.pos[ix + 1] += this.vy[i] * dt;
        this.pos[ix + 2] += this.vz[i] * dt;
        // gentle inward swirl
        const sw = dt * 1.4;
        const cx = this.pos[ix], cz = this.pos[ix + 2];
        this.pos[ix] = cx * Math.cos(sw) - cz * Math.sin(sw);
        this.pos[ix + 2] = cx * Math.sin(sw) + cz * Math.cos(sw);
      } else if (s === "orbit") {
        this.ang[i] += this.vy[i] * dt;
        this.pos[ix] = Math.cos(this.ang[i]) * this.rad[i];
        this.pos[ix + 2] = Math.sin(this.ang[i]) * this.rad[i];
        this.pos[ix + 1] = this.base[i] + Math.sin(this.age * 2 + i) * 0.12;
      } else {
        this.pos[ix] += this.vx[i] * dt;
        this.pos[ix + 1] += this.vy[i] * dt;
        this.pos[ix + 2] += this.vz[i] * dt;
      }
      // color fade hi -> base, alpha curve (fade in then out)
      const c = this.cHi.clone().lerp(this.cBase, t);
      this.col[ix] = c.r;
      this.col[ix + 1] = c.g;
      this.col[ix + 2] = c.b;
      const fade = s === "spark" ? 1 - t : Math.sin(Math.min(1, t) * Math.PI);
      this.alpha[i] = Math.max(0, fade);
    }
    (this.geom.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group);
    // ring/glow geometry + textures are shared module singletons — only the
    // per-instance tinted materials are freed here.
    (this.ring.material as THREE.Material).dispose();
    (this.glow.material as THREE.Material).dispose();
    this.geom.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** Owns active-status timers + their auras and exposes notifier views. */
export class StatusController {
  /** One status can own several auras at once (an AOE cast paints every ally). */
  private auras = new Map<StatusId, StatusAuraHandle[]>();
  private timers = new Map<StatusId, { remaining: number; duration: number }>();
  /** Optional position source per aura (a routed cast follows its target). */
  private anchors = new Map<StatusId, Array<(() => THREE.Vector3) | null>>();
  /** How a new aura is built — overridable so the timer/pool/anchor logic can
   *  be driven without a canvas/WebGL context (see {@link StatusAuraFactory}). */
  private makeAura: StatusAuraFactory;

  constructor(scene: THREE.Scene, makeAura?: StatusAuraFactory) {
    this.makeAura = makeAura ?? ((def) => new StatusAura(scene, def));
  }

  /**
   * Apply (or refresh) a status; (re)starts its timer and spawns its aura. When
   * `anchor` is given the aura tracks that point each frame (e.g. a friendly cast
   * routed onto the green ally / an offensive cast onto the red hostile) instead
   * of the default self-position passed to {@link update}.
   */
  apply(id: StatusId, anchor?: () => THREE.Vector3) {
    this.applyAll(id, [anchor ?? null]);
  }

  /**
   * Apply (or refresh) a status across several anchors at once — one aura per
   * anchor — sharing a single timer + notifier chip. Used by an area-of-effect
   * friendly cast so every ally inside the radius wears its own status aura.
   */
  applyAll(id: StatusId, anchors: Array<(() => THREE.Vector3) | null>) {
    const def = STATUS_DEFS[id];
    if (!def) return;
    const list = anchors.length > 0 ? anchors : [null];
    this.timers.set(id, { remaining: def.duration, duration: def.duration });
    this.anchors.set(id, list);
    // Resize the aura pool to match the anchor count (reuse, grow, or trim).
    const existing = this.auras.get(id) ?? [];
    for (let i = list.length; i < existing.length; i++) existing[i].dispose();
    const next: StatusAuraHandle[] = [];
    for (let i = 0; i < list.length; i++) next.push(existing[i] ?? this.makeAura(def));
    this.auras.set(id, next);
  }

  clear(id: StatusId) {
    this.timers.delete(id);
    this.anchors.delete(id);
    for (const a of this.auras.get(id) ?? []) a.dispose();
    this.auras.delete(id);
  }

  clearAll() {
    for (const id of [...this.timers.keys()]) this.clear(id);
  }

  /** True if any status is active. */
  get active(): boolean {
    return this.timers.size > 0;
  }

  update(dt: number, center: THREE.Vector3) {
    for (const [id, t] of this.timers) {
      t.remaining -= dt;
      if (t.remaining <= 0) {
        this.clear(id);
        continue;
      }
      const anchors = this.anchors.get(id);
      const auras = this.auras.get(id);
      if (!auras) continue;
      for (let i = 0; i < auras.length; i++) {
        const a = anchors?.[i];
        auras[i].update(dt, a ? a() : center);
      }
    }
  }

  /** Notifier data for the HUD (buffs first, then debuffs, stable order). */
  views(): StatusView[] {
    const out: StatusView[] = [];
    for (const id of STATUS_IDS) {
      const t = this.timers.get(id);
      if (!t) continue;
      const def = STATUS_DEFS[id];
      out.push({
        id,
        name: def.name,
        kind: def.kind,
        color: `#${def.color.toString(16).padStart(6, "0")}`,
        glyph: def.glyph,
        remaining: t.remaining,
        duration: t.duration,
      });
    }
    return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "buff" ? -1 : 1));
  }

  dispose() {
    for (const auras of this.auras.values()) for (const a of auras) a.dispose();
    this.auras.clear();
    this.timers.clear();
    this.anchors.clear();
  }
}
