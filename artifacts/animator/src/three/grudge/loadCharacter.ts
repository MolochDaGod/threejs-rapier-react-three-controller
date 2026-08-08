import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetLoadError, resolveAssetUrl } from "./assetBase";
import { powerOfTenScale, unifySkeletons } from "./skeleton";

/** SI human yardstick — grudge-world-scale / character-correctness. */
export const HUMAN_HEIGHT_M = 1.8;

export interface LoadedCharacter {
  /** Kit root: ~1.8 m tall, feet on y=0, art-forward +Z for Toon play. */
  group: THREE.Group;
  skeleton: THREE.Skeleton | null;
  mixer: THREE.AnimationMixer;
  meshNames: string[];
  /** true = Toon RTS / production GLB; false = author FBX path. */
  isToonPlay: boolean;
}

export interface WarlordsPlayContract {
  playSource: "toonRts";
  kitUrl: string;
  materialMode: "embedded" | "atlas-rebind" | "embedded-fallback" | "none";
  faceYaw: 0;
  heightTargetM: number;
  loader: "loadRaceKit-parity";
  stampedAt: string;
}

/** Stamp root.userData.warlordsPlayContract (parity with ObjectStore grudge6-kit). */
export function stampWarlordsPlayContract(
  root: THREE.Object3D,
  partial: Omit<WarlordsPlayContract, "stampedAt" | "loader" | "faceYaw" | "heightTargetM"> &
    Partial<Pick<WarlordsPlayContract, "faceYaw" | "heightTargetM">>,
): void {
  const contract: WarlordsPlayContract = {
    playSource: "toonRts",
    kitUrl: partial.kitUrl,
    materialMode: partial.materialMode,
    faceYaw: partial.faceYaw ?? 0,
    heightTargetM: partial.heightTargetM ?? HUMAN_HEIGHT_M,
    loader: "loadRaceKit-parity",
    stampedAt: new Date().toISOString(),
  };
  root.userData.warlordsPlayContract = contract;
  root.userData.grudge6MaterialMode = contract.materialMode;
}

/** True when embeds have a real texture map (not 1×1 stub). */
export function kitHasUsableMaps(root: THREE.Object3D): boolean {
  let ok = false;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const m of mats) {
      if (!m || !("map" in m) || !m.map) continue;
      const img = m.map.image as { width?: number; height?: number } | undefined;
      const w = img?.width ?? 0;
      const h = img?.height ?? 0;
      if (w > 4 && h > 4) ok = true;
    }
  });
  return ok;
}

/** sRGB normalize on embedded maps — never replace materials. */
export function normalizeEmbeddedMaps(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const m of mats) {
      if (!m || !("map" in m) || !m.map) continue;
      m.map.colorSpace = THREE.SRGBColorSpace;
      m.map.needsUpdate = true;
      n++;
      if ("metalness" in m && typeof (m as THREE.MeshStandardMaterial).metalness === "number") {
        // Keep bake; slight roughness so DR key light doesn't chrome
        const std = m as THREE.MeshStandardMaterial;
        if (std.roughness < 0.2) std.roughness = 0.55;
      }
    }
    node.castShadow = true;
    node.receiveShadow = true;
  });
  return n;
}

function bodyBox(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  let any = false;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh) || !o.visible) return;
    if (!any) {
      box.setFromObject(o);
      any = true;
    } else {
      box.expandByObject(o);
    }
  });
  if (!any) box.setFromObject(root);
  return box;
}

function collectMeshNames(root: THREE.Object3D): string[] {
  const meshNames: string[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh || child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.name) meshNames.push(child.name);
    }
  });
  return meshNames;
}

/**
 * Load GOLDEN Toon RTS GLB (or legacy FBX if URL ends in .fbx).
 * Toon path: embeds kept, yaw 0 (+Z art-forward), SI fit ~1.8 m, feet on y=0.
 * FBX path: unify skeletons, +π/2 art-forward, atlas rebind expected by caller.
 */
export function loadCharacterModel(modelUrl: string): Promise<LoadedCharacter> {
  const url = resolveAssetUrl(modelUrl);
  const isFbx = /\.fbx($|\?)/i.test(url);

  if (isFbx) {
    return new Promise((resolve, reject) => {
      new FBXLoader().load(
        url,
        (fbx) => {
          try {
            const meshNames = collectMeshNames(fbx);
            const skeleton = normalizeAuthorFbxGroup(fbx);
            const mixer = new THREE.AnimationMixer(fbx);
            resolve({ group: fbx, skeleton, mixer, meshNames, isToonPlay: false });
          } catch (err) {
            reject(err);
          }
        },
        undefined,
        (err) => reject(assetLoadError(url, err)),
      );
    });
  }

  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        try {
          const scene = gltf.scene;
          // Wrap in Group so callers can treat as FBX-like Group root
          const group = new THREE.Group();
          group.name = "toonRtsKit";
          group.add(scene);
          const meshNames = collectMeshNames(group);
          const skeleton = normalizeToonPlayGroup(group);
          normalizeEmbeddedMaps(group);
          stampWarlordsPlayContract(group, {
            playSource: "toonRts",
            kitUrl: url,
            materialMode: kitHasUsableMaps(group) ? "embedded" : "none",
          });
          const mixer = new THREE.AnimationMixer(group);
          resolve({ group, skeleton, mixer, meshNames, isToonPlay: true });
        } catch (err) {
          reject(err);
        }
      },
      undefined,
      (err) => reject(assetLoadError(url, err)),
    );
  });
}

/**
 * Toon RTS play normalize — grudge6-kit loadRaceKit parity:
 * unify skeletons → yaw 0 → uniform SI fit 1.8 m → feet on y=0 → center XZ.
 * NEVER apply π/2 (that is FBX +X art only).
 */
export function normalizeToonPlayGroup(root: THREE.Object3D): THREE.Skeleton | null {
  const skeleton = unifySkeletons(root);

  root.rotation.set(0, 0, 0);
  root.position.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);

  let box = bodyBox(root);
  let h = Math.max(box.max.y - box.min.y, 1e-4);

  // Classic 100× (cm as m) — decade fix on root only
  if (h > 40) {
    root.scale.setScalar(0.01);
    root.updateMatrixWorld(true);
    box = bodyBox(root);
    h = Math.max(box.max.y - box.min.y, 1e-4);
  }

  const s = HUMAN_HEIGHT_M / h;
  root.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  box = bodyBox(root);

  // Feet = structural min.y — never pelvis
  root.position.y -= box.min.y;
  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  root.position.x -= cx;
  root.position.z -= cz;
  root.updateMatrixWorld(true);

  // Re-ground after XZ center (bbox can shift slightly)
  box = bodyBox(root);
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);

  root.userData.grudge6FaceYaw = 0;
  root.userData.playSource = "toonRts";
  return skeleton;
}

/**
 * Author FBX normalize (lab/compare only — not play default).
 * unifySkeletons → face +Z via π/2 → unit fix → fit ~1.8 m → feet y=0.
 */
export function normalizeAuthorFbxGroup(fbx: THREE.Object3D): THREE.Skeleton | null {
  const skeleton = unifySkeletons(fbx);

  // FBX Toon author often faces +X → one π/2 to local +Z
  fbx.rotation.y = Math.PI / 2;
  fbx.updateWorldMatrix(true, true);

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

  let box = bodyBox(fbx);
  let h = Math.max(box.max.y - box.min.y, 1e-4);
  if (h > 40) {
    fbx.scale.multiplyScalar(0.01);
    fbx.updateWorldMatrix(true, true);
    box = bodyBox(fbx);
    h = Math.max(box.max.y - box.min.y, 1e-4);
  }
  fbx.scale.multiplyScalar(HUMAN_HEIGHT_M / h);
  fbx.updateWorldMatrix(true, true);
  box = bodyBox(fbx);
  fbx.position.y -= box.min.y;
  fbx.position.x -= (box.min.x + box.max.x) * 0.5;
  fbx.position.z -= (box.min.z + box.max.z) * 0.5;
  fbx.updateWorldMatrix(true, true);
  box = bodyBox(fbx);
  fbx.position.y -= box.min.y;

  fbx.userData.grudge6FaceYaw = Math.PI / 2;
  fbx.userData.playSource = "fbx-author";
  return skeleton;
}

/** @deprecated use normalizeToonPlayGroup / normalizeAuthorFbxGroup */
export function normalizeCharacterGroup(fbx: THREE.Object3D): THREE.Skeleton | null {
  // Legacy callers: detect by userData or assume FBX author path
  if (fbx.userData.playSource === "toonRts") return normalizeToonPlayGroup(fbx);
  return normalizeAuthorFbxGroup(fbx);
}

// Show only the preset's meshes (armour + weapon) with fuzzy meshKey matching
// (D1 ids often omit Units_ / change case vs FBX names).
export function applyGearPreset(group: THREE.Object3D, visibleMeshes: string[]): void {
  const meshKey = (name: string) =>
    String(name || "")
      .toLowerCase()
      .replace(/^wk_|^brb_|^orc_|^elf_|^ud_|^dwf_/, "")
      .replace(/units_/g, "")
      .replace(/xtra_/g, "")
      .replace(/weapon_/g, "weapon")
      .replace(/[^a-z0-9]/g, "");
  const want = visibleMeshes.map(meshKey).filter(Boolean);
  const isEquip = (n: string) =>
    /body|arms|legs|head|shoulder|weapon|shield|sword|axe|bow|staff|quiver|bag|helm|armor|xtra/i.test(
      n,
    );
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh)) return;
    if (!node.name || !isEquip(node.name)) return;
    const k = meshKey(node.name);
    let show = false;
    for (const w of want) {
      if (k === w || k.endsWith(w) || w.endsWith(k) || k.includes(w) || w.includes(k)) {
        show = true;
        break;
      }
    }
    node.visible = show;
  });
}

// Apply the shared body-atlas texture — FBX / broken-embed ONLY.
// Do not call on good Toon RTS embeds (destroys polyart bake).
export function applyBodyTexture(group: THREE.Object3D, texture: THREE.Texture): THREE.Material {
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    metalness: 0,
    roughness: 0.72,
    envMapIntensity: 0,
  });
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
  }
  group.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) {
      node.material = material;
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return material;
}
