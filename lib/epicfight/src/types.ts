// Type definitions for the JSON schema produced by the Antikythera-Studios
// "Epic Fight Blender exporter" (blender-json-addon) and consumed by the Epic
// Fight Minecraft mod. A single file may carry a mesh, an armature, an
// animation, and/or a camera. We only model the mesh/armature/animation here.

/** A packed numeric array block: `{stride, count, array}`. */
export interface EFArray {
  stride: number;
  count: number;
  array: number[];
}

/**
 * Decomposed transform used when the exporter is run in "attributes" format.
 * `rot` is a Blender-order quaternion `(w, x, y, z)`.
 */
export interface EFAttrTransform {
  loc: [number, number, number];
  rot: [number, number, number, number];
  sca: [number, number, number];
}

/**
 * A bone/keyframe transform. Either a flat row-major 4x4 matrix (16 numbers,
 * the default "MAT" format) or a decomposed `{loc, rot, sca}` ("attributes").
 */
export type EFTransform = number[] | EFAttrTransform;

/** A node in the armature hierarchy. `transform` is parent-relative (local). */
export interface EFHierarchyNode {
  name: string;
  transform: EFTransform;
  children?: EFHierarchyNode[];
}

/** Armature: an ordered joint list plus the bone hierarchy tree. */
export interface EFArmature {
  /** Bone names in the order that `vindices` bone-indices reference. */
  joints: string[];
  hierarchy: EFHierarchyNode[];
}

/**
 * Skinned mesh data. Faces live in `parts` keyed by body-part name; each part
 * array is flat triples `(vertexIndex, uvIndex, normalIndex)`, 9 per triangle.
 * Skinning is `vcounts` (influences per vertex) + `vindices` (pairs of
 * boneIndex, weightPaletteIndex) + `weights` (deduplicated weight palette).
 */
export interface EFMesh {
  positions: EFArray;
  uvs?: EFArray;
  normals?: EFArray;
  vcounts?: EFArray;
  weights?: EFArray;
  vindices?: EFArray;
  parts: Record<string, EFArray>;
}

/** A model file (mesh + armature). */
export interface EFModelJson {
  vertices?: EFMesh;
  armature?: EFArmature;
  /** Present (== "attributes") when the armature was exported decomposed. */
  armature_format?: string;
  /** Present (== "attributes") when the animation was exported decomposed. */
  format?: string;
  fps?: number;
}

/** A single animated bone channel: parallel `time` (seconds) + `transform`. */
export interface EFAnimBone {
  name: string;
  time: number[];
  transform: EFTransform[];
}

/** An animation file. */
export interface EFAnimationJson {
  animation: EFAnimBone[];
  /** Present (== "attributes") when exported decomposed; otherwise MAT. */
  format?: string;
  fps?: number;
}
