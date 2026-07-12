/**
 * Armor stand (mannequin) helpers for the realistic Minecraft armor showcase GLB.
 *
 * Minecraft shows armor on the player *and* on armor stands. Until worn-slot
 * meshes exist, we use the showcase stand as the visual truth for equip:
 * hide every set root, then reveal only the node(s) for the current loadout.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { asset } from "../assets";
import {
  ARMOR_STAND_FILE,
  ARMOR_STAND_PROPS,
  ARMOR_STAND_SET_NODES,
  type ArmorLoadout,
} from "./types";
import { standNodesForLoadout } from "./armorCatalog";

/**
 * Load the armor stand GLB, normalize feet to y=0, and apply an initial loadout.
 * Returns the scene root + a dispose function.
 */
export async function loadArmorStand(
  loadout: ArmorLoadout,
  opts: { showProps?: boolean; targetHeight?: number } = {},
): Promise<{ root: THREE.Group; applyLoadout: (l: ArmorLoadout) => void; dispose: () => void }> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(asset(ARMOR_STAND_FILE));
  const root = new THREE.Group();
  root.name = "armor-stand";
  root.add(gltf.scene);

  // Normalize height (~1.8–2m mannequin) and feet on floor.
  const targetH = opts.targetHeight ?? 1.85;
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 0.001) root.scale.setScalar(targetH / size.y);
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
  });

  const showProps = opts.showProps ?? true;
  applyStandVisibility(root, loadout, showProps);

  return {
    root,
    applyLoadout: (l) => applyStandVisibility(root, l, showProps),
    dispose: () => {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        }
      });
      root.removeFromParent();
    },
  };
}

/** Toggle set meshes + optional wood stand/font props. */
export function applyStandVisibility(
  root: THREE.Object3D,
  loadout: ArmorLoadout,
  showProps = true,
): void {
  const visible = new Set(standNodesForLoadout(loadout));
  // If nothing equipped, show iron as default mannequin so the rack isn't empty.
  if (visible.size === 0) visible.add("Iron_Iron_0");

  root.traverse((o) => {
    if (!o.name) return;
    if ((ARMOR_STAND_SET_NODES as readonly string[]).includes(o.name)) {
      o.visible = visible.has(o.name);
      return;
    }
    if ((ARMOR_STAND_PROPS as readonly string[]).includes(o.name)) {
      o.visible = showProps;
    }
  });
}
