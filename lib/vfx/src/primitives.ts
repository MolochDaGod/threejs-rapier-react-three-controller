/**
 * Mesh-based effects that aren't particle systems: the spline beam, the
 * force-push shockwave, and the swept weapon-trail ribbon. Each exposes a
 * {@link LiveMesh} the {@link VfxManager} ticks every frame and disposes when
 * done; beams and trails additionally return a caller-driven handle. Everything
 * is plain Three.js (no GL needed at construction), so it is headless-safe.
 */
import * as THREE from "three";

/** A self-managing mesh effect the manager updates and reaps. */
export interface LiveMesh {
  root: THREE.Object3D;
  /** Advance; return false when finished (the manager then disposes it). */
  update(dt: number): boolean;
  /** Swap in the sprite texture once it has finished loading (optional). */
  setMap?(tex: THREE.Texture | null): void;
  dispose(): void;
}

export interface BeamOptions {
  color?: THREE.ColorRepresentation;
  thickness?: number;
  /** Scroll speed of the texture along the beam (default 3). */
  scroll?: number;
  /** Seconds to fade out after `stop()` (default 0.15). */
  fade?: number;
}

/** Handle to a live beam; reposition its endpoints each frame, then `stop()`. */
export interface BeamHandle {
  setEndpoints(from: THREE.Vector3, to: THREE.Vector3): BeamHandle;
  stop(): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A glowing beam between two points: two crossed, additive, texture-scrolled
 * quads spanning local +Y (0..1), oriented and scaled onto the segment. Good for
 * laser/lightning/magic beams ("spline animated effects").
 */
export function createBeam(
  tex: THREE.Texture | null,
  from: THREE.Vector3,
  to: THREE.Vector3,
  opts: BeamOptions = {},
): { mesh: LiveMesh; handle: BeamHandle } {
  const thickness = opts.thickness ?? 0.25;
  const scroll = opts.scroll ?? 3;
  const fadeTime = opts.fade ?? 0.15;

  const mat = new THREE.MeshBasicMaterial({
    map: null,
    color: new THREE.Color(opts.color ?? 0xffffff),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  let map: THREE.Texture | null = null;
  const setMap = (t: THREE.Texture | null) => {
    map?.dispose();
    map = t ? t.clone() : null;
    if (map) {
      map.wrapT = THREE.RepeatWrapping;
      map.needsUpdate = true;
    }
    mat.map = map;
    mat.needsUpdate = true;
  };
  setMap(tex);

  // Unit quad spanning Y 0..1, width on X.
  const makeQuad = () => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    return new THREE.Mesh(g, mat);
  };
  const a = makeQuad();
  const b = makeQuad();
  b.rotation.y = Math.PI / 2;

  const root = new THREE.Group();
  root.add(a, b);

  let stopping = false;
  let fade = 0;
  const baseColor = new THREE.Color(opts.color ?? 0xffffff);

  const apply = (f: THREE.Vector3, t: THREE.Vector3) => {
    const dir = t.clone().sub(f);
    const len = dir.length();
    root.position.copy(f);
    if (len > 1e-4) {
      root.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
      root.scale.set(thickness, len, 1);
      map?.repeat.set(1, Math.max(1, len / Math.max(thickness, 0.01) / 4));
    }
  };
  apply(from, to);

  const mesh: LiveMesh = {
    root,
    update(dt) {
      if (map) map.offset.y -= scroll * dt;
      if (stopping) {
        fade += dt;
        const k = Math.max(0, 1 - fade / fadeTime);
        mat.color.setRGB(baseColor.r * k, baseColor.g * k, baseColor.b * k);
        if (fade >= fadeTime) return false;
      }
      return true;
    },
    setMap,
    dispose() {
      a.geometry.dispose();
      b.geometry.dispose();
      mat.dispose();
      map?.dispose();
      root.parent?.remove(root);
    },
  };

  const handle: BeamHandle = {
    setEndpoints(f, t) {
      if (!stopping) apply(f, t);
      return handle;
    },
    stop() {
      stopping = true;
    },
  };
  return { mesh, handle };
}

export interface ShockwaveOptions {
  /** Outer ring / spark color (default warm white). */
  color?: THREE.ColorRepresentation;
  /** Hot core disc color (defaults to a brighter tint of `color`). */
  coreColor?: THREE.ColorRepresentation;
  /** Final radius in world units (default 3). */
  radius?: number;
  /**
   * Expansion curve power. Higher = stays tight then rips out harder
   * (ease-out exponent on radius). Default 1.6.
   */
  power?: number;
  /** Lifetime seconds (default 0.45). */
  duration?: number;
  /** Burst particle count (0 = ring-only). Default 0 for light call sites. */
  particles?: number;
  /** Plane normal (default world up — a ground ring). */
  normal?: THREE.Vector3;
}

/**
 * Tuned orange impact preset matching design tooling export:
 * `new Shockwave(scene, { color: "#ff7a2e", coreColor: "#e3a302", radius: 7.55,
 * power: 2.45, duration: 0.95, particles: 202 })`
 */
export const SHOCKWAVE_ORANGE_IMPACT: Readonly<Required<
  Pick<ShockwaveOptions, "color" | "coreColor" | "radius" | "power" | "duration" | "particles">
>> = {
  color: "#ff7a2e",
  coreColor: "#e3a302",
  radius: 7.55,
  power: 2.45,
  duration: 0.95,
  particles: 202,
};

/**
 * An expanding ring + hot core + optional spark burst. Visual for knockback /
 * force-push / boss slam / spell AOE.
 */
export function createShockwave(
  tex: THREE.Texture | null,
  position: THREE.Vector3,
  opts: ShockwaveOptions = {},
): LiveMesh {
  const radius = opts.radius ?? 3;
  const duration = opts.duration ?? 0.45;
  const power = Math.max(0.5, opts.power ?? 1.6);
  const particleCount = Math.max(0, Math.floor(opts.particles ?? 0));
  const baseColor = new THREE.Color(opts.color ?? 0xffffff);
  const coreColor = new THREE.Color(opts.coreColor ?? baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35));

  const root = new THREE.Group();
  root.position.copy(position);
  const normal = (opts.normal ?? UP).clone().normalize();
  root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

  // Outer expanding ring.
  const ringGeo = new THREE.RingGeometry(0.42, 0.58, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    map: tex ?? null,
    color: baseColor.clone(),
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  root.add(ring);

  // Hot core disc (shrinks/fades faster than the ring expands).
  const coreGeo = new THREE.CircleGeometry(0.5, 48);
  const coreMat = new THREE.MeshBasicMaterial({
    map: tex ?? null,
    color: coreColor.clone(),
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.z = 0.01;
  root.add(core);

  // Radial spark burst (simple point cloud — no quarks dependency).
  let sparks: THREE.Points | null = null;
  let sparkMat: THREE.PointsMaterial | null = null;
  let sparkVel: Float32Array | null = null;
  let sparkPos: Float32Array | null = null;
  if (particleCount > 0) {
    sparkPos = new Float32Array(particleCount * 3);
    sparkVel = new Float32Array(particleCount * 3);
    const speed = radius * (0.55 + power * 0.15);
    for (let i = 0; i < particleCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.15) * 0.55;
      const s = speed * (0.35 + Math.random() * 0.9);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // Local XY plane (Z is ring normal after group orient).
      sparkVel[i * 3] = cos * s;
      sparkVel[i * 3 + 1] = sin * s;
      sparkVel[i * 3 + 2] = elev * s * 0.35;
      sparkPos[i * 3] = cos * 0.08;
      sparkPos[i * 3 + 1] = sin * 0.08;
      sparkPos[i * 3 + 2] = 0.02;
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
    sparkMat = new THREE.PointsMaterial({
      color: baseColor.clone().lerp(coreColor, 0.4),
      size: 0.12,
      map: tex ?? null,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    sparks = new THREE.Points(sparkGeo, sparkMat);
    root.add(sparks);
  }

  let age = 0;
  return {
    root,
    update(dt) {
      age += dt;
      const t = Math.min(1, age / duration);
      if (t >= 1) return false;

      // Ease-out expansion: 1 - (1-t)^power
      const ease = 1 - Math.pow(1 - t, power);
      const s = 0.15 + radius * ease;
      ring.scale.set(s, s, s);
      // Core blooms then collapses.
      const coreT = Math.min(1, t * 1.6);
      const coreS = 0.4 + radius * 0.22 * Math.sin(coreT * Math.PI);
      core.scale.set(coreS, coreS, coreS);

      const ringFade = Math.pow(1 - t, 0.85);
      ringMat.opacity = ringFade;
      ringMat.color.copy(baseColor).multiplyScalar(0.55 + 0.45 * ringFade);
      coreMat.opacity = Math.pow(1 - coreT, 1.1) * 0.95;
      coreMat.color.copy(coreColor).multiplyScalar(0.7 + 0.3 * (1 - coreT));

      if (sparks && sparkPos && sparkVel && sparkMat) {
        const grav = 2.8 * dt;
        for (let i = 0; i < particleCount; i++) {
          sparkVel[i * 3 + 2] -= grav * 0.15; // mild settle along normal
          sparkPos[i * 3] += sparkVel[i * 3] * dt;
          sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
          sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        }
        (sparks.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        sparkMat.opacity = Math.pow(1 - t, 0.7);
        sparkMat.size = 0.08 + 0.1 * (1 - t);
      }
      return true;
    },
    setMap(t) {
      ringMat.map = t;
      ringMat.needsUpdate = true;
      coreMat.map = t;
      coreMat.needsUpdate = true;
      if (sparkMat) {
        sparkMat.map = t;
        sparkMat.needsUpdate = true;
      }
    },
    dispose() {
      ringGeo.dispose();
      ringMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      if (sparks) {
        sparks.geometry.dispose();
        sparkMat?.dispose();
      }
      root.parent?.remove(root);
    },
  };
}

/**
 * Imperative helper matching design-tool export style:
 * `new Shockwave(scene, { color, coreColor, radius, power, duration, particles })`
 *
 * Adds the effect to `scene` and returns a handle that must be `update(dt)`'d
 * each frame (or prefer {@link VfxManager.shockwave} which self-ticks).
 */
export class Shockwave {
  readonly root: THREE.Object3D;
  private readonly live: LiveMesh;
  private finished = false;

  constructor(scene: THREE.Scene, opts: ShockwaveOptions = {}) {
    this.live = createShockwave(null, new THREE.Vector3(0, 0, 0), opts);
    this.root = this.live.root;
    scene.add(this.root);
  }

  /** World-space origin of the blast. */
  setPosition(p: THREE.Vector3): this {
    this.root.position.copy(p);
    return this;
  }

  /** Advance; returns false when the effect has finished and cleaned up. */
  update(dt: number): boolean {
    if (this.finished) return false;
    const alive = this.live.update(dt);
    if (!alive) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose(): void {
    if (this.finished) return;
    this.finished = true;
    this.live.dispose();
  }
}

/**
 * Per-target shell burst used by status casts (e.g. dagger storm slow).
 * Matches design export:
 * `adv.play('nova_shell', { color, secondary, duration, radius, style })`
 */
export interface NovaShellOptions {
  /** Outer shell / rim color. */
  color?: THREE.ColorRepresentation;
  /** Inner fill / secondary tint. */
  secondary?: THREE.ColorRepresentation;
  /** Lifetime seconds (default 0.7). */
  duration?: number;
  /** World-unit shell radius (default 0.6). */
  radius?: number;
  /**
   * Visual style: 0 = soft bubble (default), 1 = hard hex-ish ring,
   * 2 = spiky pulse.
   */
  style?: 0 | 1 | 2;
}

/** Storm slow-shell preset (orange nova on debuffed enemies). */
export const NOVA_SHELL_STORM: Readonly<
  Required<Pick<NovaShellOptions, "color" | "secondary" | "duration" | "radius" | "style">>
> = {
  color: "#ff6622",
  secondary: "#ffcc88",
  duration: 0.7,
  radius: 0.6,
  style: 0,
};

/**
 * Expanding translucent shell around a target — cast on enemies hit by storm
 * (slow debuff) and similar status bursts.
 */
export function createNovaShell(
  tex: THREE.Texture | null,
  position: THREE.Vector3,
  opts: NovaShellOptions = {},
): LiveMesh {
  const duration = opts.duration ?? 0.7;
  const radius = opts.radius ?? 0.6;
  const style = opts.style ?? 0;
  const color = new THREE.Color(opts.color ?? "#ff6622");
  const secondary = new THREE.Color(opts.secondary ?? "#ffcc88");

  const root = new THREE.Group();
  root.position.copy(position);

  // Outer shell sphere.
  const segs = style === 1 ? 6 : style === 2 ? 10 : 24;
  const shellGeo = new THREE.SphereGeometry(1, segs, Math.max(6, segs / 2));
  const shellMat = new THREE.MeshBasicMaterial({
    map: tex ?? null,
    color: color.clone(),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    wireframe: style === 1,
  });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  root.add(shell);

  // Inner core sphere (secondary tint).
  const coreGeo = new THREE.SphereGeometry(0.55, 16, 12);
  const coreMat = new THREE.MeshBasicMaterial({
    map: tex ?? null,
    color: secondary.clone(),
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  root.add(core);

  // Equatorial ring for style 0 / 2.
  let ring: THREE.Mesh | null = null;
  let ringMat: THREE.MeshBasicMaterial | null = null;
  let ringGeo: THREE.RingGeometry | null = null;
  if (style !== 1) {
    ringGeo = new THREE.RingGeometry(0.85, 1.05, 48);
    ringMat = new THREE.MeshBasicMaterial({
      map: tex ?? null,
      color: color.clone().lerp(secondary, 0.35),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    root.add(ring);
  }

  let age = 0;
  return {
    root,
    update(dt) {
      age += dt;
      const t = age / duration;
      if (t >= 1) return false;

      // Pop out then soft settle.
      const pop = t < 0.25 ? t / 0.25 : 1;
      const ease = 1 - Math.pow(1 - Math.min(1, t * 1.15), 2.2);
      const s = radius * (0.35 + 0.75 * ease) * (0.92 + 0.08 * Math.sin(pop * Math.PI));
      shell.scale.setScalar(s);
      core.scale.setScalar(s * (0.55 + 0.2 * (1 - t)));
      if (ring) {
        ring.scale.setScalar(s * (1.05 + 0.35 * ease));
        ring.rotation.z += dt * (style === 2 ? 4 : 1.6);
      }

      const fade = Math.pow(1 - t, 0.9);
      shellMat.opacity = 0.55 * fade;
      coreMat.opacity = 0.7 * fade * (1 - t * 0.4);
      if (ringMat) ringMat.opacity = 0.85 * fade;

      // Slight vertical bob so it reads as a status shell, not a ground ring.
      root.position.y = position.y + Math.sin(t * Math.PI) * radius * 0.15;
      return true;
    },
    setMap(t) {
      shellMat.map = t;
      shellMat.needsUpdate = true;
      coreMat.map = t;
      coreMat.needsUpdate = true;
      if (ringMat) {
        ringMat.map = t;
        ringMat.needsUpdate = true;
      }
    },
    dispose() {
      shellGeo.dispose();
      shellMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      ringGeo?.dispose();
      ringMat?.dispose();
      root.parent?.remove(root);
    },
  };
}

export interface TrailOptions {
  color?: THREE.ColorRepresentation;
  /** How long a sample lives before fading out (default 0.18s). */
  duration?: number;
  /** Max retained samples (default 24). */
  segments?: number;
}

/** Handle for a weapon trail; push the blade's two ends each frame, then stop. */
export interface TrailHandle {
  /** Add the current blade span (tip & base) to the swept ribbon. */
  push(tip: THREE.Vector3, base: THREE.Vector3): TrailHandle;
  stop(): void;
}

interface TrailSample {
  tip: THREE.Vector3;
  base: THREE.Vector3;
  age: number;
}

/**
 * A swept ribbon connecting successive blade spans — the classic melee weapon
 * trail. Fade is baked into per-vertex colour so additive blending makes older
 * segments vanish. Caller pushes (tip, base) each frame and `stop()`s on release.
 */
export function createWeaponTrail(
  tex: THREE.Texture | null,
  opts: TrailOptions = {},
): { mesh: LiveMesh; handle: TrailHandle } {
  const duration = opts.duration ?? 0.18;
  const maxSamples = opts.segments ?? 24;
  const color = new THREE.Color(opts.color ?? 0xffffff);

  const samples: TrailSample[] = [];
  let stopping = false;

  const geo = new THREE.BufferGeometry();
  const cap = maxSamples * 2;
  const positions = new Float32Array(cap * 3);
  const colors = new Float32Array(cap * 3);
  const uvs = new Float32Array(cap * 2);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setDrawRange(0, 0);

  const mat = new THREE.MeshBasicMaterial({
    map: tex ?? null,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  const rebuild = () => {
    const n = samples.length;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const k = Math.max(0, 1 - s.age / duration); // newest=1, oldest=0
      const head = (n - 1 - i) / Math.max(1, n - 1); // along strip for UV
      const o = i * 2;
      positions[o * 3] = s.tip.x;
      positions[o * 3 + 1] = s.tip.y;
      positions[o * 3 + 2] = s.tip.z;
      positions[(o + 1) * 3] = s.base.x;
      positions[(o + 1) * 3 + 1] = s.base.y;
      positions[(o + 1) * 3 + 2] = s.base.z;
      colors[o * 3] = color.r * k;
      colors[o * 3 + 1] = color.g * k;
      colors[o * 3 + 2] = color.b * k;
      colors[(o + 1) * 3] = color.r * k;
      colors[(o + 1) * 3 + 1] = color.g * k;
      colors[(o + 1) * 3 + 2] = color.b * k;
      uvs[o * 2] = head;
      uvs[o * 2 + 1] = 1;
      uvs[(o + 1) * 2] = head;
      uvs[(o + 1) * 2 + 1] = 0;
    }
    geo.setDrawRange(0, n * 2);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
  };

  const mesh_: LiveMesh = {
    root: mesh,
    update(dt) {
      for (const s of samples) s.age += dt;
      while (samples.length && samples[0].age >= duration) samples.shift();
      rebuild();
      if (stopping && samples.length === 0) return false;
      return true;
    },
    setMap(t) {
      mat.map = t;
      mat.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.parent?.remove(mesh);
    },
  };

  const handle: TrailHandle = {
    push(tip, base) {
      if (stopping) return handle;
      samples.push({ tip: tip.clone(), base: base.clone(), age: 0 });
      if (samples.length > maxSamples) samples.shift();
      return handle;
    },
    stop() {
      stopping = true;
    },
  };
  return { mesh: mesh_, handle };
}

// ---------------------------------------------------------------------------
// Earth Wall — voxel barrier (blocks ranged; design-tool export)
// ---------------------------------------------------------------------------

export interface EarthWallOptions {
  color?: THREE.ColorRepresentation;
  /** Edge length of each voxel cube (default 0.42). */
  voxelSize?: number;
  /** Wall width along the lateral axis (default 7.95). */
  width?: number;
  /** Wall height above ground (default 7). */
  height?: number;
  /** Seconds the wall stays fully up before crumbling (default 6.95). */
  holdTime?: number;
  /** How high voxels fall from when spawning (default 6). */
  dropHeight?: number;
}

/** Design preset: `new EarthWall(scene, { color: "#6c6f78", … })`. */
export const EARTH_WALL_PRESET: Readonly<Required<EarthWallOptions>> = {
  color: "#6c6f78",
  voxelSize: 0.42,
  width: 7.95,
  height: 7,
  holdTime: 6.95,
  dropHeight: 6,
};

interface WallVoxel {
  mesh: THREE.Mesh;
  targetY: number;
  startY: number;
  delay: number;
  landAge: number;
}

/**
 * Voxel earth wall that drops in from above, holds, then crumbles.
 * Exposes solid collider meshes so projectiles / rays can block against it.
 *
 * Placement: call {@link EarthWall.place} with a ground origin and a *forward*
 * direction (toward the enemy) so the wall faces them and protects the caster.
 */
export class EarthWall {
  readonly root: THREE.Group;
  /** Solid voxel meshes — push into collision lists for projectile blocking. */
  readonly colliders: THREE.Mesh[] = [];

  private readonly voxels: WallVoxel[] = [];
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly boxGeo: THREE.BoxGeometry;
  private age = 0;
  private readonly holdTime: number;
  private readonly dropHeight: number;
  private phase: "drop" | "hold" | "crumble" = "drop";
  private finished = false;
  private readonly dropDur = 0.55;
  private readonly crumbleDur = 0.85;

  constructor(scene: THREE.Scene, opts: EarthWallOptions = {}) {
    const color = new THREE.Color(opts.color ?? EARTH_WALL_PRESET.color);
    const voxelSize = opts.voxelSize ?? EARTH_WALL_PRESET.voxelSize;
    const width = opts.width ?? EARTH_WALL_PRESET.width;
    const height = opts.height ?? EARTH_WALL_PRESET.height;
    this.holdTime = opts.holdTime ?? EARTH_WALL_PRESET.holdTime;
    this.dropHeight = opts.dropHeight ?? EARTH_WALL_PRESET.dropHeight;

    this.root = new THREE.Group();
    this.root.name = "EarthWall";
    scene.add(this.root);

    this.mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: true,
    });
    this.boxGeo = new THREE.BoxGeometry(voxelSize * 0.96, voxelSize * 0.96, voxelSize * 0.96);

    const cols = Math.max(1, Math.round(width / voxelSize));
    const rows = Math.max(1, Math.round(height / voxelSize));
    const halfW = ((cols - 1) * voxelSize) * 0.5;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Jagged top / edges so it reads as broken earth, not a perfect box.
        if (r === rows - 1 && (c + r) % 3 === 0) continue;
        if (r > rows * 0.7 && Math.random() < 0.12) continue;

        const mesh = new THREE.Mesh(this.boxGeo, this.mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.earthWall = true;
        // Local space: X = width, Y = up, Z = thickness (thin barrier).
        const lx = -halfW + c * voxelSize;
        const ly = voxelSize * 0.5 + r * voxelSize;
        const lz = ((c + r) % 2 === 0 ? 0.02 : -0.02) * voxelSize;
        mesh.position.set(lx, ly + this.dropHeight, lz);
        this.root.add(mesh);
        this.colliders.push(mesh);
        this.voxels.push({
          mesh,
          targetY: ly,
          startY: ly + this.dropHeight,
          delay: (c * 0.012 + r * 0.018) + Math.random() * 0.04,
          landAge: 0,
        });
      }
    }
  }

  /**
   * Place the wall on the ground at `origin`, facing `forward` (toward enemy).
   * The wall's broad face is perpendicular to forward so it intercepts shots.
   */
  place(origin: THREE.Vector3, forward: THREE.Vector3): this {
    const f = forward.clone();
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
    f.normalize();
    this.root.position.copy(origin);
    this.root.position.y = origin.y;
    // Look along forward so local Z is toward the enemy (thin face).
    this.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f);
    return this;
  }

  /** Advance animation; returns false when finished and disposed. */
  update(dt: number): boolean {
    if (this.finished) return false;
    this.age += dt;

    if (this.phase === "drop") {
      let allLanded = true;
      for (const v of this.voxels) {
        const local = Math.max(0, this.age - v.delay);
        const t = Math.min(1, local / this.dropDur);
        if (t < 1) allLanded = false;
        // Ease-in drop.
        const ease = t * t;
        v.mesh.position.y = v.startY + (v.targetY - v.startY) * ease;
        if (t >= 1) {
          v.landAge += dt;
          // Settling jiggle.
          if (v.landAge < 0.12) {
            v.mesh.position.y = v.targetY + Math.sin(v.landAge * 40) * 0.03 * (1 - v.landAge / 0.12);
          } else {
            v.mesh.position.y = v.targetY;
          }
        }
      }
      if (allLanded && this.age > this.dropDur + 0.35) {
        this.phase = "hold";
        this.age = 0;
      }
      return true;
    }

    if (this.phase === "hold") {
      if (this.age >= this.holdTime) {
        this.phase = "crumble";
        this.age = 0;
      }
      return true;
    }

    // Crumble: voxels fall outward / down and fade.
    let anyAlive = false;
    for (let i = 0; i < this.voxels.length; i++) {
      const v = this.voxels[i];
      const stagger = (i % 7) * 0.03;
      const t = Math.max(0, this.age - stagger) / this.crumbleDur;
      if (t < 1) anyAlive = true;
      const fall = t * t * (this.dropHeight * 0.45 + 1.2);
      v.mesh.position.y = v.targetY - fall;
      v.mesh.position.x += (Math.sin(i * 1.7) * 0.8) * dt;
      v.mesh.rotation.z += dt * (1.5 + (i % 5) * 0.4);
      v.mesh.rotation.x += dt * 0.9;
      const mat = v.mesh.material as THREE.MeshStandardMaterial;
      // Shared material — only fade near the end via root opacity workaround:
      // scale down instead of mutating shared mat mid-crumble for all voxels.
      const s = Math.max(0.01, 1 - t);
      v.mesh.scale.setScalar(s);
    }
    if (!anyAlive || this.age >= this.crumbleDur + 0.4) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose(): void {
    if (this.finished) return;
    this.finished = true;
    this.root.parent?.remove(this.root);
    this.boxGeo.dispose();
    this.mat.dispose();
    this.colliders.length = 0;
    this.voxels.length = 0;
  }
}
