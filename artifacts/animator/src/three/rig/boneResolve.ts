import * as THREE from "three";

/**
 * Canonical bone / socket resolution for Dressing Room + play.
 *
 * Assets arrive with many naming dialects:
 *   - Mixamo: `mixamorigHips`, `mixamorig:RightHand`
 *   - Bip001 (Unity/Toon RTS): `Bip001_R_Hand`, `Bip001 R Hand`, `Bip001 Pelvis`
 *   - Containers: `R_hand_container`, `L_shield_container`
 *   - Generic: `Hips`, `Hand_R`, `wrist_r`
 *
 * Losing root/hips/hands is the #1 cause of T-poses, floating weapons, and
 * "skills fire but mesh doesn't animate." This module is the single resolve
 * path Dressing and combat should use.
 */

/** Strip dialect noise so names compare as keys. */
export function boneKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/^mixamorig:?/i, "")
    .replace(/^bip001[_\s.]?/i, "bip001_")
    .replace(/[:.\s\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

export type RigKind = "bip001" | "mixamo" | "generic" | "unknown";

export interface RigBindReport {
  kind: RigKind;
  /** Scene graph root that owns the skinned meshes (often the GLB/FBX root). */
  modelRoot: string;
  /** Best hip / pelvis bone (locomotion root). */
  hips: { name: string; path: string } | null;
  /** Armature object3d if found (parent of hip chain). */
  armature: { name: string; path: string } | null;
  rightHand: { name: string; path: string } | null;
  leftHand: { name: string; path: string } | null;
  rightContainer: { name: string; path: string } | null;
  leftContainer: { name: string; path: string } | null;
  /** True when both hands (or containers) resolve for weapon mount. */
  weaponReady: boolean;
  /** True when hips found (animations have a locomotion root). */
  locoReady: boolean;
  boneCount: number;
  warnings: string[];
  /** Sample of bone names for the debug panel. */
  sampleBones: string[];
}

const HIPS_ALIASES = [
  "bip001_pelvis",
  "bip001pelvis",
  "hips",
  "pelvis",
  "hip",
  "root_hips",
  "bip001",
];

const R_HAND_ALIASES = [
  "bip001_r_hand",
  "bip001rhand",
  "righthand",
  "hand_r",
  "handr",
  "r_hand",
  "rhand",
  "wrist_r",
  "rwrist",
  "rightwrist",
];

const L_HAND_ALIASES = [
  "bip001_l_hand",
  "bip001lhand",
  "lefthand",
  "hand_l",
  "handl",
  "l_hand",
  "lhand",
  "wrist_l",
  "lwrist",
  "leftwrist",
];

const R_CONTAINER_ALIASES = [
  "r_hand_container",
  "righthandcontainer",
  "weapon_r",
  "r_weapon",
  "hand_r_socket",
];

const L_CONTAINER_ALIASES = [
  "l_hand_container",
  "lefthandcontainer",
  "l_shield_container",
  "weapon_l",
  "l_weapon",
  "hand_l_socket",
];

const FINGER_RE = /finger|thumb|index|middle|ring|pinky|pinkie|metacarp|digit|toe/;

function objectPath(obj: THREE.Object3D): string {
  const parts: string[] = [];
  let n: THREE.Object3D | null = obj;
  while (n) {
    parts.unshift(n.name || n.type);
    n = n.parent;
  }
  return parts.join("/");
}

function collectBones(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone || o.type === "Bone") out.push(o);
    // Also index plain Object3D sockets used as hand containers
    else if (/container|socket|attach|weapon/i.test(o.name)) out.push(o);
  });
  return out;
}

function matchAliases(
  nodes: THREE.Object3D[],
  aliases: string[],
  opts: { excludeFinger?: boolean } = {},
): THREE.Object3D | null {
  const aliasSet = new Set(aliases);
  let fuzzy: THREE.Object3D | null = null;
  let fuzzyScore = Infinity;

  for (const node of nodes) {
    const key = boneKey(node.name);
    if (!key) continue;
    if (opts.excludeFinger !== false && FINGER_RE.test(key)) continue;

    if (aliasSet.has(key)) return node;

    // Substring / endsWith match for dialect noise (e.g. character_bip001_r_hand)
    for (const a of aliases) {
      if (key === a || key.endsWith("_" + a) || key.endsWith(a)) {
        const score = key.length;
        if (score < fuzzyScore) {
          fuzzyScore = score;
          fuzzy = node;
        }
      }
    }
  }
  return fuzzy;
}

function detectKind(sample: string[]): RigKind {
  const joined = sample.join(" ");
  if (/bip001/i.test(joined)) return "bip001";
  if (/mixamorig/i.test(joined)) return "mixamo";
  if (/hips|pelvis|spine/i.test(joined)) return "generic";
  return "unknown";
}

/**
 * Full bind report for a loaded character model (group or skinned root).
 */
export function resolveRigBind(root: THREE.Object3D): RigBindReport {
  root.updateMatrixWorld(true);
  const nodes = collectBones(root);
  const boneNames = nodes.map((n) => n.name).filter(Boolean);
  const kind = detectKind(boneNames);
  const warnings: string[] = [];

  const hipsNode = matchAliases(nodes, HIPS_ALIASES, { excludeFinger: true });
  const rHand = matchAliases(nodes, R_HAND_ALIASES);
  const lHand = matchAliases(nodes, L_HAND_ALIASES);
  const rCont = matchAliases(nodes, R_CONTAINER_ALIASES, { excludeFinger: true });
  const lCont = matchAliases(nodes, L_CONTAINER_ALIASES, { excludeFinger: true });

  // Armature: parent of hips if it looks like a skeleton root
  let armature: THREE.Object3D | null = null;
  if (hipsNode?.parent) {
    const p = hipsNode.parent;
    if (/armature|skeleton|root|rig|bip001$/i.test(p.name) || p.type === "Object3D") {
      armature = p;
    }
  }

  if (!hipsNode) {
    warnings.push("No hips/pelvis bone — locomotion/root motion may fail or T-pose.");
  }
  if (!rHand && !rCont) {
    warnings.push("No right hand / R_hand_container — main weapons will mount to body root.");
  }
  if (!lHand && !lCont) {
    warnings.push("No left hand / L_hand_container — off-hand / shield may float.");
  }
  if (nodes.length === 0) {
    warnings.push("No bones found under model root — wrong hierarchy or static mesh.");
  }

  const ref = (o: THREE.Object3D | null) =>
    o ? { name: o.name, path: objectPath(o) } : null;

  return {
    kind,
    modelRoot: root.name || root.type,
    hips: ref(hipsNode),
    armature: ref(armature),
    rightHand: ref(rHand),
    leftHand: ref(lHand),
    rightContainer: ref(rCont),
    leftContainer: ref(lCont),
    weaponReady: !!(rHand || rCont),
    locoReady: !!hipsNode,
    boneCount: nodes.filter((n) => (n as THREE.Bone).isBone || n.type === "Bone").length,
    warnings,
    sampleBones: boneNames.slice(0, 24),
  };
}

/**
 * Prefer weapon containers (grudge6) then hand bones. Used for mount points.
 */
export function findWeaponSocket(
  root: THREE.Object3D,
  side: "L" | "R",
): THREE.Object3D | null {
  const nodes = collectBones(root);
  if (side === "R") {
    return (
      matchAliases(nodes, R_CONTAINER_ALIASES, { excludeFinger: true }) ??
      matchAliases(nodes, R_HAND_ALIASES)
    );
  }
  return (
    matchAliases(nodes, L_CONTAINER_ALIASES, { excludeFinger: true }) ??
    matchAliases(nodes, L_HAND_ALIASES)
  );
}

/** Back-compat hand finder used by grudge skeleton.ts. */
export function findHandBone(root: THREE.Object3D, side: "L" | "R"): THREE.Object3D | null {
  return findWeaponSocket(root, side);
}

export function findHipsBone(root: THREE.Object3D): THREE.Object3D | null {
  return matchAliases(collectBones(root), HIPS_ALIASES, { excludeFinger: true });
}

/**
 * Compact one-line summary for console / notices.
 */
export function formatBindSummary(r: RigBindReport): string {
  const parts = [
    `kind=${r.kind}`,
    `bones=${r.boneCount}`,
    `hips=${r.hips?.name ?? "—"}`,
    `R=${r.rightContainer?.name ?? r.rightHand?.name ?? "—"}`,
    `L=${r.leftContainer?.name ?? r.leftHand?.name ?? "—"}`,
  ];
  if (r.warnings.length) parts.push(`warn=${r.warnings.length}`);
  return parts.join(" · ");
}
