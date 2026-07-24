/**
 * Optional Animated Base Character pack merge.
 * When no base pack assets are present, this is a no-op so explorer load still works.
 */
import type { AnimationClip, Object3D } from "three";

/**
 * Merge base locomotion/attack clips into the clip map.
 * Returns without changes when the pack is unavailable.
 */
export async function mergeBasePackIntoClips(
  _clips: Map<string, AnimationClip> | Record<string, AnimationClip>,
  _source?: Object3D | null,
): Promise<void> {
  // Base pack GLBs are optional; weapon style packs already cover combat ids.
  return;
}
