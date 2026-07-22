import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../assetHost";
import { disposeGlbDeep } from "./disposeDeep";

/** Resolve lobby optional GLBs (silhouettes used if missing). */
function asset(rel: string): string {
  return assetUrl(rel.replace(/^\//, ""));
}

/**
 * Ethereal Falls night skyline for the lobby — the lore backdrop.
 *
 * Four layers, all fog-immune (the lobby's FogExp2 would swallow anything
 * this far out, so every material here opts out of fog and reads as a
 * luminous distant vista):
 *
 * 1. A seamless animated nebula sky dome (direction-based fbm, so the sky
 *    wraps 360° with no tiling seam) with twinkling stars, a spinning
 *    galactic swirl, and aurora (northern-lights) curtains near the horizon.
 * 2. The Ethereal Falls beyond the woods: a huge shader-driven curtain of
 *    aurora-lit water flowing UPWARD off the world into the end of the
 *    universe, flanked by two smaller falls and dark floating islands.
 * 3. A spinning cosmic vortex at the TOP of the falls — the mouth of the
 *    universe the water pours into.
 * 4. Rising mist plumes at the base of each fall where the water lifts off.
 *
 * Everything is procedural (no textures) and cheap: one dome draw + a few
 * additive planes. `update(t)` drives all the shader time uniforms.
 */
/** One drifting island: rises from under the player's island, drifts back to
 *  the main fall and dissolves into it, then waits out a long pause. */
interface Drifter {
  root: THREE.Object3D;
  /** Per-instance cloned materials (for the dissolve fade). */
  mats: THREE.Material[];
  /** Journey start (deep under the player's island) and end (at the falls). */
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Seconds for the full crossing / seconds elapsed so far. */
  dur: number;
  age: number;
  /** Idle pause (s) before this drifter re-emerges — keeps them rare. */
  delay: number;
  baseScale: number;
  bobPhase: number;
  spinSpeed: number;
}

/** Where the main fall / vortex sits (drift + debris both aim here). */
const VORTEX = new THREE.Vector3(0, 36, -84);
const DEBRIS_COUNT = 140;

export class EtherealSky {
  readonly group = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly timed: THREE.ShaderMaterial[] = [];
  private vortex: THREE.Mesh | null = null;
  private disposed = false;

  /** Procedural cone stand-ins, swapped out when the GLB drifters load. */
  private silhouettes: THREE.Group | null = null;
  private drifters: Drifter[] = [];
  private drifterSources: THREE.Object3D[] = [];
  private debris: THREE.Points | null = null;
  private debrisVel: Float32Array | null = null;
  private debrisLife: Float32Array | null = null;
  private lastT = 0;

  constructor(scene: THREE.Scene) {
    this.buildDome();
    this.buildFalls();
    this.buildMists();
    this.buildIslands();
    this.buildDebris();
    void this.loadDriftIslands();
    scene.add(this.group);
  }

  /** Shared GLSL: hash / value noise / fbm used by both dome and falls. */
  private static NOISE = /* glsl */ `
    float hash(vec3 p) {
      p = fract(p * 0.3183099 + 0.1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float noise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      // Quintic interpolation: zero second-derivative at cell borders, so the
      // noise has no visible lattice creases (smoother texture than cubic).
      f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      return mix(
        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
        f.z);
    }
    float fbm(vec3 p) {
      float v = 0.0;
      float a = 0.5;
      // 5 octaves: the extra high-frequency layer adds fine filigree to the
      // nebula, falls and mist instead of soft blobs.
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = p * 2.03 + vec3(19.7, 7.3, 11.1);
        a *= 0.5;
      }
      return v / 0.96875;
    }
    // 1 below lo, easing to 0 at hi. (Reversed-edge smoothstep is UB in GLSL.)
    float fadeOut(float lo, float hi, float x) {
      return 1.0 - smoothstep(lo, hi, x);
    }
  `;

  // ------------------------------------------------------------------ dome
  private buildDome(): void {
    const geo = new THREE.SphereGeometry(150, 48, 32);
    this.geometries.push(geo);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vDir;
        ${EtherealSky.NOISE}

        // Round twinkling star: one jittered point per direction-cell with a
        // soft radial core + halo (no square cell blocks). The point stays
        // well inside its cell so the falloff never clips at a cell border.
        float starLayer(vec3 d, float scale, float thresh, float radius, float t) {
          vec3 p = d * scale;
          vec3 cell = floor(p);
          float s = hash(cell);
          float on = step(thresh, s);
          vec3 sp = 0.32 + 0.36 * vec3(hash(cell + 7.13), hash(cell + 3.71), hash(cell + 9.37));
          float dist = length(fract(p) - sp);
          float core = pow(clamp(1.0 - dist / radius, 0.0, 1.0), 3.0);
          // Halo capped so its steep pow-8 tail is ~zero by the 0.32 border
          // margin — no visible clipping at cell seams.
          float halo = pow(clamp(1.0 - dist / min(radius * 2.2, 0.45), 0.0, 1.0), 8.0) * 0.5;
          float tw = 0.7 + 0.3 * sin(t * (1.0 + s * 3.0) + s * 40.0);
          return on * (core + halo) * tw;
        }

        void main() {
          vec3 d = normalize(vDir);
          float t = uTime * 0.014;

          // Nebula bands: richer multi-scale fbm for a deeper cosmic wash.
          float n1 = fbm(d * 3.1 + vec3(t, t * 0.4, -t * 0.6));
          float n2 = fbm(d * 6.4 - vec3(t * 0.7, t * 0.2, t));
          float n3 = fbm(d * 11.0 + vec3(t * 0.3, -t * 0.5, t * 0.2));
          float neb = smoothstep(0.28, 0.88, n1 * 0.55 + n2 * 0.4 + n3 * 0.25);

          // Primary galactic swirl over the falls (-Z).
          vec3 axis = normalize(vec3(0.0, 0.55, -1.0));
          float ca = dot(d, axis);
          vec3 ortho = normalize(d - axis * ca);
          vec3 u1 = normalize(cross(axis, vec3(0.0, 1.0, 0.001)));
          vec3 u2 = cross(axis, u1);
          float ang = atan(dot(ortho, u2), dot(ortho, u1)) + uTime * 0.055;
          float rad = acos(clamp(ca, -1.0, 1.0));
          float arm = fbm(vec3(ang * 1.6 + rad * 5.0 - uTime * 0.22, rad * 7.0, 1.7));
          float arm2 = fbm(vec3(ang * 3.2 - rad * 8.0 + uTime * 0.15, rad * 5.0, 7.9));
          float ring = fadeOut(0.0, 0.58, abs(rad - 0.40 - (arm - 0.5) * 0.16)) * step(0.0, ca);
          ring *= 0.5 + 0.45 * arm + 0.3 * arm2;

          // Second tilted galaxy — distant cosmic sibling.
          vec3 axis2 = normalize(vec3(0.55, 0.35, 0.75));
          float ca2 = dot(d, axis2);
          vec3 ortho2 = normalize(d - axis2 * ca2);
          vec3 v1 = normalize(cross(axis2, vec3(0.0, 1.0, 0.001)));
          vec3 v2 = cross(axis2, v1);
          float ang2 = atan(dot(ortho2, v2), dot(ortho2, v1)) - uTime * 0.03;
          float rad2 = acos(clamp(ca2, -1.0, 1.0));
          float armB = fbm(vec3(ang2 * 2.0 + rad2 * 6.0 + uTime * 0.1, rad2 * 8.0, 3.3));
          float ring2 = fadeOut(0.0, 0.42, abs(rad2 - 0.35 - (armB - 0.5) * 0.1)) * step(0.0, ca2);
          ring2 *= 0.35 + 0.4 * armB;

          // Aurora curtains — brighter, more violet-heavy cosmic ribbons.
          float aur = fbm(vec3(d.x * 2.6 + t * 4.0, d.y * 7.5 - uTime * 0.11, d.z * 2.6 - t * 2.0));
          float band = smoothstep(0.38, 0.92, aur)
                     * smoothstep(-0.08, 0.28, d.y) * fadeOut(0.28, 0.85, d.y);
          vec3 aurCol = mix(vec3(0.08, 0.85, 0.55), vec3(0.35, 0.35, 1.0),
                            0.5 + 0.5 * sin(d.x * 4.0 + uTime * 0.4));
          aurCol = mix(aurCol, vec3(0.75, 0.2, 1.0), smoothstep(0.5, 0.95, aur));

          // Cosmic ray streaks (thin bright lines sweeping across the dome).
          float rayAng = atan(d.x, d.z) + uTime * 0.02;
          float ray = pow(max(0.0, sin(rayAng * 9.0 + d.y * 14.0 - uTime * 0.6)), 48.0)
                    * smoothstep(0.05, 0.55, d.y) * fadeOut(0.55, 0.95, d.y);
          ray *= 0.35 + 0.65 * hash(floor(vec3(rayAng * 4.0, d.y * 8.0, 1.0)));

          // Shooting-star streaks (rare, bright).
          float shoot = 0.0;
          for (int k = 0; k < 3; k++) {
            float kt = uTime * (0.35 + float(k) * 0.12) + float(k) * 17.0;
            float phase = fract(kt * 0.08);
            vec3 sdir = normalize(vec3(
              sin(float(k) * 2.1 + 1.0),
              0.35 + 0.2 * float(k),
              -cos(float(k) * 1.7)
            ));
            float along = dot(d, sdir);
            float trail = smoothstep(0.92, 0.998, along) * fadeOut(0.15, 0.85, phase) * smoothstep(0.0, 0.12, phase);
            shoot += trail * (1.0 - abs(phase - 0.4) * 2.0);
          }
          shoot = clamp(shoot, 0.0, 1.5);

          // Palette: void → magenta nebula → violet core, more luminous.
          vec3 col = vec3(0.003, 0.002, 0.012);
          col = mix(col, vec3(0.07, 0.02, 0.2), neb * 0.95);
          col = mix(col, vec3(0.28, 0.06, 0.45), smoothstep(0.5, 1.0, neb) * 0.95);
          col = mix(col, vec3(0.55, 0.15, 0.75), smoothstep(0.78, 1.1, neb + ring * 0.35) * 0.65);
          col += vec3(0.3, 0.4, 0.95) * ring * 0.85;
          col += vec3(0.25, 0.85, 0.7) * ring * arm2 * 0.55;
          col += vec3(0.85, 0.55, 1.0) * fadeOut(0.15, 0.8, rad) * ring * 0.4;
          col += vec3(0.4, 0.25, 0.9) * ring2 * 0.55;
          col += vec3(0.2, 0.6, 0.9) * ring2 * armB * 0.35;
          col += aurCol * band * 0.62;
          col += vec3(0.7, 0.85, 1.0) * ray * 0.55;
          col += vec3(1.0, 0.92, 0.85) * shoot * 1.4;

          // Star field denser + more luminous beacons.
          float dust = starLayer(d, 300.0, 0.88, 0.2, uTime * 0.7);
          float mid = starLayer(d + 11.3, 150.0, 0.93, 0.24, uTime);
          float big = starLayer(d + 5.7, 48.0, 0.97, 0.32, uTime * 0.6);
          float huge = starLayer(d + 19.0, 22.0, 0.985, 0.38, uTime * 0.4);
          float bigHue = hash(floor((d + 5.7) * 48.0) + 13.1);
          vec3 bigCol = mix(vec3(0.75, 0.9, 1.0), vec3(1.0, 0.8, 0.65), step(0.65, bigHue));
          bigCol = mix(bigCol, vec3(0.75, 0.55, 1.0), step(0.88, bigHue));
          col += vec3(0.85, 0.9, 1.0) * dust * 0.42;
          col += vec3(0.92, 0.96, 1.0) * mid * (0.6 + neb * 0.55);
          col += bigCol * big * 1.35;
          col += vec3(0.9, 0.75, 1.0) * huge * 1.6;

          // Soft purple haze toward zenith (void glow).
          col += vec3(0.12, 0.05, 0.22) * smoothstep(0.2, 0.95, d.y) * 0.25;

          // Blue-noise dither against banding.
          col += (hash(d * 337.7) - 0.5) * 0.014;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.materials.push(mat);
    this.timed.push(mat);
    const dome = new THREE.Mesh(geo, mat);
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    this.group.add(dome);
  }

  // ----------------------------------------------------------------- falls
  /** Additive scrolling-water curtain material. */
  private makeFallMat(intensity: number): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uBoost: { value: intensity } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uBoost;
        varying vec2 vUv;
        ${EtherealSky.NOISE}
        void main() {
          vec2 uv = vUv;
          float rise = uTime * 0.55;

          // Gentle sideways shimmer so the streaks snake instead of ruling
          // straight lines up the curtain.
          uv.x += (fbm(vec3(uv.x * 3.5, (uv.y - rise * 0.3) * 1.4, 15.7)) - 0.5) * 0.05;

          // Three flow layers scrolling UPWARD at different speeds — broad
          // billows, main streaks, fine filigree — for real parallax depth.
          float billow = fbm(vec3(uv.x * 3.2, (uv.y - rise * 0.55) * 1.1, 12.3));
          float streak = fbm(vec3(uv.x * 9.0, (uv.y - rise) * 2.2, 3.1));
          float fine = fbm(vec3(uv.x * 22.0, (uv.y - rise * 1.5) * 5.0, 8.4));
          float water = billow * 0.35 + streak * 0.6 + fine * 0.45;

          // Curtain shape: bright core, soft ragged side edges.
          float edge = smoothstep(0.0, 0.16, uv.x) * fadeOut(0.84, 1.0, uv.x);
          edge *= 0.75 + 0.25 * fbm(vec3(uv.x * 5.0, uv.y * 3.0 - rise * 0.4, 6.2));
          // Stay dense almost all the way down (the plane's bottom is hidden
          // below the horizon), only soften the top lip into the vortex.
          float vert = fadeOut(0.94, 1.0, uv.y) * smoothstep(0.0, 0.06, uv.y);

          float a = water * edge * vert;
          a = smoothstep(0.18, 0.9, a);

          // Aurora water: the hue slides green -> teal -> violet up the
          // curtain and through time, with a starlit white core.
          float hueT = uv.y * 2.4 + uTime * 0.22;
          vec3 col = mix(vec3(0.1, 0.72, 0.42), vec3(0.18, 0.55, 0.85), 0.5 + 0.5 * sin(hueT));
          col = mix(col, vec3(0.55, 0.25, 0.85), 0.55 + 0.45 * sin(hueT * 0.7 + 2.1));
          col = mix(col, vec3(0.8, 0.85, 0.95), water * 0.45);
          col = mix(vec3(0.3, 0.18, 0.65), col, edge);
          // Luminous central column: the heart of the flow glows white-blue.
          float core = fadeOut(0.14, 0.5, abs(uv.x - 0.5));
          col += vec3(0.45, 0.55, 0.8) * core * water * 0.4;
          a += core * water * 0.12;
          // Sparkle motes riding the upward flow.
          float mote = smoothstep(0.995, 1.0, hash(floor(vec3(uv.x * 60.0, (uv.y - rise) * 90.0, 2.0))));
          col += vec3(1.0) * mote * 0.8;

          gl_FragColor = vec4(col * uBoost, a * uBoost);
        }
      `,
    });
    this.materials.push(mat);
    this.timed.push(mat);
    return mat;
  }

  private buildFalls(): void {
    // Main curtain: lifts off the world's edge behind the woods and flows
    // UP past the treeline into the vortex overhead (screen-forward, -Z).
    // Wider + taller for a more cosmic scale read from the camp overlook.
    const main = new THREE.PlaneGeometry(28, 110);
    this.geometries.push(main);
    const mainMesh = new THREE.Mesh(main, this.makeFallMat(1.2));
    mainMesh.position.set(0, -8, -78);
    mainMesh.renderOrder = -90;
    this.group.add(mainMesh);

    // Side falls off neighbouring shards — same trick, bottoms sunk well
    // below the horizon line.
    const side = new THREE.PlaneGeometry(9, 72);
    this.geometries.push(side);
    for (const [x, y, z, rot, boost] of [
      [-32, -5, -86, 0.22, 0.9],
      [28, -2, -90, -0.18, 0.85],
      [-18, 2, -100, 0.12, 0.55],
      [16, 4, -102, -0.1, 0.5],
    ] as const) {
      const m = new THREE.Mesh(side, this.makeFallMat(boost));
      m.position.set(x, y, z);
      m.rotation.y = rot;
      m.renderOrder = -90;
      this.group.add(m);
    }

    // Cosmic vortex at the TOP of the falls: the spinning mouth of the
    // universe the upward-flowing water pours into. Additive swirl disc
    // facing the camera, spun in update().
    const disc = new THREE.CircleGeometry(20, 48);
    this.geometries.push(disc);
    const vortexMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        ${EtherealSky.NOISE}
        void main() {
          float r = length(vUv);
          float ang = atan(vUv.y, vUv.x);
          // Spiral arms wound tighter and spun harder — water winds INTO the
          // core, so the swirl phase pulls inward over time.
          float swirl = fbm(vec3(ang * 3.0 + r * 7.5 - uTime * 1.1, r * 5.0 + uTime * 0.4, 4.7));
          float swirl2 = fbm(vec3(ang * 1.7 - r * 5.0 + uTime * 0.6, r * 3.0 - uTime * 0.25, 9.3));
          float swirl3 = fbm(vec3(ang * 5.0 + r * 12.0 - uTime * 1.4, r * 8.0, 2.1));
          float body = fadeOut(0.08, 1.0, r) * (0.28 + 0.48 * swirl + 0.35 * swirl2 + 0.22 * swirl3);
          float core = fadeOut(0.0, 0.4, r);
          // Hotter cosmic core: white-magenta heart, teal arms, violet accretion rim.
          vec3 col = mix(vec3(0.1, 0.75, 0.55), vec3(0.95, 0.85, 1.0), core + swirl * 0.35);
          col = mix(col, vec3(0.25, 0.55, 0.95), swirl2 * fadeOut(0.15, 0.75, r) * 0.75);
          col += vec3(0.65, 0.2, 0.95) * smoothstep(0.45, 0.98, r) * swirl * 0.95;
          col += vec3(1.0, 0.7, 0.9) * core * core * 0.8;
          // Accretion sparks.
          float spark = smoothstep(0.992, 1.0, hash(floor(vec3(ang * 20.0, r * 30.0 - uTime * 2.0, 4.0))));
          col += vec3(1.0) * spark * fadeOut(0.2, 0.9, r);
          gl_FragColor = vec4(col, body * 0.95);
        }
      `,
    });
    this.materials.push(vortexMat);
    this.timed.push(vortexMat);
    const vortex = new THREE.Mesh(disc, vortexMat);
    vortex.rotation.x = 0.3; // top tipped away, facing down at the lobby
    vortex.position.set(0, 38, -84);
    vortex.renderOrder = -95;
    this.vortex = vortex;
    this.group.add(vortex);

    // Outer accretion halo (slower, larger, more violet).
    const halo = new THREE.CircleGeometry(28, 48);
    this.geometries.push(halo);
    const haloMesh = new THREE.Mesh(
      halo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          ${EtherealSky.NOISE}
          void main() {
            float r = length(vUv);
            float ang = atan(vUv.y, vUv.x);
            float band = fadeOut(0.55, 1.0, r) * smoothstep(0.35, 0.7, r);
            float n = fbm(vec3(ang * 2.0 - uTime * 0.2, r * 4.0, 5.0));
            float a = band * (0.25 + 0.55 * n);
            vec3 col = mix(vec3(0.2, 0.4, 0.9), vec3(0.7, 0.25, 0.95), n);
            gl_FragColor = vec4(col, a * 0.55);
          }
        `,
      }),
    );
    this.materials.push(haloMesh.material as THREE.Material);
    this.timed.push(haloMesh.material as THREE.ShaderMaterial);
    haloMesh.rotation.x = 0.32;
    haloMesh.position.set(0, 38, -84.5);
    haloMesh.renderOrder = -96;
    this.group.add(haloMesh);
  }

  // ------------------------------------------------------------------ mist
  /** Soft aurora-tinted mist plume, billowing upward. */
  private makeMistMat(strength: number): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uBoost: { value: strength } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uBoost;
        varying vec2 vUv;
        ${EtherealSky.NOISE}
        void main() {
          vec2 uv = vUv;
          float drift = uTime * 0.09;
          // Two billow layers rising at different speeds.
          float m1 = fbm(vec3(uv.x * 3.0, uv.y * 2.0 - drift * 2.6, drift * 0.7));
          float m2 = fbm(vec3(uv.x * 6.5 + 4.2, uv.y * 4.0 - drift * 4.2, 9.1 + drift * 0.4));
          float mist = m1 * 0.7 + m2 * 0.45;
          // Puffy footprint: soft sides, dense base, wisping away above.
          float shape = smoothstep(0.0, 0.22, uv.x) * fadeOut(0.78, 1.0, uv.x)
                      * smoothstep(0.0, 0.12, uv.y) * fadeOut(0.45, 1.0, uv.y);
          float a = smoothstep(0.35, 0.95, mist) * shape;
          // Darker aurora tint: muted teal shading into deep violet crests.
          vec3 col = mix(vec3(0.12, 0.6, 0.45), vec3(0.28, 0.38, 0.8),
                         fbm(vec3(uv * 2.0, drift + 3.3)));
          col = mix(col, vec3(0.55, 0.3, 0.8), smoothstep(0.62, 1.0, mist));
          gl_FragColor = vec4(col * uBoost, a * 0.55 * uBoost);
        }
      `,
    });
    this.materials.push(mat);
    this.timed.push(mat);
    return mat;
  }

  /** Rising mist plumes at the base of each fall, where the water lifts off. */
  private buildMists(): void {
    const mistGeo = new THREE.PlaneGeometry(34, 16);
    const sideGeo = new THREE.PlaneGeometry(14, 9);
    this.geometries.push(mistGeo, sideGeo);

    const main = new THREE.Mesh(mistGeo, this.makeMistMat(1.0));
    main.position.set(0, -14, -76);
    main.renderOrder = -88;
    this.group.add(main);

    for (const [x, y, z, rot] of [
      [-30, -3, -84, 0.22],
      [26, 0, -88, -0.18],
    ] as const) {
      const m = new THREE.Mesh(sideGeo, this.makeMistMat(0.7));
      m.position.set(x, y, z);
      m.rotation.y = rot;
      m.renderOrder = -88;
      this.group.add(m);
    }
  }

  // --------------------------------------------------------------- islands
  /** Dark floating-island cone silhouettes — instant placeholders shown until
   *  the real GLB drifters stream in (then removed). */
  private buildIslands(): void {
    const rockMat = new THREE.MeshBasicMaterial({ color: 0x0b0d1c, fog: false });
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x6f4fd0,
      fog: false,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(rockMat, rimMat);

    const top = new THREE.ConeGeometry(1, 0.5, 7);
    const bottom = new THREE.ConeGeometry(0.85, 1.6, 7);
    this.geometries.push(top, bottom);

    const placements: Array<[number, number, number, number]> = [
      [-34, 8, -98, 6],
      [26, 14, -104, 5.5],
      [48, 4, -88, 4],
    ];
    const silhouettes = new THREE.Group();
    for (const [x, y, z, s] of placements) {
      const isle = new THREE.Group();
      const cap = new THREE.Mesh(top, rimMat);
      cap.position.y = 0.26;
      const rock = new THREE.Mesh(bottom, rockMat);
      rock.rotation.x = Math.PI;
      rock.position.y = -0.55;
      isle.add(cap, rock);
      isle.position.set(x, y, z);
      isle.scale.setScalar(s);
      isle.rotation.y = x * 0.3;
      silhouettes.add(isle);
    }
    this.silhouettes = silhouettes;
    this.group.add(silhouettes);
  }

  /** Swap the cone stand-ins for the real drifting-island GLBs. */
  private async loadDriftIslands(): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const [a, b] = await Promise.all([
        loader.loadAsync(asset("models/lobby/island-drift-a.glb")),
        loader.loadAsync(asset("models/lobby/island-drift-b.glb")),
      ]);
      if (this.disposed) {
        disposeGlbDeep(a.scene);
        disposeGlbDeep(b.scene);
        return;
      }

      // Normalize each source to ~1 world unit across so drifter scales are
      // absolute sizes, and keep sources around for cloning + disposal.
      for (const gltf of [a, b]) {
        const src = gltf.scene;
        const box = new THREE.Box3().setFromObject(src);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const norm = 1 / Math.max(size.x, size.y, size.z, 1e-4);
        src.scale.setScalar(norm);
        src.position.set(-center.x * norm, -center.y * norm, -center.z * norm);
        const wrap = new THREE.Group();
        wrap.add(src);
        this.drifterSources.push(wrap);
      }

      // Just two wanderers, staggered along the crossing — rare visitors,
      // not a fleet. Long random pauses between trips keep them sparse.
      const seeds: Array<{ src: number; frac: number }> = [
        { src: 0, frac: 0.4 },
        { src: 1, frac: 0 },
      ];
      for (const seed of seeds) {
        const root = this.drifterSources[seed.src].clone(true);
        const mats: THREE.Material[] = [];
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          // clone(true) shares materials — clone per drifter for the fade.
          const cloned = (Array.isArray(m.material) ? m.material : [m.material]).map(
            (mm) => {
              const c = mm.clone() as THREE.MeshStandardMaterial;
              c.fog = false;
              c.transparent = true;
              // Faint violet self-glow so the rock reads against the nebula.
              c.emissive?.set(0x161030);
              mats.push(c);
              return c;
            },
          );
          m.material = Array.isArray(m.material) ? cloned : cloned[0];
        });
        const drifter: Drifter = {
          root,
          mats,
          from: new THREE.Vector3(),
          to: new THREE.Vector3(),
          dur: 1,
          age: 0,
          delay: 0,
          baseScale: 1,
          bobPhase: Math.random() * Math.PI * 2,
          spinSpeed: (Math.random() - 0.5) * 0.05,
        };
        this.respawnDrifter(drifter, seed.frac);
        this.drifters.push(drifter);
        this.group.add(root);
      }

      // Real islands are in — drop the cone stand-ins.
      if (this.silhouettes) {
        this.group.remove(this.silhouettes);
        this.silhouettes = null;
      }
    } catch (err) {
      console.error("[EtherealSky] drift island load failed", err);
    }
  }

  /** (Re)seed a drifter's journey: it emerges from deep BELOW the player's
   *  island, rises as it drifts back, and ends at the falls where it
   *  dissolves. `frac` (0–1) fast-forwards the initial trip; respawns after
   *  a trip wait out a shortish random pause before the next sighting. */
  private respawnDrifter(d: Drifter, frac = 0): void {
    // Pick a lane for this trip — the island emerges from screen-left,
    // centre, or screen-right under the terrain, then converges on the falls.
    const lane = Math.floor(Math.random() * 3) - 1; // -1 left, 0 middle, 1 right
    // Start: under our island, offset into the chosen lane.
    d.from.set(
      lane * 28 + (Math.random() - 0.5) * 14,
      -34 - Math.random() * 10,
      -6 - Math.random() * 20,
    );
    // End: at the base of the falls, keeping a hint of the lane's side.
    d.to.set(
      lane * 9 + (Math.random() - 0.5) * 12,
      12 + Math.random() * 14,
      -80 - Math.random() * 10,
    );
    d.dur = 70 + Math.random() * 40;
    d.age = frac * d.dur;
    d.delay = frac > 0 ? 0 : 25 + Math.random() * 40;
    d.baseScale = 9 + Math.random() * 8;
    d.root.position.copy(d.from);
    d.root.rotation.y = Math.random() * Math.PI * 2;
    d.root.scale.setScalar(d.baseScale);
    for (const m of d.mats) m.opacity = 0;
  }

  // ---------------------------------------------------------------- debris
  /** Shared glowing-shard pool: islands entering the break zone shed motes
   *  that stream up the fall into the vortex. */
  private buildDebris(): void {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(DEBRIS_COUNT * 3);
    pos.fill(-9999);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.geometries.push(geo);
    const mat = new THREE.PointsMaterial({
      color: 0xb99cf5,
      size: 0.8,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.materials.push(mat);
    this.debris = new THREE.Points(geo, mat);
    this.debris.frustumCulled = false;
    this.debrisVel = new Float32Array(DEBRIS_COUNT * 3);
    this.debrisLife = new Float32Array(DEBRIS_COUNT); // 0 = dead
    this.group.add(this.debris);
  }

  /** Spawn one debris shard at a world position (no-op when pool is full). */
  private spawnDebris(p: THREE.Vector3, spread: number): void {
    const life = this.debrisLife;
    const vel = this.debrisVel;
    const points = this.debris;
    if (!life || !vel || !points) return;
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      if (life[i] > 0) continue;
      life[i] = 3.5 + Math.random() * 3;
      const attr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
      attr.setXYZ(
        i,
        p.x + (Math.random() - 0.5) * spread,
        p.y + (Math.random() - 0.5) * spread * 0.6,
        p.z + (Math.random() - 0.5) * spread * 0.5,
      );
      vel[i * 3] = (Math.random() - 0.5) * 1.5;
      vel[i * 3 + 1] = 1 + Math.random() * 2;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
      return;
    }
  }

  // ------------------------------------------------------------------ tick
  update(t: number): void {
    const dt = Math.min(Math.max(t - this.lastT, 0), 0.1);
    this.lastT = t;
    for (const m of this.timed) m.uniforms.uTime.value = t;
    if (this.vortex) this.vortex.rotation.z = t * 0.16;

    // Drifting islands: rise from under the player's island, drift back to
    // the falls, shed debris + dissolve into the curtain, then wait out a
    // long pause before the next trip.
    for (const d of this.drifters) {
      if (d.delay > 0) {
        d.delay -= dt;
        continue;
      }
      // Rare sightings: only one island travels at a time. If another is
      // mid-trip, hold this one back a little longer before it sets off.
      if (
        d.age === 0 &&
        this.drifters.some((o) => o !== d && o.delay <= 0 && o.age > 0 && o.age < o.dur)
      ) {
        d.delay = 8 + Math.random() * 12;
        continue;
      }
      d.age += dt;
      const s = Math.min(d.age / d.dur, 1);
      // Ease the climb so the island lingers low early and settles at the top.
      const rise = s * s * (3 - 2 * s);
      const p = d.root.position;
      p.x = d.from.x + (d.to.x - d.from.x) * s;
      p.y = d.from.y + (d.to.y - d.from.y) * rise + Math.sin(t * 0.25 + d.bobPhase) * 0.8;
      p.z = d.from.z + (d.to.z - d.from.z) * s;
      d.root.rotation.y += d.spinSpeed * dt;

      // Fade in over the first stretch (it clears the terrain's underside),
      // dissolve over the last stretch as it merges into the falls.
      const fadeIn = Math.min(s / 0.12, 1);
      const dissolve = Math.min(Math.max((s - 0.78) / 0.22, 0), 1);
      for (const m of d.mats) m.opacity = fadeIn * (1 - dissolve);
      d.root.scale.setScalar(d.baseScale * (1 - dissolve * 0.45));
      // Shed harder the deeper it sits in the dissolve zone.
      if (dissolve > 0 && Math.random() < dt * (2 + dissolve * 14)) {
        this.spawnDebris(p, d.baseScale * 0.7);
      }
      if (s >= 1) this.respawnDrifter(d);
    }

    // Debris shards: swirl up the fall into the vortex mouth.
    const life = this.debrisLife;
    const vel = this.debrisVel;
    if (life && vel && this.debris) {
      const attr = this.debris.geometry.getAttribute("position") as THREE.BufferAttribute;
      let dirty = false;
      for (let i = 0; i < DEBRIS_COUNT; i++) {
        if (life[i] <= 0) continue;
        dirty = true;
        life[i] -= dt;
        const x = attr.getX(i);
        const y = attr.getY(i);
        const z = attr.getZ(i);
        // Pull toward the vortex + a light spiral around its axis.
        const dx = VORTEX.x - x;
        const dy = VORTEX.y - y;
        const dz = VORTEX.z - z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const pull = 6 / dist + 0.9;
        vel[i * 3] += (dx / dist) * pull * dt * 4 - dz * 0.002;
        vel[i * 3 + 1] += (dy / dist) * pull * dt * 4;
        vel[i * 3 + 2] += (dz / dist) * pull * dt * 4 + dx * 0.002;
        if (life[i] <= 0 || dist < 4) {
          life[i] = 0;
          attr.setXYZ(i, -9999, -9999, -9999);
          continue;
        }
        attr.setXYZ(i, x + vel[i * 3] * dt, y + vel[i * 3 + 1] * dt, z + vel[i * 3 + 2] * dt);
      }
      if (dirty) attr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    // GLB drifters: per-instance cloned materials + shared source geometry
    // and textures (clones share geometry with their source).
    for (const d of this.drifters) {
      for (const m of d.mats) m.dispose();
    }
    for (const src of this.drifterSources) disposeGlbDeep(src);
  }
}
