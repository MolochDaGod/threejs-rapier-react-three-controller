// Vendored Grudge character-kit — framework-agnostic (three only) helpers and
// data for spawning the equipment-driven Toon_RTS character inside the Animator.
// The Animator forbids `@workspace` imports, so this is a local copy of the
// grudge-game character-kit; keep the DATA (RACE_ASSETS, RACE_GEAR_PRESETS) in
// lockstep with the source if it ever changes.

export {
  setAssetBase,
  getAssetBase,
  resolveAssetUrl,
  assetLoadError,
  probeAssetHost,
} from "./assetBase";

export type { RaceId, RaceAsset } from "./raceAssets";
export { RACE_ASSETS, RACE_IDS } from "./raceAssets";

export type { GearPreset, PresetId } from "./gearPresets";
export { RACE_GEAR_PRESETS, PRESET_IDS, getPreset } from "./gearPresets";

export type { AnimPack, LoadoutClips } from "./anims";
export {
  ANIM_PACK_CLIPS,
  SPRINT_CLIP,
  asAnimPack,
  bakedClipUrl,
  toRotationOnlyClip,
  loadBakedClip,
} from "./anims";

export { powerOfTenScale, unifySkeletons, findHandBone } from "./skeleton";

export type { LoadedCharacter } from "./loadCharacter";
export {
  loadCharacterModel,
  normalizeCharacterGroup,
  applyGearPreset,
  applyBodyTexture,
} from "./loadCharacter";

export { loadBodyTexture } from "./texture";
