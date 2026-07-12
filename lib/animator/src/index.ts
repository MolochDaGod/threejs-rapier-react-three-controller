/**
 * @workspace/animator
 *
 * A reusable skeletal-animation system for blocky (voxel) characters. It drives
 * box-geometry avatars rigidly bound to the standard 25-bone Mixamo skeleton
 * (`mixamorig*`) using motion-only clip packs (sword & shield, rifle, longbow),
 * with directional locomotion, weapon stances, melee combos, skills, blocks,
 * aim/draw, and movement specials (jump, dodge roll, dash, dash-attack).
 *
 * Quick start:
 *
 *   import { createAnimatedCharacter } from "@workspace/animator";
 *
 *   const hero = await createAnimatedCharacter({ weapon: "bow" });
 *   scene.add(hero.root);
 *   // per frame:
 *   hero.setLocomotion({ x: 0, z: 1, speed: 1, running: true });
 *   hero.update(dt);
 *   // actions:
 *   hero.attack(); hero.roll("F"); hero.aim(true);
 */
export { Animator } from "./Animator.js";
export { VoxelCharacter, type WeaponMounts } from "./rig.js";
export { mountWeapons, unmountWeapons, type MountedWeapons } from "./weapons.js";
export {
  WEAPON_SETS,
  TRAVERSAL_SETS,
  GLOBAL_ACTIONS,
  SKELETON_SOURCE_ID,
  allReferencedClipIds,
  clipIdsForClass,
  resolveGlobalAction,
  type TraversalSet,
} from "./clipCatalog.js";
export {
  createAnimatedCharacter,
  loadClips,
  loadSkeletonSource,
  DEFAULT_LOOK,
  type CreateAnimatedCharacterOptions,
} from "./loader.js";
export type {
  WeaponClass,
  TraversalMode,
  MoveInput,
  ActionKey,
  LocoSet,
  WeaponClipSet,
  CharacterLook,
} from "./types.js";
