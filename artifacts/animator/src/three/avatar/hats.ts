/**
 * 3D GLB hats for the Avatar Edit cube heads.
 *
 * Sources under `public/avatar/hats/`:
 * - `hat-pack.glb` — Sketchfab pack (Pirate / Cowboy / Witch / TopHat / Princess)
 * - `pirate-voxel.glb` — Minecraft-style voxel pirate hat
 * - `horns.glb` — low-poly horn accessory (replaces painted box horns)
 * - `hooded-adventurer.glb` — Kenney-style Medieval_Head hood (head mesh only)
 *
 * Templates are normalized into head-unit space (head = unit cube: centred in
 * X/Z, base at y = 0, scaled to a per-hat fit width) and cached forever.
 * Mounted hats are clones SHARING template geometry + materials — a mount's
 * dispose only detaches it and must never dispose shared resources.
 *
 * Attachment: all hats sit on the head group with base at y ≈ 0.5 (top of the
 * unit cube) + per-hat `y` offset so brims/horns roots sit on the skull crown.
 */
import * as THREE from "three";
import { assetUrl } from "../assetHost";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AvatarConfig, HatId, PartAdjust } from "./catalog";
import { isHidden } from "./catalog";

interface HatDef {
  /** Which source family the hat lives in. */
  src: "pack" | "voxel" | "file";
  /** Named subtree inside the pack / multi-mesh file. */
  node?: string;
  /** Filename under `avatar/hats/` when `src === "file"`. */
  file?: string;
  /** Target width (max of x/z extent) in head units. */
  fit: number;
  /**
   * Vertical offset of the hat base relative to the head top (y = 0.5).
   * Negative sinks the brim into the skull slightly for a snug seat.
   */
  y: number;
  /** Extra yaw (radians) so the hat's front matches the face (+z). */
  rotY?: number;
  /** Extra pitch (radians) after normalize (e.g. hood lean). */
  rotX?: number;
}

const HAT_DEFS: Record<Exclude<HatId, "none">, HatDef> = {
  pirateVoxel: { src: "voxel", fit: 1.45, y: -0.1 },
  pirate: { src: "pack", node: "Pirate_low", fit: 1.5, y: -0.06 },
  cowboy: { src: "pack", node: "Cowboy_low", fit: 1.55, y: -0.05 },
  witch: { src: "pack", node: "Witch_low", fit: 1.45, y: -0.06 },
  tophat: { src: "pack", node: "TopHat_low", fit: 1.2, y: -0.03 },
  princess: { src: "pack", node: "Princess_low", fit: 0.85, y: -0.02 },
  // Horn accessory: sits on the crown; slight sink so roots meet the skull.
  horns: { src: "file", file: "horns.glb", fit: 1.05, y: -0.08, rotY: 0 },
  // Hood mesh from Hooded Adventurer — covers hair; attach lower so neck seam meets head.
  hood: {
    src: "file",
    file: "hooded-adventurer.glb",
    node: "Medieval_Head",
    fit: 1.28,
    y: -0.42,
    rotY: Math.PI,
  },
};

function hatUrl(file: string): string {
  return assetUrl(`avatar/hats/${file}`);
}

const loader = new GLTFLoader();
let packScene: Promise<THREE.Group> | null = null;
let voxelScene: Promise<THREE.Group> | null = null;
const fileScenes = new Map<string, Promise<THREE.Group>>();

function loadScene(url: string): Promise<THREE.Group> {
  return loader.loadAsync(url).then((gltf) => {
    gltf.scene.updateWorldMatrix(true, true);
    return gltf.scene;
  });
}

function loadFileScene(file: string): Promise<THREE.Group> {
  let p = fileScenes.get(file);
  if (!p) {
    p = loadScene(hatUrl(file));
    fileScenes.set(file, p);
  }
  return p;
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
  // pivot applies corrective yaw/pitch about world axes BEFORE the bbox is
  // measured, so fit/centre/base all account for the spun orientation
  const pivot = new THREE.Group();
  if (def.rotY) pivot.rotation.y = def.rotY;
  if (def.rotX) pivot.rotation.x = def.rotX;
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

  if (def.src === "file") {
    const file = def.file!;
    return loadFileScene(file)
      .then((scene) => {
        // Z-up Sketchfab roots: snap to Y-up when present.
        const sketch = scene.getObjectByName("Sketchfab_model");
        if (sketch) {
          sketch.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
          scene.updateWorldMatrix(true, true);
        }
        let source: THREE.Object3D = scene;
        if (def.node) {
          const node = scene.getObjectByName(def.node);
          if (!node) {
            console.error(`avatar hat "${id}": node "${def.node}" missing from ${file}`);
            return null;
          }
          source = node;
        }
        return normalize(cloneWithWorldTransform(source), def);
      })
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

/**
 * Which GLB hat to mount for this config.
 * Explicit hat pick wins; otherwise headgear "horns" mounts the 3D horn accessory
 * (replacing the old painted box horns).
 */
export function resolveMountedHatId(cfg: AvatarConfig): HatId {
  if (cfg.hat !== "none" && !isHidden(cfg, "hat")) return cfg.hat;
  if (cfg.headgear === "horns" && !isHidden(cfg, "headgear")) return "horns";
  return "none";
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
    // Head top is y = 0.5 in head-unit space; def.y fine-tunes crown contact.
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
