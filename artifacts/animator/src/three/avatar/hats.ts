/**
 * 3D GLB hats for the Avatar Edit cube heads.
 *
 * Two source files under `public/avatar/hats/`:
 * - `hat-pack.glb` — one Sketchfab pack holding seven named low-poly hats
 *   (Pirate / Cowboy / Witch / TopHat / Princess / Astronaut / Hood) sharing
 *   a single texture atlas. Loaded ONCE; each hat is a cloned subtree.
 * - `pirate-voxel.glb` — a tiny Minecraft-style voxel pirate hat.
 *
 * Templates are normalized into head-unit space (head = unit cube: centred in
 * X/Z, brim base at y = 0, scaled to a per-hat fit width) and cached forever.
 * Mounted hats are clones SHARING template geometry + materials — a mount's
 * dispose only detaches it and must never dispose shared resources.
 */
import * as THREE from "three";
import { assetUrl } from "../assetHost";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { HatId, PartAdjust } from "./catalog";

interface HatDef {
  /** Which source file the hat lives in. */
  src: "pack" | "voxel";
  /** Named subtree inside the pack (pack hats only). */
  node?: string;
  /** Target width (max of x/z extent) in head units. */
  fit: number;
  /** Vertical offset of the hat base relative to the head top (head units). */
  y: number;
  /** Extra yaw (radians) so the hat's front matches the face (+z). */
  rotY?: number;
}

const HAT_DEFS: Record<Exclude<HatId, "none">, HatDef> = {
  pirateVoxel: { src: "voxel", fit: 1.45, y: -0.1 },
  pirate: { src: "pack", node: "Pirate_low", fit: 1.5, y: -0.06 },
  cowboy: { src: "pack", node: "Cowboy_low", fit: 1.55, y: -0.05 },
  witch: { src: "pack", node: "Witch_low", fit: 1.45, y: -0.06 },
  tophat: { src: "pack", node: "TopHat_low", fit: 1.2, y: -0.03 },
  princess: { src: "pack", node: "Princess_low", fit: 0.85, y: -0.02 },
  // The astronaut node's authored rotation faces the visor along ±X (every
  // other pack hat faces ±Z) — spin it a quarter turn to face the face.
  astronaut: { src: "pack", node: "Astronaut_low", fit: 1.35, y: -0.45, rotY: Math.PI / 2 },
  hood: { src: "pack", node: "Hood_low", fit: 1.35, y: -0.55 },
};

function hatUrl(file: string): string {
  return assetUrl(`avatar/hats/${file}`);
}

const loader = new GLTFLoader();
let packScene: Promise<THREE.Group> | null = null;
let voxelScene: Promise<THREE.Group> | null = null;

function loadScene(url: string): Promise<THREE.Group> {
  return loader.loadAsync(url).then((gltf) => {
    gltf.scene.updateWorldMatrix(true, true);
    return gltf.scene;
  });
}

/** Normalized, cached template per hat id (shared geo/mats — never dispose). */
const templates = new Map<HatId, Promise<THREE.Group | null>>();

/**
 * Clone `source` with its full world transform baked onto the clone root, so
 * a subtree extracted from a deep Sketchfab hierarchy keeps its orientation.
 */
function cloneWithWorldTransform(source: THREE.Object3D): THREE.Object3D {
  const clone = source.clone(true);
  source.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
  return clone;
}

/** Wrap + normalize a raw hat subtree into head-unit space. */
function normalize(raw: THREE.Object3D, def: HatDef): THREE.Group {
  const wrap = new THREE.Group();
  // pivot applies the corrective yaw about world Y BEFORE the bbox is
  // measured, so fit/centre/base all account for the spun orientation
  const pivot = new THREE.Group();
  if (def.rotY) pivot.rotation.y = def.rotY;
  pivot.add(raw);
  wrap.add(pivot);
  wrap.updateWorldMatrix(true, true);

  const box = new THREE.Box3().setFromObject(wrap);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);
  const width = Math.max(size.x, size.z) || 1;
  const s = def.fit / width;
  pivot.scale.multiplyScalar(s);
  pivot.position.sub(centre.multiplyScalar(s));
  // base of the (scaled) bbox to y = 0
  pivot.position.y += (size.y * s) / 2;

  wrap.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    }
  });
  return wrap;
}

function loadTemplate(id: Exclude<HatId, "none">): Promise<THREE.Group | null> {
  const def = HAT_DEFS[id];
  if (def.src === "voxel") {
    voxelScene ??= loadScene(hatUrl("pirate-voxel.glb")).then((scene) => {
      // The voxel GLB's "Sketchfab_model" root carries a sloppy ~-82° tilted
      // quaternion (display pose) instead of the exact -90° X that would
      // cancel the inner Z-up→Y-up +90° X — snap it so the hat sits upright.
      const root = scene.getObjectByName("Sketchfab_model");
      if (root) {
        root.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
        scene.updateWorldMatrix(true, true);
      }
      return scene;
    });
    return voxelScene
      .then((scene) => normalize(cloneWithWorldTransform(scene), def))
      .catch((err) => {
        console.error(`avatar hat "${id}" failed to load`, err);
        return null;
      });
  }
  packScene ??= loadScene(hatUrl("hat-pack.glb"));
  return packScene
    .then((scene) => {
      const node = def.node ? scene.getObjectByName(def.node) : null;
      if (!node) {
        console.error(`avatar hat "${id}": node "${def.node}" missing from pack`);
        return null;
      }
      return normalize(cloneWithWorldTransform(node), def);
    })
    .catch((err) => {
      console.error(`avatar hat "${id}" failed to load`, err);
      return null;
    });
}

/** Handle for one mounted hat instance. */
export interface HatMount {
  dispose(): void;
}

/**
 * Asynchronously mount the hat onto `parent` (head-unit space: head is a unit
 * cube centred at the origin). The mount is a clone sharing template geometry
 * and materials, positioned so its base sits at the head top plus the hat's
 * tuned offset. Disposing before the load resolves cancels the attach; it
 * never touches shared template resources.
 */
export function mountHat(parent: THREE.Object3D, id: HatId, adjust?: PartAdjust): HatMount {
  if (id === "none" || adjust?.hide) return { dispose() {} };
  let cancelled = false;
  let attached: THREE.Object3D | null = null;

  let promise = templates.get(id);
  if (!promise) {
    promise = loadTemplate(id as Exclude<HatId, "none">);
    templates.set(id, promise);
  }
  void promise.then((template) => {
    if (cancelled || !template) return;
    const inst = template.clone(true);
    const def = HAT_DEFS[id as Exclude<HatId, "none">];
    inst.position.set(adjust?.x ?? 0, 0.5 + def.y + (adjust?.y ?? 0), adjust?.z ?? 0);
    if (adjust && adjust.scale !== 1) inst.scale.setScalar(adjust.scale);
    if (adjust && (adjust.rotX !== 0 || adjust.rotY !== 0 || adjust.rotZ !== 0)) {
      const d = Math.PI / 180;
      inst.rotation.set(adjust.rotX * d, adjust.rotY * d, adjust.rotZ * d);
    }
    parent.add(inst);
    attached = inst;
  });

  return {
    dispose() {
      cancelled = true;
      if (attached) {
        attached.parent?.remove(attached);
        attached = null;
      }
    },
  };
}
