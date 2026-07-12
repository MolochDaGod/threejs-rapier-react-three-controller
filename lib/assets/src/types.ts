import type { AnimationClip, Group } from "three";

/**
 * Web-friendly model container formats curated into this library.
 * - `gltf`: self-contained glTF (embedded geometry, textures and animations).
 * - `fbx`:  FBX, used here for skinned characters and standalone animation clips.
 * - `obj`:  Wavefront OBJ, used for static voxel meshes (textured via an atlas).
 */
export type AssetFormat = "gltf" | "fbx" | "obj";

/** Top-level content buckets, derived from the on-disk folder layout. */
export type AssetCategory =
  | "enemies"
  | "characters"
  | "creatures"
  | "props"
  | "weapons"
  | "blocks"
  | "animations"
  | "vehicles"
  | "environment";

/**
 * A single curated asset. Entries are generated from the bundled model files at
 * module-evaluation time (see `catalog.ts`), so the catalog can never drift from
 * what is actually shipped in `lib/assets/models/`.
 */
export interface AssetEntry {
  /** Stable, unique id (the model's path under `models/` without extension), e.g. `enemies/zombie`. */
  id: string;
  /** Top-level bucket the asset belongs to. */
  category: AssetCategory;
  /** Optional sub-grouping below the category, e.g. `humanoid`, `guns`, `dungeon`. */
  subgroup?: string;
  /** Human-friendly display name, e.g. `Zombie`, `Tpose Character01`. */
  name: string;
  /** Container format of the primary model file. */
  format: AssetFormat;
  /** Bundler-resolved URL of the primary model file (hashed and served by Vite). */
  url: string;
  /**
   * Companion texture URLs to apply after load for formats that reference
   * external maps (FBX/OBJ). Empty for self-contained glTF.
   */
  textureUrls: string[];
  /**
   * Best-effort hint that the asset carries skeletal animation. The authoritative
   * source is always the `animations` array returned by the loader.
   */
  animated: boolean;
}

/** Result of loading a model: a scene graph plus any bundled animation clips. */
export interface LoadedModel {
  /**
   * Root object ready to add to a scene. Treat this as shared/cached: clone it
   * (e.g. `SkeletonUtils.clone` for skinned meshes, `.clone()` otherwise) before
   * mutating, so multiple consumers can reuse one decoded model.
   */
  scene: Group;
  /** Animation clips bundled with the model. Empty for static assets. */
  animations: AnimationClip[];
}

/** Progress payload reported while preloading a batch of assets. */
export interface PreloadProgress {
  /** Number of assets finished (succeeded or failed) so far. */
  loaded: number;
  /** Total number of assets in the batch. */
  total: number;
  /** Fraction in the range [0, 1]. */
  fraction: number;
  /** Id of the most recently completed asset. */
  current: string;
}
