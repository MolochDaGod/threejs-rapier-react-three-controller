import * as THREE from "three";

/**
 * SmokeFx — a single-draw-call GPU-instanced billboard particle system.
 *
 * Adapted from the "smoke / fire / trace / steam" technique (illuminsi /
 * MolochDaGod, MIT): every particle is one instance of a shared quad, oriented
 * in the vertex shader by a per-instance `mode` packed into `iQuat.w`:
 *   - mode 3  → camera-facing billboard   (puffs, smoke, fire, embers)
 *   - mode 4  → cylindrical (world-up)     (upright cards)
 *   - mode 6  → axis-aligned streak        (bullet trails / traces)
 * A 4-texture atlas (soft puff / fire / spark / streak) is indexed per instance.
 *
 * Blending is premultiplied additive (CustomBlending One+One on premultiplied
 * rgb) so it reads as a soft glow, is order-independent (no per-frame CPU sort),
 * and matches the rest of the project's additive VFX. Self-contained: no
 * external particle lib, no @workspace imports.
 */

type BillboardMode = 3 | 4 | 6;

interface SParticle {
  ox: number; oy: number; oz: number; // world offset
  vx: number; vy: number; vz: number; // velocity (units/sec)
  ax: number; ay: number; az: number; // axis (mode 6)
  mode: BillboardMode;
  rot: number; // spin speed (× global time)
  sx: number; sy: number; // scale
  grow: number; // scale increase per sec
  cr: number; cg: number; cb: number; // current colour
  cr0: number; cg0: number; cb0: number; // colour from
  cr1: number; cg1: number; cb1: number; // colour to
  cpr: number; cspeed: number; // colour lerp progress / speed
  alpha: number;
  blend: number;
  tex: number; // atlas index 0..3
  live: number; // delay (s) before alpha begins to fade
  fade: number; // alpha lost per sec once live expires
  gravity: number; // downward accel (units/sec²)
  drag: number; // velocity damping per sec (0 = none)
}

interface Emitter {
  remaining: number; // seconds of emission left
  accum: number; // spawn accumulator
  rate: number; // spawns per second
  spawn: (e: Emitter) => void;
}

const MAX = 2000;

export class SmokeFx {
  private scene: THREE.Scene;
  private mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private textures: THREE.Texture[];

  private particles: SParticle[] = [];
  private pool: SParticle[] = [];
  private emitters: Emitter[] = [];

  // Reusable instance buffers (sized to MAX once).
  private aOffset: THREE.InstancedBufferAttribute;
  private aScale: THREE.InstancedBufferAttribute;
  private aQuat: THREE.InstancedBufferAttribute;
  private aRot: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aBlend: THREE.InstancedBufferAttribute;
  private aTex: THREE.InstancedBufferAttribute;

  private time = 0;
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.textures = [
      this.makePuffTexture(),
      this.makeFireTexture(),
      this.makeSparkTexture(),
      this.makeStreakTexture(),
    ];

    this.geo = new THREE.InstancedBufferGeometry();
    // Two-triangle quad (matches the source layout).
    this.geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [-0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0],
        3,
      ),
    );
    this.geo.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0], 2),
    );

    const usage = THREE.DynamicDrawUsage;
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(usage);
    this.aScale = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(usage);
    this.aQuat = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(usage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(usage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(usage);
    this.aBlend = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(usage);
    this.aTex = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(usage);
    this.geo.setAttribute("iOffset", this.aOffset);
    this.geo.setAttribute("iScale", this.aScale);
    this.geo.setAttribute("iQuat", this.aQuat);
    this.geo.setAttribute("iRot", this.aRot);
    this.geo.setAttribute("iColor", this.aColor);
    this.geo.setAttribute("iBlend", this.aBlend);
    this.geo.setAttribute("iTex", this.aTex);
    this.geo.instanceCount = 0;
    // Never cull — particles roam far from the mesh's nominal origin.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap0: { value: this.textures[0] },
        uMap1: { value: this.textures[1] },
        uMap2: { value: this.textures[2] },
        uMap3: { value: this.textures[3] },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iOffset;
        attribute vec2 iScale;
        attribute vec4 iQuat;
        attribute float iRot;
        attribute vec4 iColor;
        attribute float iBlend;
        attribute float iTex;
        uniform float uTime;
        varying vec2 vUv;
        varying vec4 vColor;
        varying float vBlend;
        varying float vTex;
        void main() {
          float angle = uTime * iRot;
          float c = cos(angle), s = sin(angle);
          vec3 vRot = vec3(
            position.x * iScale.x * c - position.y * iScale.y * s,
            position.y * iScale.y * c + position.x * iScale.x * s,
            position.z);
          vUv = uv; vColor = iColor; vBlend = iBlend; vTex = iTex;
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 vPos;
          float mode = iQuat.w;
          if (mode < 3.5) {
            // Camera-facing billboard.
            vec3 look = normalize(iOffset - cameraPosition);
            vec3 right = normalize(cross(look, up));
            vec3 nup = normalize(cross(look, right));
            vPos = right * vRot.x + nup * vRot.y + look * vRot.z;
          } else if (mode < 4.5) {
            // Cylindrical (locked to world up, faces camera horizontally).
            vec3 look = iOffset - cameraPosition;
            vec3 right = normalize(cross(look, up));
            vPos = vRot.x * right + vRot.y * up + vRot.z;
          } else {
            // Axis-aligned streak (mode 6): local-Y runs along the axis,
            // local-X stays perpendicular to both axis and view.
            vec3 look = normalize(iOffset - cameraPosition);
            vec3 axis = normalize(iQuat.xyz);
            vec3 xaxis = normalize(cross(look, axis));
            vPos = xaxis * vRot.x + axis * vRot.y + vRot.z;
          }
          gl_Position = projectionMatrix * modelViewMatrix * vec4(vPos + iOffset, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uMap0;
        uniform sampler2D uMap1;
        uniform sampler2D uMap2;
        uniform sampler2D uMap3;
        varying vec2 vUv;
        varying vec4 vColor;
        varying float vBlend;
        varying float vTex;
        void main() {
          float t = floor(vTex + 0.5);
          vec4 tx;
          if (t == 0.0) tx = texture2D(uMap0, vUv);
          else if (t == 1.0) tx = texture2D(uMap1, vUv);
          else if (t == 2.0) tx = texture2D(uMap2, vUv);
          else tx = texture2D(uMap3, vUv);
          vec4 col = tx * vColor;
          col.rgb *= col.a;     // premultiply
          col.a *= vBlend;
          if (col.a <= 0.001) discard;
          gl_FragColor = col;
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.scene.add(this.mesh);
  }

  // ── procedural atlas textures ─────────────────────────────────────────────

  private makePuffTexture(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    // A soft cloudy puff: a base radial + a few offset lobes for irregularity.
    const blob = (x: number, y: number, r: number, a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.5, `rgba(255,255,255,${a * 0.5})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    };
    blob(64, 64, 60, 0.9);
    blob(48, 56, 34, 0.5);
    blob(82, 72, 30, 0.5);
    blob(70, 48, 26, 0.4);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeFireTexture(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,236,150,0.95)");
    g.addColorStop(0.55, "rgba(255,150,40,0.7)");
    g.addColorStop(0.8, "rgba(190,40,10,0.25)");
    g.addColorStop(1, "rgba(120,10,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeSparkTexture(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.85)");
    g.addColorStop(0.6, "rgba(255,255,255,0.25)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeStreakTexture(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 128;
    const ctx = c.getContext("2d")!;
    // Bright vertical core, fading to the sides (x) and tapering at both ends (y).
    const g = ctx.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 128);
    // Fade the ends.
    const v = ctx.createLinearGradient(0, 0, 0, 128);
    v.addColorStop(0, "rgba(0,0,0,1)");
    v.addColorStop(0.2, "rgba(0,0,0,0)");
    v.addColorStop(0.8, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 32, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ── particle plumbing ─────────────────────────────────────────────────────

  private alloc(): SParticle | null {
    if (this.particles.length >= MAX) return null;
    const p =
      this.pool.pop() ??
      ({
        ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 1, az: 0,
        mode: 3, rot: 0, sx: 1, sy: 1, grow: 0,
        cr: 1, cg: 1, cb: 1, cr0: 1, cg0: 1, cb0: 1, cr1: 1, cg1: 1, cb1: 1,
        cpr: 0, cspeed: 1, alpha: 1, blend: 1, tex: 0, live: 0, fade: 1,
        gravity: 0, drag: 0,
      } as SParticle);
    return p;
  }

  // ── public emit presets ───────────────────────────────────────────────────

  /**
   * Soft expanding dust puff — landing/footfall/whoosh. Light, short-lived
   * camera-facing smoke that grows and lifts on a gentle outward spread.
   */
  puff(pos: THREE.Vector3, color = 0xdfe6ee, count = 12, scale = 1) {
    const col = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const p = this.alloc();
      if (!p) break;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.4 * scale;
      p.ox = pos.x + Math.cos(a) * r;
      p.oy = pos.y + Math.random() * 0.2;
      p.oz = pos.z + Math.sin(a) * r;
      p.vx = Math.cos(a) * (0.6 + Math.random() * 0.8) * scale;
      p.vy = 0.4 + Math.random() * 0.6;
      p.vz = Math.sin(a) * (0.6 + Math.random() * 0.8) * scale;
      p.ax = 0; p.ay = 1; p.az = 0; p.mode = 3;
      p.rot = (Math.random() - 0.5) * 1.2;
      p.sx = p.sy = (0.5 + Math.random() * 0.4) * scale;
      p.grow = (1.6 + Math.random()) * scale;
      p.cr0 = col.r; p.cg0 = col.g; p.cb0 = col.b;
      p.cr1 = col.r * 0.5; p.cg1 = col.g * 0.5; p.cb1 = col.b * 0.55;
      p.cr = p.cr0; p.cg = p.cg0; p.cb = p.cb0;
      p.cpr = 0; p.cspeed = 1.4;
      p.alpha = 0.55 + Math.random() * 0.25;
      p.blend = 0.7;
      p.tex = 0;
      p.live = 0.05; p.fade = 1.4 + Math.random();
      p.gravity = 0; p.drag = 2.2;
      this.particles.push(p);
    }
  }

  /**
   * Impact smoke pop: a fast grey burst that expands and dissipates, salted
   * with a handful of bright sparks flung outward. Designed to layer on top of
   * the existing hit flash for grit + volume.
   */
  smokePop(pos: THREE.Vector3, color = 0xffcaa0, scale = 1) {
    const col = new THREE.Color(color);
    // Grey smoke core.
    for (let i = 0; i < 8; i++) {
      const p = this.alloc();
      if (!p) break;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.3 * scale;
      p.ox = pos.x + Math.cos(a) * r;
      p.oy = pos.y + (Math.random() - 0.2) * 0.3;
      p.oz = pos.z + Math.sin(a) * r;
      p.vx = Math.cos(a) * (1.0 + Math.random()) * scale;
      p.vy = 0.6 + Math.random() * 0.8;
      p.vz = Math.sin(a) * (1.0 + Math.random()) * scale;
      p.ax = 0; p.ay = 1; p.az = 0; p.mode = 3;
      p.rot = (Math.random() - 0.5) * 2;
      p.sx = p.sy = (0.35 + Math.random() * 0.3) * scale;
      p.grow = (2.0 + Math.random()) * scale;
      p.cr0 = 0.85; p.cg0 = 0.85; p.cb0 = 0.9;
      p.cr1 = 0.18; p.cg1 = 0.18; p.cb1 = 0.22;
      p.cr = p.cr0; p.cg = p.cg0; p.cb = p.cb0;
      p.cpr = 0; p.cspeed = 2.4;
      p.alpha = 0.5 + Math.random() * 0.2;
      p.blend = 0.75;
      p.tex = 0;
      p.live = 0; p.fade = 2.4;
      p.gravity = 0; p.drag = 3.2;
      this.particles.push(p);
    }
    // Bright sparks.
    for (let i = 0; i < 10; i++) {
      const p = this.alloc();
      if (!p) break;
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.8 + 0.1,
        Math.random() - 0.5,
      ).normalize();
      const spd = (3 + Math.random() * 4) * scale;
      p.ox = pos.x; p.oy = pos.y; p.oz = pos.z;
      p.vx = dir.x * spd; p.vy = dir.y * spd; p.vz = dir.z * spd;
      p.ax = 0; p.ay = 1; p.az = 0; p.mode = 3;
      p.rot = 0;
      p.sx = p.sy = (0.12 + Math.random() * 0.1) * scale;
      p.grow = -0.1;
      p.cr0 = col.r; p.cg0 = col.g; p.cb0 = col.b;
      p.cr1 = col.r; p.cg1 = col.g * 0.6; p.cb1 = col.b * 0.3;
      p.cr = p.cr0; p.cg = p.cg0; p.cb = p.cb0;
      p.cpr = 0; p.cspeed = 3;
      p.alpha = 1; p.blend = 1;
      p.tex = 2;
      p.live = 0.04; p.fade = 3.5;
      p.gravity = 6; p.drag = 1.4;
      this.particles.push(p);
    }
  }

  /**
   * Casting swirl: a timed emitter that rings embers + faint smoke upward
   * around a focus point — the "charge-up" tell before a skill releases.
   */
  castSwirl(pos: THREE.Vector3, color = 0x9fd0ff, duration = 0.8, radius = 0.9) {
    const col = new THREE.Color(color);
    const center = pos.clone();
    let phase = 0;
    this.emitters.push({
      remaining: duration,
      accum: 0,
      rate: 60,
      spawn: () => {
        phase += 0.5;
        // Embers spiralling inward + up.
        const e = this.alloc();
        if (e) {
          const a = phase + Math.random() * 0.4;
          const r = radius * (0.7 + Math.random() * 0.4);
          e.ox = center.x + Math.cos(a) * r;
          e.oy = center.y + Math.random() * 0.3;
          e.oz = center.z + Math.sin(a) * r;
          // tangential + inward + lift
          e.vx = -Math.cos(a) * 0.8 + -Math.sin(a) * 1.4;
          e.vy = 1.4 + Math.random() * 0.8;
          e.vz = -Math.sin(a) * 0.8 + Math.cos(a) * 1.4;
          e.ax = 0; e.ay = 1; e.az = 0; e.mode = 3;
          e.rot = (Math.random() - 0.5) * 3;
          e.sx = e.sy = 0.12 + Math.random() * 0.1;
          e.grow = 0.2;
          e.cr0 = col.r; e.cg0 = col.g; e.cb0 = col.b;
          e.cr1 = col.r * 0.4; e.cg1 = col.g * 0.5; e.cb1 = col.b;
          e.cr = e.cr0; e.cg = e.cg0; e.cb = e.cb0;
          e.cpr = 0; e.cspeed = 1.6;
          e.alpha = 0.9; e.blend = 1;
          e.tex = 2;
          e.live = 0; e.fade = 1.8;
          e.gravity = 0; e.drag = 1.5;
          this.particles.push(e);
        }
        // Occasional faint smoke wisp.
        if (Math.random() < 0.3) {
          const s = this.alloc();
          if (s) {
            const a = Math.random() * Math.PI * 2;
            s.ox = center.x + Math.cos(a) * radius * 0.5;
            s.oy = center.y;
            s.oz = center.z + Math.sin(a) * radius * 0.5;
            s.vx = 0; s.vy = 0.7; s.vz = 0;
            s.ax = 0; s.ay = 1; s.az = 0; s.mode = 3;
            s.rot = (Math.random() - 0.5);
            s.sx = s.sy = 0.4;
            s.grow = 0.8;
            s.cr0 = col.r * 0.6; s.cg0 = col.g * 0.6; s.cb0 = col.b * 0.7;
            s.cr1 = 0.1; s.cg1 = 0.1; s.cb1 = 0.14;
            s.cr = s.cr0; s.cg = s.cg0; s.cb = s.cb0;
            s.cpr = 0; s.cspeed = 1.4;
            s.alpha = 0.35; s.blend = 0.6;
            s.tex = 0;
            s.live = 0; s.fade = 1.2;
            s.gravity = 0; s.drag = 1.2;
            this.particles.push(s);
          }
        }
      },
    });
  }

  /**
   * Bullet trail / trace: an axis-aligned streak (mode 6) drawn between two
   * points, fading fast, with a little muzzle/impact spark dust at the ends.
   */
  bulletTrail(from: THREE.Vector3, to: THREE.Vector3, color = 0xfff1c0) {
    const col = new THREE.Color(color);
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-4) return;
    dir.normalize();
    const mid = from.clone().addScaledVector(dir, len * 0.5);
    const p = this.alloc();
    if (p) {
      p.ox = mid.x; p.oy = mid.y; p.oz = mid.z;
      p.vx = 0; p.vy = 0; p.vz = 0;
      p.ax = dir.x; p.ay = dir.y; p.az = dir.z; p.mode = 6;
      p.rot = 0;
      p.sx = 0.16; p.sy = len; // thin × long
      p.grow = 0;
      p.cr0 = col.r; p.cg0 = col.g; p.cb0 = col.b;
      p.cr1 = col.r; p.cg1 = col.g; p.cb1 = col.b;
      p.cr = p.cr0; p.cg = p.cg0; p.cb = p.cb0;
      p.cpr = 1; p.cspeed = 1;
      p.alpha = 1; p.blend = 1;
      p.tex = 3;
      p.live = 0; p.fade = 6; // ~0.16s
      p.gravity = 0; p.drag = 0;
      this.particles.push(p);
    }
    // Tracer spark dust along the line.
    const dust = Math.min(6, Math.floor(len));
    for (let i = 0; i < dust; i++) {
      const sp = this.alloc();
      if (!sp) break;
      const t = Math.random();
      sp.ox = from.x + dir.x * len * t;
      sp.oy = from.y + dir.y * len * t;
      sp.oz = from.z + dir.z * len * t;
      sp.vx = (Math.random() - 0.5) * 1.2;
      sp.vy = (Math.random() - 0.5) * 1.2;
      sp.vz = (Math.random() - 0.5) * 1.2;
      sp.ax = 0; sp.ay = 1; sp.az = 0; sp.mode = 3;
      sp.rot = 0;
      sp.sx = sp.sy = 0.08 + Math.random() * 0.06;
      sp.grow = -0.05;
      sp.cr0 = col.r; sp.cg0 = col.g; sp.cb0 = col.b;
      sp.cr1 = col.r; sp.cg1 = col.g * 0.6; sp.cb1 = col.b * 0.4;
      sp.cr = sp.cr0; sp.cg = sp.cg0; sp.cb = sp.cb0;
      sp.cpr = 0; sp.cspeed = 4;
      sp.alpha = 0.9; sp.blend = 1;
      sp.tex = 2;
      sp.live = 0; sp.fade = 4;
      sp.gravity = 1; sp.drag = 2;
      this.particles.push(sp);
    }
  }

  /**
   * Rising smoke / steam column — a timed emitter that lofts soft grey puffs
   * (use a pale cool tint for steam). Good for smouldering wreckage, vents, or
   * a "mesh-texture" aerial smoke source.
   */
  smokeColumn(pos: THREE.Vector3, color = 0x8a8f99, duration = 1.5, rise = 1.6) {
    const col = new THREE.Color(color);
    const base = pos.clone();
    this.emitters.push({
      remaining: duration,
      accum: 0,
      rate: 14,
      spawn: () => {
        const p = this.alloc();
        if (!p) return;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.25;
        p.ox = base.x + Math.cos(a) * r;
        p.oy = base.y;
        p.oz = base.z + Math.sin(a) * r;
        p.vx = (Math.random() - 0.5) * 0.4;
        p.vy = rise * (0.7 + Math.random() * 0.6);
        p.vz = (Math.random() - 0.5) * 0.4;
        p.ax = 0; p.ay = 1; p.az = 0; p.mode = 3;
        p.rot = (Math.random() - 0.5) * 0.8;
        p.sx = p.sy = 0.4 + Math.random() * 0.3;
        p.grow = 0.9;
        p.cr0 = col.r; p.cg0 = col.g; p.cb0 = col.b;
        p.cr1 = col.r * 0.25; p.cg1 = col.g * 0.25; p.cb1 = col.b * 0.3;
        p.cr = p.cr0; p.cg = p.cg0; p.cb = p.cb0;
        p.cpr = 0; p.cspeed = 0.8;
        p.alpha = 0.45 + Math.random() * 0.2;
        p.blend = 0.6;
        p.tex = 0;
        p.live = 0.1; p.fade = 0.7;
        p.gravity = 0; p.drag = 0.8;
        this.particles.push(p);
      },
    });
  }

  /**
   * Fire shot: a hot fire puff that erupts and rolls outward leaving smoke —
   * a muzzle/cast burst for fire-flavoured attacks.
   */
  fireBurst(pos: THREE.Vector3, dir?: THREE.Vector3, scale = 1) {
    const d = (dir ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
    // Fire core.
    for (let i = 0; i < 10; i++) {
      const p = this.alloc();
      if (!p) break;
      const jitter = new THREE.Vector3(
        d.x + (Math.random() - 0.5) * 0.8,
        d.y + (Math.random() - 0.5) * 0.6,
        d.z + (Math.random() - 0.5) * 0.8,
      ).normalize();
      const spd = (2 + Math.random() * 3) * scale;
      p.ox = pos.x; p.oy = pos.y; p.oz = pos.z;
      p.vx = jitter.x * spd; p.vy = jitter.y * spd + 0.6; p.vz = jitter.z * spd;
      p.ax = 0; p.ay = 1; p.az = 0; p.mode = 3;
      p.rot = (Math.random() - 0.5) * 2;
      p.sx = p.sy = (0.3 + Math.random() * 0.3) * scale;
      p.grow = (1.2 + Math.random()) * scale;
      p.cr0 = 1.4; p.cg0 = 1.1; p.cb0 = 0.5;
      p.cr1 = 0.7; p.cg1 = 0.18; p.cb1 = 0.05;
      p.cr = p.cr0; p.cg = p.cg0; p.cb = p.cb0;
      p.cpr = 0; p.cspeed = 2.6;
      p.alpha = 0.9; p.blend = 1;
      p.tex = 1;
      p.live = 0; p.fade = 2.2;
      p.gravity = -1.5; p.drag = 2.5;
      this.particles.push(p);
    }
    // Trailing smoke.
    for (let i = 0; i < 5; i++) {
      const p = this.alloc();
      if (!p) break;
      p.ox = pos.x + (Math.random() - 0.5) * 0.3;
      p.oy = pos.y + (Math.random() - 0.5) * 0.3;
      p.oz = pos.z + (Math.random() - 0.5) * 0.3;
      p.vx = d.x * 0.6; p.vy = 0.8; p.vz = d.z * 0.6;
      p.ax = 0; p.ay = 1; p.az = 0; p.mode = 3;
      p.rot = (Math.random() - 0.5);
      p.sx = p.sy = (0.35 + Math.random() * 0.25) * scale;
      p.grow = 1.0 * scale;
      p.cr0 = 0.35; p.cg0 = 0.32; p.cb0 = 0.3;
      p.cr1 = 0.06; p.cg1 = 0.06; p.cb1 = 0.07;
      p.cr = p.cr0; p.cg = p.cg0; p.cb = p.cb0;
      p.cpr = 0; p.cspeed = 1.4;
      p.alpha = 0.4; p.blend = 0.6;
      p.tex = 0;
      p.live = 0.1; p.fade = 1.0;
      p.gravity = 0; p.drag = 1.5;
      this.particles.push(p);
    }
  }

  // ── per-frame update ──────────────────────────────────────────────────────

  update(dt: number) {
    if (this.disposed) return;
    // Clamp dt so a tab-stall doesn't teleport everything.
    const d = Math.min(dt, 0.05);
    this.time += d;
    this.mat.uniforms.uTime.value = this.time;

    // Run emitters.
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const em = this.emitters[i];
      em.remaining -= d;
      em.accum += d * em.rate;
      let n = Math.floor(em.accum);
      if (n > 0) {
        em.accum -= n;
        while (n-- > 0) em.spawn(em);
      }
      if (em.remaining <= 0) this.emitters.splice(i, 1);
    }

    // Integrate particles, swap-removing dead ones.
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      // colour lerp
      if (p.cpr < 1) {
        p.cpr = Math.min(1, p.cpr + d * p.cspeed);
        p.cr = p.cr0 + (p.cr1 - p.cr0) * p.cpr;
        p.cg = p.cg0 + (p.cg1 - p.cg0) * p.cpr;
        p.cb = p.cb0 + (p.cb1 - p.cb0) * p.cpr;
      }
      // motion
      if (p.gravity) p.vy -= p.gravity * d;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * d);
        p.vx *= k; p.vy *= k; p.vz *= k;
      }
      p.ox += p.vx * d;
      p.oy += p.vy * d;
      p.oz += p.vz * d;
      p.sx += p.grow * d;
      p.sy += p.grow * d;
      if (p.sx < 0) p.sx = 0;
      if (p.sy < 0) p.sy = 0;
      // life / fade
      if (p.live > 0) p.live -= d;
      else p.alpha -= p.fade * d;
      if (p.alpha <= 0) {
        const last = ps.length - 1;
        ps[i] = ps[last];
        ps.pop();
        this.pool.push(p);
      }
    }

    // Upload instance attributes.
    const count = ps.length;
    const off = this.aOffset.array as Float32Array;
    const scl = this.aScale.array as Float32Array;
    const qt = this.aQuat.array as Float32Array;
    const rt = this.aRot.array as Float32Array;
    const cl = this.aColor.array as Float32Array;
    const bl = this.aBlend.array as Float32Array;
    const tx = this.aTex.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const p = ps[i];
      const i2 = i * 2, i3 = i * 3, i4 = i * 4;
      off[i3] = p.ox; off[i3 + 1] = p.oy; off[i3 + 2] = p.oz;
      scl[i2] = p.sx; scl[i2 + 1] = p.sy;
      qt[i4] = p.ax; qt[i4 + 1] = p.ay; qt[i4 + 2] = p.az; qt[i4 + 3] = p.mode;
      rt[i] = p.rot;
      cl[i4] = p.cr; cl[i4 + 1] = p.cg; cl[i4 + 2] = p.cb; cl[i4 + 3] = p.alpha;
      bl[i] = p.blend;
      tx[i] = p.tex;
    }
    this.geo.instanceCount = count;
    if (count > 0) {
      this.aOffset.needsUpdate = true;
      this.aScale.needsUpdate = true;
      this.aQuat.needsUpdate = true;
      this.aRot.needsUpdate = true;
      this.aColor.needsUpdate = true;
      this.aBlend.needsUpdate = true;
      this.aTex.needsUpdate = true;
    }
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
    for (const t of this.textures) t.dispose();
    this.particles.length = 0;
    this.pool.length = 0;
    this.emitters.length = 0;
  }
}
