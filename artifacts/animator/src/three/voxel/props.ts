import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { asset } from "../assets";
import { PROPS, type PropId } from "./types";

/**
 * Loads + normalizes a deployable GLB prop once and caches the prepared
 * template, so every placement (both the Voxel Editor and play mode) clones the
 * same geometry/materials instead of re-downloading the model.
 *
 * The source models arrive at wildly different native scales and off-origin
 * pivots, so each template is fit to its {@link PropDef.targetHeight}, recentred
 * on X/Z, and dropped so its base sits at Y=0 (matching the deployable group
 * origin). Clones share the template's geometry + materials, so they must NOT be
 * disposed per instance — only the cached template owns those GPU resources for
 * the lifetime of the app.
 */
const loader = new GLTFLoader();
const cache = new Map<PropId, Promise<THREE.Group | null>>();

export function loadPropTemplate(id: PropId): Promise<THREE.Group | null> {
  let pending = cache.get(id);
  if (!pending) {
    pending = buildTemplate(id).catch((err) => {
      console.error(`[props] failed to load prop "${id}"`, err);
      cache.delete(id); // allow a later retry
      return null;
    });
    cache.set(id, pending);
  }
  return pending;
}

async function buildTemplate(id: PropId): Promise<THREE.Group> {
  const def = PROPS[id];
  const gltf = await loader.loadAsync(asset(def.file));
  const model = gltf.scene;

  // Fit to the target world height.
  model.updateWorldMatrix(true, true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(def.targetHeight / (size.y || 1));

  // Recentre on X/Z and drop the base to Y=0 (after scaling).
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  const wrap = new THREE.Group();
  wrap.add(model);
  return wrap;
}
