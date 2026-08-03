/**
 * Avatar system — public barrel export.
 *
 * Import the pieces you need:
 *
 *   // Pure data (no DOM / THREE needed)
 *   import { defaultConfig, randomConfig, RACES } from "./avatar";
 *   import { composeHead }                        from "./avatar";
 *   import { renderPortraitDataUrl }              from "./avatar";
 *
 *   // Three.js 3D stage (needs a canvas + THREE in scope)
 *   import { HeadStage }                          from "./avatar";
 *
 *   // React editor component (needs React + THREE)
 *   import { AvatarEditMode }                     from "./avatar";
 *
 *   // In-game rig bridge (Explorer/GLB character only)
 *   import { applyAvatarHead }                    from "./avatar";
 */

// ─── Pure data model ──────────────────────────────────────────────────────────
export type {
  RaceId,
  HairStyle,
  EyeStyle,
  BrowStyle,
  FacialHairStyle,
  EarStyle,
  TuskStyle,
  ExtraStyle,
  MouthStyle,
  HatId,
  HeadgearStyle,
  ExpressionId,
  AdjustSlot,
  PartAdjust,
  AvatarConfig,
} from "./catalog";

export {
  RACES,
  HAIR_STYLES,
  HAIR_COLORS,
  EYE_STYLES,
  EYE_COLORS,
  BROW_STYLES,
  FACIAL_HAIR_STYLES,
  GEAR_COLORS,
  PAINT_COLORS,
  MOUTH_STYLES,
  HAT_STYLES,
  HEADGEAR_STYLES,
  EXTRA_STYLES,
  EXPRESSIONS,
  ADJUST_SLOTS,
  DEFAULT_ADJUST,
  ADJUST_SCALE_MIN,
  ADJUST_SCALE_MAX,
  ADJUST_OFFSET_LIMIT,
  ADJUST_ROT_LIMIT,
  defaultConfig,
  randomConfig,
  surpriseConfig,
  sanitizeConfig,
  encodeConfig,
  decodeConfig,
  raceDef,
  skinToneOf,
  earStylesFor,
  tuskStylesFor,
  getAdjust,
  isDefaultAdjust,
} from "./catalog";

// ─── Pixel composer (pure, no DOM) ────────────────────────────────────────────
export type { Grid } from "./pixels";
export type { ProtrusionBox, BoxMotion, FaceName } from "./composeHead";
export { TALK_FRAME_COUNT, composeHead, composeTalkFrames } from "./composeHead";

// ─── Pixel utilities ──────────────────────────────────────────────────────────
export { FACE, cssHex } from "./pixels";

// ─── 2D portrait renderer (needs a 2D canvas, but no WebGL) ──────────────────
export { renderPortraitDataUrl } from "./portrait";

// ─── Three.js 3D stage ────────────────────────────────────────────────────────
export { HeadStage } from "./HeadStage";

// ─── React editor component ───────────────────────────────────────────────────
export { AvatarEditMode } from "./AvatarEditMode";

// ─── In-game rig bridge (Explorer / skinned GLB characters) ──────────────────
export type { AvatarHeadHandle } from "./playerHead";
export {
  PLAYER_HEAD_KEY,
  loadPlayerHeadConfig,
  savePlayerHeadConfig,
  applyAvatarHead,
} from "./playerHead";

// ─── Production 6-race voxel defaults (fleet SSOT for voxel games) ───────────
export type {
  VoxelRaceDefault,
  VoxelRaceBodyLook,
  VoxelRaceDefaultsManifest,
} from "./raceDefaults";
export {
  buildRaceDefault,
  listRaceDefaults,
  raceDefault,
  buildRaceDefaultsManifest,
  saveRaceDefaultsToStorage,
  loadRaceDefaultsFromStorage,
  ensureRaceHeadConfig,
  RACE_DEFAULTS_STORE_KEY,
} from "./raceDefaults";
