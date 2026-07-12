import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { assetLoadError, resolveAssetUrl } from "./assetBase";
import { powerOfTenScale, unifySkeletons } from "./skeleton";

export interface LoadedCharacter {
  /** Auto-fit FBX group: ~2 units tall, feet on y=0, facing +Z. */
  group: THREE.Group;
  skeleton: THREE.Skeleton | null;
  mixer: THREE.AnimationMixer;
  meshNames: string[];
}

// Load + normalize a customizable race FBX:
//   FBXLoader -> unifySkeletons -> face +Z -> per-mesh power-of-ten unit
//   normalization (over NON-skinned meshes) -> auto-fit bbox computed over
//   SkinnedMesh body parts ONLY -> scale to ~2 units -> sit feet on y=0.
export function loadCharacterModel(modelUrl: string): Promise<LoadedCharacter> {
  const url = resolveAssetUrl(modelUrl);
  return new Promise((resolve, reject) => {
    new FBXLoader().load(
      url,
      (fbx) => {
        try {
          const meshNames: string[] = [];
          fbx.traverse((child) => {
            if (child instanceof THREE.SkinnedMesh || child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              if (child.name) meshNames.push(child.name);
            }
          });

          const skeleton = normalizeCharacterGroup(fbx);
          const mixer = new THREE.AnimationMixer(fbx);
          resolve({ group: fbx, skeleton, mixer, meshNames });
        } catch (err) {
          reject(err);
        }
      },
      undefined,
      (err) => reject(assetLoadError(url, err)),
    );
  });
}

// Normalize a freshly-parsed customizable race FBX in place. Steps:
//   unifySkeletons -> face +Z -> per-mesh power-of-ten unit normalization (over
//   NON-skinned meshes) -> auto-fit bbox over SkinnedMesh body parts ONLY ->
//   scale to ~2 units -> sit feet on y=0. Static off-origin gear meshes never
//   warp the scale. Returns the widest unified skeleton (or null).
export function normalizeCharacterGroup(fbx: THREE.Object3D): THREE.Skeleton | null {
  // Collapse the ~27 per-mesh disconnected skeletons onto ONE canonical chain so
  // animation clips actually deform every mesh.
  const skeleton = unifySkeletons(fbx);

  // Face +Z (toward the default camera) at zero facing-rotation.
  fbx.rotation.y = Math.PI / 2;
  fbx.updateWorldMatrix(true, true);

  // ── Per-mesh unit normalization (non-skinned meshes only) ──────────
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const effScaleOf = (node: THREE.Object3D): number => {
    node.matrixWorld.decompose(_p, _q, _s);
    return Math.max(Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z));
  };
  const skinnedEff: number[] = [];
  fbx.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) skinnedEff.push(effScaleOf(node));
  });
  skinnedEff.sort((a, b) => a - b);
  const refEff = skinnedEff.length > 0 ? skinnedEff[Math.floor(skinnedEff.length / 2)] : 1;
  let normalizedAny = false;
  fbx.traverse((node) => {
    if (node instanceof THREE.Mesh && !(node instanceof THREE.SkinnedMesh)) {
      const correction = powerOfTenScale(refEff, effScaleOf(node));
      if (correction !== 1) {
        node.scale.multiplyScalar(correction);
        normalizedAny = true;
      }
    }
  });
  if (normalizedAny) fbx.updateWorldMatrix(true, true);

  // ── Auto-fit (bbox over SkinnedMesh body parts only) ───────────────
  const bodyBox = new THREE.Box3();
  let bodyMeshCount = 0;
  fbx.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) {
      bodyBox.expandByObject(node);
      bodyMeshCount++;
    }
  });
  const box = bodyMeshCount > 0 ? bodyBox : new THREE.Box3().setFromObject(fbx);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) fbx.scale.setScalar(2 / maxDim);
  fbx.userData.bodyRawMax = maxDim;

  // Sit feet on y=0 — re-measure body-only after scaling.
  fbx.updateWorldMatrix(true, true);
  const bodyBox2 = new THREE.Box3();
  fbx.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) bodyBox2.expandByObject(node);
  });
  const box2 = bodyMeshCount > 0 ? bodyBox2 : new THREE.Box3().setFromObject(fbx);
  fbx.position.set(-center.x * fbx.scale.x, -box2.min.y, -center.z * fbx.scale.z);

  return skeleton;
}

// Show only the preset's meshes (armour + weapon). Every other mesh in the parts
// catalog is hidden.
export function applyGearPreset(group: THREE.Object3D, visibleMeshes: string[]): void {
  const want = new Set(visibleMeshes);
  group.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) {
      node.visible = want.has(node.name);
    }
  });
}

// Apply the shared body-atlas texture to every mesh as a flat-toon
// MeshLambertMaterial. One material instance is shared across all meshes —
// weapons use the same body atlas as the armour. Returns it so the owner can
// dispose it (the shared texture is owned separately).
export function applyBodyTexture(group: THREE.Object3D, texture: THREE.Texture): THREE.Material {
  const material = new THREE.MeshLambertMaterial({ map: texture, color: 0xffffff });
  group.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) {
      node.material = material;
    }
  });
  return material;
}
