/**
 * Bone-name fragments (Mixamo `mixamorig*`) that make up the UPPER body. An
 * additive combat overlay keeps only tracks targeting these bones so the legs
 * stay owned by the locomotion blend (walk/run continues under the swing) while
 * the spine, shoulders, arms and hands play the attack. `Hips` is deliberately
 * excluded — rotating it would drag the whole lower body with the swing.
 *
 * Shared by the procedural Explorer rig ({@link ./explorer/Animator}) and the
 * standard GLB {@link ./Character} so both rigs split an attack from locomotion
 * the same way.
 */
export const UPPER_BODY_BONES = ["Spine", "Neck", "Head", "Shoulder", "Arm", "Hand"];

/** Whether an animation track targets an upper-body bone (see {@link UPPER_BODY_BONES}). */
export function isUpperBodyTrack(trackName: string): boolean {
  return UPPER_BODY_BONES.some((b) => trackName.includes(b));
}
