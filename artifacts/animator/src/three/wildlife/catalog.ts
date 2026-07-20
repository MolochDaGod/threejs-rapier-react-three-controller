/**
 * Quirky Series free animals pack — species catalog.
 *
 * Source GLB: `public/models/wildlife/quirky-animals.glb`
 * (from D:\Games\Models\quirky_series_-_free_animals_pack.glb)
 *
 * Eight species; each has a `_LOD1` mesh root under the pack's RootNode.
 * A single packed "Scene" animation drives all rigs; we filter tracks per instance.
 */

export type AnimalHabitat = "land" | "aerial" | "aquatic";
export type AnimalTemperament = "skittish" | "docile" | "aggressive" | "predator";

export type AnimalSpeciesId =
  | "colobus"
  | "gecko"
  | "herring"
  | "inkfish"
  | "muskrat"
  | "pudu"
  | "sparrow"
  | "taipan";

export interface HarvestYield {
  /** Inventory item id (matches bag / crafting naming). */
  itemId: string;
  label: string;
  /** Inclusive min/max rolls. */
  min: number;
  max: number;
}

export interface AnimalSpeciesDef {
  id: AnimalSpeciesId;
  label: string;
  /** Exact node name of the first LOD mesh in the pack. */
  rootNode: string;
  habitat: AnimalHabitat;
  temperament: AnimalTemperament;
  /** Target body height (m) after normalize. */
  heightM: number;
  /** Max health. */
  health: number;
  /** Wander / flee speed (m/s). */
  walkSpeed: number;
  fleeSpeed: number;
  /** Detection radius for player (m). */
  detectRange: number;
  /** Prefer this many when auto-spawning land packs. */
  spawnWeight: number;
  meat: HarvestYield;
  leather: HarvestYield;
  /** Optional third product (scales, feathers, venom sacs…). */
  extra?: HarvestYield;
}

/** Packed multi-animal GLB under public/. */
export const WILDLIFE_PACK_FILE = "models/wildlife/quirky-animals.glb";

/**
 * Flesh corpse window (s) for skin/butcher before auto-skeleton.
 * After skin OR timeout, body is replaced by Skeletons_Free residual
 * (see `corpse/SkeletonCorpse.ts`); skeleton then lingers ~90s.
 */
export const CORPSE_LIFETIME_S = 120;

/** Max simultaneous animals (bounds cost). */
export const WILDLIFE_MAX = 24;

export const ANIMAL_SPECIES: readonly AnimalSpeciesDef[] = [
  {
    id: "colobus",
    label: "Colobus Monkey",
    rootNode: "Colobus_LOD1",
    habitat: "land",
    temperament: "skittish",
    heightM: 0.85,
    health: 35,
    walkSpeed: 1.6,
    fleeSpeed: 4.2,
    detectRange: 9,
    spawnWeight: 2,
    meat: { itemId: "meat_game", label: "Monkey Meat", min: 1, max: 2 },
    leather: { itemId: "leather_hide", label: "Primate Hide", min: 1, max: 1 },
  },
  {
    id: "gecko",
    label: "Gecko",
    rootNode: "Gecko_LOD1",
    habitat: "land",
    temperament: "docile",
    heightM: 0.25,
    health: 12,
    walkSpeed: 0.9,
    fleeSpeed: 2.4,
    detectRange: 5,
    spawnWeight: 3,
    meat: { itemId: "meat_tiny", label: "Lizard Meat", min: 1, max: 1 },
    leather: { itemId: "leather_scale", label: "Gecko Scale", min: 1, max: 2 },
  },
  {
    id: "herring",
    label: "Herring",
    rootNode: "Herring_LOD1",
    habitat: "aquatic",
    temperament: "skittish",
    heightM: 0.2,
    health: 8,
    walkSpeed: 1.2,
    fleeSpeed: 2.8,
    detectRange: 6,
    spawnWeight: 0,
    meat: { itemId: "meat_fish", label: "Fish Meat", min: 1, max: 2 },
    leather: { itemId: "leather_scale", label: "Fish Scale", min: 0, max: 1 },
  },
  {
    id: "inkfish",
    label: "Inkfish",
    rootNode: "Inkfish_LOD1",
    habitat: "aquatic",
    temperament: "docile",
    heightM: 0.35,
    health: 18,
    walkSpeed: 1.0,
    fleeSpeed: 2.2,
    detectRange: 7,
    spawnWeight: 0,
    meat: { itemId: "meat_fish", label: "Cephalopod Meat", min: 1, max: 2 },
    leather: { itemId: "leather_ink", label: "Ink Sac Hide", min: 1, max: 1 },
    extra: { itemId: "reagent_ink", label: "Ink Sac", min: 1, max: 1 },
  },
  {
    id: "muskrat",
    label: "Muskrat",
    rootNode: "Muskrat_LOD1",
    habitat: "land",
    temperament: "docile",
    heightM: 0.4,
    health: 22,
    walkSpeed: 1.3,
    fleeSpeed: 3.5,
    detectRange: 7,
    spawnWeight: 3,
    meat: { itemId: "meat_game", label: "Muskrat Meat", min: 1, max: 2 },
    leather: { itemId: "leather_pelt", label: "Muskrat Pelt", min: 1, max: 1 },
  },
  {
    id: "pudu",
    label: "Pudu Deer",
    rootNode: "Pudu_LOD1",
    habitat: "land",
    temperament: "skittish",
    heightM: 0.55,
    health: 40,
    walkSpeed: 1.8,
    fleeSpeed: 5.0,
    detectRange: 11,
    spawnWeight: 2,
    meat: { itemId: "meat_venison", label: "Venison", min: 2, max: 3 },
    leather: { itemId: "leather_hide", label: "Deer Hide", min: 1, max: 2 },
  },
  {
    id: "sparrow",
    label: "Sparrow",
    rootNode: "Sparrow_LOD1.001",
    habitat: "aerial",
    temperament: "skittish",
    heightM: 0.18,
    health: 6,
    walkSpeed: 1.4,
    fleeSpeed: 4.5,
    detectRange: 8,
    spawnWeight: 2,
    meat: { itemId: "meat_tiny", label: "Bird Meat", min: 1, max: 1 },
    leather: { itemId: "leather_feather", label: "Feathers", min: 1, max: 3 },
  },
  {
    id: "taipan",
    label: "Taipan",
    rootNode: "Taipan_LOD1",
    habitat: "land",
    temperament: "predator",
    heightM: 0.2,
    health: 28,
    walkSpeed: 1.5,
    fleeSpeed: 3.8,
    detectRange: 8,
    spawnWeight: 1,
    meat: { itemId: "meat_game", label: "Snake Meat", min: 1, max: 1 },
    leather: { itemId: "leather_scale", label: "Snake Skin", min: 1, max: 2 },
    extra: { itemId: "reagent_venom", label: "Venom Sac", min: 0, max: 1 },
  },
] as const;

export function getSpecies(id: AnimalSpeciesId): AnimalSpeciesDef {
  const s = ANIMAL_SPECIES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown animal species: ${id}`);
  return s;
}

/** Land (+ aerial ground-hop) species for Danger Room auto-spawn. */
export function landSpawnSpecies(): AnimalSpeciesDef[] {
  return ANIMAL_SPECIES.filter((s) => s.habitat !== "aquatic" && s.spawnWeight > 0);
}

/** Roll harvest stacks for a full butcher (meat + leather + optional extra). */
export function rollButcherYield(species: AnimalSpeciesDef, rng = Math.random): { itemId: string; label: string; qty: number }[] {
  const out: { itemId: string; label: string; qty: number }[] = [];
  for (const y of [species.meat, species.leather, species.extra].filter(Boolean) as HarvestYield[]) {
    const qty = y.min + Math.floor(rng() * (y.max - y.min + 1));
    if (qty > 0) out.push({ itemId: y.itemId, label: y.label, qty });
  }
  return out;
}
