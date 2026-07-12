/**
 * Armor catalog — realistic Minecraft-style sets derived from the Fin Armor
 * showcase GLB (`models/armor/mc-armor-stand.glb`).
 *
 * Optimized stand mesh nodes (gltf-transform flatten):
 *   Gold_Gold_0, Iron_Iron_0, Leather_1_*, Leather_2_*, Magic_1_*, Magic_2_*
 *
 * Each set is a **full suit** on the mannequin today (one mesh group per material).
 * Piece rows below still use Minecraft's four slots so the UI + save format match
 * real modular equipment; when worn meshes land, swap `standNode` visibility for
 * bone-attached `wornFile` without changing loadout IDs.
 */

import type { ArmorPiece, ArmorSet, ArmorSlot, ArmorLoadout } from "./types";
import { ARMOR_SLOTS } from "./types";

function piecesForSet(
  setId: string,
  label: string,
  material: ArmorPiece["material"],
  standNode: string,
  defensePerSlot: Record<ArmorSlot, number>,
): ArmorPiece[] {
  const slotLabel: Record<ArmorSlot, string> = {
    head: "Helmet",
    chest: "Chestplate",
    legs: "Leggings",
    feet: "Boots",
  };
  return ARMOR_SLOTS.map((slot) => ({
    id: `${setId}-${slot}`,
    label: `${label} ${slotLabel[slot]}`,
    slot,
    material,
    defense: defensePerSlot[slot],
    // Full-set mesh until split; all four pieces share the stand node.
    standNodes: [standNode],
  }));
}

/** Minecraft-ish defense totals (rough, not vanilla tables). */
const DEF = {
  leather: { head: 1, chest: 3, legs: 2, feet: 1 },
  iron: { head: 2, chest: 6, legs: 5, feet: 2 },
  gold: { head: 2, chest: 5, legs: 3, feet: 1 },
  magic: { head: 3, chest: 7, legs: 5, feet: 3 },
} as const;

export const ARMOR_PIECES: ArmorPiece[] = [
  ...piecesForSet("leather", "Leather", "leather", "Leather_1_Leather_1_0", DEF.leather),
  ...piecesForSet("leather-dark", "Dark Leather", "leather", "Leather_2_Leather_2_0", DEF.leather),
  ...piecesForSet("iron", "Iron", "iron", "Iron_Iron_0", DEF.iron),
  ...piecesForSet("gold", "Gold", "gold", "Gold_Gold_0", DEF.gold),
  ...piecesForSet("magic-arcane", "Arcane", "magic", "Magic_1_Magic_1_0", DEF.magic),
  ...piecesForSet("magic-void", "Void", "magic", "Magic_2_Magic_2_0", DEF.magic),
];

export const ARMOR_SETS: ArmorSet[] = [
  {
    id: "leather",
    label: "Leather",
    material: "leather",
    description: "Light hide set — low defense, classic starter look.",
    defense: 7,
    standNode: "Leather_1_Leather_1_0",
    pieces: {
      head: "leather-head",
      chest: "leather-chest",
      legs: "leather-legs",
      feet: "leather-feet",
    },
  },
  {
    id: "leather-dark",
    label: "Dark Leather",
    material: "leather",
    description: "Darker leather variant from the showcase pack.",
    defense: 7,
    standNode: "Leather_2_Leather_2_0",
    pieces: {
      head: "leather-dark-head",
      chest: "leather-dark-chest",
      legs: "leather-dark-legs",
      feet: "leather-dark-feet",
    },
  },
  {
    id: "iron",
    label: "Iron",
    material: "iron",
    description: "Solid plate — workhorse mid-tier defense.",
    defense: 15,
    standNode: "Iron_Iron_0",
    pieces: {
      head: "iron-head",
      chest: "iron-chest",
      legs: "iron-legs",
      feet: "iron-feet",
    },
  },
  {
    id: "gold",
    label: "Gold",
    material: "gold",
    description: "Ornate gold plate — flashy, moderate protection.",
    defense: 11,
    standNode: "Gold_Gold_0",
    pieces: {
      head: "gold-head",
      chest: "gold-chest",
      legs: "gold-legs",
      feet: "gold-feet",
    },
  },
  {
    id: "magic-arcane",
    label: "Arcane",
    material: "magic",
    description: "Enchanted arcane suit — high defense showcase set.",
    defense: 18,
    standNode: "Magic_1_Magic_1_0",
    pieces: {
      head: "magic-arcane-head",
      chest: "magic-arcane-chest",
      legs: "magic-arcane-legs",
      feet: "magic-arcane-feet",
    },
  },
  {
    id: "magic-void",
    label: "Void",
    material: "magic",
    description: "Void-touched magic plate — alternate enchanted look.",
    defense: 18,
    standNode: "Magic_2_Magic_2_0",
    pieces: {
      head: "magic-void-head",
      chest: "magic-void-chest",
      legs: "magic-void-legs",
      feet: "magic-void-feet",
    },
  },
];

export function getArmorPiece(id: string | null | undefined): ArmorPiece | undefined {
  if (!id) return undefined;
  return ARMOR_PIECES.find((p) => p.id === id);
}

export function getArmorSet(id: string | null | undefined): ArmorSet | undefined {
  if (!id) return undefined;
  return ARMOR_SETS.find((s) => s.id === id);
}

/** Empty loadout (all slots bare). */
export function emptyArmorLoadout(): ArmorLoadout {
  return { head: null, chest: null, legs: null, feet: null };
}

/** Equip an entire set into all four slots (Minecraft "shift-click full set" feel). */
export function loadoutFromSet(setId: string): ArmorLoadout {
  const set = getArmorSet(setId);
  if (!set) return emptyArmorLoadout();
  return { ...set.pieces };
}

/** Sum defense of equipped pieces. */
export function loadoutDefense(loadout: ArmorLoadout): number {
  let n = 0;
  for (const slot of ARMOR_SLOTS) {
    const piece = getArmorPiece(loadout[slot] ?? null);
    if (piece?.defense) n += piece.defense;
  }
  return n;
}

/**
 * Which stand-root nodes should be visible for this loadout.
 * While pieces share a full-suit mesh, we show the set node if any piece of that
 * set is equipped (and prefer a single full set when all four match).
 */
export function standNodesForLoadout(loadout: ArmorLoadout): string[] {
  // Prefer full-set match
  for (const set of ARMOR_SETS) {
    const full = ARMOR_SLOTS.every((slot) => loadout[slot] === set.pieces[slot]);
    if (full) return [set.standNode];
  }
  const nodes = new Set<string>();
  for (const slot of ARMOR_SLOTS) {
    const piece = getArmorPiece(loadout[slot] ?? null);
    for (const n of piece?.standNodes ?? []) nodes.add(n);
  }
  return [...nodes];
}

/** LocalStorage key for the player's armor loadout. */
export const ARMOR_LOADOUT_STORAGE_KEY = "animator.armorLoadout.v1";

export function loadArmorLoadoutFromStorage(): ArmorLoadout {
  try {
    const raw = localStorage.getItem(ARMOR_LOADOUT_STORAGE_KEY);
    if (!raw) return emptyArmorLoadout();
    const parsed = JSON.parse(raw) as ArmorLoadout;
    const out = emptyArmorLoadout();
    for (const slot of ARMOR_SLOTS) {
      const id = parsed[slot];
      out[slot] = id && getArmorPiece(id) ? id : null;
    }
    return out;
  } catch {
    return emptyArmorLoadout();
  }
}

export function saveArmorLoadoutToStorage(loadout: ArmorLoadout): void {
  try {
    localStorage.setItem(ARMOR_LOADOUT_STORAGE_KEY, JSON.stringify(loadout));
  } catch {
    /* private mode / quota */
  }
}
