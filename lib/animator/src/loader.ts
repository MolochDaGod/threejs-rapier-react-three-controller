import * as THREE from "three";
import { loadAsset } from "@workspace/assets";
import { Animator } from "./Animator.js";
import { VoxelCharacter } from "./rig.js";
import { SKELETON_SOURCE_ID, allReferencedClipIds, clipIdsForClass } from "./clipCatalog.js";
import type { CharacterLook, WeaponClass } from "./types.js";

/**
 * Load a set of motion clips by asset id into a name->clip map. Missing/empty
 * FBX are skipped silently (the Animator falls back along its clip chains).
 */
export async function loadClips(ids: string[]): Promise<Map<string, THREE.AnimationClip>> {
  const map = new Map<string, THREE.AnimationClip>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const model = await loadAsset(id);
        const clip = model.animations[0];
        if (clip) map.set(id, clip);
      } catch {
        // Unknown id or load failure: leave it out; chains cover the gap.
      }
    }),
  );
  return map;
}

/** Load the shared skeleton source scene (the bone hierarchy clips bind to). */
export async function loadSkeletonSource(): Promise<THREE.Object3D> {
  const model = await loadAsset(SKELETON_SOURCE_ID);
  return model.scene;
}

/** Default look used when the caller doesn't supply one. */
export const DEFAULT_LOOK: CharacterLook = {
  skin: "#c98c5a",
  shirt: "#3b6ea5",
  pants: "#2e3440",
  hat: "none",
  hatColor: "#b03030",
};

export interface CreateAnimatedCharacterOptions {
  look?: Partial<CharacterLook>;
  /** Weapon classes whose clips to preload (default: all classes). */
  classes?: WeaponClass[];
  /** Initial equipped class (default: "unarmed"). */
  weapon?: WeaponClass;
  /** Target world-space height of the avatar in metres (default: 2). */
  height?: number;
}

/**
 * One-call factory: loads the skeleton + the needed clips, builds the box rig,
 * wires up an {@link Animator}, and equips the initial weapon. Returns the ready
 * Animator; add `animator.root` to your scene and call `animator.update(dt)`.
 */
export async function createAnimatedCharacter(
  opts: CreateAnimatedCharacterOptions = {},
): Promise<Animator> {
  const classes =
    opts.classes ?? (["unarmed", "sword", "knife", "ranged", "bow", "magic"] as WeaponClass[]);
  const ids = opts.classes
    ? [...new Set(classes.flatMap((c) => clipIdsForClass(c)))]
    : allReferencedClipIds();

  const [source, clips] = await Promise.all([loadSkeletonSource(), loadClips(ids)]);
  const look: CharacterLook = { ...DEFAULT_LOOK, ...opts.look };
  const character = new VoxelCharacter(source, look, opts.height ?? 2);
  const animator = new Animator(character, clips);
  animator.setWeapon(opts.weapon ?? "unarmed");
  return animator;
}
