import * as THREE from "three";
import type { EFArmature, EFHierarchyNode, EFMesh, EFModelJson } from "./types.js";
import { matrixFromTransform } from "./matrix.js";

/** A loaded Epic Fight model: a skinned mesh driven by a named-bone skeleton. */
export interface EpicFightModel {
  /** Container group — apply world scale/rotation/position here. */
  root: THREE.Group;
  skinnedMesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  /** Bones in joint order (== `skinIndex` order). */
  bones: THREE.Bone[];
  boneByName: Map<string, THREE.Bone>;
  /** Body-part name → the unique vertex indices that part covers. */
  parts: Record<string, number[]>;
  /** Body-part name → rest-pose, mesh-local AABB (hit-volume metadata). */
  partBounds: Record<string, THREE.Box3>;
}

export interface LoadModelOptions {
  /** Uniform scale applied to the container group. Defaults to 1. */
  scale?: number;
  /** Override the default material. */
  material?: THREE.Material;
  /** Tint for the default material. */
  color?: THREE.ColorRepresentation;
}

interface BoneTree {
  boneByName: Map<string, THREE.Bone>;
  roots: THREE.Bone[];
}

function buildBones(armature: EFArmature): BoneTree {
  const boneByName = new Map<string, THREE.Bone>();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();

  const walk = (node: EFHierarchyNode, parent: THREE.Bone | null): THREE.Bone => {
    const bone = new THREE.Bone();
    bone.name = node.name;
    matrixFromTransform(node.transform, m).decompose(p, q, s);
    bone.position.copy(p);
    bone.quaternion.copy(q);
    bone.scale.copy(s);
    boneByName.set(node.name, bone);
    if (parent) parent.add(bone);
    for (const child of node.children ?? []) walk(child, bone);
    return bone;
  };

  const roots = armature.hierarchy.map((n) => walk(n, null));
  return { boneByName, roots };
}

interface Skinning {
  indices: [number, number, number, number][];
  weights: [number, number, number, number][];
}

function buildSkinning(mesh: EFMesh, numVerts: number): Skinning {
  const indices: [number, number, number, number][] = [];
  const weights: [number, number, number, number][] = [];
  const vcounts = mesh.vcounts?.array;
  const vindices = mesh.vindices?.array;
  const palette = mesh.weights?.array;

  if (!vcounts || !vindices || !palette) {
    for (let v = 0; v < numVerts; v++) {
      indices.push([0, 0, 0, 0]);
      weights.push([1, 0, 0, 0]);
    }
    return { indices, weights };
  }

  let ptr = 0;
  for (let v = 0; v < numVerts; v++) {
    const count = vcounts[v] | 0;
    const infl: [number, number][] = [];
    for (let c = 0; c < count; c++) {
      const boneIdx = vindices[ptr] | 0;
      const wIdx = vindices[ptr + 1] | 0;
      ptr += 2;
      infl.push([boneIdx, palette[wIdx] ?? 0]);
    }
    // Keep the 4 strongest influences (THREE supports up to 4 per vertex).
    infl.sort((a, b) => b[1] - a[1]);
    const top = infl.slice(0, 4);
    const sum = top.reduce((acc, e) => acc + e[1], 0);
    const idx4: [number, number, number, number] = [0, 0, 0, 0];
    const w4: [number, number, number, number] = [0, 0, 0, 0];
    if (sum > 0) {
      const inv = 1 / sum;
      for (let k = 0; k < top.length; k++) {
        idx4[k] = top[k][0];
        w4[k] = top[k][1] * inv;
      }
    } else {
      w4[0] = 1;
    }
    indices.push(idx4);
    weights.push(w4);
  }
  return { indices, weights };
}

function buildGeometry(mesh: EFMesh): THREE.BufferGeometry {
  const positions = mesh.positions.array;
  const numVerts = mesh.positions.count;
  const uvs = mesh.uvs?.array;
  const normals = mesh.normals?.array;
  const skin = buildSkinning(mesh, numVerts);

  const outPos: number[] = [];
  const outNorm: number[] = [];
  const outUv: number[] = [];
  const outSkinIdx: number[] = [];
  const outSkinW: number[] = [];

  const pushCorner = (vIdx: number, uvIdx: number, nIdx: number): void => {
    outPos.push(positions[vIdx * 3], positions[vIdx * 3 + 1], positions[vIdx * 3 + 2]);
    if (normals) {
      outNorm.push(normals[nIdx * 3], normals[nIdx * 3 + 1], normals[nIdx * 3 + 2]);
    }
    if (uvs) {
      // Exporter stores V flipped; flip back for THREE's default texture space.
      outUv.push(uvs[uvIdx * 2], 1 - uvs[uvIdx * 2 + 1]);
    }
    const si = skin.indices[vIdx];
    const sw = skin.weights[vIdx];
    outSkinIdx.push(si[0], si[1], si[2], si[3]);
    outSkinW.push(sw[0], sw[1], sw[2], sw[3]);
  };

  for (const part of Object.values(mesh.parts)) {
    const a = part.array;
    for (let i = 0; i + 8 < a.length; i += 9) {
      pushCorner(a[i], a[i + 1], a[i + 2]);
      pushCorner(a[i + 3], a[i + 4], a[i + 5]);
      pushCorner(a[i + 6], a[i + 7], a[i + 8]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
  if (outNorm.length) {
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(outNorm, 3));
  }
  if (outUv.length) {
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(outUv, 2));
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(outSkinIdx, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(outSkinW, 4));
  if (!outNorm.length) geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function extractParts(mesh: EFMesh): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [name, part] of Object.entries(mesh.parts)) {
    const set = new Set<number>();
    const a = part.array;
    for (let i = 0; i + 8 < a.length; i += 9) {
      set.add(a[i]);
      set.add(a[i + 3]);
      set.add(a[i + 6]);
    }
    out[name] = [...set];
  }
  return out;
}

function extractPartBounds(mesh: EFMesh): Record<string, THREE.Box3> {
  const pos = mesh.positions.array;
  const out: Record<string, THREE.Box3> = {};
  const v = new THREE.Vector3();
  for (const [name, part] of Object.entries(mesh.parts)) {
    const box = new THREE.Box3().makeEmpty();
    const a = part.array;
    for (let i = 0; i + 8 < a.length; i += 9) {
      for (const corner of [a[i], a[i + 3], a[i + 6]]) {
        box.expandByPoint(v.set(pos[corner * 3], pos[corner * 3 + 1], pos[corner * 3 + 2]));
      }
    }
    out[name] = box;
  }
  return out;
}

/**
 * Build a `THREE.SkinnedMesh` + `Skeleton` from an Epic Fight model JSON.
 *
 * The skeleton's bone array is ordered to match `armature.joints`, so the
 * mesh's `skinIndex` values resolve correctly. The whole character lives under
 * a container group (`root`) so callers can scale/orient it into their world
 * without disturbing the bind pose.
 */
export function loadEpicFightModel(
  json: EFModelJson,
  opts: LoadModelOptions = {},
): EpicFightModel {
  if (!json.armature) throw new Error("Epic Fight model JSON has no armature");
  if (!json.vertices) throw new Error("Epic Fight model JSON has no vertices");

  const { boneByName, roots } = buildBones(json.armature);
  const bones = json.armature.joints.map((name) => {
    const b = boneByName.get(name);
    if (!b) throw new Error(`Joint '${name}' is missing from the armature hierarchy`);
    return b;
  });

  const geometry = buildGeometry(json.vertices);
  const material =
    opts.material ??
    new THREE.MeshStandardMaterial({
      color: opts.color ?? 0xc9b9a8,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.name = "EpicFightMesh";
  skinnedMesh.castShadow = true;
  skinnedMesh.receiveShadow = true;
  for (const r of roots) skinnedMesh.add(r);
  // Bind pose: bone world matrices must reflect rest before constructing the
  // Skeleton (its boneInverses are computed from them). The mesh is at identity
  // here, so the default bind matrix (identity) is correct.
  skinnedMesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skinnedMesh.bind(skeleton);

  const root = new THREE.Group();
  root.name = "EpicFightCharacter";
  root.scale.setScalar(opts.scale ?? 1);
  root.add(skinnedMesh);

  return {
    root,
    skinnedMesh,
    skeleton,
    bones,
    boneByName,
    parts: extractParts(json.vertices),
    partBounds: extractPartBounds(json.vertices),
  };
}
