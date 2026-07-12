/**
 * Selectable gameplay maps loaded behind the Danger Room door (the {@link
 * Dungeon} system). Each entry is just a GLB level file plus a label/blurb for
 * the picker; the Dungeon loader auto-scales the model and bakes its own
 * colliders + navmesh, so any reasonably-sized scene GLB can be dropped in here.
 *
 * The choice is persisted per browser session (mirroring {@link RoomPresets}) so
 * the next dungeon entry reuses it. `enterDungeon` reads {@link loadDungeonMap}
 * at entry time — no extra Studio↔App plumbing needed.
 */

export type DungeonMapId = "default" | "chicken-gun-town" | "breeze-island";

export interface DungeonMap {
  id: DungeonMapId;
  name: string;
  /** One-line blurb shown in the picker. */
  blurb: string;
  /** GLB file under `public/` (resolved through `asset()`). */
  file: string;
  /**
   * Extra scale multiplier applied AFTER the Dungeon loader's auto-fit, for maps
   * that should read much larger than the default playable footprint (e.g. an
   * open town sized for a 2m character rather than a tight arena). Defaults to 1
   * (auto-fit only). This is a single tunable knob — nudge it up/down to taste.
   */
  scale?: number;
}

export const DUNGEON_MAPS: Record<DungeonMapId, DungeonMap> = {
  default: {
    id: "default",
    name: "Forge Depths",
    blurb: "The original dungeon level — tight corridors and a sealed boss pit.",
    file: "models/minecraft-kit.glb",
  },
  "chicken-gun-town": {
    id: "chicken-gun-town",
    name: "Chicken Gun Town",
    blurb: "Open small-town test map — streets and buildings for ranged duels.",
    file: "models/chicken-gun-town.glb",
    // Blown up ~100x over the auto-fit so the streets/buildings read at true
    // human scale for a 2m explorer (an open town, not a pocket arena).
    scale: 100,
  },
  "breeze-island": {
    id: "breeze-island",
    name: "Breeze Island",
    blurb: "An open voxel island — rolling terrain, cliffs and coves to roam.",
    file: "models/worlds/breeze-island.glb",
    // Raw model is ~500u across (>300 → auto-fit shrinks x0.01 to ~5u); scale it
    // back up to a ~300u walkable footprint for the 2m explorer.
    scale: 60,
  },
};

export const DUNGEON_MAP_LIST: DungeonMap[] = [
  DUNGEON_MAPS.default,
  DUNGEON_MAPS["chicken-gun-town"],
  DUNGEON_MAPS["breeze-island"],
];

const STORAGE_KEY = "dangerroom:dungeon-map";

/** Narrow an arbitrary string to a known map id (or null when unknown). */
export function asDungeonMapId(v: string | null | undefined): DungeonMapId | null {
  return v === "default" || v === "chicken-gun-town" || v === "breeze-island" ? v : null;
}

/** Read the session-persisted map choice (defaults to the original level). */
export function loadDungeonMap(): DungeonMapId {
  try {
    return asDungeonMapId(sessionStorage.getItem(STORAGE_KEY)) ?? "default";
  } catch {
    return "default";
  }
}

/** Persist the map choice for the current browser session. */
export function saveDungeonMap(id: DungeonMapId): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* no-op */
  }
}
