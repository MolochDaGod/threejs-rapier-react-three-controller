// Race asset catalog — GOLDEN play mesh = Toon RTS GLB (grudge6-cdn-ssot).
// Author FBX / races bake are compare-only — never the Danger Room play default.
// Paths resolve via assetBase → https://assets.grudge-studio.com

export type RaceId =
  | "barbarians"
  | "dwarves"
  | "high-elves"
  | "orcs"
  | "undead"
  | "western-kingdoms";

/** Fleet / CDN race id used by loadRaceKit parity (`human`…`undead`). */
export type FleetRaceId = "human" | "barbarian" | "elf" | "dwarf" | "orc" | "undead";

export interface RaceAsset {
  id: RaceId;
  /** CDN kit id for Toon RTS GLB filename. */
  fleetId: FleetRaceId;
  name: string;
  abbr: string;
  color: string;
  /**
   * GOLDEN play mesh (Toon RTS pack). Absolute CDN URL so we never depend on
   * wrong `/assets/...` FBX mirrors.
   */
  modelUrl: string;
  /**
   * Atlas only for FBX / broken-embed fallback — NEVER force-bind on good Toon.
   * Verified paths: textures/grudge6/{folder}/…
   */
  textureUrl: string;
  /** Play source tag stamped on warlordsPlayContract. */
  playSource: "toonRts";
}

const CDN = "https://assets.grudge-studio.com";
const TOON = (id: FleetRaceId) =>
  `${CDN}/asset-packs/toon-rts-characters/glb/characters/${id}.glb`;

export const RACE_ASSETS: Record<RaceId, RaceAsset> = {
  barbarians: {
    id: "barbarians",
    fleetId: "barbarian",
    name: "Barbarians",
    abbr: "BRB",
    color: "#c2410c",
    modelUrl: TOON("barbarian"),
    textureUrl: "/textures/grudge6/barbarians/BRB_StandardUnits_texture.webp",
    playSource: "toonRts",
  },
  dwarves: {
    id: "dwarves",
    fleetId: "dwarf",
    name: "Dwarves",
    abbr: "DWF",
    color: "#b45309",
    modelUrl: TOON("dwarf"),
    textureUrl: "/textures/grudge6/dwarves/DWF_Standard_Units.webp",
    playSource: "toonRts",
  },
  "high-elves": {
    id: "high-elves",
    fleetId: "elf",
    name: "High Elves",
    abbr: "ELF",
    color: "#0891b2",
    modelUrl: TOON("elf"),
    textureUrl: "/textures/grudge6/elves/ELF_HighElves_Texture.webp",
    playSource: "toonRts",
  },
  orcs: {
    id: "orcs",
    fleetId: "orc",
    name: "Orcs",
    abbr: "ORC",
    color: "#15803d",
    modelUrl: TOON("orc"),
    textureUrl: "/textures/grudge6/orcs/ORC_StandardUnits.webp",
    playSource: "toonRts",
  },
  undead: {
    id: "undead",
    fleetId: "undead",
    name: "Undead",
    abbr: "UD",
    color: "#7c3aed",
    modelUrl: TOON("undead"),
    textureUrl: "/textures/grudge6/undead/UD_Standard_Units.webp",
    playSource: "toonRts",
  },
  "western-kingdoms": {
    id: "western-kingdoms",
    fleetId: "human",
    name: "W. Kingdoms",
    abbr: "WK",
    color: "#1d4ed8",
    modelUrl: TOON("human"),
    textureUrl: "/textures/grudge6/western-kingdoms/WK_Standard_Units.webp",
    playSource: "toonRts",
  },
};

export const RACE_IDS: RaceId[] = [
  "barbarians",
  "dwarves",
  "high-elves",
  "orcs",
  "undead",
  "western-kingdoms",
];

/** Map fleet CDN race id → Animator RaceId. */
export function fleetRaceToRaceId(fleet: string): RaceId | null {
  const n = String(fleet || "")
    .trim()
    .toLowerCase();
  const map: Record<string, RaceId> = {
    human: "western-kingdoms",
    wk: "western-kingdoms",
    barbarian: "barbarians",
    barbarians: "barbarians",
    brb: "barbarians",
    elf: "high-elves",
    "high-elves": "high-elves",
    dwarf: "dwarves",
    dwarves: "dwarves",
    orc: "orcs",
    orcs: "orcs",
    undead: "undead",
  };
  return map[n] ?? null;
}
