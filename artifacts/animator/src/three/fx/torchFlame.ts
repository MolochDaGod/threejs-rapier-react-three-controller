/**
 * Dying-torch flame shader + torch factory.
 *
 * A procedural additive fire `ShaderMaterial` (layered value-noise fbm shaped
 * into a flickering teardrop) plus helpers to build a crossed-plane flame
 * billboard and a full torch (GLB model + flame + flickering point light).
 *
 * Flame time (`uTime`) is advanced by ONE module-owned rAF that ticks every
 * registered material, so torches animate in any scene — including cloned prop
 * instances that share a material — without the host loop needing to update it.
 */
import * as THREE from "three";
import { asset, assetCandidates, loadGltfFirst } from "../assets";
import { sharedGltfLoader } from "../loaders/gltf";

const flameMaterials = new Set<THREE.ShaderMaterial>();
let rafId = 0;

function ensureFlameLoop(): void {
  if (rafId || typeof requestAnimationFrame === "undefined") return;
  const loop = () => {
    const t = performance.now() / 1000;
    for (const m of flameMaterials) m.uniforms.uTime.value = t;
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLAME_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uDying;
  uniform vec3 uCore;
  uniform vec3 uMid;
  uniform vec3 uEdge;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    float y = uv.y;
    float x = uv.x - 0.5;
    // Turbulence rises with time; "dying" flames sputter faster.
    float t = uTime * (1.5 + 0.9 * uDying);
    float n = fbm(vec2(uv.x * 3.0, uv.y * 2.6 - t));
    // Teardrop: wide at the base, pinched at the tip, wobbled by noise.
    float width = mix(0.46, 0.05, y);
    float body = smoothstep(width, 0.0, abs(x) - (n - 0.5) * 0.18 * (1.0 - y));
    float flame = body * (0.55 + 0.7 * n);
    flame *= smoothstep(0.0, 0.10, y);   // base ramp-in
    flame *= smoothstep(1.0, 0.5, y);    // tip fade-out
    // Dying: shorten + sputter the upper flame.
    float sput = 0.85 + 0.15 * sin(uTime * 22.0) + 0.10 * (n - 0.5);
    flame *= mix(1.0, sput * (1.0 - 0.35 * y), uDying);
    flame = clamp(flame * uIntensity, 0.0, 1.0);

    vec3 col = mix(uEdge, uMid, smoothstep(0.12, 0.5, flame));
    col = mix(col, uCore, smoothstep(0.5, 0.92, flame));
    float alpha = smoothstep(0.02, 0.25, flame);
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(col * (0.8 + 0.6 * flame), alpha);
  }
`;

export interface FlameColors {
  core?: number;
  mid?: number;
  edge?: number;
}

/** A self-animating additive fire material. Register + start the shared clock. */
export function createFlameMaterial(colors: FlameColors = {}, dying = 0.5): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uDying: { value: dying },
      uCore: { value: new THREE.Color(colors.core ?? 0xfff1c0) },
      uMid: { value: new THREE.Color(colors.mid ?? 0xff8a1e) },
      uEdge: { value: new THREE.Color(colors.edge ?? 0xd23400) },
    },
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  flameMaterials.add(mat);
  ensureFlameLoop();
  return mat;
}

/** Crossed-plane flame billboard (reads from every angle), base pinned at Y=0. */
export function createFlameSprite(
  width: number,
  height: number,
  material: THREE.ShaderMaterial,
): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(width, height);
  geo.translate(0, height / 2, 0); // pivot at the flame base
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(geo, material);
    m.rotation.y = i * (Math.PI / 2);
    group.add(m);
  }
  return group;
}

export interface TorchOptions {
  modelUrl?: string;
  targetHeight?: number;
  dying?: number;
  colors?: FlameColors;
  lightColor?: number;
  lightIntensity?: number;
  flameScale?: number;
}

export interface TorchHandle {
  group: THREE.Group;
  flame: THREE.Group;
  light: THREE.PointLight;
  /** Optional per-frame light flicker for scenes that own their loop. */
  update(dt: number): void;
  dispose(): void;
}

const gltfLoader = sharedGltfLoader();
let modelCache: Promise<THREE.Group> | null = null;

/**
 * Prefer dying-torch, then lighter torch aliases. Each path tries same-origin
 * + open hosts before R2 (R2 gameopen bucket often 404s for props).
 */
const TORCH_MODEL_PATHS = [
  "models/props/dying-torch.glb",
  "models/props/torch.glb",
  "models/props/torch-burning.glb",
] as const;

function loadTorchModel(explicitUrl?: string): Promise<THREE.Group> {
  if (!modelCache) {
    modelCache = (async () => {
      try {
        if (explicitUrl) {
          // Still try candidates if explicit is a relative path
          if (!/^https?:\/\//i.test(explicitUrl)) {
            const { scene } = await loadGltfFirst(explicitUrl, gltfLoader);
            return scene as THREE.Group;
          }
          const g = await gltfLoader.loadAsync(explicitUrl);
          return g.scene;
        }
        const { scene, url } = await loadGltfFirst([...TORCH_MODEL_PATHS], gltfLoader);
        console.info("[torch] model loaded from", url);
        return scene as THREE.Group;
      } catch (err) {
        console.error(
          "[torch] model load failed for all candidates",
          TORCH_MODEL_PATHS.flatMap((p) => assetCandidates(p)).slice(0, 6),
          err,
        );
        modelCache = null;
        throw err;
      }
    })();
  }
  return modelCache.then((s) => s.clone(true));
}

/** Normalize a torch model to `targetHeight`, base at Y=0, centred on X/Z. */
function normalizeModel(model: THREE.Object3D, targetHeight: number): number {
  model.updateWorldMatrix(true, true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(targetHeight / (size.y || 1));
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  return box.max.y - box.min.y; // normalized height ≈ targetHeight
}

/**
 * Attach a flame billboard + warm point light to an already-normalized group
 * whose base sits at Y=0 and whose height is `height`. Used by the in-game prop
 * pipeline; the flame animates via the shared clock and survives cloning
 * (clones share the material). Light stays at a warm base intensity per clone.
 */
export function attachTorchFlame(
  group: THREE.Object3D,
  height: number,
  opts: TorchOptions = {},
): void {
  const flameMat = createFlameMaterial(opts.colors, opts.dying ?? 0.6);
  const s = opts.flameScale ?? 1;
  const flame = createFlameSprite(0.45 * s, 0.8 * s, flameMat);
  flame.position.y = height - 0.05;
  flame.name = "torchFlame";
  group.add(flame);

  const light = new THREE.PointLight(opts.lightColor ?? 0xff7b33, opts.lightIntensity ?? 4, 9, 2);
  light.position.set(0, height + 0.1, 0);
  light.name = "torchLight";
  group.add(light);
}

/** Build a full torch (GLB model + flame + flickering light) for owned scenes. */
export async function createTorch(opts: TorchOptions = {}): Promise<TorchHandle> {
  const group = new THREE.Group();
  const targetH = opts.targetHeight ?? 1.8;
  let tipY = targetH;

  try {
    // Never hard-point R2-only URLs — use candidate chain (same-origin first).
    const model = await loadTorchModel(opts.modelUrl);
    tipY = normalizeModel(model, targetH);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    group.add(model);
  } catch {
    // Fallback: a simple haft so the flame still reads if every GLB 404s.
    console.warn(
      "[torch] using procedural haft — place dying-torch.glb under public/models/props/",
      asset("models/props/dying-torch.glb"),
    );
    const haft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.06, targetH, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.9 }),
    );
    haft.position.y = targetH / 2;
    group.add(haft);
    tipY = targetH;
  }

  const flameMat = createFlameMaterial(opts.colors, opts.dying ?? 0.5);
  const s = opts.flameScale ?? 1;
  const flame = createFlameSprite(0.5 * s, 0.95 * s, flameMat);
  flame.position.y = tipY - 0.05;
  group.add(flame);

  const light = new THREE.PointLight(opts.lightColor ?? 0xff7b33, opts.lightIntensity ?? 6, 14, 2);
  light.position.set(0, tipY + 0.15, 0);
  group.add(light);

  const baseIntensity = light.intensity;
  let clock = 0;
  const update = (dt: number) => {
    clock += dt;
    const f =
      0.72 +
      0.18 * Math.sin(clock * 17.0) +
      0.12 * Math.sin(clock * 7.3 + 1.7) +
      0.06 * Math.sin(clock * 31.0);
    light.intensity = baseIntensity * f;
    flameMat.uniforms.uIntensity.value = 0.85 + 0.25 * f;
  };

  const dispose = () => {
    flameMaterials.delete(flameMat);
    flameMat.dispose();
    flame.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    group.clear();
  };

  return { group, flame, light, update, dispose };
}
