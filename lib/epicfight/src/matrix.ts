import * as THREE from "three";
import type { EFAttrTransform, EFTransform } from "./types.js";

/** True when a transform is the decomposed `{loc, rot, sca}` "attributes" form. */
export function isAttrTransform(t: EFTransform): t is EFAttrTransform {
  return !Array.isArray(t);
}

/**
 * Convert a flat 16-element matrix to a `THREE.Matrix4`.
 *
 * The exporter writes matrices in **row-major** order (`Matrix((row0, row1,
 * row2, row3))` in Blender's mathutils). `THREE.Matrix4.set()` also takes its
 * arguments row-major, so a direct spread is correct.
 */
export function matrixFromFlat(
  flat: number[],
  out: THREE.Matrix4 = new THREE.Matrix4(),
): THREE.Matrix4 {
  if (flat.length !== 16) {
    throw new Error(
      `Epic Fight matrix must have 16 elements, got ${flat.length}`,
    );
  }
  // prettier-ignore
  out.set(
    flat[0],  flat[1],  flat[2],  flat[3],
    flat[4],  flat[5],  flat[6],  flat[7],
    flat[8],  flat[9],  flat[10], flat[11],
    flat[12], flat[13], flat[14], flat[15],
  );
  return out;
}

/** Convert a decomposed transform to a `THREE.Matrix4`. */
export function matrixFromAttr(
  t: EFAttrTransform,
  out: THREE.Matrix4 = new THREE.Matrix4(),
): THREE.Matrix4 {
  // Blender quaternion order is (w, x, y, z); THREE is (x, y, z, w).
  const q = new THREE.Quaternion(t.rot[1], t.rot[2], t.rot[3], t.rot[0]);
  const p = new THREE.Vector3(t.loc[0], t.loc[1], t.loc[2]);
  const s = new THREE.Vector3(t.sca[0], t.sca[1], t.sca[2]);
  return out.compose(p, q, s);
}

/** Convert either transform representation to a `THREE.Matrix4`. */
export function matrixFromTransform(
  t: EFTransform,
  out: THREE.Matrix4 = new THREE.Matrix4(),
): THREE.Matrix4 {
  return isAttrTransform(t) ? matrixFromAttr(t, out) : matrixFromFlat(t, out);
}
