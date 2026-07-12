import type { WeaponId } from "../types";

/** A buildable voxel piece shape. All occupy one 1×1×1 grid cell. */
export type PieceShape = "block" | "slab" | "wall" | "pillar" | "ramp";

/** A placeable, non-block entity. */
export type DeployableKind = "npc" | "heavyBag" | "physicsBag" | "prop" | "start";

/** Palette grouping for deployable GLB props. */
export type PropCategory = "bench" | "build";

/** The set of GLB props that can be deployed (crafting benches + build helpers). */
export type PropId = "brewingStand" | "alchemistsChest" | "modularFortress";

/** Static metadata for a deployable GLB prop. */
export interface PropDef {
  id: PropId;
  label: string;
  glyph: string;
  category: PropCategory;
  /** Public path (under the artifact base) of the GLB model. */
  file: string;
  /** Models are normalized at load time to fit this world height (metres). */
  targetHeight: number;
  /**
   * Horizontal half-extent (metres ≈ grid cells) of the prop AFTER it is
   * normalized to {@link targetHeight}. Authored from the model's measured,
   * normalized X/Z size (the larger axis, so it's rotation-invariant) and used by
   * the Voxel Editor to compute the prop's placement footprint deterministically
   * at click time. Keep this in sync if `targetHeight` or the model changes.
   */
  footprintRadius: number;
  /** Whether the prop bakes a static collider in play mode. */
  collide: boolean;
}

/** Registry of deployable props, grouped by {@link PropCategory}. */
export const PROPS: Record<PropId, PropDef> = {
  brewingStand: {
    id: "brewingStand",
    label: "Brewing Stand",
    glyph: "⚗",
    category: "bench",
    file: "models/props/brewing-stand.glb",
    targetHeight: 1.5,
    footprintRadius: 0.63,
    collide: true,
  },
  alchemistsChest: {
    id: "alchemistsChest",
    label: "Alchemist's Chest",
    glyph: "⬚",
    category: "bench",
    file: "models/props/alchemists-chest.glb",
    targetHeight: 1.2,
    footprintRadius: 0.8,
    collide: true,
  },
  modularFortress: {
    id: "modularFortress",
    label: "Fortress Piece",
    glyph: "⛫",
    category: "build",
    file: "models/props/modular-fortress.glb",
    targetHeight: 3,
    footprintRadius: 2.79,
    collide: true,
  },
};

/** Props in palette order. */
export const PROP_LIST: PropDef[] = Object.values(PROPS);

/** Enemy strength tiers used when authoring a custom dungeon. */
export type Difficulty = "easy" | "normal" | "hard" | "elite";

/** Which tool the brush is currently using. */
export type EditorTool = "block" | "deploy" | "select";

/** Transform-gizmo mode for the Select tool. */
export type GizmoMode = "translate" | "rotate" | "scale";

/** The live brush state, mirrored from the React toolbar. */
export interface BrushState {
  tool: EditorTool;
  shape: PieceShape;
  color: number;
  deployKind: DeployableKind;
  weapon: WeaponId;
  difficulty: Difficulty;
  /** Selected GLB prop for `prop` deployables. */
  prop: PropId;
  /** Quarter-turn rotation (0-3) for the next placement. */
  rotation: number;
}

/** One placed voxel piece. `x/y/z` are integer grid-cell coordinates. */
export interface BlockData {
  x: number;
  y: number;
  z: number;
  shape: PieceShape;
  color: number;
  rotation: number;
}

/** One placed entity. `x/z` are grid cells; `y` is the cell it stands on. */
export interface DeployableData {
  id: string;
  kind: DeployableKind;
  x: number;
  y: number;
  z: number;
  rotation: number;
  /** Armed weapon for `npc` deployables. */
  weapon?: WeaponId;
  /** Strength tier for `npc` deployables in a custom dungeon. */
  difficulty?: Difficulty;
  /** Which GLB prop to render for `prop` deployables. */
  prop?: PropId;
  /**
   * Continuous world-space position override set by the Select tool's move gizmo.
   * When all three are present they take precedence over the cell-derived position
   * (`x+0.5`, surface Y, `z+0.5`); when absent the entity snaps to its grid cell.
   */
  px?: number;
  py?: number;
  pz?: number;
  /** Free Y-rotation (radians) from the rotate gizmo; overrides quarter-turn `rotation`. */
  yaw?: number;
  /** Uniform scale from the scale gizmo (default 1). */
  scale?: number;
}

/** One selectable row in the Voxel Editor hierarchy. */
export interface DeployableNode {
  id: string;
  kind: DeployableKind;
  label: string;
  selected: boolean;
}

/** A serialized map (blocks + deployables + dungeon flag). */
export interface VoxelMap {
  version: number;
  dungeon: boolean;
  blocks: BlockData[];
  deployables: DeployableData[];
}

/** Live counts pushed to the React HUD. */
export interface EditorStats {
  blocks: number;
  npcs: number;
  bags: number;
  props: number;
  hasStart: boolean;
  dungeon: boolean;
}

export const VOXEL_MAP_VERSION = 1;

/** Difficulty -> ring colour (and a relative scale for the NPC body). */
export const DIFFICULTY_COLOR: Record<Difficulty, number> = {
  easy: 0x57d977,
  normal: 0x4fb0ff,
  hard: 0xffb24d,
  elite: 0xff5470,
};

export const DIFFICULTY_SCALE: Record<Difficulty, number> = {
  easy: 0.9,
  normal: 1,
  hard: 1.12,
  elite: 1.28,
};

/** Difficulty -> spawned-combatant max health when a map is played. */
export const DIFFICULTY_HEALTH: Record<Difficulty, number> = {
  easy: 70,
  normal: 100,
  hard: 150,
  elite: 220,
};

/** Difficulty -> outgoing-damage multiplier for a spawned combatant. */
export const DIFFICULTY_DAMAGE: Record<Difficulty, number> = {
  easy: 0.7,
  normal: 1,
  hard: 1.35,
  elite: 1.7,
};

/** Per-weapon accent colour for the NPC's held-weapon proxy. */
export const WEAPON_COLOR: Record<WeaponId, number> = {
  none: 0x9fb6ff,
  sword: 0xd7e2ff,
  gunblade: 0xc8d0e0,
  greatsword: 0x9fd0ff,
  axe: 0xffb27a,
  dagger: 0xc7ffe5,
  spear: 0xffe08a,
  hammer: 0xff9d6b,
  mace: 0xffc27a,
  greataxe: 0xff8f5a,
  hammer2h: 0xff8a55,
  bow: 0x9affc0,
  staff: 0xc79bff,
  staffFire: 0xff6a1e,
  staffIce: 0x9fdcff,
  staffStorm: 0xffe14d,
  staffNature: 0x6ee36e,
  staffHoly: 0xffe08a,
  staffArcane: 0xb15cff,
  pistol: 0xc0c8d4,
  rifle: 0x8fb6ff,
  "hunter-rifle": 0x9fb0c8,
  javelin: 0xffe08a,
  shield: 0xffd27a,
};
