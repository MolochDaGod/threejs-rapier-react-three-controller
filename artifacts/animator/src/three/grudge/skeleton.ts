import * as THREE from "three";

// Order-of-magnitude unit correction. Ported from the grudge character-viewer
// (powerOfTenScale).
export function powerOfTenScale(reference: number, current: number): number {
  if (!(reference > 0) || !(current > 0)) return 1;
  return Math.pow(10, Math.round(Math.log10(reference / current)));
}

// Skeleton unification. The Toon_RTS customizable FBX ships each of its ~27
// SkinnedMeshes with its OWN skeleton referencing DISCONNECTED duplicate bone
// instances, so no animation clip can deform the mesh. Fix: collapse every
// SkinnedMesh onto ONE canonical skeleton — the shallowest bone-node per name
// (BFS from root) — reusing each mesh's original boneInverses/bindMatrix.
// Returns the widest resulting skeleton.
export function unifySkeletons(root: THREE.Object3D): THREE.Skeleton | null {
  root.updateMatrixWorld(true);
  const canon = new Map<string, THREE.Bone>();
  const queue: THREE.Object3D[] = [...root.children];
  while (queue.length) {
    const node = queue.shift()!;
    if (node instanceof THREE.Bone && !canon.has(node.name)) canon.set(node.name, node);
    queue.push(...node.children);
  }
  if (canon.size === 0) return null;

  let widest: THREE.Skeleton | null = null;
  let unresolved = 0;
  root.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh && node.skeleton) {
      const newBones = node.skeleton.bones.map((b) => {
        const c = canon.get(b.name);
        if (!c) unresolved++;
        return c ?? b;
      });
      const newSkel = new THREE.Skeleton(newBones, node.skeleton.boneInverses);
      node.bind(newSkel, node.bindMatrix);
      if (!widest || newSkel.bones.length > widest.bones.length) widest = newSkel;
    }
  });
  if (unresolved > 0) {
    console.warn(
      `[grudge-kit] unifySkeletons: ${unresolved} bone(s) had no canonical match; ` +
        `those regions may not deform.`,
    );
  }
  return widest;
}

// Resolve a character's hand bone for weapon attachment. All six races use the
// unified Bip001 rig (exact "Bip001_R_Hand" / "Bip001_L_Hand"), tried first; a
// fuzzy fallback handles non-standard skeletons. Finger/thumb bones excluded.
export function findHandBone(root: THREE.Object3D, side: "L" | "R"): THREE.Object3D | null {
  const exact = side === "R" ? "Bip001_R_Hand" : "Bip001_L_Hand";
  let exactHit: THREE.Object3D | null = null;
  let fuzzyHit: THREE.Object3D | null = null;
  let fuzzyName = "";
  const want = side === "R" ? /rhand|righthand|handr|rwrist/ : /lhand|lefthand|handl|lwrist/;
  const isFinger = /finger|thumb|index|middle|ring|pinky|pinkie|metacarp|digit/;
  root.traverse((node) => {
    if (exactHit) return;
    if (node.name === exact) {
      exactHit = node;
      return;
    }
    const norm = node.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!want.test(norm) || isFinger.test(norm)) return;
    if (!fuzzyHit || norm.length < fuzzyName.length) {
      fuzzyHit = node;
      fuzzyName = norm;
    }
  });
  return exactHit ?? fuzzyHit;
}
