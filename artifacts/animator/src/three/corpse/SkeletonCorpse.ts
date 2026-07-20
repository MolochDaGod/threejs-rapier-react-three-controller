/**
 * Skeleton corpse residuals from Skeletons_Free pack.
 *
 * After a creature/character is dead for CORPSE_TO_SKELETON_S (2 min) OR
 * immediately after being skinned/looted, the flesh mesh is swapped for a
 * lying skeleton prop. The skeleton lingers SKELETON_LINGER_S then despawns.
 *
 * Assets (public):
 *   models/skeletons/Skeleton.glb | Skeleton.fbx
 *   models/skeletons/Skeleton_Archer.glb | Skeleton_Archer.fbx
 *   models/skeletons/Texture.png
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { asset } from "../assets";

/** Seconds a full corpse remains before becoming a skeleton (if not looted). */
export const CORPSE_TO_SKELETON_S = 120;
/** Seconds the skeleton residual remains before despawn. */
export const SKELETON_LINGER_S = 90;

export type SkeletonVariant = "humanoid" | "archer";

const MODEL_PATHS: Record<SkeletonVariant, { glb: string; fbx: string }> = {
  humanoid: {
    glb: "models/skeletons/Skeleton.glb",
    fbx: "models/skeletons/Skeleton.fbx",
  },
  archer: {
    glb: "models/skeletons/Skeleton_Archer.glb",
    fbx: "models/skeletons/Skeleton_Archer.fbx",
  },
};

const templateCache = new Map<SkeletonVariant, THREE.Object3D>();
const loadPromises = new Map<SkeletonVariant, Promise<THREE.Object3D | null>>();

function prepareTemplate(root: THREE.Object3D, targetHeight = 1.55): THREE.Object3D {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;
    if (size.y > 1e-3) root.scale.multiplyScalar(targetHeight / size.y);
  }
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (!mat) continue;
      // Bone ivory tone if flat/untextured
      if ((mat as THREE.MeshStandardMaterial).color) {
        const sm = mat as THREE.MeshStandardMaterial;
        if (!sm.map) sm.color.setHex(0xe8e0d4);
        if (sm.roughness != null) sm.roughness = 0.78;
        if (sm.metalness != null) sm.metalness = 0.04;
      }
    }
  });
  return root;
}

async function loadVariant(variant: SkeletonVariant): Promise<THREE.Object3D | null> {
  const hit = templateCache.get(variant);
  if (hit) return hit;
  const inflight = loadPromises.get(variant);
  if (inflight) return inflight;

  const paths = MODEL_PATHS[variant];
  const p = (async () => {
    // Prefer GLB, fall back to FBX from the free pack.
    try {
      const gltf = await new GLTFLoader().loadAsync(asset(paths.glb));
      const tpl = prepareTemplate(gltf.scene);
      templateCache.set(variant, tpl);
      return tpl;
    } catch {
      /* try FBX */
    }
    try {
      const fbx = await new FBXLoader().loadAsync(asset(paths.fbx));
      const tpl = prepareTemplate(fbx);
      templateCache.set(variant, tpl);
      return tpl;
    } catch (err) {
      console.warn(`[SkeletonCorpse] failed to load ${variant}`, err);
      return null;
    }
  })();
  loadPromises.set(variant, p);
  return p;
}

/**
 * Clone a lying skeleton at world position. Scale is multiplied on top of the
 * normalized ~1.55 m humanoid (use 0.4–0.8 for small animals).
 */
export async function createSkeletonCorpse(opts: {
  position: THREE.Vector3;
  yaw?: number;
  scale?: number;
  variant?: SkeletonVariant;
  /** Tip on side (default true) so it reads as a body, not a standing NPC. */
  lieDown?: boolean;
}): Promise<THREE.Group | null> {
  const variant = opts.variant ?? "humanoid";
  const tpl = await loadVariant(variant);
  if (!tpl) return null;

  const root = new THREE.Group();
  root.name = `skeleton_corpse_${variant}`;
  const clone = tpl.clone(true);
  clone.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material)) m.material = m.material.map((x) => x.clone());
    else if (m.material) m.material = (m.material as THREE.Material).clone();
  });

  const s = opts.scale ?? 1;
  clone.scale.multiplyScalar(s);
  if (opts.lieDown !== false) {
    // Lie on side: pitch ~90° so the prop rests on the ground.
    clone.rotation.z = Math.PI / 2;
  }
  root.add(clone);
  root.position.copy(opts.position);
  if (opts.yaw != null) root.rotation.y = opts.yaw;
  root.userData.skeletonCorpse = true;
  root.userData.variant = variant;
  return root;
}

/** Prefetch both variants so death swaps are instant. */
export function preloadSkeletonCorpses(): void {
  void loadVariant("humanoid");
  void loadVariant("archer");
}

/**
 * Pick a scale for an animal/creature from its approximate body height in metres.
 * Humanoids ≈ 1.0; deer ≈ 0.7; beetles ≈ 0.25.
 */
export function skeletonScaleForBodyHeight(heightM: number): number {
  const h = Math.max(0.15, Math.min(2.5, heightM));
  return Math.max(0.2, Math.min(1.2, h / 1.55));
}
