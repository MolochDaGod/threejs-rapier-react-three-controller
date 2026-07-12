import * as THREE from "three";

/**
 * Drop the tracks of `clip` whose target node does not exist under `root`.
 *
 * Merged / retargeted clips (e.g. the Meshy-sourced GLB fighters whose baked
 * clips still carry finger bones — `mixamorig*Hand{Thumb,Index}1-4` — or a
 * `Sword` node) target joints a given model may not own. Binding those to an
 * `AnimationMixer` makes three log a flood of
 * `THREE.PropertyBinding: No target node found for track: …` warnings — one per
 * missing node, every time the action is bound. Filtering the misses out before
 * the mixer ever sees them keeps the console quiet without changing how the
 * tracks that DO bind play.
 *
 * Returns the original clip untouched when every track resolves (the common
 * case), so callers can use it unconditionally with no allocation cost.
 */
export function filterBindableTracks(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
): THREE.AnimationClip {
  const bindable = clip.tracks.filter((track) => {
    const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
    return THREE.PropertyBinding.findNode(root, nodeName) != null;
  });
  if (bindable.length === clip.tracks.length) return clip;
  return new THREE.AnimationClip(clip.name, clip.duration, bindable, clip.blendMode);
}
