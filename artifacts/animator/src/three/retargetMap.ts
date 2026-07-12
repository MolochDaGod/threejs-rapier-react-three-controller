/**
 * Pure bone-name mapping for the unified animation retargeting pipeline.
 *
 * The shared FBX weapon library is authored on Mixamo's `mixamorig*` skeleton.
 * Real GLB fighters (e.g. Racalvin) carry their own bone names — usually the
 * Mixamo SUFFIXES with no `mixamorig` prefix, plus a handful of rig-specific
 * spelling quirks (`Spine01`/`Spine02`, lowercase `neck`, extra `head_end` /
 * `headfront` leaves). To drive a library clip onto such a rig with three's
 * `SkeletonUtils.retargetClip`, we need an `options.names` map keyed by the
 * TARGET bone name whose value is the SOURCE (`mixamorig*`) bone name.
 *
 * This module is intentionally three-free string logic so it can be unit-tested
 * in the sandbox (no WebGL): {@link canonicalSuffix} reduces any raw bone name to
 * its canonical Mixamo suffix, and {@link buildRetargetNameMap} assembles the
 * target→source map from a rig's actual bone names.
 */

/**
 * The 22 canonical Mixamo bone suffixes the shared library animates. A library
 * clip only drives a rig bone whose name reduces (via {@link canonicalSuffix}) to
 * one of these. Source bone names are `mixamorig${suffix}`.
 */
export const CANONICAL_SUFFIXES = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "RightHand",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "LeftToeBase",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "RightToeBase",
] as const;

export type CanonicalSuffix = (typeof CANONICAL_SUFFIXES)[number];

const SUFFIX_BY_LOWER = new Map<string, CanonicalSuffix>(
  CANONICAL_SUFFIXES.map((s) => [s.toLowerCase(), s]),
);

/** The source skeleton's hip bone name (`options.hip` for `retargetClip`). */
export const SOURCE_HIP = "mixamorigHips";

/** Build the `mixamorig*` source bone name for a canonical suffix. */
export function sourceBoneName(suffix: CanonicalSuffix): string {
  return `mixamorig${suffix}`;
}

/**
 * Reduce a raw target bone name to its canonical Mixamo suffix, or `null` when it
 * has no library equivalent (and should be left un-driven). Strips a leading
 * `mixamorig`/`mixamorig:` prefix, folds the two common spine/neck/head/hips
 * spelling variants shipped across rigs (`Spine01`/`Spine11` → `Spine1`,
 * `Spine02`/`Spine21` → `Spine2`, `Neck2` → `Neck`, `Head1` → `Head`,
 * `Hips1` → `Hips`), and matches the rest case-insensitively against
 * {@link CANONICAL_SUFFIXES}. Container/leaf bones with no library segment
 * (`Armature`, `head_end`, `headfront`, `HeadTop_End`, `*_End`) return `null`.
 */
export function canonicalSuffix(raw: string): CanonicalSuffix | null {
  let n = raw.replace(/^mixamorig:?/i, "");
  if (/^Spine0*1$|^Spine11$/i.test(n)) n = "Spine1";
  else if (/^Spine0*2$|^Spine21$/i.test(n)) n = "Spine2";
  else if (/^Spine$/i.test(n)) n = "Spine";
  else if (/^Neck\d*$/i.test(n)) n = "Neck";
  else if (/^Head\d*$/i.test(n)) n = "Head";
  else if (/^Hips\d*$/i.test(n)) n = "Hips";
  else n = n.replace(/\d+$/, "");
  return SUFFIX_BY_LOWER.get(n.toLowerCase()) ?? null;
}

/**
 * The result of {@link buildRetargetNameMap}: the `names` map handed straight to
 * `SkeletonUtils.retargetClip` plus diagnostics for how complete the match was.
 */
export interface RetargetNameMap {
  /** TARGET bone name → SOURCE (`mixamorig*`) bone name. */
  names: Record<string, string>;
  /** Source hip bone name (`options.hip`). */
  hip: string;
  /** Canonical suffixes that found a target bone. */
  matched: CanonicalSuffix[];
  /** Canonical suffixes with no target bone (clip motion on these is dropped). */
  missing: CanonicalSuffix[];
}

/**
 * Build the target→source bone-name map for a rig from its actual bone names.
 *
 * Each target bone is reduced to a canonical suffix via {@link canonicalSuffix}
 * (an explicit `aliases` entry, keyed by the exact target bone name and valued by
 * a canonical suffix, wins) and mapped to the matching `mixamorig*` source bone.
 * Bones with no canonical equivalent are skipped — `retargetClip` leaves them at
 * their rest pose. The first target bone claiming a suffix wins, so duplicate /
 * leaf bones can't steal an already-mapped role.
 */
export function buildRetargetNameMap(
  targetBoneNames: readonly string[],
  aliases: Record<string, CanonicalSuffix> = {},
): RetargetNameMap {
  const names: Record<string, string> = {};
  const matched = new Set<CanonicalSuffix>();
  for (const bone of targetBoneNames) {
    const suffix = aliases[bone] ?? canonicalSuffix(bone);
    if (!suffix) continue;
    if (matched.has(suffix)) continue;
    names[bone] = sourceBoneName(suffix);
    matched.add(suffix);
  }
  const missing = CANONICAL_SUFFIXES.filter((s) => !matched.has(s));
  return { names, hip: SOURCE_HIP, matched: [...matched], missing };
}
