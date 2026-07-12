import * as THREE from "three";

/**
 * A SNIPPET: a short, separately-playable slice of a parent native clip, defined
 * by FRACTION (0..1) of the parent's duration. Mirrors the explorer rig's GLB
 * sub-clip registry ({@link ./explorer/loader}) but for the standard GLB
 * {@link ./Character}: register a snippet against a clip the rig already owns and
 * it becomes playable on demand (e.g. one long combo split into per-click hits,
 * or a flourish trimmed out of an idle) with NO extra files.
 */
export interface SnippetSpec {
  /** Id the snippet is registered + played under (must be unique on the rig). */
  id: string;
  /** Name of the parent clip already loaded on the rig. */
  parent: string;
  /** Start fraction (0..1) of the parent's duration. */
  from: number;
  /** End fraction (0..1) of the parent's duration. */
  to: number;
}

/** Frames-per-second the slice is sampled at (matches the explorer sub-clip rig). */
export const SNIPPET_FPS = 30;

/**
 * Slice `[from, to]` (fractions of `parent`'s duration) out of `parent` into a
 * new, independently-playable {@link THREE.AnimationClip} named `name`.
 *
 * Pure + side-effect free: `THREE.AnimationUtils.subclip` CLONES the source
 * before trimming, so the parent clip is never mutated and can be reused for
 * other snippets. Fractions are clamped to [0,1] and ordered, and the slice is
 * guaranteed to be at least one frame long so a degenerate range still yields a
 * usable clip rather than an empty one.
 */
export function sliceClipFraction(
  parent: THREE.AnimationClip,
  from: number,
  to: number,
  name: string,
  fps = SNIPPET_FPS,
): THREE.AnimationClip {
  const lo = THREE.MathUtils.clamp(Math.min(from, to), 0, 1);
  const hi = THREE.MathUtils.clamp(Math.max(from, to), 0, 1);
  const totalFrames = Math.max(1, Math.round(parent.duration * fps));
  const start = Math.round(lo * totalFrames);
  const end = Math.max(start + 1, Math.round(hi * totalFrames));
  return THREE.AnimationUtils.subclip(parent, name, start, end, fps);
}
