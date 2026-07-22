import * as THREE from "three";

/**
 * Deep-dispose a loaded GLB subtree: geometry, materials, and every texture
 * slot a standard material can own. Used on async-load abort paths (the lobby
 * was disposed while a GLB was still downloading) so the orphaned assets
 * don't leak GPU memory.
 */
export function disposeGlbDeep(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat) continue;
      const std = mat as THREE.MeshStandardMaterial;
      std.map?.dispose();
      std.normalMap?.dispose();
      std.roughnessMap?.dispose();
      std.metalnessMap?.dispose();
      std.aoMap?.dispose();
      std.emissiveMap?.dispose();
      mat.dispose();
    }
  });
}
