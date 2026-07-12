/**
 * Minecraft-style modular equipment slots + armor set catalog.
 *
 * Minecraft equips armor in four body slots (head / chest / legs / feet), each
 * piece independently swappable, with a full "set" as a convenience that fills
 * all four. Grudge mirrors that model:
 *
 * - {@link ArmorSlot} — the four body slots (+ display-only stand)
 * - {@link ArmorPiece} — one equippable piece for one slot
 * - {@link ArmorSet} — convenience pack that fills head+chest+legs+feet
 *
 * The realistic Minecraft armor GLB in `public/models/armor/` is a **display
 * stand** (static meshes per material set, no skin). Best practice:
 * 1. Use it as the **armor rack / mannequin** for loadout preview (like MC armor stands).
 * 2. Wire **slot state** in the equipment UI so loadouts are data-driven.
 * 3. Future worn form: attach per-slot meshes (or texture layers) to character bones —
 *    same slot IDs; only the render path changes.
 */

/** Body equipment slots — matches Minecraft armor inventory order. */
export type ArmorSlot = "head" | "chest" | "legs" | "feet";

export const ARMOR_SLOTS: readonly ArmorSlot[] = ["head", "chest", "legs", "feet"] as const;

export type ArmorMaterial =
  | "leather"
  | "iron"
  | "gold"
  | "magic"
  | "chain"
  | "diamond"
  | "netherite"
  | "custom";

export interface ArmorPiece {
  id: string;
  label: string;
  slot: ArmorSlot;
  material: ArmorMaterial;
  /** Optional defense points (Minecraft-style; 0 = cosmetic). */
  defense?: number;
  /** Scene-graph node name(s) in the stand GLB that represent this piece/set. */
  standNodes?: string[];
  /** Future: path to a worn mesh GLB for bone-attach. */
  wornFile?: string;
}

export interface ArmorSet {
  id: string;
  label: string;
  material: ArmorMaterial;
  /** Short blurb for UI. */
  description: string;
  /** Defense total when the full set is worn (sum of pieces). */
  defense: number;
  /**
   * Root node name in `models/armor/mc-armor-stand.glb` for this full set
   * (e.g. "Gold", "Iron"). Toggle visibility like Grudge gear presets.
   */
  standNode: string;
  /** Piece ids that compose the set (head, chest, legs, feet). */
  pieces: Record<ArmorSlot, string>;
}

/** Current equipped loadout — null slot = empty (like MC bare skin). */
export type ArmorLoadout = Partial<Record<ArmorSlot, string | null>>;

/** Display / mannequin asset (armor stand showcase). */
export const ARMOR_STAND_FILE = "models/armor/mc-armor-stand.glb";

/**
 * Node names in the showcase GLB that are props, not equippable armor.
 * Hide or keep for mannequin context depending on preview mode.
 */
/** Prop meshes after gltf-transform flatten (wood stand + font). */
export const ARMOR_STAND_PROPS = ["Stand_Woden_Stand_0", "Font_Font_0"] as const;

/**
 * Equippable set mesh node names in the optimized stand GLB.
 * (Source groups Gold/Iron/… were flattened to Mesh_Material_0 names.)
 */
export const ARMOR_STAND_SET_NODES = [
  "Gold_Gold_0",
  "Iron_Iron_0",
  "Leather_1_Leather_1_0",
  "Leather_2_Leather_2_0",
  "Magic_1_Magic_1_0",
  "Magic_2_Magic_2_0",
] as const;
